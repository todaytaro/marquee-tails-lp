import { NextResponse } from "next/server";
import { OrderStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { transitionOrder, TransitionError } from "@/lib/orders";
import { kickLoraTraining } from "@/lib/stills-pipeline";

/**
 * Director's Cut "Gate 0" — the customer approves the treatment.
 *
 * POST { orderId, approveToken }
 *
 * Guards, in order:
 * 1. approveToken must match the order (link-based auth, no login).
 * 2. Status must be exactly AWAITING_TREATMENT_APPROVAL — enforced atomically
 *    by transitionOrder, so a double-submit cannot kick the pipeline twice.
 *
 * On approval, hands off to the EXISTING stills pipeline (unchanged from
 * here on): AWAITING_TREATMENT_APPROVAL -> IMAGE_GENERATING, then
 * kickLoraTraining (LORA-STORYBOARD-SPEC.md §2.7 — trains first, then chains
 * into stills once training is done or has given up), with the same
 * compensating-revert pattern as submit-photos / approve-storyboard (kick
 * failure reverts the transition).
 */
export async function POST(req: Request) {
  let body: { orderId?: string; approveToken?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const { orderId, approveToken } = body;
  if (!orderId || !approveToken) {
    return NextResponse.json(
      { ok: false, error: "orderId and approveToken are required." },
      { status: 400 }
    );
  }

  const order = await prisma.order.findUnique({ where: { id: orderId } });
  // Same response for "not found" and "bad token" — don't leak which.
  if (!order || order.approveToken !== approveToken) {
    return NextResponse.json({ ok: false, error: "Order not found." }, { status: 404 });
  }

  try {
    const updated = await transitionOrder(
      order.id,
      OrderStatus.AWAITING_TREATMENT_APPROVAL,
      OrderStatus.IMAGE_GENERATING,
      "customer",
      {},
      "Gate 0: customer approved the treatment"
    );

    try {
      await kickLoraTraining(updated);
    } catch (kickErr) {
      console.error(`[approve-treatment] lora/stills kick failed, reverting order=${order.id}`, kickErr);
      await transitionOrder(
        order.id,
        OrderStatus.IMAGE_GENERATING,
        OrderStatus.AWAITING_TREATMENT_APPROVAL,
        "system",
        {},
        "stills kick failed — reverted for retry"
      );
      return NextResponse.json(
        { ok: false, error: "We couldn't start on your stills just now. Please try again in a moment." },
        { status: 503 }
      );
    }

    return NextResponse.json({ ok: true, status: updated.status });
  } catch (err) {
    if (err instanceof TransitionError) {
      return NextResponse.json(
        { ok: false, error: `Order is not awaiting treatment approval (current: ${order.status}).` },
        { status: 409 }
      );
    }
    console.error("[approve-treatment]", err);
    return NextResponse.json(
      { ok: false, error: "Something went wrong on our end." },
      { status: 500 }
    );
  }
}

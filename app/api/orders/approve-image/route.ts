import { NextResponse } from "next/server";
import { OrderStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { transitionOrder, TransitionError } from "@/lib/orders";
import { kickFilmGeneration } from "@/lib/film-pipeline";

/**
 * Gate 1 — the customer approves one concept still.
 *
 * POST { orderId, approveToken, selectedImageUrl }
 *
 * Guards, in order:
 * 1. approveToken must match the order (link-based auth, no login).
 * 2. selectedImageUrl must be one of the stills WE generated for this order
 *    (customers cannot inject arbitrary URLs into the video pipeline).
 * 3. Status must be exactly AWAITING_CUSTOMER_APPROVAL — enforced atomically
 *    by transitionOrder, so a double-click cannot kick the pipeline twice.
 */
export async function POST(req: Request) {
  let body: {
    orderId?: string;
    approveToken?: string;
    selectedImageUrl?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body." },
      { status: 400 }
    );
  }

  const { orderId, approveToken, selectedImageUrl } = body;
  if (!orderId || !approveToken || !selectedImageUrl) {
    return NextResponse.json(
      { ok: false, error: "orderId, approveToken and selectedImageUrl are required." },
      { status: 400 }
    );
  }

  const order = await prisma.order.findUnique({ where: { id: orderId } });
  // Same response for "not found" and "bad token" — don't leak which.
  if (!order || order.approveToken !== approveToken) {
    return NextResponse.json(
      { ok: false, error: "Order not found." },
      { status: 404 }
    );
  }

  if (!order.conceptImageUrls.includes(selectedImageUrl)) {
    return NextResponse.json(
      { ok: false, error: "selectedImageUrl is not one of this order's concept images." },
      { status: 400 }
    );
  }

  try {
    const updated = await transitionOrder(
      order.id,
      OrderStatus.AWAITING_CUSTOMER_APPROVAL,
      OrderStatus.VIDEO_GENERATING,
      "customer",
      { selectedImageUrl },
      "Gate 1: customer approved concept still"
    );

    // Side effect fires only after the transition is committed. If the kick
    // fails (provider down, balance exhausted), compensate: revert to
    // AWAITING_CUSTOMER_APPROVAL so the order is never stranded waiting for
    // a video that will never come, and let the customer retry.
    try {
      await kickFilmGeneration(updated);
    } catch (kickErr) {
      console.error(`[approve-image] pipeline kick failed, reverting order=${order.id}`, kickErr);
      await transitionOrder(
        order.id,
        OrderStatus.VIDEO_GENERATING,
        OrderStatus.AWAITING_CUSTOMER_APPROVAL,
        "system",
        {},
        "pipeline kick failed — reverted for retry"
      );
      return NextResponse.json(
        { ok: false, error: "We couldn't start production just now. Please try again in a moment." },
        { status: 503 }
      );
    }

    return NextResponse.json({ ok: true, status: updated.status });
  } catch (err) {
    if (err instanceof TransitionError) {
      return NextResponse.json(
        { ok: false, error: `Order is not awaiting customer approval (current: ${order.status}).` },
        { status: 409 }
      );
    }
    console.error("[approve-image]", err);
    return NextResponse.json(
      { ok: false, error: "Something went wrong on our end." },
      { status: 500 }
    );
  }
}

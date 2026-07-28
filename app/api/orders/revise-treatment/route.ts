import { NextResponse } from "next/server";
import { OrderStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { transitionOrder, TransitionError } from "@/lib/orders";
import { generateTreatment, type WorldBundle } from "@/lib/claude-script";

/**
 * Director's Cut "Gate 0" — the customer asks for a treatment revision.
 *
 * POST { orderId, approveToken, instruction }
 *
 * Framed to the customer as "unlimited free text revisions"; REVISION_CAP is
 * an internal anti-abuse guard only, never a customer-facing limit.
 *
 * AWAITING_TREATMENT_APPROVAL -> TREATMENT_GENERATING (increment
 * treatmentRevisionCount) -> generateTreatment() runs INLINE with the prior
 * bundle + instruction -> back to AWAITING_TREATMENT_APPROVAL either way
 * (fresh treatment on success, unchanged treatment + friendly reason on
 * rejection/error) — same compensating-revert pattern as submit-photos.
 */

// This handler runs an inline Claude call (generateTreatment). Give it headroom
// so a slow response can't be killed mid-flight and strand the order in
// TREATMENT_GENERATING (a killed process skips the compensating revert below).
export const maxDuration = 60;

const REVISION_CAP = 20;
const INSTRUCTION_MAX = 1000;

export async function POST(req: Request) {
  let body: { orderId?: string; approveToken?: string; instruction?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const { orderId, approveToken } = body;
  const instruction = String(body.instruction ?? "").trim().slice(0, INSTRUCTION_MAX);
  if (!orderId || !approveToken) {
    return NextResponse.json(
      { ok: false, error: "orderId and approveToken are required." },
      { status: 400 }
    );
  }
  if (!instruction) {
    return NextResponse.json({ ok: false, error: "Please describe what should change." }, { status: 400 });
  }

  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order || order.approveToken !== approveToken) {
    return NextResponse.json({ ok: false, error: "Order not found." }, { status: 404 });
  }

  // Internal abuse cap only — the customer-facing framing is "unlimited".
  if (order.treatmentRevisionCount >= REVISION_CAP) {
    return NextResponse.json(
      {
        ok: false,
        error: "You've made a lot of changes already — let's hop on email and get this just right. Reply to any of our messages.",
      },
      { status: 429 }
    );
  }

  const petName = order.petName ?? "Your Star";
  const prior = (order.generatedScript as unknown as WorldBundle | null) ?? undefined;

  try {
    await transitionOrder(
      order.id,
      OrderStatus.AWAITING_TREATMENT_APPROVAL,
      OrderStatus.TREATMENT_GENERATING,
      "customer",
      { treatmentRevisionCount: order.treatmentRevisionCount + 1 },
      "Gate 0: customer requested treatment changes"
    );

    try {
      const result = await generateTreatment({
        brief: order.customBrief ?? "",
        petName,
        revisionInstruction: instruction,
        prior,
      });

      if (result.status === "rejected") {
        await transitionOrder(
          order.id,
          OrderStatus.TREATMENT_GENERATING,
          OrderStatus.AWAITING_TREATMENT_APPROVAL,
          "system",
          {},
          `revision rejected: ${result.reason}`
        );
        return NextResponse.json({ ok: false, error: result.reason }, { status: 422 });
      }

      const revised = await transitionOrder(
        order.id,
        OrderStatus.TREATMENT_GENERATING,
        OrderStatus.AWAITING_TREATMENT_APPROVAL,
        "system",
        { generatedScript: result.bundle, treatmentText: result.treatmentText },
        "revised treatment ready"
      );
      return NextResponse.json({ ok: true, status: revised.status, treatmentText: revised.treatmentText });
    } catch (genErr) {
      console.error(`[revise-treatment] generation failed, reverting order=${order.id}`, genErr);
      await transitionOrder(
        order.id,
        OrderStatus.TREATMENT_GENERATING,
        OrderStatus.AWAITING_TREATMENT_APPROVAL,
        "system",
        {},
        "revision generation failed — kept prior treatment"
      );
      return NextResponse.json(
        { ok: false, error: "We couldn't rewrite the treatment just now. Please try again in a moment." },
        { status: 503 }
      );
    }
  } catch (err) {
    if (err instanceof TransitionError) {
      return NextResponse.json(
        { ok: false, error: `Order is not awaiting treatment approval (current: ${order.status}).` },
        { status: 409 }
      );
    }
    console.error("[revise-treatment]", err);
    return NextResponse.json(
      { ok: false, error: "Something went wrong on our end." },
      { status: 500 }
    );
  }
}

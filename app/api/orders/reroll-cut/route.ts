import { NextResponse } from "next/server";
import { OrderStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { canReroll, STORYBOARD_REROLL_CAP } from "@/lib/safety-net";
import { NUM_CUTS, normalizeStoryboard, rerollCutTakes } from "@/lib/stills-pipeline";

/**
 * Gate 1 — one free storyboard re-roll (B2-SAFETY-NET-SPEC.md §3.1).
 *
 * POST { orderId, approveToken, cutIndex }
 *
 * §1.1 pins what "re-roll" means so it can't be confused with the other two
 * "start over" levers this app has: re-shoots ONE cut's THREE takes, same
 * scene/costume/identity, NO customer instruction, fresh seeds — unlike
 * revise-treatment (Gate 0, free text, effectively unlimited) or the admin's
 * Gate-2 shot re-render (post-approval, admin-only, one take). Mixing any
 * two of those up would let one feature quietly paper over a gap in another.
 *
 * Timing: 3 fal.ai stills (each up to MAX_TAKE_REROLLS identity-gate retries)
 * — the spec's own estimate is 30-60s, the same order of magnitude as
 * revise-treatment's inline Claude call. Run SYNCHRONOUSLY rather than via
 * Trigger.dev: the customer is looking at a spinner they just clicked into
 * (not walking away for the several minutes a full stills/film run takes),
 * and revise-treatment already proves a customer-facing inline generation
 * call fits inside a Vercel function's lifetime. maxDuration below gives 2x
 * headroom over the spec's own worst-case estimate.
 */
export const maxDuration = 120;

export async function POST(req: Request) {
  let body: { orderId?: string; approveToken?: string; cutIndex?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const { orderId, approveToken } = body;
  const cutIndex = Number(body.cutIndex);
  if (!orderId || !approveToken) {
    return NextResponse.json(
      { ok: false, error: "orderId and approveToken are required." },
      { status: 400 }
    );
  }
  if (!Number.isInteger(cutIndex) || cutIndex < 0 || cutIndex >= NUM_CUTS) {
    return NextResponse.json(
      { ok: false, error: `cutIndex must be between 0 and ${NUM_CUTS - 1}.` },
      { status: 400 }
    );
  }

  const order = await prisma.order.findUnique({ where: { id: orderId } });
  // Same response for "not found" and "bad token" as every other approve-*
  // route (approve-storyboard, revise-treatment) — don't leak which.
  if (!order || order.approveToken !== approveToken) {
    return NextResponse.json({ ok: false, error: "Order not found." }, { status: 404 });
  }

  // Fast, friendly pre-check. NOT the enforcement — a plainly-wrong request
  // (preset order, wrong gate, refund already requested) fails here with a
  // specific reason before spending a DB round trip on the atomic guard
  // below, which is what actually decides.
  const preCheck = canReroll(order);
  if (!preCheck.ok) {
    return NextResponse.json({ ok: false, error: preCheck.reason }, { status: 409 });
  }
  const cut = normalizeStoryboard(order.storyboardOptions)[cutIndex];
  if (!cut) {
    return NextResponse.json(
      { ok: false, error: "This order has no storyboard for that scene yet." },
      { status: 409 }
    );
  }

  // ATOMIC reservation (§3.1 step 1) — mirrors handleAddonSession's guarded
  // updateMany (app/api/webhooks/stripe/route.ts). The WHERE clause below is
  // lib/safety-net.ts's canReroll() re-expressed as a Prisma filter: it
  // re-checks tier/refund/status/count at the moment Postgres grants this
  // request the row's lock, so two clicks or two open tabs firing at once
  // cannot both observe count=2 and both write count=3 — only the request
  // whose WHERE still matches when its turn comes gets the increment; the
  // other gets `count: 0` back and is refused below. Read-then-write could
  // not offer this: by the time it re-read, the count it checked may already
  // be stale.
  const { count } = await prisma.order.updateMany({
    where: {
      id: orderId,
      tier: "custom",
      status: OrderStatus.AWAITING_CUSTOMER_APPROVAL,
      refundRequestedAt: null,
      storyboardRerollCount: { lt: STORYBOARD_REROLL_CAP },
    },
    data: { storyboardRerollCount: { increment: 1 } },
  });

  if (count !== 1) {
    // Lost the race, or the order moved between the pre-check above and
    // here (e.g. the last re-roll was spent in another tab). Re-run the
    // same guard against fresh state for an accurate, specific reason
    // rather than a bare "try again".
    const fresh = await prisma.order.findUnique({ where: { id: orderId } });
    const result = fresh ? canReroll(fresh) : { ok: false as const, reason: "Order not found." };
    return NextResponse.json(
      { ok: false, error: result.ok ? "Please try again." : result.reason },
      { status: 409 }
    );
  }

  // Slot reserved. Re-read to learn the committed count (rerollCutTakes'
  // seed-band uniqueness depends on THIS exact, just-incremented value).
  const reserved = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });

  try {
    await rerollCutTakes(reserved, cutIndex, reserved.storyboardRerollCount);
  } catch (err) {
    // Compensating revert: a re-roll that fails outright delivered nothing,
    // so it must not permanently cost the customer one of their three — the
    // spec's "a re-roll that returns the same three images is a re-roll
    // spent and not delivered" applies even more directly to a re-roll that
    // returns NO images. Best-effort: if this second write also fails there
    // is nothing further to compensate with, but the failure response below
    // still fires either way (never silently "succeeds").
    console.error(`[reroll-cut] generation failed order=${orderId} cut=${cutIndex}, refunding the slot`, err);
    await prisma.order
      .updateMany({
        where: { id: orderId, storyboardRerollCount: reserved.storyboardRerollCount },
        data: { storyboardRerollCount: { decrement: 1 } },
      })
      .catch((revertErr) =>
        console.error(`[reroll-cut] slot refund also failed order=${orderId}`, revertErr)
      );
    return NextResponse.json(
      { ok: false, error: "We couldn't re-roll that scene just now. Please try again in a moment." },
      { status: 503 }
    );
  }

  const updated = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
  const updatedCut = normalizeStoryboard(updated.storyboardOptions)[cutIndex];
  return NextResponse.json({
    ok: true,
    rerollsRemaining: Math.max(0, STORYBOARD_REROLL_CAP - updated.storyboardRerollCount),
    // PRICING-PRODUCT-V2-SPEC.md §3.5(C): the CLEAN url must never reach the
    // browser — strip it here, same discipline as Gate1View's server-side
    // mapping for the initial page load.
    cut: { scene: updatedCut.scene, options: updatedCut.options.map((o) => o.preview) },
  });
}

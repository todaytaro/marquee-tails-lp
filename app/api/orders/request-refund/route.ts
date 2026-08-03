import { NextResponse } from "next/server";
import { OrderStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import {
  canRequestRefund,
  STORYBOARD_REROLL_CAP,
  REFUND_AMOUNT_USD,
  NONREFUNDABLE_FEE_USD,
} from "@/lib/safety-net";
import { sendRefundRequestedAlert } from "@/lib/mocks";
import { refundConfirmText } from "@/lib/refund-consent";
import { recordEvidence } from "@/lib/evidence";

/**
 * Gate 1 — the customer's refund way out (B2-SAFETY-NET-SPEC.md §4).
 *
 * POST { orderId, approveToken }
 *
 * Eligibility is a conjunction, enforced HERE server-side — the UI only
 * shows this control once storyboardRerollCount hits the cap (§3.2), but a
 * request fired straight at this route must be refused the exact same way:
 * tier === "custom" AND all STORYBOARD_REROLL_CAP re-rolls spent AND Gate 1
 * not yet approved (§4.1, lib/safety-net.ts#canRequestRefund).
 *
 * This route does NOT touch Stripe and does NOT compute a refund amount —
 * §3.5(C) explicitly keeps the refund itself a manual dashboard action
 * (HARD CONSTRAINT: never call Stripe's refund API). It only RECORDS that
 * the customer asked, notifies the admin, and freezes Gate 1 for this order
 * (approve-storyboard's own guard checks refundRequestedAt too). The other
 * half — recording that the money actually moved — is
 * app/admin/actions.ts#markRefundIssuedAction.
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
  if (!order || order.approveToken !== approveToken) {
    return NextResponse.json({ ok: false, error: "Order not found." }, { status: 404 });
  }

  // Fast, friendly pre-check — NOT the enforcement (see the atomic guard
  // below, which is what actually decides under a race).
  const preCheck = canRequestRefund(order);
  if (!preCheck.ok) {
    return NextResponse.json({ ok: false, error: preCheck.reason }, { status: 409 });
  }

  // ATOMIC — same guarded-updateMany shape as reroll-cut and
  // handleAddonSession (app/api/webhooks/stripe/route.ts): refundRequestedAt
  // only gets set by the ONE request whose WHERE clause still matches when
  // Postgres grants it the row lock, so a double-click cannot fire the
  // admin alert twice, and a refund request racing a re-roll for the last
  // slot cannot both "win".
  const { count } = await prisma.order.updateMany({
    where: {
      id: orderId,
      tier: "custom",
      status: OrderStatus.AWAITING_CUSTOMER_APPROVAL,
      storyboardRerollCount: { gte: STORYBOARD_REROLL_CAP },
      refundRequestedAt: null,
    },
    data: { refundRequestedAt: new Date() },
  });

  if (count !== 1) {
    const fresh = await prisma.order.findUnique({ where: { id: orderId } });
    const result = fresh ? canRequestRefund(fresh) : { ok: false as const, reason: "Order not found." };
    return NextResponse.json(
      { ok: false, error: result.ok ? "Please try again." : result.reason },
      { status: 409 }
    );
  }

  const updated = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });

  // CHARGEBACK-DEFENSE-SPEC.md §3 refund.requested / §7 proof 4 — records
  // the EXACT confirm-panel text the customer read before clicking through
  // (refundConfirmText, shared verbatim with components/StoryboardWizard.tsx,
  // so this is never a paraphrase). Never throws (lib/evidence.ts).
  await recordEvidence(
    orderId,
    "refund.requested",
    { consentText: refundConfirmText(updated.petName ?? "Your Star") },
    req
  );

  // Fire-and-forget: never let an alert-email failure hide from the customer
  // that their refund request WAS successfully recorded.
  try {
    await sendRefundRequestedAlert(updated);
  } catch (err) {
    console.error(`[request-refund] admin alert email failed (non-fatal) order=${orderId}`, err);
  }

  return NextResponse.json({
    ok: true,
    refundAmountUsd: REFUND_AMOUNT_USD,
    nonRefundableFeeUsd: NONREFUNDABLE_FEE_USD,
  });
}

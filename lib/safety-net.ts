/**
 * B2 — Director's Cut safety net: pure eligibility rules for the two Gate-1
 * levers PRICING-PRODUCT-V2-SPEC.md §3.5(C) promises (B2-SAFETY-NET-SPEC.md):
 *
 *   1. Three free storyboard RE-ROLLS (§1.1 — one cut's three takes, no
 *      customer instruction, order-wide count).
 *   2. A $150 REFUND once all three are spent and Gate 1 is still
 *      unapproved (§4.1).
 *
 * WHY this file is pure functions with no Prisma/DB import: every guard
 * gates either real compute spend or a real refund, so §8 of the spec
 * requires each one to be provable WITHOUT a database or a running server —
 * a unit test calling these functions directly, not an HTTP round trip. Both
 * API routes (reroll-cut, request-refund) call the SAME functions used here
 * for their "friendly reason" pre-check, so "what the guard says" and "what
 * the route enforces" cannot silently drift apart. The actual enforcement
 * against a race (two clicks, two tabs) is a separate, atomic `updateMany`
 * WHERE clause in each route — see the comments there — but that WHERE
 * clause is written to match the conditions checked below field-for-field.
 *
 * Deliberately NOT importing `OrderStatus` from "@/generated/prisma/client":
 * that module is the actual Prisma Client runtime, and this file must stay
 * safe to import from anywhere (a route, a script, in principle a client
 * component) without dragging that runtime along. `status` below is typed as
 * `string` — a Prisma `Order.status` (type `OrderStatus`) is a plain string
 * enum value at runtime and widens into that type without a cast.
 */

// PRICING-PRODUCT-V2-SPEC.md §3.5(C): "three free storyboard re-rolls" — a
// hard product ceiling, not a soft rate limit. Named so it's never
// re-hardcoded as a bare `3` in a route, a component, or a test.
export const STORYBOARD_REROLL_CAP = 3;

// Gate 0's free treatment-revision limit. A customer-facing product ceiling
// (not the old internal anti-abuse cap of 20 the field once carried) — the
// number appears in five disclosure surfaces (PricingTeaser, checkout
// consent, terms, refund policy, Tokushoho) and MUST match this constant, the
// route's REVISION_CAP, and the counter shown on the treatment approval
// screen. Change it in exactly one place.
export const TREATMENT_REVISION_CAP = 2;

// Customer-facing dollar figures from the same spec section. COPY constants
// ONLY: the app never feeds these into a Stripe call and never treats them as
// the source of truth for what was actually refunded — the admin reads $150
// off the same policy this constant backs and types it into Stripe's own
// dashboard by hand (B2-SAFETY-NET-SPEC.md §4.3, HARD CONSTRAINT #3).
export const REFUND_AMOUNT_USD = 150;
export const NONREFUNDABLE_FEE_USD = 99;

// The exact wire value of OrderStatus.AWAITING_CUSTOMER_APPROVAL (see
// prisma/schema.prisma) — see the file-level note above for why this is a
// literal instead of an import.
const AWAITING_CUSTOMER_APPROVAL = "AWAITING_CUSTOMER_APPROVAL";

export type GuardResult = { ok: true } | { ok: false; reason: string };

/** Minimal Order shape both guards need. A legacy pre-B2 row reads as
 *  storyboardRerollCount: 0, refundRequestedAt: null (the migration's column
 *  defaults), so no separate legacy-row branch is needed here — the same
 *  defensive-read posture the rest of this codebase uses for Json columns. */
export type OrderForGuard = {
  tier: string | null;
  status: string;
  storyboardRerollCount: number;
  refundRequestedAt: Date | null;
};

const NOT_CUSTOM_REASON =
  "This is part of the Director's Cut plan — it isn't available on Preset Worlds orders.";

function isCustomTier(order: Pick<OrderForGuard, "tier">): boolean {
  return order.tier === "custom";
}

/**
 * Gate-1 re-roll guard (§3.1). Checked as a conjunction, in an order chosen
 * so the reason returned is always the MOST relevant one: tier first
 * (nothing else about this order applies to a Preset order at all), then
 * "did the customer already end this" (a refund request should freeze
 * everything else about Gate 1, including re-rolls), then the gate itself,
 * then the cap.
 */
export function canReroll(order: OrderForGuard): GuardResult {
  if (!isCustomTier(order)) {
    return { ok: false, reason: NOT_CUSTOM_REASON };
  }
  if (order.refundRequestedAt) {
    return {
      ok: false,
      reason: "You've already asked for a refund on this order, so the storyboard is locked.",
    };
  }
  if (order.status !== AWAITING_CUSTOMER_APPROVAL) {
    return {
      ok: false,
      reason: "This storyboard isn't open for re-rolls right now.",
    };
  }
  if (order.storyboardRerollCount >= STORYBOARD_REROLL_CAP) {
    return {
      ok: false,
      reason: `You've used all ${STORYBOARD_REROLL_CAP} free re-rolls for this order.`,
    };
  }
  return { ok: true };
}

/**
 * $150 refund-request guard (§4.1) — a conjunction of:
 *   1. tier === "custom" (§7 — Preset has no Gate 0, no $99/$150 split)
 *   2. all STORYBOARD_REROLL_CAP re-rolls spent ("fix it first" — the whole
 *      point of B2 is that re-rolling comes before refunding)
 *   3. Gate 1 not yet approved (still AWAITING_CUSTOMER_APPROVAL — once video
 *      generation starts this is bespoke, in-production work, not a
 *      pre-production direction mismatch)
 *   4. not already requested (the button is a one-shot, not a second ticket)
 */
export function canRequestRefund(order: OrderForGuard): GuardResult {
  if (!isCustomTier(order)) {
    return { ok: false, reason: NOT_CUSTOM_REASON };
  }
  if (order.status !== AWAITING_CUSTOMER_APPROVAL) {
    return {
      ok: false,
      reason: "This order has already moved into production, so the refund window has closed.",
    };
  }
  if (order.storyboardRerollCount < STORYBOARD_REROLL_CAP) {
    const remaining = STORYBOARD_REROLL_CAP - order.storyboardRerollCount;
    return {
      ok: false,
      reason: `Please use your remaining ${remaining} free re-roll${remaining === 1 ? "" : "s"} first — the refund unlocks once all ${STORYBOARD_REROLL_CAP} are spent.`,
    };
  }
  if (order.refundRequestedAt) {
    return { ok: false, reason: "A refund has already been requested for this order." };
  }
  return { ok: true };
}

/**
 * In-process stand-in for the guarded `updateMany` in
 * app/api/orders/reroll-cut/route.ts, used ONLY by
 * scripts/test-safety-net.ts to prove the "two clicks / two tabs cannot
 * exceed the cap" guard (§8 item 5) without a database.
 *
 * This is not a probabilistic simulation — it is the literal predicate the
 * route's WHERE clause evaluates (tier/refund/status/count), called once per
 * simulated "click". Real Postgres serializes concurrent `updateMany` calls
 * against the same row: the second call's WHERE is only evaluated once the
 * first call's row lock is released, against whatever the first call just
 * committed — which is exactly "check the guard, then mutate, one call at a
 * time" below. That equivalence is the entire reason the reroll route does
 * the increment IN the WHERE clause instead of read-then-write: read-then-
 * write would let two concurrent reads both observe count < CAP before
 * either writes, letting both succeed.
 */
export function attemptReroll(row: OrderForGuard): boolean {
  const eligible =
    isCustomTier(row) &&
    row.refundRequestedAt === null &&
    row.status === AWAITING_CUSTOMER_APPROVAL &&
    row.storyboardRerollCount < STORYBOARD_REROLL_CAP;
  if (eligible) row.storyboardRerollCount += 1;
  return eligible;
}

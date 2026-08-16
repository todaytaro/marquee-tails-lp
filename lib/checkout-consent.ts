import { NONREFUNDABLE_FEE_USD } from "@/lib/safety-net";
import type { Tier } from "@/lib/stripe";

/**
 * The exact consent-checkbox copy shown on Stripe Checkout
 * (`consent_collection.terms_of_service`, app/api/checkout/route.ts's
 * `custom_text.terms_of_service_acceptance.message`) — the literal line the
 * buyer ticks to agree, before any money moves.
 *
 * Pulled out of the route into its own function so the Stripe webhook
 * (app/api/webhooks/stripe/route.ts) can record this SAME string as the
 * `checkout.consent` evidence event's "consent text version"
 * (CHARGEBACK-DEFENSE-SPEC.md §3) without the two ever drifting apart — the
 * whole point of that evidence row is proving the customer saw THIS exact
 * text, not a paraphrase reconstructed later from memory.
 */
export function checkoutConsentText(tier: Tier, base: string): string {
  // B2-SAFETY-NET-SPEC.md §5 disclosure point 2 — custom (Director's Cut)
  // ONLY: the non-refundable concept & storyboard fee is a Director's
  // Cut-specific structure (Preset has no Gate 0 and no fee/refund split,
  // §7), so this line does not belong on a preset checkout.
  // 2026-08-16 追加、**両プラン共通**: 承認した絵コンテから作るので完成した
  // 動画は作り直さない、という条項（/refund §2）。決済前に同意させておくのが
  // チャージバック対応で最も強い — 「規約に書いてある」より「同意にチェック
  // した」の方が通る。§5 の開示点と同じ理由でここに置く。
  const noRemake =
    " I understand my trailer is made from a storyboard I approve before filming, and that a delivered trailer is not re-made.";
  return tier === "custom"
    ? `I agree to the [Marquee Tails Terms of Service](${base}/terms) and [Refund Policy](${base}/refund). I understand $${NONREFUNDABLE_FEE_USD} of this order is a non-refundable concept & storyboard fee.${noRemake}`
    : `I agree to the [Marquee Tails Terms of Service](${base}/terms) and [Refund Policy](${base}/refund).${noRemake}`;
}

import { REFUND_AMOUNT_USD, NONREFUNDABLE_FEE_USD } from "@/lib/safety-net";

/**
 * The exact copy shown in the B2 pre-production refund's confirm panel
 * (components/StoryboardWizard.tsx's `refundOffer()`, the box that appears
 * after clicking "Get $X back" and before the irreversible confirm click) —
 * the words the customer actually reads before ending production.
 *
 * Exported so app/api/orders/request-refund/route.ts can record this SAME
 * string as the `refund.requested` evidence event's consent text
 * (CHARGEBACK-DEFENSE-SPEC.md §3 / §7 proof 4) without the UI copy and the
 * evidence record ever drifting apart.
 */
export function refundConfirmText(petName: string): string {
  return `This ends production for good. We'll refund $${REFUND_AMOUNT_USD} of your $249 order — the $${NONREFUNDABLE_FEE_USD} concept & storyboard fee stays non-refundable (the treatment and storyboard we made for ${petName} are yours to keep either way).`;
}

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Refund & Cancellation Policy — Marquee Tails",
};

export default function RefundPage() {
  return (
    <>
      {/* TEMPLATE — 公開前に弁護士レビュー必須。特に特商法の実開示情報と英語圏消費者法の適合性。 */}
      <h1>Refund &amp; Cancellation Policy</h1>

      <h2>1. Made-to-Order Product</h2>
      <p>
        Each film and poster is produced to order for your specific pet, using
        compute we begin spending as soon as your order is placed. Because of
        this, we are generally unable to offer refunds or cancellations for a
        simple change of mind once an order has been placed.
      </p>

      <h2>2. Defects / Quality</h2>
      <p>
        If your delivered film or poster has a defect — for example, your pet
        is clearly not recognizable against our human quality-review
        standard — we will remake or fix the affected material at no
        additional cost, up to two (2) remakes per order. If the issue is
        still not resolved after the second remake, we will issue a full
        refund instead.
      </p>

      <h2>3. Director&rsquo;s Cut Pre-Production Safety Net</h2>
      <p>
        Section 2 above covers defects in your DELIVERED film or poster.
        This section is different: it covers what happens BEFORE anything is
        filmed, if you and your director simply can&rsquo;t agree on the
        storyboard.
      </p>
      <p>
        Director&rsquo;s Cut ($249) orders include up to two (2) free text
        revisions to your written treatment, plus up to three (3) free
        re-rolls of any single storyboard scene at Gate 1 (before filming
        begins). If, after using all three re-rolls, you still cannot approve
        the storyboard, you may end production there in exchange for a $200
        refund. The $49 concept &amp; storyboard fee is non-refundable in
        that case &mdash; it covers the treatment and storyboard work we
        already completed specifically for you, which remain yours to keep.
        This option is only available before Gate 1 approval (i.e., before
        filming starts); once you approve the storyboard, production is
        underway and this section no longer applies &mdash; Section 2&rsquo;s
        defect policy governs the delivered result instead. This safety net
        is exclusive to Director&rsquo;s Cut; Preset Worlds orders do not
        have a Gate 0 treatment step and are not eligible for it.
      </p>

      <h2>4. Non-Delivery</h2>
      <p>
        If we are unable to deliver your order for reasons within our
        control, we will provide a full refund.
      </p>

      <h2>5. Physical Items (Printify)</h2>
      <p>
        Physical prints and canvases are produced and shipped through our
        print partner, Printify. If your physical item arrives damaged or
        defective, we will arrange a reprint and reshipment. In most cases a
        photo of the damaged or defective item is enough for us to process a
        reprint, without needing you to return the original item.
      </p>

      <h2>6. How to Request</h2>
      <p>
        To request a remake, fix, or refund under this policy, email{" "}
        <a href="mailto:support@marqueetails.com">support@marqueetails.com</a> with your order
        number and a description of the issue.
      </p>

      <p className="mt-10 text-xs">Last updated: July 31, 2026</p>
    </>
  );
}

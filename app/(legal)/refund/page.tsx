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

      <h2>2. The Storyboard Is Where Changes Happen</h2>
      <p>
        Before we film anything, you approve a storyboard: six still frames
        showing exactly what your trailer will contain. That approval is the
        point at which the film is settled. If a scene isn&rsquo;t right, you
        can re-roll it &mdash; see Section 3 &mdash; and you can keep going
        until you are happy to approve, or decline to approve at all.
      </p>
      <p>
        Because of that, <strong>we do not remake or re-film a delivered
        trailer</strong>. The film is made from frames you already saw and
        approved, and re-filming one costs as much as producing the order
        again. Changes belong at the storyboard stage, where they are quick
        and free.
      </p>
      <p>
        This does not limit your rights under applicable consumer law, and it
        is not a licence for us to deliver poor work: every shot passes a
        human quality review before it reaches you, and if something is
        clearly wrong on our side we will put it right at our discretion.
      </p>

      <h2>3. Storyboard Re-Rolls &amp; the Pre-Production Refund</h2>
      <p>
        Section 2 explains why changes belong before filming. This section
        sets out exactly what you get at that stage.
      </p>
      <p>
        <strong>Every order</strong> includes two (2) free storyboard
        re-rolls. A re-roll regenerates one scene as three brand-new takes.
        The two are a total for the order, not two per scene.
      </p>
      <p>
        Director&rsquo;s Cut ($249) additionally includes up to two (2) free
        revisions to your written treatment before the storyboard is drawn,
        and one further protection: if you have used both re-rolls and still
        cannot approve the storyboard, you may end production there, before
        filming begins, in exchange for a $150 refund. The $99 concept &amp;
        storyboard fee is non-refundable in that case &mdash; it covers the
        treatment and storyboard work already completed specifically for you,
        which remain yours to keep.
      </p>
      <p>
        That refund is only available before you approve the storyboard. Once
        you approve it, filming begins and the order is final.
      </p>
      <p>
        Preset Worlds orders have no written-treatment stage and no standing
        refund window. If you believe something has gone wrong, contact us and
        we will look at your order individually; where we agree to refund a
        Preset order before filming has begun, we keep $59 to cover the model
        training and storyboard work already completed for you, and refund the
        rest.
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

      <p className="mt-10 text-xs">Last updated: August 3, 2026</p>
    </>
  );
}

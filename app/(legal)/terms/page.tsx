import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service — Marquee Tails",
};

export default function TermsPage() {
  return (
    <>
      {/* TEMPLATE — 公開前に弁護士レビュー必須。特に特商法の実開示情報と英語圏消費者法の適合性。 */}
      <h1>Terms of Service</h1>

      <h2>1. Acceptance of Terms</h2>
      <p>
        By accessing or using the Marquee Tails website, submitting photos, or
        placing an order, you agree to be bound by these Terms of Service. If
        you do not agree, please do not use the service.
      </p>

      <h2>2. Description of Service</h2>
      <p>
        Marquee Tails produces a short cinematic movie trailer starring your
        pet, generated from photos you upload, along with a matching movie
        poster. The finished film and poster are made with AI and are
        directed, checked, and finished by human reviewers before delivery.
      </p>

      <h2>3. Photo Submission &amp; Your Responsibilities</h2>
      <p>
        You must own or hold the necessary rights to every photo you submit,
        and the photos must not infringe any third party&rsquo;s rights. You
        confirm that the photos you upload are genuine photos of your own pet
        and that you have the right to use them for this purpose. Do not
        upload photos of people, other owners&rsquo; pets, or any content you
        do not have permission to use.
      </p>

      <h2>4. License You Grant Us</h2>
      <p>
        By uploading photos, you grant Marquee Tails a limited,
        non-exclusive, revocable license to use, reproduce, and process those
        photos solely for the purpose of producing your film and poster, and
        for the related storage and processing described in our{" "}
        <a href="/privacy">Privacy Policy</a>. We do not use your photos for
        any other purpose without your consent.
      </p>

      <h2>5. Ownership of the Finished Film &amp; Poster</h2>
      <p>
        The finished film and poster are provided for your{" "}
        personal, non-commercial use. Please contact us before
        using the finished materials in any commercial context.
      </p>

      <h2>6. Made-to-Order Nature &amp; Approvals</h2>
      <p>
        Every order is made to order and proceeds in two stages: first, you
        review and approve the storyboard for your film scene by scene
        (Gate 1); production of the final film and poster only begins after
        this approval. Second, once production is complete, your order is
        delivered for your review (Gate 2). Because production only starts
        after your storyboard approval, the finished materials are made
        specifically for you.
      </p>
      <p>
        Director&rsquo;s Cut orders may re-roll (regenerate) any single
        storyboard scene up to three (3) times at no additional cost before
        approving it. If, after using all three re-rolls, you still cannot
        approve the storyboard, you may end production before filming begins
        in exchange for a $200 refund; the $49 concept &amp; storyboard fee is
        non-refundable in that case, because it covers the treatment and
        storyboard work already completed for you. This is separate from,
        and does not replace, the defect-based remake/refund process in our{" "}
        <a href="/refund">Refund &amp; Cancellation Policy</a>, which applies
        to your finished, delivered film and poster rather than to
        pre-production direction.
      </p>

      <h2>7. Pricing &amp; Payment</h2>
      <p>
        Current prices for each edition are shown on our pricing section at
        the time of purchase. Payment is processed securely through Stripe at
        checkout.
      </p>

      <h2>8. Refunds</h2>
      <p>
        Refunds and cancellations are governed by our{" "}
        <a href="/refund">Refund &amp; Cancellation Policy</a>.
      </p>

      <h2>9. Acceptable Use / Prohibited Content</h2>
      <p>
        You may not submit content that is illegal, infringes any third
        party&rsquo;s intellectual property or other rights, or is otherwise
        prohibited by applicable law. We reserve the right to refuse or cancel
        any order that violates this policy.
      </p>

      <h2>10. AI Disclosure</h2>
      <p>
        Your film and poster are generated using AI models and are then
        reviewed, adjusted, and finished by our human team before delivery.
        We are transparent about this process and do not represent the
        finished materials as unedited photography or hand-drawn artwork.
      </p>

      <h2>11. Disclaimers &amp; Limitation of Liability</h2>
      <p>
        The service is provided on an &ldquo;as is&rdquo; basis. While every
        order goes through human quality review, we do not guarantee a
        perfect likeness of your pet in every shot. To the maximum extent
        permitted by law, Marquee Tails is not liable for indirect,
        incidental, or consequential damages arising from your use of the
        service.
      </p>

      <h2>12. Changes to Terms / Governing Law</h2>
      <p>
        We may update these Terms from time to time; the &ldquo;Last
        updated&rdquo; date below reflects the latest revision. These Terms
        are governed by the laws of Japan, and any dispute shall be subject
        to the exclusive jurisdiction of the Tokyo District Court, Japan.
      </p>

      <h2>13. Contact</h2>
      <p>
        Questions about these Terms can be sent to{" "}
        <a href="mailto:support@marqueetails.com">support@marqueetails.com</a>.
      </p>

      <p className="mt-10 text-xs">Last updated: July 31, 2026</p>
    </>
  );
}

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy — Marquee Tails",
};

export default function PrivacyPage() {
  return (
    <>
      {/* TEMPLATE — 公開前に弁護士レビュー必須。特に特商法の実開示情報と英語圏消費者法の適合性。 */}
      <h1>Privacy Policy</h1>

      <h2>1. What We Collect</h2>
      <p>
        We collect the photos of your pet that you upload for production, your
        email address, and, for orders that include a physical print or
        canvas, the shipping name and address you provide at checkout.
        Payment is processed by Stripe — Marquee Tails never receives or
        stores your card details.
      </p>

      <h2>2. How We Use It</h2>
      <p>
        We use this information to produce your film and poster, to
        communicate with you about your order (including storyboard approval
        and delivery), and, for physical items, to ship your order to you.
      </p>

      <h2>3. Third-Party Processors</h2>
      <p>
        We share data with the following service providers, solely to
        deliver our service:
      </p>
      <ul>
        <li>
          <strong>fal.ai</strong> — image and video generation
        </li>
        <li>
          <strong>Stripe</strong> — payment processing
        </li>
        <li>
          <strong>Printify</strong> — printing and shipping of physical items
        </li>
        <li>
          <strong>Resend</strong> — transactional and marketing email
        </li>
        <li>
          <strong>Vercel</strong> — website hosting and file storage
        </li>
      </ul>
      <p>Each provider processes your data only as necessary to perform its service for us.</p>

      <h2>4. Data Retention</h2>
      <p>
        We retain your uploaded photos and finished materials for{" "}
        up to 24 months after your order is completed, after which they are
        deleted unless a longer retention is required for legal, accounting,
        or dispute-resolution purposes. You may request earlier deletion at
        any time (see &ldquo;Your Rights&rdquo; below).
      </p>

      <h2>5. International Transfer</h2>
      <p>
        Marquee Tails is operated from Japan. If you are located outside
        Japan, your data will be transferred to and processed in Japan, and
        it may also be processed by our service providers located in other
        countries (including the United States), as listed above.
      </p>

      <h2>6. Your Rights</h2>
      <p>
        You may request access to, correction of, or deletion of your
        personal data by contacting us at{" "}
        <a href="mailto:support@marqueetails.com">support@marqueetails.com</a>.
      </p>

      <h2>7. Cookies</h2>
      <p>
        We use only essential cookies required for the site and checkout to
        function. We do not use advertising or cross-site tracking cookies.
      </p>

      <h2>8. Contact</h2>
      <p>
        Questions about this Privacy Policy can be sent to{" "}
        <a href="mailto:support@marqueetails.com">support@marqueetails.com</a>.
      </p>

      <p className="mt-10 text-xs">Last updated: July 22, 2026</p>
    </>
  );
}

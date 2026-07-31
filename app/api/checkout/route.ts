import { NextResponse } from "next/server";
import { getStripeClient, getPriceId, type Tier } from "@/lib/stripe";

const VALID_TIERS: Tier[] = ["preset", "custom"];

/**
 * Creates a Stripe Checkout Session for one of the 2 plans
 * (PRICING-PRODUCT-V2-SPEC.md).
 *
 * POST { tier: "preset" | "custom" }
 *
 * "custom" (Director's Cut) is video-only at base checkout, same session
 * shape as preset — the Claude script-generation + treatment-approval flow
 * (Director's Cut B1) picks up after intake, at /approve/[token].
 *
 * Returns 503 while STRIPE_SECRET_KEY is unset, same "not configured yet"
 * posture as the rest of the app's optional integrations.
 */
export async function POST(req: Request) {
  let body: { tier?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const { tier } = body;
  if (typeof tier !== "string" || !VALID_TIERS.includes(tier as Tier)) {
    return NextResponse.json(
      { ok: false, error: `tier must be one of: ${VALID_TIERS.join(", ")}.` },
      { status: 400 }
    );
  }

  const stripe = getStripeClient();
  if (!stripe) {
    return NextResponse.json(
      { ok: false, error: "Payments aren't configured yet." },
      { status: 503 }
    );
  }

  const priceId = getPriceId(tier as Tier);
  if (!priceId) {
    console.error(`[checkout] no Price ID configured for tier=${tier}`);
    return NextResponse.json(
      { ok: false, error: "This tier isn't configured yet." },
      { status: 500 }
    );
  }

  try {
    const base = process.env.APP_BASE_URL ?? "http://localhost:3100";
    // Pass 1: "preset" is video-only (the digital poster ships free, no
    // physical good at base checkout) — no shipping address is collected
    // here. Printed poster / gallery canvas become a post-delivery add-on
    // purchase in a later pass (see PRICING-PRODUCT-V2-SPEC.md §5), with its
    // own Checkout session and shipping collection at that time.
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: priceId, quantity: 1 }],
      // Forces the buyer to check a Terms-of-service consent box on the
      // Stripe-hosted Checkout page. NOTE: this only works once the owner
      // sets the Terms of service URL in the Stripe Dashboard under
      // Settings -> Public business information -> Terms of service
      // (domain-dependent, done after the real domain is live).
      consent_collection: { terms_of_service: "required" },
      custom_text: {
        terms_of_service_acceptance: {
          // Absolute URLs, because this is the line the buyer actually ticks
          // to agree. `(URL)` shipped here as a literal placeholder, so the
          // consent pointed at nothing on the one page where it has to
          // resolve — and Checkout is served from Stripe's domain, so a
          // relative path would not work either.
          //
          // B2-SAFETY-NET-SPEC.md §5 disclosure point 2 — custom (Director's
          // Cut) ONLY: the $49-of-$249 non-refundable concept & storyboard
          // fee is a Director's Cut-specific structure (Preset has no Gate 0
          // and no $49/$200 split, §7), so this line does not belong on a
          // preset checkout.
          message:
            tier === "custom"
              ? `I agree to the [Marquee Tails Terms of Service](${base}/terms) and [Refund Policy](${base}/refund). I understand $49 of this order is a non-refundable concept & storyboard fee.`
              : `I agree to the [Marquee Tails Terms of Service](${base}/terms) and [Refund Policy](${base}/refund).`,
        },
      },
      success_url: `${base}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/#pricing`,
    });

    return NextResponse.json({ ok: true, url: session.url });
  } catch (err) {
    console.error("[checkout] session creation failed", err);
    return NextResponse.json(
      { ok: false, error: "Something went wrong on our end." },
      { status: 500 }
    );
  }
}

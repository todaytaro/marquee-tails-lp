import { NextResponse } from "next/server";
import { getStripeClient, getPriceId, type Tier } from "@/lib/stripe";

const VALID_TIERS: Tier[] = ["digital", "feature", "collector"];

/**
 * Creates a Stripe Checkout Session for one of the 3 fixed tiers.
 *
 * POST { tier: "digital" | "feature" | "collector" }
 *
 * Plumbing only — no Buy button calls this yet (see STRIPE-INTEGRATION-SPEC.md).
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
    // Feature Film / Collector's Edition ship a physical poster/canvas —
    // collect a shipping address for those tiers only (see POD-INTEGRATION-SPEC.md §4).
    const needsShipping = tier === "feature" || tier === "collector";
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: priceId, quantity: 1 }],
      ...(needsShipping && {
        shipping_address_collection: { allowed_countries: ["US", "CA", "GB", "AU"] }, // 要オーナー確認: 対応国
      }),
      // Forces the buyer to check a Terms-of-service consent box on the
      // Stripe-hosted Checkout page. NOTE: this only works once the owner
      // sets the Terms of service URL in the Stripe Dashboard under
      // Settings -> Public business information -> Terms of service
      // (domain-dependent, done after the real domain is live).
      consent_collection: { terms_of_service: "required" },
      custom_text: {
        terms_of_service_acceptance: {
          message:
            "I agree to the [Marquee Tails Terms of Service](URL) and [Refund Policy](URL).",
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

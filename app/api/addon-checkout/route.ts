import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripeClient, getAddonPriceId, type AddonType } from "@/lib/stripe";
import { prisma } from "@/lib/db";

const VALID_ADDONS: AddonType[] = ["poster", "canvas"];

// Launch set of countries offered at the add-on Checkout's shipping address
// collection — Printify ships to these widely. The owner can expand this
// list later; it does not affect the base plan checkout (no shipping there).
const ADDON_SHIP_COUNTRIES: Stripe.Checkout.SessionCreateParams.ShippingAddressCollection.AllowedCountry[] =
  [
    "US", "CA", "GB", "AU", "NZ", "IE", "JP",
    "DE", "FR", "ES", "IT", "NL", "BE", "AT", "SE", "DK", "FI", "NO", "PT", "PL", "CH",
  ];

/**
 * Creates the SECOND Stripe Checkout session — the post-delivery physical
 * add-on purchase (PRICING-PRODUCT-V2-SPEC.md §5). Offered once an order
 * reaches COMPLETED: the digital poster/film are already delivered, and the
 * customer can optionally buy a Printed Poster ($59) or Gallery Canvas ($99)
 * printed via Printify and shipped to them.
 *
 * POST { orderId: string, approveToken: string, addon: "poster" | "canvas" }
 *
 * Auth is the same token-as-auth model as the approve page: no login, just
 * the cuid approveToken minted at order creation and emailed to the customer.
 *
 * One physical add-on per order in this pass (MVP) — guarded by
 * addonStripeSessionId already being set (also enforced idempotently by the
 * unique constraint + webhook's guarded updateMany).
 */
export async function POST(req: Request) {
  let body: { orderId?: unknown; approveToken?: unknown; addon?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const { orderId, approveToken, addon } = body;
  if (
    typeof orderId !== "string" ||
    typeof approveToken !== "string" ||
    typeof addon !== "string" ||
    !VALID_ADDONS.includes(addon as AddonType)
  ) {
    return NextResponse.json(
      { ok: false, error: `addon must be one of: ${VALID_ADDONS.join(", ")}.` },
      { status: 400 }
    );
  }

  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) {
    return NextResponse.json({ ok: false, error: "Order not found." }, { status: 404 });
  }

  if (order.approveToken !== approveToken) {
    return NextResponse.json({ ok: false, error: "Not authorized." }, { status: 403 });
  }

  if (order.status !== "COMPLETED") {
    return NextResponse.json(
      { ok: false, error: "Available after your film is delivered." },
      { status: 409 }
    );
  }

  if (!order.posterPrintUrl) {
    return NextResponse.json(
      { ok: false, error: "No print-ready poster on this order." },
      { status: 409 }
    );
  }

  if (order.addonStripeSessionId) {
    return NextResponse.json(
      { ok: false, error: "You've already added a physical piece to this order." },
      { status: 409 }
    );
  }

  const stripe = getStripeClient();
  if (!stripe) {
    return NextResponse.json(
      { ok: false, error: "Payments aren't configured yet." },
      { status: 503 }
    );
  }

  const priceId = getAddonPriceId(addon as AddonType);
  if (!priceId) {
    console.error(`[addon-checkout] no Price ID configured for addon=${addon}`);
    return NextResponse.json(
      { ok: false, error: "This add-on isn't configured yet." },
      { status: 500 }
    );
  }

  try {
    const base = process.env.APP_BASE_URL ?? "http://localhost:3100";
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: priceId, quantity: 1 }],
      shipping_address_collection: { allowed_countries: ADDON_SHIP_COUNTRIES },
      client_reference_id: order.id,
      metadata: { kind: "addon", orderId: order.id, addonType: addon },
      consent_collection: { terms_of_service: "required" },
      custom_text: {
        terms_of_service_acceptance: {
          message:
            "I agree to the [Marquee Tails Terms of Service](URL) and [Refund Policy](URL).",
        },
      },
      success_url: `${base}/approve/${order.approveToken}?addon=success`,
      cancel_url: `${base}/approve/${order.approveToken}`,
    });

    return NextResponse.json({ ok: true, url: session.url });
  } catch (err) {
    console.error("[addon-checkout] session creation failed", err);
    return NextResponse.json(
      { ok: false, error: "Something went wrong on our end." },
      { status: 500 }
    );
  }
}

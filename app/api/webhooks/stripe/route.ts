import { NextResponse } from "next/server";
import Stripe from "stripe";
import { getStripeClient, priceIdToTier } from "@/lib/stripe";
import { prisma } from "@/lib/db";
import { OrderStatus } from "@/generated/prisma/client";

/**
 * Stripe webhook — creates the Order row once checkout completes.
 *
 * This is the "order creation entry point" that today only exists via
 * scripts/seed-demo.ts: before this route, nothing could create a real
 * Order row for a paying customer.
 *
 * Signature verification requires the RAW request body, so this handler
 * calls req.text() and never req.json() first (parsing to JSON first would
 * lose the exact byte sequence Stripe signed, breaking verification).
 *
 * Idempotency: a replayed webhook must return 200, never re-process. Here
 * that's enforced by the unique constraint on stripeSessionId — a duplicate
 * insert throws P2002, which we treat as "already processed" and answer with
 * 200 so Stripe stops retrying.
 *
 * Local testing (once the owner has Stripe keys):
 *   stripe listen --forward-to localhost:3100/api/webhooks/stripe
 */
export async function POST(req: Request) {
  const stripe = getStripeClient();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !webhookSecret) {
    return NextResponse.json({ ok: false, error: "Stripe not configured." }, { status: 503 });
  }

  const sig = req.headers.get("stripe-signature");
  if (!sig) {
    return NextResponse.json({ ok: false, error: "Missing signature." }, { status: 400 });
  }

  const rawBody = await req.text(); // MUST be the raw body — do not req.json() first
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    console.error("[stripe-webhook] signature verification failed", err);
    return NextResponse.json({ ok: false, error: "Invalid signature." }, { status: 400 });
  }

  if (event.type !== "checkout.session.completed") {
    return NextResponse.json({ ok: true, ignored: event.type });
  }

  const session = event.data.object as Stripe.Checkout.Session;
  const customerEmail = session.customer_details?.email;
  if (!customerEmail) {
    console.error("[stripe-webhook] no customer email on session", session.id);
    return NextResponse.json({ ok: false, error: "No customer email." }, { status: 400 });
  }

  // Retrieve line items to resolve which Price (=tier) was purchased.
  const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 1 });
  const priceId = lineItems.data[0]?.price?.id;
  const tier = priceId ? priceIdToTier(priceId) : null;
  if (!tier) {
    console.error("[stripe-webhook] could not resolve tier for session", session.id, priceId);
    return NextResponse.json({ ok: false, error: "Unknown price." }, { status: 400 });
  }

  // Note: the spec (POD-INTEGRATION-SPEC.md §4) references `session.shipping_details`,
  // but this Stripe SDK version (22.x) nests it under `collected_information` instead.
  const shipping = session.collected_information?.shipping_details;

  try {
    const order = await prisma.order.create({
      data: {
        stripeSessionId: session.id,
        customerEmail,
        tier,
        amountPaidCents: session.amount_total ?? 0,
        status: OrderStatus.UPLOADING,
        shippingName: shipping?.name ?? null,
        shippingLine1: shipping?.address?.line1 ?? null,
        shippingLine2: shipping?.address?.line2 ?? null,
        shippingCity: shipping?.address?.city ?? null,
        shippingRegion: shipping?.address?.state ?? null,
        shippingPostalCode: shipping?.address?.postal_code ?? null,
        shippingCountry: shipping?.address?.country ?? null,
      },
    });
    console.log(`[stripe-webhook] order created id=${order.id} tier=${tier} email=${customerEmail}`);
    // Fire-and-forget: email the upload link. Never let an email failure
    // fail the webhook (Stripe would retry and we'd double-create — though
    // the unique stripeSessionId constraint below already guards that).
    try {
      const { sendWelcomeUploadEmail } = await import("@/lib/mocks");
      await sendWelcomeUploadEmail(order);
    } catch (emailErr) {
      console.error("[stripe-webhook] welcome email failed (non-fatal)", emailErr);
    }
  } catch (err: unknown) {
    // Unique constraint on stripeSessionId = replayed webhook for an order
    // we already created. Idempotent no-op, same as the fal webhook pattern.
    if (typeof err === "object" && err !== null && "code" in err && err.code === "P2002") {
      console.warn(`[stripe-webhook] duplicate session, already processed: ${session.id}`);
      return NextResponse.json({ ok: true, duplicate: true });
    }
    console.error("[stripe-webhook] order creation failed", err);
    return NextResponse.json({ ok: false, error: "Order creation failed." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

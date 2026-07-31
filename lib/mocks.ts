import { Resend } from "resend";
import type { Order } from "@/generated/prisma/client";
import { STORYBOARD_REROLL_CAP, REFUND_AMOUNT_USD, NONREFUNDABLE_FEE_USD } from "@/lib/safety-net";

/**
 * Order-lifecycle email — provider chain, same shape as lib/waitlist.ts:
 *
 * 1. Klaviyo — used when KLAVIYO_API_KEY is set. Tracks a custom event
 *    ("Order Paid" / "Storyboard Ready" / "Film Delivered") via the Events
 *    API; the actual email template + send timing is owned by a Klaviyo
 *    Flow triggered on that metric (per business_strategy.md §2.5's flow
 *    plan) — we never author email HTML here for this path.
 * 2. Resend — used when KLAVIYO_API_KEY is unset but RESEND_API_KEY is set.
 *    A direct transactional send with HTML authored below. Good for
 *    going live before Klaviyo flows are built out.
 * 3. console.log mock — neither configured (current default/dev state).
 *
 * sendWelcomeUploadEmail / sendChooseStillEmail / sendDeliveryEmail /
 * sendAddonConfirmationEmail all follow this same 3-tier fallback.
 *
 * createPodOrder -> lib/printify.ts's Printify order API. Pass 2
 * (PRICING-PRODUCT-V2-SPEC.md §5): fires once an order has purchased a
 * physical add-on (Printed Poster / Gallery Canvas) via the add-on Checkout
 * webhook (app/api/webhooks/stripe/route.ts) — a no-op before that. Logs
 * and returns cleanly if PRINTIFY_API_KEY isn't configured yet.
 */

const KLAVIYO_REVISION = "2024-10-15";

function approveUrl(order: Order): string {
  const base = process.env.APP_BASE_URL ?? "http://localhost:3100";
  return new URL(`/approve/${order.approveToken}`, base).toString();
}

/** Track a custom Klaviyo metric so an Owner-built Flow can send the email. */
async function trackKlaviyoEvent(
  apiKey: string,
  metricName: string,
  order: Order,
  properties: Record<string, unknown>
): Promise<void> {
  const res = await fetch("https://a.klaviyo.com/api/events/", {
    method: "POST",
    headers: {
      Authorization: `Klaviyo-API-Key ${apiKey}`,
      "Content-Type": "application/vnd.api+json",
      revision: KLAVIYO_REVISION,
    },
    body: JSON.stringify({
      data: {
        type: "event",
        attributes: {
          properties,
          metric: { data: { type: "metric", attributes: { name: metricName } } },
          profile: { data: { type: "profile", attributes: { email: order.customerEmail } } },
        },
      },
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Klaviyo event "${metricName}" failed: ${res.status} ${res.statusText} ${detail}`.trim());
  }
}

function resendClient(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  return key ? new Resend(key) : null;
}

function fromAddress(): string {
  return process.env.RESEND_FROM_EMAIL ?? "Marquee Tails <onboarding@resend.dev>";
}

export async function sendChooseStillEmail(order: Order): Promise<void> {
  const petName = order.petName ?? "Your Star";
  const link = approveUrl(order);
  const apiKey = process.env.KLAVIYO_API_KEY;

  if (apiKey) {
    await trackKlaviyoEvent(apiKey, "Storyboard Ready", order, {
      order_id: order.id,
      pet_name: petName,
      world: order.world,
      approve_url: link,
    });
    return;
  }

  const resend = resendClient();
  if (resend) {
    const { error } = await resend.emails.send({
      from: fromAddress(),
      to: order.customerEmail,
      subject: `${petName}'s storyboard is ready — pick your favorites`,
      html: `
        <p>Six scenes, three takes each — ${petName}'s storyboard is painted and
        waiting for your director's eye.</p>
        <p><a href="${link}">Pick your favorite of every scene →</a></p>
        <p style="color:#888;font-size:12px">This is a private screening link, just for you.</p>
      `,
    });
    if (error) throw new Error(`Resend "choose still" send failed: ${JSON.stringify(error)}`);
    return;
  }

  console.log(
    `[mock:email] "choose your still" mail to=${order.customerEmail} order=${order.id} link=/approve/${order.approveToken} — set KLAVIYO_API_KEY or RESEND_API_KEY to send for real`
  );
}

export async function sendDeliveryEmail(order: Order): Promise<void> {
  const petName = order.petName ?? "Your Star";
  const link = approveUrl(order);
  const apiKey = process.env.KLAVIYO_API_KEY;

  if (apiKey) {
    await trackKlaviyoEvent(apiKey, "Film Delivered", order, {
      order_id: order.id,
      pet_name: petName,
      world: order.world,
      approve_url: link,
      video_url: order.finalVideoUrl,
      social_video_url: order.socialVideoUrl,
    });
    return;
  }

  const resend = resendClient();
  if (resend) {
    const { error } = await resend.emails.send({
      from: fromAddress(),
      to: order.customerEmail,
      subject: `${petName}'s premiere is ready!`,
      html: `
        <p>${petName}'s film has wrapped, passed quality check, and is ready
        to premiere.</p>
        <p><a href="${link}">Watch and download ${petName}'s film →</a></p>
        <p><a href="${link}#keepsake">Make it a keepsake — add a printed poster or gallery canvas →</a></p>
        <p style="color:#888;font-size:12px">This is a private screening link, just for you.</p>
      `,
    });
    if (error) throw new Error(`Resend delivery send failed: ${JSON.stringify(error)}`);
    return;
  }

  console.log(
    `[mock:email] delivery mail to=${order.customerEmail} order=${order.id} video=${order.finalVideoUrl} — set KLAVIYO_API_KEY or RESEND_API_KEY to send for real`
  );
}

export async function sendWelcomeUploadEmail(order: Order): Promise<void> {
  const link = approveUrl(order); // 既存のapproveUrl()ヘルパーをそのまま使う
  const apiKey = process.env.KLAVIYO_API_KEY;

  if (apiKey) {
    await trackKlaviyoEvent(apiKey, "Order Paid", order, {
      order_id: order.id,
      tier: order.tier,
      approve_url: link,
    });
    return;
  }

  const resend = resendClient();
  if (resend) {
    const { error } = await resend.emails.send({
      from: fromAddress(),
      to: order.customerEmail,
      subject: `You're in! Let's meet your star`,
      html: `
        <p>Thanks for your order — time to send us the photos that'll become
        your pet's premiere.</p>
        <p><a href="${link}">Upload your pet's photos →</a></p>
        <p style="color:#888;font-size:12px">This is a private link, just for you.</p>
      `,
    });
    if (error) throw new Error(`Resend "welcome" send failed: ${JSON.stringify(error)}`);
    return;
  }

  console.log(
    `[mock:email] welcome/upload mail to=${order.customerEmail} order=${order.id} tier=${order.tier} link=/approve/${order.approveToken} — set KLAVIYO_API_KEY or RESEND_API_KEY to send for real`
  );
}

export async function createPodOrder(order: Order): Promise<void> {
  // Pass 2: fires once an order has purchased a physical add-on (Printed
  // Poster / Gallery Canvas) — a no-op before that (no plan sells a physical
  // good at base checkout).
  if (!order.addonType) {
    console.log(`[pod] skip — order=${order.id} no physical add-on purchased`);
    return;
  }
  try {
    const { createPrintifyOrder } = await import("./printify");
    const result = await createPrintifyOrder(order);
    if (result) {
      const { prisma } = await import("./db");
      await prisma.order.update({ where: { id: order.id }, data: { podOrderId: result.printifyOrderId } });
      console.log(`[pod] Printify order created order=${order.id} printifyOrderId=${result.printifyOrderId}`);
    } else {
      console.log(`[pod] Printify not configured yet — order=${order.id} addonType=${order.addonType} not submitted (set PRINTIFY_*_BLUEPRINT_ID etc.)`);
    }
  } catch (err) {
    // Never let a POD failure block delivery — same pattern as poster-print
    // rendering in lib/approvals.ts. Admin needs to see this in logs and
    // manually submit the Printify order if it ever fires in production.
    console.error(`[pod] Printify order FAILED order=${order.id} — manual follow-up needed`, err);
  }
}

/** Human label for the add-on type — used in confirmation email + UI. */
function addonLabel(addonType: string): string {
  return addonType === "canvas" ? "gallery canvas" : "printed poster";
}

/**
 * Pass 2 — sent when the add-on Checkout webhook attaches a purchased
 * physical add-on to an order (app/api/webhooks/stripe/route.ts). Follows
 * the same 3-tier provider chain as sendDeliveryEmail et al.
 */
export async function sendAddonConfirmationEmail(order: Order): Promise<void> {
  const petName = order.petName ?? "Your Star";
  const addonType = order.addonType ?? "poster";
  const label = addonLabel(addonType);
  const apiKey = process.env.KLAVIYO_API_KEY;

  if (apiKey) {
    await trackKlaviyoEvent(apiKey, "Addon Purchased", order, {
      order_id: order.id,
      addon_type: addonType,
      pet_name: petName,
    });
    return;
  }

  const resend = resendClient();
  if (resend) {
    const { error } = await resend.emails.send({
      from: fromAddress(),
      to: order.customerEmail,
      subject: `Your ${petName} keepsake is on its way`,
      html: `
        <p>We're printing your ${label} and will email tracking when it ships.</p>
        <p style="color:#888;font-size:12px">Questions? Just reply to this email.</p>
      `,
    });
    if (error) throw new Error(`Resend addon confirmation send failed: ${JSON.stringify(error)}`);
    return;
  }

  console.log(
    `[mock:email] addon confirmation mail to=${order.customerEmail} order=${order.id} addon=${addonType} — set KLAVIYO_API_KEY or RESEND_API_KEY to send for real`
  );
}

/**
 * B2-SAFETY-NET-SPEC.md §4.4 — the customer just used their last free
 * re-roll and requested the $200 refund; alert US so a human can process it
 * (§4.3 — this app never calls Stripe's refund API, so nothing happens on
 * this order until a person acts on this email). Unlike every other
 * function in this file the recipient is the ADMIN, not the customer, so
 * this skips the Klaviyo customer-event path entirely (trackKlaviyoEvent
 * always profiles order.customerEmail, which would be the wrong inbox for
 * an internal ops alert) and goes straight Resend -> console.log.
 */
export async function sendRefundRequestedAlert(order: Order): Promise<void> {
  const petName = order.petName ?? "Unnamed pet";
  const adminEmail = process.env.ADMIN_ALERT_EMAIL ?? "support@marqueetails.com";
  const link = new URL(
    `/admin/${order.id}`,
    process.env.APP_BASE_URL ?? "http://localhost:3100"
  ).toString();

  const resend = resendClient();
  if (resend) {
    const { error } = await resend.emails.send({
      from: fromAddress(),
      to: adminEmail,
      subject: `[Action needed] $${REFUND_AMOUNT_USD} refund requested — ${petName} (${order.id})`,
      html: `
        <p>${petName}'s order (${order.id}, ${order.customerEmail}) has used all
        ${STORYBOARD_REROLL_CAP} free storyboard re-rolls and requested the
        $${REFUND_AMOUNT_USD} refund (B2-SAFETY-NET-SPEC.md §3.5(C)/§4).</p>
        <p>Issue $${REFUND_AMOUNT_USD} by hand from the Stripe dashboard against
        Stripe session <strong>${order.stripeSessionId}</strong>, then mark it
        as refunded on the order's admin page so the customer gets their
        confirmation email and the order closes out:</p>
        <p><a href="${link}">${link}</a></p>
      `,
    });
    if (error) throw new Error(`Resend refund-alert send failed: ${JSON.stringify(error)}`);
    return;
  }

  console.log(
    `[mock:email] REFUND REQUESTED alert to=${adminEmail} order=${order.id} pet=${petName} customer=${order.customerEmail} stripeSession=${order.stripeSessionId} — set RESEND_API_KEY to send for real`
  );
}

/**
 * B2-SAFETY-NET-SPEC.md §4.4 — sent once the admin records the $200 as
 * actually refunded in Stripe (app/admin/actions.ts#markRefundIssuedAction).
 * Standard customer-lifecycle fallback chain, like every other send above.
 */
export async function sendRefundIssuedEmail(order: Order): Promise<void> {
  const petName = order.petName ?? "Your Star";
  const apiKey = process.env.KLAVIYO_API_KEY;

  if (apiKey) {
    await trackKlaviyoEvent(apiKey, "Refund Issued", order, {
      order_id: order.id,
      pet_name: petName,
      refund_amount_usd: REFUND_AMOUNT_USD,
      nonrefundable_fee_usd: NONREFUNDABLE_FEE_USD,
    });
    return;
  }

  const resend = resendClient();
  if (resend) {
    const { error } = await resend.emails.send({
      from: fromAddress(),
      to: order.customerEmail,
      subject: `Your $${REFUND_AMOUNT_USD} refund is on its way`,
      html: `
        <p>We've issued your $${REFUND_AMOUNT_USD} refund for ${petName}'s
        Director's Cut order — it should land on your card within 5-10
        business days.</p>
        <p>The $${NONREFUNDABLE_FEE_USD} concept &amp; storyboard fee covers the
        treatment and storyboard work we already did for ${petName}, so it
        isn't part of this refund.</p>
        <p style="color:#888;font-size:12px">Questions? Just reply to this email.</p>
      `,
    });
    if (error) throw new Error(`Resend refund-issued send failed: ${JSON.stringify(error)}`);
    return;
  }

  console.log(
    `[mock:email] refund issued mail to=${order.customerEmail} order=${order.id} amount=$${REFUND_AMOUNT_USD} — set KLAVIYO_API_KEY or RESEND_API_KEY to send for real`
  );
}

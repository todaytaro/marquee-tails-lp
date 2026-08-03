import { Resend } from "resend";
import type { Order } from "@/generated/prisma/client";
import { STORYBOARD_REROLL_CAP, REFUND_AMOUNT_USD, NONREFUNDABLE_FEE_USD } from "@/lib/safety-net";
import { recordEvidence } from "@/lib/evidence";

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

/**
 * The customer's private link into their order — the ONLY way back in, since
 * there is no login and the token in the URL is the auth.
 *
 * Refuses to fall back to localhost in production. That fallback used to be
 * silent, which meant a missing APP_BASE_URL produced a perfectly successful
 * send carrying a link to `http://localhost:3100` — a dead end for the
 * customer and nothing at all in the logs to notice. Failing the send is
 * strictly better: it surfaces as an error someone can act on, and the
 * customer is no worse off than if the mail had arrived unusable.
 *
 * This got sharper with LORA-STORYBOARD-SPEC.md §2.7: the storyboard now
 * takes hours (LoRA training runs first), so nobody is sitting on the page
 * waiting when it lands. The Gate-1 mail IS the hand-off. If its link is
 * wrong, the order simply stops there.
 */
function approveUrl(order: Order): string {
  const base = process.env.APP_BASE_URL;
  if (!base) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "APP_BASE_URL is not set — refusing to email a localhost link. Set it on Vercel and on the Trigger.dev environment."
      );
    }
    return new URL(`/approve/${order.approveToken}`, "http://localhost:3100").toString();
  }
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

/**
 * CHARGEBACK-DEFENSE-SPEC.md §3 email.sent — recorded only for a REAL Resend
 * send. The dev/console.log mock path never actually delivers anything, so
 * recording it as evidence would misrepresent what happened, and the Klaviyo
 * path's event-tracking API hands back no message id to anchor a record to.
 * Capturing Resend's own message id (`data.id` from `resend.emails.send`)
 * means a dispute can point at Resend's own delivery record, not just this
 * app's say-so. Never throws (lib/evidence.ts) — a failed evidence insert
 * must never turn a successful send into a failed one.
 */
async function recordEmailEvidence(
  order: Order,
  template: string,
  resendMessageId: string | null | undefined
): Promise<void> {
  await recordEvidence(order.id, "email.sent", {
    template,
    to: order.customerEmail,
    resendMessageId: resendMessageId ?? null,
  });
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
    const { data, error } = await resend.emails.send({
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
    await recordEmailEvidence(order, "choose-still", data?.id);
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
    const { data, error } = await resend.emails.send({
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
    await recordEmailEvidence(order, "delivery", data?.id);
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
    const { data, error } = await resend.emails.send({
      from: fromAddress(),
      to: order.customerEmail,
      subject: `You're in! Let's meet your star`,
      html: `
        <p>Thanks for your order — time to send us the photos that'll become
        your pet's premiere.</p>
        <p><a href="${link}">Upload your pet's photos →</a></p>
        <!-- STORYBOARD-ADMIN-GATE-SPEC.md §3.6: was "up to about three hours"
             (LORA-STORYBOARD-SPEC.md §2.1/§2.7 — the ~45min LoRA training
             bound, with headroom). That promise no longer holds now that a
             human director reviews every cut before anything reaches the
             customer (§0/§3.1) — the review has no fixed duration, so "up to
             one business day" is the bound we can actually keep, not a
             number we hope fal's queue respects. The training-a-custom-model
             reason still explains the wait; the director review is now ADDED
             to that reason rather than replacing it, turning the extra time
             into a second, visible quality step rather than an unexplained
             delay. -->
        <p>Building your storyboard takes up to one business day. We train a
        custom model of your pet first, so every scene is unmistakably them —
        not a generic lookalike — then a director reviews all eighteen shots
        before anything reaches you. No need to wait around: we'll email you
        the moment it's ready.</p>
        <p style="color:#888;font-size:12px">This is a private link, just for you.</p>
      `,
    });
    if (error) throw new Error(`Resend "welcome" send failed: ${JSON.stringify(error)}`);
    await recordEmailEvidence(order, "welcome-upload", data?.id);
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
    const { data, error } = await resend.emails.send({
      from: fromAddress(),
      to: order.customerEmail,
      subject: `Your ${petName} keepsake is on its way`,
      html: `
        <p>We're printing your ${label} and will email tracking when it ships.</p>
        <p style="color:#888;font-size:12px">Questions? Just reply to this email.</p>
      `,
    });
    if (error) throw new Error(`Resend addon confirmation send failed: ${JSON.stringify(error)}`);
    await recordEmailEvidence(order, "addon-confirmation", data?.id);
    return;
  }

  console.log(
    `[mock:email] addon confirmation mail to=${order.customerEmail} order=${order.id} addon=${addonType} — set KLAVIYO_API_KEY or RESEND_API_KEY to send for real`
  );
}

/**
 * STORYBOARD-ADMIN-GATE-SPEC.md §3.4 — the storyboard (6 cuts × 3 takes) just
 * finished generating and is sitting in the admin review queue
 * (lib/stills-pipeline.ts#completeStillsGeneration leaves the order in
 * IMAGE_GENERATING with storyboardOptions populated — that combination IS the
 * queue, §2). Nothing moves toward the customer until a human looks at it
 * (§0: a take where the dog was unreadable inside the costume once reached a
 * real Gate 1 because nobody had). This alert is what makes that possible in
 * practice — without it, an order simply sits here until someone happens to
 * check /admin, and the customer waits indefinitely for a mail that will
 * never come. Modeled directly on sendRefundRequestedAlert above: recipient
 * is the OWNER (ADMIN_ALERT_EMAIL, falling back to support@marqueetails.com),
 * never the customer, so — like that function — this skips the Klaviyo
 * customer-event path entirely (trackKlaviyoEvent always profiles
 * order.customerEmail, the wrong inbox for an internal ops alert) and goes
 * straight Resend -> console.log.
 */
export async function sendAdminStoryboardReviewAlert(order: Order): Promise<void> {
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
      subject: `[Review needed] ${petName}'s storyboard is ready (${order.id})`,
      html: `
        <p>${petName}'s order (${order.id}, ${order.customerEmail}, ${order.tier ?? "unknown"} tier)
        has a finished storyboard waiting for your review before it goes to the
        customer (STORYBOARD-ADMIN-GATE-SPEC.md §3.2/§3.5).</p>
        <p>Check every cut for a readable dog, re-roll anything that isn't, then
        approve to send it to ${order.customerEmail}:</p>
        <p><a href="${link}">${link}</a></p>
      `,
    });
    if (error) throw new Error(`Resend storyboard-review-alert send failed: ${JSON.stringify(error)}`);
    return;
  }

  console.log(
    `[mock:email] STORYBOARD REVIEW NEEDED alert to=${adminEmail} order=${order.id} pet=${petName} customer=${order.customerEmail} link=${link} — set RESEND_API_KEY to send for real`
  );
}

/**
 * B2-SAFETY-NET-SPEC.md §4.4 — the customer just used their last free
 * re-roll and requested the refund; alert US so a human can process it
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
 * B2-SAFETY-NET-SPEC.md §4.4 — sent once the admin records the refund as
 * actually refunded in Stripe (app/admin/actions.ts#markRefundIssuedAction).
 * Standard customer-lifecycle fallback chain, like every other send above.
 *
 * Links back to the approve page (now rendering, on this CANCELLED order,
 * the treatment + full storyboard as the keepsake the fee paid for —
 * app/approve/[token]/page.tsx#RefundIssuedView). A refunded customer has no
 * other reason to revisit that link, so this email is the one moment that
 * makes them aware the keepsake is even there; without the link, "yours to
 * keep" would still be true on the page but undiscoverable in practice.
 */
export async function sendRefundIssuedEmail(order: Order): Promise<void> {
  const petName = order.petName ?? "Your Star";
  const link = approveUrl(order);
  const apiKey = process.env.KLAVIYO_API_KEY;

  if (apiKey) {
    await trackKlaviyoEvent(apiKey, "Refund Issued", order, {
      order_id: order.id,
      pet_name: petName,
      refund_amount_usd: REFUND_AMOUNT_USD,
      nonrefundable_fee_usd: NONREFUNDABLE_FEE_USD,
      approve_url: link,
    });
    return;
  }

  const resend = resendClient();
  if (resend) {
    const { data, error } = await resend.emails.send({
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
        <p><a href="${link}">See ${petName}'s treatment and full storyboard →</a>
        they're yours to keep, and that link is where to find them.</p>
        <p style="color:#888;font-size:12px">Questions? Just reply to this email.</p>
      `,
    });
    if (error) throw new Error(`Resend refund-issued send failed: ${JSON.stringify(error)}`);
    await recordEmailEvidence(order, "refund-issued", data?.id);
    return;
  }

  console.log(
    `[mock:email] refund issued mail to=${order.customerEmail} order=${order.id} amount=$${REFUND_AMOUNT_USD} link=${link} — set KLAVIYO_API_KEY or RESEND_API_KEY to send for real`
  );
}

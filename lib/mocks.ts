import { Resend } from "resend";
import type { Order } from "@/generated/prisma/client";

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
 * sendWelcomeUploadEmail / sendChooseStillEmail / sendDeliveryEmail all
 * follow this same 3-tier fallback.
 *
 * createPodOrder -> lib/printify.ts's Printify order API (Feature Film /
 * Collector's Edition tiers only; digital-only orders are a no-op). Logs and
 * returns cleanly if PRINTIFY_API_KEY isn't configured yet.
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
  if (order.tier === "digital" || !order.tier) {
    console.log(`[pod] skip — order=${order.id} tier=${order.tier ?? "unknown"} has no physical good`);
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
      console.log(`[pod] Printify not configured yet — order=${order.id} tier=${order.tier} not submitted (set PRINTIFY_API_KEY etc.)`);
    }
  } catch (err) {
    // Never let a POD failure block delivery — same pattern as poster-print
    // rendering in lib/approvals.ts. Admin needs to see this in logs and
    // manually submit the Printify order if it ever fires in production.
    console.error(`[pod] Printify order FAILED order=${order.id} — manual follow-up needed`, err);
  }
}

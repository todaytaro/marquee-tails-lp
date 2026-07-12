import { fal } from "@fal-ai/client";
import { OrderStatus, type Order } from "@/generated/prisma/client";
import { prisma } from "./db";
import { transitionOrder } from "./orders";

/**
 * Real video generation via fal.ai Kling v3 (image-to-video).
 *
 * Flow: Gate 1 approval -> kickVideoGeneration() submits the approved still
 * to fal's queue -> fal calls back (webhook in prod, dev poller locally) ->
 * completeVideoGeneration() moves the order to AWAITING_ADMIN_APPROVAL.
 *
 * MVP scope: ONE cinematic shot (5s) per order from the selected still.
 * The full 8-12 shot film uses `multi_prompt` + assembly later (n8n phase).
 *
 * Env: FAL_KEY (auth), APP_BASE_URL (webhook target, e.g. Vercel URL),
 * FAL_WEBHOOK_SECRET (shared secret in the webhook URL), PUBLIC_ASSET_BASE
 * (origin for resolving relative /assets/... stills in dev).
 */

const MODEL = "fal-ai/kling-video/v3/standard/image-to-video"; // $0.084/s (audio off) / $0.126 (on)

// Per-world single-shot prompts. Subtle motion preserves likeness; the still
// already carries composition and identity.
const WORLD_PROMPTS: Record<string, string> = {
  deepspace:
    "Cinematic sci-fi film shot. The pet from the reference image comes alive on the starship bridge: it slowly turns its head toward the giant viewport as a violet nebula drifts past, console lights flickering across its fur, subtle anamorphic lens flare, epic and serene mood.",
  storybook:
    "Cinematic fantasy film shot. The royal pet from the reference image comes alive on the castle balcony: a warm golden-hour breeze moves its fur and the tiny cape, banners flutter softly in the background kingdom, painterly light, gentle heroic mood.",
  noir:
    "Cinematic film noir shot. The detective pet from the reference image comes alive in the rain-slicked alley: it lifts its gaze from under the fedora as rain drips from the streetlamp halo, drifting fog, black-and-white with one warm gold light source, moody and mysterious.",
};

function assertEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

/** Resolve possibly-relative still URLs (/assets/...) to a public absolute URL. */
function publicImageUrl(url: string): string {
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  const base =
    process.env.PUBLIC_ASSET_BASE ?? "https://marquee-tails-lp.vercel.app";
  return new URL(url, base).toString();
}

export async function kickVideoGeneration(order: Order): Promise<void> {
  const falKey = assertEnv("FAL_KEY");
  fal.config({ credentials: falKey });

  if (!order.selectedImageUrl) {
    throw new Error(`Order ${order.id} has no selectedImageUrl`);
  }

  const prompt =
    WORLD_PROMPTS[order.world ?? ""] ??
    "Cinematic film shot. The pet from the reference image comes alive with subtle, natural motion; gentle camera push-in; warm cinematic lighting.";

  const appBase = process.env.APP_BASE_URL ?? "http://localhost:3100";
  const webhookSecret = process.env.FAL_WEBHOOK_SECRET ?? "";
  const webhookUrl = `${appBase}/api/webhooks/fal?orderId=${encodeURIComponent(order.id)}&secret=${encodeURIComponent(webhookSecret)}`;
  const isLocal = appBase.includes("localhost") || appBase.includes("127.0.0.1");

  const { request_id } = await fal.queue.submit(MODEL, {
    input: {
      start_image_url: publicImageUrl(order.selectedImageUrl),
      prompt,
      duration: "5",
      generate_audio: true,
      negative_prompt:
        "blur, distort, low quality, extra limbs, deformed face, warped anatomy, text, watermark",
    },
    // fal cannot reach localhost — only attach the webhook when public.
    ...(isLocal ? {} : { webhookUrl }),
  });

  await prisma.order.update({
    where: { id: order.id },
    data: { falRequestId: request_id },
  });
  console.log(
    `[video-pipeline] submitted order=${order.id} fal_request=${request_id} (${isLocal ? "dev poller" : "webhook"})`
  );

  if (isLocal) {
    // Dev fallback: next dev is a long-lived process, so a detached poller is
    // fine here. Production always uses the webhook (serverless-safe).
    void pollUntilDone(order.id, request_id).catch((e) =>
      console.error(`[video-pipeline] dev poller failed order=${order.id}`, e)
    );
  }
}

async function pollUntilDone(orderId: string, requestId: string): Promise<void> {
  const deadline = Date.now() + 15 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 10_000));
    const status = await fal.queue.status(MODEL, {
      requestId,
      logs: false,
    });
    if (status.status === "COMPLETED") {
      const result = await fal.queue.result(MODEL, { requestId });
      const videoUrl = (result.data as { video?: { url?: string } })?.video?.url;
      if (!videoUrl) throw new Error(`fal result has no video url (request ${requestId})`);
      await completeVideoGeneration(orderId, videoUrl);
      return;
    }
    console.log(`[video-pipeline] order=${orderId} status=${status.status}`);
  }
  throw new Error(`fal request ${requestId} did not complete within 15min`);
}

/**
 * Shared completion: called by the webhook route (prod) or dev poller.
 * Atomic transition — a replayed webhook cannot double-fire (409 semantics).
 */
export async function completeVideoGeneration(
  orderId: string,
  videoUrl: string
): Promise<void> {
  await transitionOrder(
    orderId,
    OrderStatus.VIDEO_GENERATING,
    OrderStatus.AWAITING_ADMIN_APPROVAL,
    "system",
    { finalVideoUrl: videoUrl },
    "video pipeline finished (fal.ai Kling v3)"
  );
  console.log(`[video-pipeline] order=${orderId} -> AWAITING_ADMIN_APPROVAL`);
}

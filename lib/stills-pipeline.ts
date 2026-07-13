import { fal } from "@fal-ai/client";
import { OrderStatus, type Order } from "@/generated/prisma/client";
import { prisma } from "./db";
import { transitionOrder } from "./orders";
import { sendChooseStillEmail } from "./mocks";

/**
 * Concept-still generation (the step BEFORE Gate 1).
 *
 * From the customer's uploaded pet photos, generate three concept stills —
 * each a DIFFERENT scene inside the chosen world (TAKE 1/2/3), so the
 * customer's pick meaningfully steers the film (variation design: shot
 * pools + personality arcs + scene-level takes).
 *
 * Model: fal-ai/nano-banana-pro/edit — multi-reference identity-preserving
 * editing, $0.15/image at 1-2K. 3 takes ≈ $0.45 per order.
 *
 * Same operational pattern as video-pipeline: detached async in dev,
 * compensating revert to UPLOADING on failure so orders never strand.
 */

const MODEL = "fal-ai/nano-banana-pro/edit";

// TAKE 1 / 2 / 3 — three distinct scenes per world.
const WORLD_SCENES: Record<string, string[]> = {
  deepspace: [
    "standing proudly on the command bridge of a starship in a fitted astronaut suit, gazing out the giant viewport at a violet nebula, console lights glowing across its fur",
    "floating gently on a spacewalk outside the ship in a sleek space suit, tether drifting, the blue curve of an alien planet and two moons behind",
    "standing on the ridge of an alien desert at dusk in explorer gear, twin suns setting over crystalline rock spires, long heroic shadow",
  ],
  storybook: [
    "standing regally on a storybook castle balcony in tiny ornate royal robes and a small crown, overlooking a painterly kingdom at golden hour",
    "sitting on a velvet cushion in a candle-lit royal library, wearing a scholar's cape, ancient books and a glowing map spread open",
    "walking bravely down an enchanted forest path in a small knight's cloak, fireflies and soft god-rays between giant mossy trees",
  ],
  noir: [
    "standing under a flickering streetlamp in a rain-slicked 1940s alley, wearing a tiny trench coat and fedora, dramatic black-and-white with one warm gold light",
    "sitting behind a detective's desk in a dim office, venetian-blind shadows across the fur, a case file and old telephone in frame, film noir style",
    "on a foggy rooftop stakeout at night in a trench coat, city neon glowing faintly below, profile silhouette against the mist, film noir style",
  ],
};

const STILL_PROMPT = (scene: string) =>
  `Using the pet from the reference photos as the main character, create ONE cinematic live-action film still: the exact same animal — identical breed, fur colors, markings and face — ${scene}. Blockbuster movie cinematography, dramatic lighting, shallow depth of field, film grain. The pet must be unmistakably the same pet as in the reference photos. No text, no watermark, no humans.`;

export async function kickStillsGeneration(order: Order): Promise<void> {
  if (process.env.VIDEO_PIPELINE_MOCK === "1") {
    console.log(`[stills-pipeline:MOCK] kick order=${order.id} — no compute spent`);
    // Mock path still completes the flow so dev/e2e can traverse states.
    await completeStillsGeneration(order.id, [
      "/assets/world-deepspace.png",
      "/assets/world-storybook.png",
      "/assets/world-noir.png",
    ]);
    return;
  }

  const falKey = process.env.FAL_KEY;
  if (!falKey) throw new Error("FAL_KEY is not set");
  fal.config({ credentials: falKey });

  if (order.uploadedPhotoUrls.length === 0) {
    throw new Error(`Order ${order.id} has no uploaded photos`);
  }
  const scenes = WORLD_SCENES[order.world ?? ""] ?? WORLD_SCENES.deepspace;

  // Detached: generation takes ~30-90s for 3 stills. next dev is long-lived;
  // on Vercel move this behind a queue/waitUntil (n8n phase).
  void generateAll(order, scenes).catch(async (e) => {
    console.error(`[stills-pipeline] failed order=${order.id}, reverting`, e);
    await transitionOrder(
      order.id,
      OrderStatus.IMAGE_GENERATING,
      OrderStatus.UPLOADING,
      "system",
      {},
      "stills generation failed — reverted for retry"
    ).catch((revertErr) =>
      console.error(`[stills-pipeline] revert also failed order=${order.id}`, revertErr)
    );
  });
}

async function generateAll(order: Order, scenes: string[]): Promise<void> {
  console.log(`[stills-pipeline] generating 3 takes order=${order.id} world=${order.world}`);
  const results = await Promise.all(
    scenes.map((scene) =>
      fal.subscribe(MODEL, {
        input: {
          prompt: STILL_PROMPT(scene),
          image_urls: order.uploadedPhotoUrls,
          num_images: 1,
          resolution: "2K",
          aspect_ratio: "16:9",
          output_format: "png",
        },
      })
    )
  );

  const urls = results.map((r) => {
    const url = (r.data as { images?: { url?: string }[] })?.images?.[0]?.url;
    if (!url) throw new Error("nano-banana result missing image url");
    return url;
  });

  await completeStillsGeneration(order.id, urls);
}

export async function completeStillsGeneration(
  orderId: string,
  conceptImageUrls: string[]
): Promise<void> {
  // Store the stills, then transition. Two writes, but the gate lives on the
  // transition: customers can only pick from whatever is stored when the
  // status flips to AWAITING_CUSTOMER_APPROVAL.
  await prisma.order.update({ where: { id: orderId }, data: { conceptImageUrls } });
  const order = await transitionOrder(
    orderId,
    OrderStatus.IMAGE_GENERATING,
    OrderStatus.AWAITING_CUSTOMER_APPROVAL,
    "system",
    {},
    `concept stills ready (${conceptImageUrls.length} takes)`
  );
  await sendChooseStillEmail(order);
  console.log(`[stills-pipeline] order=${orderId} -> AWAITING_CUSTOMER_APPROVAL`);
}

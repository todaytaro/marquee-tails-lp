import { fal } from "@fal-ai/client";
import { OrderStatus, type Order } from "@/generated/prisma/client";
import { prisma } from "./db";
import { transitionOrder } from "./orders";
import { sendChooseStillEmail } from "./mocks";

/**
 * Concept-still generation v2 — "identity lock" (the step BEFORE Gate 1).
 *
 * Likeness is THE conversion moment ("that's my pet!"), so instead of one
 * transformation jump we run three stages:
 *
 *   Stage 0  describePet      VLM extracts the pet's distinguishing features
 *                             as text (coat colors, cut, face) — injected into
 *                             every downstream prompt so the model can't fall
 *                             back to a generic breed prototype.
 *   Stage 1  identityPortrait Neutral studio close-up from the photos — locks
 *                             the face BEFORE any costume/scene transformation.
 *   Stage 2  three takes      Scene generations referencing the portrait +
 *                             originals, face-forward 3:4 compositions so the
 *                             face carries the frame.
 *
 * Cost: ~$0.01 (VLM) + $0.15 (portrait) + 3×$0.15 (takes) ≈ $0.61/order.
 *
 * Ops pattern unchanged: detached async in dev, compensating revert to
 * UPLOADING on failure, VIDEO_PIPELINE_MOCK short-circuit for e2e.
 */

const EDIT_MODEL = "fal-ai/nano-banana-pro/edit";
const VISION_MODEL = "openrouter/router/vision";
const VISION_LLM = "google/gemini-2.5-flash";

// TAKE 1 / 2 / 3 — distinct scenes per world, framed face-forward
// (medium shots; wide scenery shrinks the face and invites freelancing).
const WORLD_SCENES: Record<string, string[]> = {
  deepspace: [
    "in a fitted astronaut suit on a starship bridge, medium shot from the chest up, a violet nebula glowing through the viewport behind them",
    "in a sleek space suit during a spacewalk, medium close shot, helmet visor open, the blue curve of an alien planet behind",
    "in explorer gear on an alien ridge at dusk, medium shot, twin suns setting behind crystalline rock spires",
  ],
  storybook: [
    "in tiny ornate royal robes and a small crown on a castle balcony, medium shot from the chest up, a painterly kingdom soft-focused behind",
    "in a scholar's cape beside candle-lit ancient books in a royal library, medium close shot, warm glow on the face",
    "in a small knight's cloak on an enchanted forest path, medium shot, fireflies and god-rays soft in the background",
  ],
  noir: [
    "in a tiny trench coat and fedora under a flickering streetlamp in a rain-slicked 1940s alley, medium shot from the chest up, black-and-white with one warm gold light",
    "in a detective's office behind a desk with a case file, medium close shot, venetian-blind shadows across the scene, film noir style",
    "in a trench coat on a foggy rooftop at night, medium shot, city neon glowing soft below, film noir style",
  ],
};

const IDENTITY_RULES =
  "Preserve this exact pet's identity from the reference photos: the same coat colors in the same places, the same fur texture and haircut, the same face structure, eyes, ears and proportions. Do NOT idealize, do NOT groom them differently, do NOT drift toward a generic breed look. No text, no watermark, no humans.";

function assertEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

/**
 * Stage 0 — one VLM pass over the uploads that both (a) extracts the pet's
 * distinguishing features and (b) auto-sorts the photos by angle, so the
 * cleanest FRONT-FACING shot seeds the identity portrait and Kling element.
 * No per-photo labeling asked of the customer (auto-detect, not manual).
 */
async function analyzePhotos(
  photoUrls: string[]
): Promise<{ description: string; bestFrontalIndex: number; hasFrontal: boolean }> {
  const n = Math.min(photoUrls.length, 6);
  const r = await fal.subscribe(VISION_MODEL, {
    input: {
      model: VISION_LLM,
      image_urls: photoUrls.slice(0, n),
      prompt:
        `These ${n} photos (indexed 0-${n - 1}) show ONE pet. Reply with ONLY minified JSON, no prose:\n` +
        `{"description":"<one dense sentence, max 70 words: exact coat colors and where they appear, fur texture/length/haircut, face shape, eye color/shape, nose, muzzle/beard/eyebrow markings, body build — features only, no name>",` +
        // These three drift the most and owners notice them, so pin each one
        // explicitly and inject verbatim into every generation prompt.
        `"mouth":"<color of the inside of the mouth/tongue and lips, e.g. pink tongue, black lips>",` +
        `"tail":"<tail length and shape, e.g. short docked stub, long feathered, curled over back>",` +
        `"ears":"<ear carriage exactly, e.g. floppy triangular drop ears, upright pointed, semi-erect>",` +
        `"best_frontal_index":<index of the photo with the clearest, sharpest FRONT-FACING view of the face, or -1 if none is front-facing>}`,
    },
  });
  const raw = String((r.data as { output?: string; text?: string })?.output ?? (r.data as { text?: string })?.text ?? "");
  try {
    const json = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
    const base = String(json.description ?? "").trim().slice(0, 480);
    const idx = Number.isInteger(json.best_frontal_index) ? json.best_frontal_index : -1;
    if (!base) throw new Error("empty description");
    // Pin the three details owners notice most, verbatim, into the description
    // that flows to every downstream prompt (hero sheet, stills, clips).
    const locked: string[] = [];
    if (json.mouth) locked.push(`mouth/tongue: ${String(json.mouth).trim()}`);
    if (json.tail) locked.push(`tail: ${String(json.tail).trim()}`);
    if (json.ears) locked.push(`ears: ${String(json.ears).trim()}`);
    const desc = locked.length
      ? `${base} MUST MATCH EXACTLY — ${locked.join("; ")}.`
      : base;
    return { description: desc, bestFrontalIndex: idx >= 0 && idx < n ? idx : 0, hasFrontal: idx >= 0 };
  } catch {
    // Fallback: use whatever text came back as the description, keep order.
    const desc = raw.replace(/[{}]/g, " ").trim().slice(0, 500);
    if (!desc) throw new Error("vision model returned nothing usable");
    return { description: desc, bestFrontalIndex: 0, hasFrontal: false };
  }
}

/** Stage 1 — neutral close-up that locks the face before any transformation. */
async function generateIdentityPortrait(
  photoUrls: string[],
  description: string
): Promise<string> {
  const r = await fal.subscribe(EDIT_MODEL, {
    input: {
      prompt: `Photorealistic studio portrait photograph of this exact pet from the reference photos: ${description}. Head-and-chest close-up looking toward the camera, plain dark studio background, soft flattering key light, tack-sharp focus on the face. No clothing, no accessories. ${IDENTITY_RULES}`,
      image_urls: photoUrls,
      num_images: 1,
      resolution: "2K",
      aspect_ratio: "3:4",
      output_format: "png",
    },
  });
  const url = (r.data as { images?: { url?: string }[] })?.images?.[0]?.url;
  if (!url) throw new Error("identity portrait result missing image url");
  return url;
}

/** Stage 2 — one cinematic take. */
async function generateTake(
  refs: string[],
  description: string,
  scene: string
): Promise<string> {
  const r = await fal.subscribe(EDIT_MODEL, {
    input: {
      prompt: `This exact pet from the reference photos — ${description}. Create ONE cinematic live-action film still of THIS SAME pet ${scene}. The pet's face is large, well-lit and clearly recognizable. Blockbuster movie cinematography, dramatic lighting, shallow depth of field, film grain. ${IDENTITY_RULES}`,
      image_urls: refs,
      num_images: 1,
      resolution: "2K",
      aspect_ratio: "3:4",
      output_format: "png",
    },
  });
  const url = (r.data as { images?: { url?: string }[] })?.images?.[0]?.url;
  if (!url) throw new Error("take result missing image url");
  return url;
}

/**
 * Full generation run — awaitable (scripts/tests), while kickStillsGeneration
 * fires it detached for the request path.
 */
export async function runStillsGeneration(order: Order): Promise<void> {
  const falKey = assertEnv("FAL_KEY");
  fal.config({ credentials: falKey });

  if (order.uploadedPhotoUrls.length === 0) {
    throw new Error(`Order ${order.id} has no uploaded photos`);
  }
  const scenes = WORLD_SCENES[order.world ?? ""] ?? WORLD_SCENES.deepspace;

  console.log(`[stills-pipeline] stage 0: analyzing photos order=${order.id}`);
  const { description, bestFrontalIndex, hasFrontal } = await analyzePhotos(order.uploadedPhotoUrls);
  console.log(`[stills-pipeline] features: ${description}`);
  console.log(`[stills-pipeline] best frontal: #${bestFrontalIndex}${hasFrontal ? "" : " (no clear frontal detected)"}`);

  // Put the clearest front-facing photo FIRST — it seeds the identity portrait
  // (the anchor for every downstream generation and the Kling character element).
  const orderedPhotos = [
    order.uploadedPhotoUrls[bestFrontalIndex],
    ...order.uploadedPhotoUrls.filter((_, i) => i !== bestFrontalIndex),
  ].filter(Boolean) as string[];

  console.log(`[stills-pipeline] stage 1: identity portrait order=${order.id}`);
  const identityPortraitUrl = await generateIdentityPortrait(orderedPhotos, description);

  await prisma.order.update({
    where: { id: order.id },
    data: { petDescription: description, identityPortraitUrl, uploadedPhotoUrls: orderedPhotos },
  });

  console.log(`[stills-pipeline] stage 2: generating 3 takes order=${order.id} world=${order.world}`);
  // Portrait first in refs — it is the cleanest identity signal.
  const refs = [identityPortraitUrl, ...orderedPhotos.slice(0, 3)];
  const urls = await Promise.all(
    scenes.map((scene) => generateTake(refs, description, scene))
  );

  await completeStillsGeneration(order.id, urls);
}

export async function kickStillsGeneration(order: Order): Promise<void> {
  if (process.env.VIDEO_PIPELINE_MOCK === "1") {
    console.log(`[stills-pipeline:MOCK] kick order=${order.id} — no compute spent`);
    await completeStillsGeneration(order.id, [
      "/assets/world-deepspace.png",
      "/assets/world-storybook.png",
      "/assets/world-noir.png",
    ]);
    return;
  }

  // Detached: ~60-120s for the full chain. next dev is long-lived; on Vercel
  // move behind a queue/waitUntil (n8n phase).
  void runStillsGeneration(order).catch(async (e) => {
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

export async function completeStillsGeneration(
  orderId: string,
  conceptImageUrls: string[]
): Promise<void> {
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

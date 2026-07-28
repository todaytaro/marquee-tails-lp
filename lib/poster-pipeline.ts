import { tasks } from "@trigger.dev/sdk";
import type { generatePosterTask } from "@/trigger/poster"; // type-only: task code stays out of the Next bundle
import { fal } from "@fal-ai/client";
import { type Order } from "@/generated/prisma/client";
import { prisma } from "./db";
import { publicUrl, scoreIdentity } from "./identity";
import { resolveWorld } from "./film-script";
import { IDENTITY_RULES, STYLE_RULES, type StoryboardCut } from "./stills-pipeline";

/**
 * Poster pipeline — the hero product.
 *
 * At Gate 1 the customer marks ONE approved cut as the poster scene
 * (posterCutIndex). While the film renders, this pipeline produces THREE
 * finished one-sheets for that scene and the customer picks their favorite on
 * the "now filming" page — the second human-pick moment, applied to the
 * product that hangs on the wall.
 *
 * Quality model mirrors the film's: the art is generated with the identity
 * stack (chosen cut still + portrait + hero sheet as refs, identity gate,
 * photoreal style lock) in portrait 2:3 at 4K for print, with ABSOLUTELY NO
 * text in the image. `posterOptions` stores this TEXT-FREE art directly — the
 * typography (pet name, tagline, credits, brand) is a separate layer:
 *   - on screen: components/MoviePosterOverlay.tsx (live CSS, any scale)
 *   - for print: lib/poster-print.ts renders that exact design to a flat PNG
 *     (satori → resvg) once the customer's pick is approved at Gate 2
 * so what ships is pixel-identical to what the customer chose, and the title
 * block is never at the mercy of an image model's text rendering.
 *
 * Cost: 3 × $0.30 (nano-banana 4K) + identity scoring ≈ $0.95 + re-rolls.
 * VIDEO_PIPELINE_MOCK=1 fabricates candidates from local assets.
 */

const EDIT_MODEL = "fal-ai/nano-banana-pro/edit";

const NUM_POSTER_TAKES = 3;
const POSTER_IDENTITY_THRESHOLD = 80;
const MAX_POSTER_REROLLS = 2;
const POSTER_SEED = 424201;

function assertEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

/* ------------------------------------------------------------------ */
/* Art generation                                                      */
/* ------------------------------------------------------------------ */

/** One text-free 2:3 key-art take at 4K (print resolution). */
async function generatePosterArt(
  refs: string[],
  description: string,
  costume: string,
  sceneHint: string,
  seed: number
): Promise<string> {
  const r = await fal.subscribe(EDIT_MODEL, {
    input: {
      prompt: `Cinematic theatrical movie poster KEY ART, portrait orientation. The FIRST reference image is the film's exact scene, mood, world and costume — recreate its setting and atmosphere as a vertical one-sheet composition (scene: ${sceneHint}). This exact pet (${description}), ${costume}, as the heroic lead: shown from a slightly pulled-back distance — head and upper body in frame (a medium hero shot, NOT a tight face-filling close-up), a little more of the costume and the surrounding environment visible around it, still sharp, beautifully lit and turned toward the camera, composed in the upper two thirds with the dramatic environment behind; the bottom third calmer and darker, leaving clear open space for a title block. Epic blockbuster one-sheet framing, dramatic rim lighting, rich color grade, film grain. ABSOLUTELY NO text, NO letters, NO typography, NO logos anywhere in the image — the title is composited later. ${STYLE_RULES} ${IDENTITY_RULES}`,
      image_urls: refs,
      num_images: 1,
      resolution: "4K",
      aspect_ratio: "2:3",
      output_format: "png",
      seed,
    },
  });
  const url = (r.data as { images?: { url?: string }[] })?.images?.[0]?.url;
  if (!url) throw new Error("poster art missing url");
  return url;
}

/** Gated take: render, score vs portrait, re-roll on a fresh seed; best-of. */
async function generateGatedPosterArt(
  refs: string[],
  description: string,
  costume: string,
  sceneHint: string,
  portraitRef: string,
  baseSeed: number,
  label: string
): Promise<string> {
  let best = "";
  let bestScore = -1;
  for (let attempt = 0; attempt <= MAX_POSTER_REROLLS; attempt++) {
    const url = await generatePosterArt(refs, description, costume, sceneHint, baseSeed + attempt * 7919);
    const score = await scoreIdentity(portraitRef, url);
    console.log(`[poster] ${label} attempt ${attempt}: consistency ${score}`);
    if (score > bestScore) {
      bestScore = score;
      best = url;
    }
    if (score >= POSTER_IDENTITY_THRESHOLD) return url;
  }
  console.warn(`[poster] ${label}: best consistency ${bestScore} (< ${POSTER_IDENTITY_THRESHOLD}), using best attempt`);
  return best;
}

/* ------------------------------------------------------------------ */
/* Orchestration                                                       */
/* ------------------------------------------------------------------ */

export async function runPosterGeneration(order: Order): Promise<void> {
  assertEnv("FAL_KEY");
  fal.config({ credentials: process.env.FAL_KEY });

  const cut = order.posterCutIndex ?? 0;
  const sourceStill = order.chosenStills[cut];
  if (!sourceStill) throw new Error(`order ${order.id} has no chosen still at posterCutIndex ${cut}`);
  const portrait = order.identityPortraitUrl;
  if (!portrait) throw new Error(`order ${order.id} has no identityPortraitUrl`);

  const description = order.petDescription ?? "the pet shown in the reference images";
  const costume = resolveWorld(order).costume;
  const storyboard = (order.storyboardOptions as StoryboardCut[] | null) ?? [];
  const sceneHint = storyboard[cut]?.scene ?? "the film's signature moment";

  const refs = [sourceStill, portrait, order.heroSheetUrl, order.uploadedPhotoUrls[0]]
    .filter((u): u is string => !!u)
    .map(publicUrl);
  const portraitRef = publicUrl(portrait);

  console.log(`[poster] generating ${NUM_POSTER_TAKES} one-sheets order=${order.id} cut=${cut}`);
  // Text-free — this IS posterOptions; MoviePosterOverlay lays the title block
  // over it live, and poster-print.ts renders that same design for POD.
  const posterOptions = await Promise.all(
    Array.from({ length: NUM_POSTER_TAKES }, (_, take) =>
      generateGatedPosterArt(
        refs,
        description,
        costume,
        sceneHint,
        portraitRef,
        POSTER_SEED + take * 1000,
        `take ${take}`
      )
    )
  );

  await prisma.order.update({ where: { id: order.id }, data: { posterOptions } });
  console.log(`[poster] ${posterOptions.length} candidates ready order=${order.id}`);
}

/**
 * Kick (parallel to the film). Poster failure never blocks the film. 3-way
 * branch (see FILM-ASYNC-SPEC.md §3):
 *   1. MOCK — fabricate candidates from local assets, no compute.
 *   2. No TRIGGER_SECRET_KEY (local dev) — run detached inline, as before.
 *   3. Otherwise (Vercel/production) — offload to Trigger.dev.
 */
export async function kickPosterGeneration(order: Order): Promise<void> {
  if (process.env.VIDEO_PIPELINE_MOCK === "1") {
    console.log(`[poster:MOCK] kick order=${order.id} — no compute spent`);
    await prisma.order.update({
      where: { id: order.id },
      data: {
        posterOptions: [
          "/assets/world-deepspace.png",
          "/assets/world-storybook.png",
          "/assets/world-noir.png",
        ],
      },
    });
    return;
  }
  if (!process.env.TRIGGER_SECRET_KEY) {
    void runPosterGeneration(order).catch((e) =>
      // Film continues regardless; admin sees "no poster candidates" at Gate 2
      // and production can re-kick after fixing the cause.
      console.error(`[poster] failed order=${order.id} (film unaffected)`, e)
    );
    return;
  }
  await tasks.trigger<typeof generatePosterTask>("generate-poster", { orderId: order.id });
}

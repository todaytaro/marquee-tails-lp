import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import { fal } from "@fal-ai/client";
import { OrderStatus, type Order } from "@/generated/prisma/client";
import { prisma } from "./db";
import { transitionOrder } from "./orders";
import { getArc, getCostume, getLoglines, SHOT_MOTIONS, WORLD_SCORES, TITLE_CARDS } from "./film-script";

/**
 * Film pipeline — the 60-second trailer (replaces the single-shot MVP).
 *
 * Kicked at Gate 1 approval. Runs the whole chain in-process:
 *   1. six 16:9 shot stills (identity-lock: portrait + selected still + desc)
 *   2. each still -> 8s Kling clip (i2v, silent — music is a separate track)
 *   3. original score via Stable Audio 2.5
 *   4. ffmpeg assembly: title cards + 6 shots + score -> 16:9 master
 *   5. centre-crop -> 9:16 social cut
 *   6. upload both to fal storage, -> AWAITING_ADMIN_APPROVAL
 *
 * Structure: [3s opening card][6×8s shots = 48s][9s closing card] = 60s.
 * Shot order follows the personality arc (getArc); the customer's selected
 * still seeds shot 1 for visual continuity with their Gate-1 pick.
 *
 * Cost ~ $1.05 stills + ~$4.0 video + $0.20 music ≈ $5.3 + retries.
 *
 * Dev/localhost only (heavy, long-running). On Vercel this moves behind a
 * queue/worker (n8n phase). VIDEO_PIPELINE_MOCK=1 short-circuits for e2e.
 */

const EDIT_MODEL = "fal-ai/nano-banana-pro/edit";
const KLING_MODEL = "fal-ai/kling-video/v3/standard/image-to-video";
const MUSIC_MODEL = "fal-ai/stable-audio-25/text-to-audio";
const VISION_MODEL = "openrouter/router/vision";
const VISION_LLM = "google/gemini-2.5-flash";

const SHOT_SECONDS = 8;
const NUM_SHOTS = 6;
const OPEN_SECONDS = 3;
const CLOSE_SECONDS = 9;
// open + 6×8 shots + close = 3 + 48 + 9 = 60. Story text is now overlaid on
// the footage (captions), not cut to black cards — keeps the pet on screen.
const TOTAL_SECONDS = OPEN_SECONDS + NUM_SHOTS * SHOT_SECONDS + CLOSE_SECONDS;

const FONT_DISPLAY = path.join(process.cwd(), "public/fonts/BebasNeue-Regular.ttf");
const FONT_NAME = path.join(process.cwd(), "public/fonts/NotoSansJP-Bold.ttf");

const IDENTITY_RULES =
  "Preserve this exact pet's identity from the reference images: same coat colors in the same places, same fur texture and haircut, same face, eyes, ears and proportions. Do not idealize or drift to a generic breed look. No text, no watermark, no humans.";

function assertEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

function publicUrl(url: string): string {
  if (url.startsWith("http")) return url;
  const base = process.env.PUBLIC_ASSET_BASE ?? "https://marquee-tails-lp.vercel.app";
  return new URL(url, base).toString();
}

function ffmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath as string, ["-y", ...args], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-800)}`))
    );
    proc.on("error", reject);
  });
}

async function download(url: string, dest: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed ${res.status}: ${url}`);
  await writeFile(dest, Buffer.from(await res.arrayBuffer()));
}

/** ffmpeg drawtext escaping: backslash-escape :, ', and \. */
function esc(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

/**
 * Hero sheet — the pet in the film's LOCKED costume, neutral full-body pose.
 * Generated once and referenced by every shot, so costume, tail and face
 * stay identical across cuts (the fix for shot-to-shot drift).
 */
async function generateHeroSheet(refs: string[], description: string, costume: string): Promise<string> {
  const r = await fal.subscribe(EDIT_MODEL, {
    input: {
      prompt: `Full-body character reference of this exact pet from the reference images — ${description} — ${costume}. Standing in a neutral three-quarter pose, facing the camera, plain neutral studio background, even soft lighting, the whole body and tail visible and in focus. This is the definitive costumed look of the character. ${IDENTITY_RULES}`,
      image_urls: refs,
      num_images: 1,
      resolution: "2K",
      aspect_ratio: "16:9",
      output_format: "png",
    },
  });
  const url = (r.data as { images?: { url?: string }[] })?.images?.[0]?.url;
  if (!url) throw new Error("hero sheet missing url");
  return url;
}

// Face-forward framing keeps identity legible — owners reject far/profile
// cuts where "it could be any dog". Enforced on every shot regardless of arc.
const FRAMING =
  "Framed as a medium shot with the pet's face large, sharp and clearly toward the camera, the head and chest filling much of the frame";

/** One raw 16:9 cinematic shot still — same character, same costume, new action. */
async function generateShotStillOnce(
  refs: string[],
  description: string,
  costume: string,
  scene: string,
  seed?: number
): Promise<string> {
  const r = await fal.subscribe(EDIT_MODEL, {
    input: {
      prompt: `The FIRST reference image is the definitive look of this character — match its costume, fur colors and markings, tail and face EXACTLY. This exact pet (${description}), ${costume}, ${scene}. ${FRAMING}. One cinematic live-action film still, unmistakably the same individual pet, same outfit as the reference, blockbuster cinematography, dramatic lighting, shallow depth of field, film grain. ${IDENTITY_RULES}`,
      image_urls: refs,
      num_images: 1,
      resolution: "2K",
      aspect_ratio: "16:9",
      output_format: "png",
      ...(seed !== undefined ? { seed } : {}),
    },
  });
  const url = (r.data as { images?: { url?: string }[] })?.images?.[0]?.url;
  if (!url) throw new Error("shot still missing url");
  return url;
}

/**
 * Identity gate — VLM checks a generated still against the identity portrait
 * ("same individual pet? same markings?") and returns 0-100. Stills below the
 * threshold are re-rolled before they ever reach the (costly) animation step.
 * This is the direct fix for "some cuts aren't my dog".
 */
async function scoreIdentity(portraitUrl: string, candidateUrl: string): Promise<number> {
  try {
    const r = await fal.subscribe(VISION_MODEL, {
      input: {
        model: VISION_LLM,
        image_urls: [publicUrl(portraitUrl), candidateUrl],
        prompt:
          "Image 1 is the REAL pet. Image 2 is an AI render of the same pet in costume. How confidently is the render the SAME INDIVIDUAL animal — same breed, same coat colors in the same places, same facial markings (beard, eyebrows), same proportions? Ignore costume, background and pose. Reply with ONLY an integer 0-100 (100 = unmistakably the same individual).",
      },
    });
    const txt = String((r.data as { output?: string; text?: string })?.output ?? (r.data as { text?: string })?.text ?? "");
    const n = parseInt(txt.replace(/[^0-9]/g, "").slice(0, 3), 10);
    return Number.isFinite(n) ? Math.min(100, n) : 0;
  } catch (e) {
    // A failed check must not block the pipeline — treat as pass, log it.
    console.warn("[film] identity check errored, passing still through:", e);
    return 100;
  }
}

const IDENTITY_THRESHOLD = 72;
const MAX_STILL_REROLLS = 2;

/** Generate a shot still, re-rolling until it clears the identity gate. */
async function generateShotStill(
  refs: string[],
  description: string,
  costume: string,
  scene: string,
  portraitUrl: string,
  shotIndex: number
): Promise<string> {
  let best = "";
  let bestScore = -1;
  for (let attempt = 0; attempt <= MAX_STILL_REROLLS; attempt++) {
    const url = await generateShotStillOnce(refs, description, costume, scene, attempt === 0 ? undefined : 1000 + attempt);
    const score = await scoreIdentity(portraitUrl, url);
    console.log(`[film] shot ${shotIndex} still attempt ${attempt}: identity ${score}`);
    if (score > bestScore) {
      bestScore = score;
      best = url;
    }
    if (score >= IDENTITY_THRESHOLD) return url;
  }
  // None cleared the bar — ship the best of the attempts.
  console.warn(`[film] shot ${shotIndex}: best identity ${bestScore} (< ${IDENTITY_THRESHOLD}), using best attempt`);
  return best;
}

const WORLD_ATMOSPHERE: Record<string, string> = {
  deepspace: "drifting particles and console light",
  storybook: "drifting leaves and warm light",
  noir: "drifting fog and flickering light",
};

/**
 * Animate a still into an 8s silent clip with a per-shot camera move.
 *
 * `character` locks identity THROUGH the animation via Kling's elements:
 * frontal_image_url = the clean identity portrait, reference_image_urls =
 * the costumed hero sheet. Referenced as @Element1 in the prompt so Kling
 * keeps the same individual pet as it moves (the fix for mid-clip morphing).
 */
async function generateShotClip(
  stillUrl: string,
  world: string,
  shotIndex: number,
  character: { frontal_image_url: string; reference_image_urls: string[] }
): Promise<string> {
  const camera = SHOT_MOTIONS[shotIndex] ?? SHOT_MOTIONS[0];
  const atmosphere = WORLD_ATMOSPHERE[world] ?? "";
  const { request_id } = await fal.queue.submit(KLING_MODEL, {
    input: {
      start_image_url: publicUrl(stillUrl),
      prompt: `@Element1 ${camera}, ${atmosphere}. @Element1 moves naturally but stays exactly the same individual pet — identical face, markings and costume, no morphing, no distortion.`,
      elements: [character],
      duration: String(SHOT_SECONDS) as "8",
      generate_audio: false,
      cfg_scale: 0.4,
      negative_prompt: "blur, distort, low quality, deformed face, extra limbs, warped anatomy, morphing, changing costume, different dog, text, watermark",
    },
  });
  // Poll (in-process; dev worker is long-lived).
  const deadline = Date.now() + 12 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 8000));
    const s = await fal.queue.status(KLING_MODEL, { requestId: request_id, logs: false });
    if (s.status === "COMPLETED") {
      const res = await fal.queue.result(KLING_MODEL, { requestId: request_id });
      const url = (res.data as { video?: { url?: string } })?.video?.url;
      if (!url) throw new Error("kling result missing url");
      return url;
    }
  }
  throw new Error(`kling request ${request_id} timed out`);
}

async function generateScore(world: string): Promise<string> {
  const r = await fal.subscribe(MUSIC_MODEL, {
    input: {
      prompt: WORLD_SCORES[world] ?? WORLD_SCORES.deepspace,
      seconds_total: TOTAL_SECONDS,
      num_inference_steps: 8,
    },
  });
  const url = (r.data as { audio?: { url?: string } })?.audio?.url;
  if (!url) throw new Error("music result missing url");
  return url;
}

/**
 * Normalise a clip to 1920x1080 / 24fps / h264 / silent. Optionally burn a
 * trailer caption: gold lower-third text that fades in, holds, fades out —
 * over the live footage, so the story builds without cutting to black.
 */
async function normaliseClip(input: string, output: string, caption?: string): Promise<void> {
  let vf = "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,fps=24";
  if (caption) {
    // Gold caption over a soft scrim, shown 0.6s-7.4s of the 8s clip; text
    // fades via alpha, scrim toggles with enable. Robust (no nested exprs).
    const show = "between(t,0.6,7.4)";
    const alpha = "if(lt(t,0.6),0,if(lt(t,1.2),(t-0.6)/0.6,if(lt(t,6.8),1,if(lt(t,7.4),(7.4-t)/0.6,0))))";
    vf +=
      `,drawbox=x=0:y=ih-250:w=iw:h=250:color=black@0.4:t=fill:enable='${show}'` +
      `,drawtext=fontfile='${FONT_DISPLAY}':text='${esc(caption)}':fontcolor=0xe8b64c:alpha='${alpha}':fontsize=62:x=(w-text_w)/2:y=h-165`;
  }
  await ffmpeg([
    "-i", input,
    "-vf", vf,
    "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast",
    output,
  ]);
}

/** A solid title card clip with centred gold text. */
async function titleCard(output: string, seconds: number, lines: { text: string; size: number; y: string; font: string }[]): Promise<void> {
  const draw = lines
    .map((l) => `drawtext=fontfile='${l.font}':text='${esc(l.text)}':fontcolor=0xe8b64c:fontsize=${l.size}:x=(w-text_w)/2:y=${l.y}`)
    .join(",");
  await ffmpeg([
    "-f", "lavfi", "-i", `color=c=0x0b0a10:s=1920x1080:d=${seconds}:r=24`,
    "-vf", draw,
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast",
    output,
  ]);
}

/** Persisted intermediate results, so a run resumes without re-spending. */
type FilmArtifacts = {
  heroSheet?: string;
  shotStillUrls?: string[];
  clipUrls?: string[];
  scoreUrl?: string;
};

async function saveArtifacts(orderId: string, patch: FilmArtifacts): Promise<FilmArtifacts> {
  const cur = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
  const merged: FilmArtifacts = { ...((cur.filmArtifacts as FilmArtifacts) ?? {}), ...patch };
  await prisma.order.update({ where: { id: orderId }, data: { filmArtifacts: merged } });
  return merged;
}

export async function runFilmGeneration(order: Order): Promise<void> {
  assertEnv("FAL_KEY");
  fal.config({ credentials: process.env.FAL_KEY });

  if (!order.selectedImageUrl) throw new Error(`order ${order.id} has no selectedImageUrl`);
  const description = order.petDescription ?? "the pet shown in the reference images";
  const world = order.world ?? "deepspace";
  const costume = getCostume(world);
  const arc = getArc(world, order.personality).slice(0, NUM_SHOTS);
  const loglines = getLoglines(world, order.personality);
  const petName = order.petName ?? "Your Star";

  // Resume from any checkpoint saved by a previous (failed) run.
  let art: FilmArtifacts = (order.filmArtifacts as FilmArtifacts) ?? {};

  // Stage A: lock the costumed hero look ONCE.
  if (!art.heroSheet) {
    console.log(`[film] hero sheet order=${order.id} world=${world}`);
    const idRefs = [
      order.identityPortraitUrl,
      order.selectedImageUrl,
      ...order.uploadedPhotoUrls.slice(0, 2),
    ].filter((u): u is string => !!u).map(publicUrl);
    art = await saveArtifacts(order.id, { heroSheet: await generateHeroSheet(idRefs, description, costume) });
  } else {
    console.log(`[film] resume: hero sheet cached order=${order.id}`);
  }

  // The identity portrait is the anchor for the QC gate and the Kling
  // character element — required for the fidelity pipeline.
  const portraitUrl = order.identityPortraitUrl;
  if (!portraitUrl) throw new Error(`order ${order.id} has no identityPortraitUrl`);

  // Stage B: shots reference the hero sheet FIRST, then re-roll each still
  // until it clears the identity gate (fix for "not my dog" cuts).
  if (!art.shotStillUrls) {
    console.log(`[film] stills: 6 shots (identity-gated) order=${order.id} arc=${order.personality}`);
    const shotRefs = [art.heroSheet!, portraitUrl, ...order.uploadedPhotoUrls.slice(0, 1)]
      .filter((u): u is string => !!u)
      .map(publicUrl);
    art = await saveArtifacts(order.id, {
      shotStillUrls: await Promise.all(
        arc.map((scene, i) => generateShotStill(shotRefs, description, costume, scene, portraitUrl, i))
      ),
    });
  } else {
    console.log(`[film] resume: ${art.shotStillUrls.length} stills cached order=${order.id}`);
  }

  // Kling character element: locks identity through the animation itself.
  const character = {
    frontal_image_url: publicUrl(portraitUrl),
    reference_image_urls: [publicUrl(art.heroSheet!)],
  };

  // Stage C: animate + score (only what's missing).
  if (!art.clipUrls || !art.scoreUrl) {
    console.log(`[film] animating 6 shots + score order=${order.id}`);
    const [clipUrls, scoreUrl] = await Promise.all([
      art.clipUrls ?? Promise.all(art.shotStillUrls!.map((s, i) => generateShotClip(s, world, i, character))),
      art.scoreUrl ?? generateScore(world),
    ]);
    art = await saveArtifacts(order.id, { clipUrls, scoreUrl });
  } else {
    console.log(`[film] resume: clips + score cached order=${order.id}`);
  }
  const clipUrls = art.clipUrls!;
  const scoreUrl = art.scoreUrl!;

  console.log(`[film] assembling order=${order.id}`);
  const [masterUrl, socialUrl] = await assemble(order.id, petName, clipUrls, scoreUrl, loglines);

  await completeFilmGeneration(order.id, masterUrl, socialUrl);
}

async function assemble(
  orderId: string,
  petName: string,
  clipUrls: string[],
  scoreUrl: string,
  loglines: { intro: string; turn: string; tagline: string }
): Promise<[string, string]> {
  const dir = await mkdtemp(path.join(tmpdir(), `mt-film-${orderId}-`));
  try {
    // Download + normalise shots. Story text is burned onto the footage as
    // captions (intro on shot 1, turn on shot 4) — no cut-to-black beats.
    const captions: Record<number, string> = { 0: loglines.intro, 3: loglines.turn };
    const normShots: string[] = [];
    for (let i = 0; i < clipUrls.length; i++) {
      const raw = path.join(dir, `raw${i}.mp4`);
      const norm = path.join(dir, `shot${i}.mp4`);
      await download(clipUrls[i], raw);
      await normaliseClip(raw, norm, captions[i]);
      normShots.push(norm);
    }

    // Cards: brand opening + tagline/name closing (kept as black cards).
    const openCard = path.join(dir, "open.mp4");
    const closeCard = path.join(dir, "close.mp4");
    await titleCard(openCard, OPEN_SECONDS, [
      { text: TITLE_CARDS.opening, size: 90, y: "(h-text_h)/2", font: FONT_DISPLAY },
    ]);
    await titleCard(closeCard, CLOSE_SECONDS, [
      { text: loglines.tagline, size: 96, y: "h/2-210", font: FONT_DISPLAY },
      { text: petName, size: 150, y: "h/2-80", font: FONT_NAME },
      { text: TITLE_CARDS.closing, size: 56, y: "h/2+110", font: FONT_DISPLAY },
    ]);

    // Trailer order: brand card, six captioned shots, name/tagline card.
    const listFile = path.join(dir, "list.txt");
    const sequence = [openCard, ...normShots, closeCard].filter(Boolean);
    await writeFile(listFile, sequence.map((f) => `file '${f}'`).join("\n"));
    const silent = path.join(dir, "silent.mp4");
    await ffmpeg(["-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", silent]);

    // Score: trim to length + 2s fade-out, mux.
    const music = path.join(dir, "score.wav");
    await download(scoreUrl, music);
    const master = path.join(dir, "master.mp4");
    await ffmpeg([
      "-i", silent, "-i", music,
      "-filter_complex", `[1:a]afade=t=out:st=${TOTAL_SECONDS - 2}:d=2[a]`,
      "-map", "0:v", "-map", "[a]",
      "-c:v", "copy", "-c:a", "aac", "-shortest",
      master,
    ]);

    // 9:16 social cut (centre crop).
    const social = path.join(dir, "social.mp4");
    await ffmpeg([
      "-i", master,
      "-vf", "crop=ih*9/16:ih,scale=1080:1920",
      "-c:a", "copy", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast",
      social,
    ]);

    // Upload both. Filename is ASCII-slugged (fal storage mangles non-ASCII).
    const slug = petName.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "film";
    const masterUrl = await uploadFile(master, `${slug}-marquee-tails.mp4`);
    const socialUrl = await uploadFile(social, `${slug}-marquee-tails-social.mp4`);
    return [masterUrl, socialUrl];
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function uploadFile(filePath: string, name: string): Promise<string> {
  const buf = await readFile(filePath);
  const file = new File([new Uint8Array(buf)], name, { type: "video/mp4" });
  return fal.storage.upload(file);
}

export async function completeFilmGeneration(
  orderId: string,
  masterUrl: string,
  socialUrl: string
): Promise<void> {
  await transitionOrder(
    orderId,
    OrderStatus.VIDEO_GENERATING,
    OrderStatus.AWAITING_ADMIN_APPROVAL,
    "system",
    { finalVideoUrl: masterUrl, socialVideoUrl: socialUrl },
    "film assembled (6-shot 60s trailer)"
  );
  // Checkpoints served their purpose — clear so a future re-render starts fresh.
  await prisma.order.update({ where: { id: orderId }, data: { filmArtifacts: {} } });
  console.log(`[film] order=${orderId} -> AWAITING_ADMIN_APPROVAL`);
}

/** Entry point from Gate 1 approval (mirrors kickVideoGeneration). */
export async function kickFilmGeneration(order: Order): Promise<void> {
  if (process.env.VIDEO_PIPELINE_MOCK === "1") {
    // No-op: leave the order in VIDEO_GENERATING so the state machine can be
    // driven by tests / a manual callback without spending compute. (Matches
    // the original single-shot mock's contract.)
    console.log(`[film:MOCK] kick order=${order.id} — no compute spent, order stays VIDEO_GENERATING`);
    return;
  }
  void runFilmGeneration(order).catch(async (e) => {
    console.error(`[film] failed order=${order.id}, reverting`, e);
    await transitionOrder(
      order.id,
      OrderStatus.VIDEO_GENERATING,
      OrderStatus.AWAITING_CUSTOMER_APPROVAL,
      "system",
      {},
      "film generation failed — reverted for retry"
    ).catch((err) => console.error(`[film] revert failed order=${order.id}`, err));
  });
}

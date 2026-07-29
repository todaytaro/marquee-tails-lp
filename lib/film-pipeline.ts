import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import { tasks } from "@trigger.dev/sdk";
import type { generateFilmTask } from "@/trigger/film"; // type-only: task code stays out of the Next bundle
import type { rerenderShotTask } from "@/trigger/rerender"; // type-only: ditto
import { fal } from "@fal-ai/client";
import { OrderStatus, type Order } from "@/generated/prisma/client";
import { prisma } from "./db";
import { transitionOrder } from "./orders";
import { TITLE_CARDS, resolveWorld, getShotMotion } from "./film-script";
import { publicUrl, scoreFrame } from "./identity";
import { reshootCutStill } from "./stills-pipeline";

/**
 * Film pipeline — the trailer assembler.
 *
 * Kicked at Gate 1 approval. By the time we get here the customer has already
 * picked one take per cut in the storyboard wizard (lib/stills-pipeline.ts
 * generates the 18 candidates BEFORE Gate 1), so this pipeline no longer
 * generates any stills — it just animates the six the customer chose:
 *   1. each chosen still (order.chosenStills) -> SHOT_SECONDS Kling clip (i2v, silent)
 *   2. original score via Stable Audio 2.5
 *   3. ffmpeg assembly: title cards + 6 shots + score -> 16:9 master
 *   4. centre-crop -> 9:16 social cut
 *   5. upload both to fal storage, -> AWAITING_ADMIN_APPROVAL
 *
 * Structure: [3s opening card][6×SHOT_SECONDS shots][9s closing card].
 * Cut order follows the personality arc used at storyboard time; chosenStills[0]
 * (cut 1) is the customer's opening shot. Drift within a longer cut is held by
 * the storyboard's per-cut human pick + the post-animation identity gate.
 *
 * Cost ~ 6×SHOT_SECONDS×$0.084 video + $0.20 music (≈ $4.2 at 8s) + gate
 * re-rolls; stills were already spent at Gate 1. Dev/localhost only (heavy,
 * long-running); on Vercel this moves behind a queue/worker (n8n phase).
 * VIDEO_PIPELINE_MOCK=1 short-circuits e2e.
 */

// Env-overridable so the tier can be A/B'd or rolled back without a deploy.
// standard -> pro: pro trades more $/s for tighter start-frame adherence,
// which is the same direction as the cfg_scale bump below (less drift, at
// the cost of some stiffness) — worth the spend after the profile-drift
// production incident. NOTE: swap the KLING_MODEL env var to instantly
// revert to standard if the pro endpoint id turns out to be wrong or the
// tier underperforms.
const KLING_MODEL = process.env.KLING_MODEL ?? "fal-ai/kling-video/v3/pro/image-to-video";
const MUSIC_MODEL = "fal-ai/stable-audio-25/text-to-audio";

// House setting: 8s cuts (Kling duration enum is 3-15s) → a 60s trailer.
const SHOT_SECONDS = 8;
const OPEN_SECONDS = 3;
const CLOSE_SECONDS = 9;
// open + 6×shots + close. Story text is overlaid on the footage (captions),
// not cut to black cards — keeps the pet on screen. At 8s: 3 + 48 + 9 = 60s.
const TOTAL_SECONDS = OPEN_SECONDS + 6 * SHOT_SECONDS + CLOSE_SECONDS;

const FONT_DISPLAY = path.join(process.cwd(), "public/fonts/BebasNeue-Regular.ttf");
const FONT_NAME = path.join(process.cwd(), "public/fonts/NotoSansJP-Bold.ttf");

function assertEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

// Local dev: ffmpeg-static's bundled binary. On Trigger.dev: the ffmpeg()
// build extension installs a system binary and sets FFMPEG_PATH — prefer
// that when present (see trigger.config.ts).
const FFMPEG_BIN = process.env.FFMPEG_PATH ?? (ffmpegPath as string);

function ffmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG_BIN, ["-y", ...args], { stdio: ["ignore", "ignore", "pipe"] });
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

const WORLD_ATMOSPHERE: Record<string, string> = {
  deepspace: "drifting particles and console light",
  storybook: "drifting leaves and warm light",
  noir: "drifting fog and flickering light",
};

const CLIP_NEGATIVE =
  "blur, distort, low quality, deformed face, extra limbs, warped anatomy, morphing, changing costume, different dog, wrong tongue color, wrong tail length, wrong ear shape, ears changing, tail changing, cartoon, cel shading, 3d render, cgi, plastic sheen, illustration, stylized animation, text, watermark";

/** Submit one Kling clip and poll to completion within `capMs`. */
async function submitClip(input: Record<string, unknown>, capMs: number): Promise<string> {
  // fal's per-model input union is too wide to satisfy structurally; submit
  // with a narrow cast.
  const { request_id } = await fal.queue.submit(KLING_MODEL, {
    input: input as never,
  });
  const deadline = Date.now() + capMs;
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

/**
 * Animate a chosen still into an 8s silent clip with a per-shot camera move.
 *
 * Identity through the clip is held by (a) the customer's hand-picked,
 * identity-gated start frame and (b) calm low-morph motion. We deliberately do
 * NOT use Kling's `elements` character lock — measured to add queue flakiness
 * without improving on a strong start frame, and the storyboard picks already
 * give us six high-identity frames to animate.
 */
async function generateShotClip(
  stillUrl: string,
  world: string,
  shotIndex: number,
  orderId: string,
  durationSec: number = SHOT_SECONDS,
  directorNote?: string
): Promise<string> {
  // getShotMotion resolves index 5 (the climax) to one of several variants,
  // picked deterministically from orderId — see film-script.ts for why this
  // must be stable across an original run and any later single-shot re-render.
  const camera = getShotMotion(shotIndex, orderId);
  const atmosphere = WORLD_ATMOSPHERE[world] ?? "";
  const note = directorNote?.trim() ? ` Director's note, follow it strictly: ${directorNote.trim()}.` : "";
  return submitClip(
    {
      start_image_url: publicUrl(stillUrl),
      duration: String(durationSec) as "8",
      generate_audio: false,
      // Tuning knob: 0.4 -> 0.55. Low cfg lets the model drift from the start
      // frame on its own initiative, which is the same failure mode as the
      // yaw problem — it invents detail the reference never showed. Higher
      // cfg holds the start frame more strictly; trade-off is some stiffness
      // if pushed too far, so this is a nudge, not a jump to 1.0.
      cfg_scale: 0.55,
      negative_prompt: CLIP_NEGATIVE,
      prompt: `${camera}, ${atmosphere}.${note} The pet stays exactly the same individual — identical face, mouth/tongue color, tail length and ear carriage, coat markings and costume — lively but never morphing into a different dog.`,
    },
    15 * 60 * 1000
  );
}

// The video identity gate. Clips can hold a strong start frame yet drift into
// "a different dog" mid-motion, so after each clip we sample frames and score
// them against the identity portrait; a clip below the threshold is re-rolled.
// Clips are inherently a touch below stills, so this bar is a little lower than
// the still gate (80). One re-roll caps the added spend (2 animations/shot max).
const CLIP_IDENTITY_THRESHOLD = 75;
const MAX_CLIP_REROLLS = 1;

/** Grab a single frame using ffmpeg seek args (placed before -i for fast seek). */
async function extractFrame(input: string, seek: string[], output: string): Promise<void> {
  await ffmpeg([...seek, "-i", input, "-frames:v", "1", "-q:v", "2", output]);
}

async function uploadImage(filePath: string, name: string): Promise<string> {
  const buf = await readFile(filePath);
  const file = new File([new Uint8Array(buf)], name, { type: "image/png" });
  return fal.storage.upload(file);
}

/**
 * Score an animated clip on BOTH identity and realism: sample an early frame,
 * a ~2.5s frame (style drift — the "Disneyfication" — typically sets in a
 * couple of seconds in) and a near-end frame, score each against the portrait,
 * and return the LOWEST of all axes — one bad frame is enough to make an owner
 * say "that's not my dog" or "that's a cartoon".
 *
 * Sampling is RELATIVE to the actual clip, not the configured shot length:
 * `-ss` offsets exist in any 3-15s Kling cut and `-sseof -1` grabs ~1s before
 * the end, so no duration probe is needed. Never blocks the pipeline: any
 * error scores 100 (pass).
 */
async function scoreClip(clipUrl: string, portraitUrl: string): Promise<number> {
  const dir = await mkdtemp(path.join(tmpdir(), "mt-clipscore-"));
  try {
    const raw = path.join(dir, "clip.mp4");
    await download(clipUrl, raw);
    const samples: string[][] = [["-ss", "1"], ["-ss", "2.5"], ["-sseof", "-1"]];
    const scores: number[] = [];
    for (let i = 0; i < samples.length; i++) {
      const frame = path.join(dir, `f${i}.png`);
      await extractFrame(raw, samples[i], frame);
      const url = await uploadImage(frame, `identity-frame-${i}.png`);
      const s = await scoreFrame(portraitUrl, url);
      scores.push(s.identity, s.realism);
    }
    return Math.min(...scores);
  } catch (e) {
    console.warn("[film] clip scoring errored, passing clip through:", e);
    return 100;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Animate a shot and gate it on identity: re-roll a drifting clip once, keep
 * the best attempt regardless so a film never stalls. Returns the clip URL and
 * its identity score (persisted for the admin drift view at Gate 2).
 */
async function generateGatedClip(
  stillUrl: string,
  world: string,
  shotIndex: number,
  orderId: string,
  portraitUrl?: string,
  directorNote?: string
): Promise<{ url: string; score: number }> {
  let best = { url: "", score: -1 };
  for (let attempt = 0; attempt <= MAX_CLIP_REROLLS; attempt++) {
    const url = await generateShotClip(stillUrl, world, shotIndex, orderId, SHOT_SECONDS, directorNote);
    const score = portraitUrl ? await scoreClip(url, portraitUrl) : 100;
    console.log(`[film] shot ${shotIndex} clip attempt ${attempt}: identity ${score}`);
    if (score > best.score) best = { url, score };
    if (score >= CLIP_IDENTITY_THRESHOLD) return { url, score };
  }
  console.warn(
    `[film] shot ${shotIndex}: best clip identity ${best.score} (< ${CLIP_IDENTITY_THRESHOLD}), using best attempt`
  );
  return best;
}

/** scorePrompt comes from resolveWorld(order).score — static WORLD_SCORES for presets, Claude's bundle for custom orders. */
async function generateScore(scorePrompt: string): Promise<string> {
  const r = await fal.subscribe(MUSIC_MODEL, {
    input: {
      prompt: scorePrompt,
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
async function normaliseClip(
  input: string,
  output: string,
  caption?: { text: string; font?: string; sup?: string }
): Promise<void> {
  let vf = "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,fps=24";
  if (caption) {
    // Gold caption over a soft scrim; text fades in over 0.6s after a 0.6s hold,
    // holds, then fades out over the last 0.6s (ending 0.6s before the cut).
    // Timings are RELATIVE to the clip length so they stay correct at any cut
    // duration (5s → shown 0.6-4.4s; 8s → 0.6-7.4s). Robust (no nested exprs).
    // Optional `sup` = a small superscript line above (e.g. "STARRING").
    const font = caption.font ?? FONT_DISPLAY;
    // Auto-fit: drawtext doesn't wrap, so shrink the font for long lines (or a
    // long pet name) rather than letting text run off-frame. The display font
    // (Bebas, condensed) fits more chars per line than the JP font (Noto).
    const budget = font === FONT_DISPLAY ? 38 : 26;
    const fontSize = Math.max(40, Math.min(64, Math.round((64 * budget) / Math.max(caption.text.length, budget))));
    const inA = 0.6, inB = 1.2, outA = SHOT_SECONDS - 1.2, outB = SHOT_SECONDS - 0.6;
    const show = `between(t,${inA},${outB})`;
    const alpha = `if(lt(t,${inA}),0,if(lt(t,${inB}),(t-${inA})/0.6,if(lt(t,${outA}),1,if(lt(t,${outB}),(${outB}-t)/0.6,0))))`;
    vf += `,drawbox=x=0:y=ih-260:w=iw:h=260:color=black@0.4:t=fill:enable='${show}'`;
    if (caption.sup) {
      vf += `,drawtext=fontfile='${FONT_DISPLAY}':text='${esc(caption.sup)}':fontcolor=0xf4f1e8:alpha='${alpha}':fontsize=34:x=(w-text_w)/2:y=h-205`;
    }
    vf += `,drawtext=fontfile='${font}':text='${esc(caption.text)}':fontcolor=0xe8b64c:alpha='${alpha}':fontsize=${fontSize}:x=(w-text_w)/2:y=h-160`;
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
  clipUrls?: string[];
  clipScores?: number[]; // per-shot identity score, parallel to clipUrls
  scoreUrl?: string;
};

async function saveArtifacts(orderId: string, patch: FilmArtifacts): Promise<FilmArtifacts> {
  const cur = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
  const merged: FilmArtifacts = { ...((cur.filmArtifacts as FilmArtifacts) ?? {}), ...patch };
  await prisma.order.update({ where: { id: orderId }, data: { filmArtifacts: merged } });
  return merged;
}

/** Thin export of generateShotClip for the clip test script. */
export function generateShotClipForTest(
  stillUrl: string,
  world: string,
  shotIndex: number,
  orderId: string,
  durationSec: number
): Promise<string> {
  return generateShotClip(stillUrl, world, shotIndex, orderId, durationSec);
}

export async function runFilmGeneration(order: Order): Promise<void> {
  assertEnv("FAL_KEY");
  fal.config({ credentials: process.env.FAL_KEY });

  const shotStillUrls = order.chosenStills;
  if (!shotStillUrls || shotStillUrls.length === 0) {
    throw new Error(`order ${order.id} has no chosenStills to animate`);
  }
  const world = order.world ?? "deepspace"; // atmosphere-only fallback (WORLD_ATMOSPHERE); custom scenes carry their own atmosphere in Claude's cut text
  const petName = order.petName ?? "Your Star";
  const resolved = resolveWorld(order);
  const loglines = resolved.loglines;

  const portraitUrl = order.identityPortraitUrl ?? undefined;
  let art: FilmArtifacts = (order.filmArtifacts as FilmArtifacts) ?? {};

  // Stage C. Three independent, separately-cached steps so a resume only redoes
  // what's missing — crucially, clip GENERATION (Kling, expensive) is decoupled
  // from clip SCORING (VLM, cheap), so a scoring failure never forces a costly
  // re-animate. generateGatedClip scores as it generates (for the re-roll);
  // scoreClip re-scores already-cached clips on resume.
  if (!art.clipUrls) {
    console.log(`[film] animating ${shotStillUrls.length} shots (identity-gated) order=${order.id}`);
    const gated = await Promise.all(
      shotStillUrls.map((s, i) => generateGatedClip(s, world, i, order.id, portraitUrl))
    );
    art = await saveArtifacts(order.id, {
      clipUrls: gated.map((g) => g.url),
      clipScores: gated.map((g) => g.score),
    });
  }
  if (!art.clipScores) {
    console.log(`[film] scoring ${art.clipUrls!.length} cached clips order=${order.id}`);
    const scores = await Promise.all(
      art.clipUrls!.map((u) => (portraitUrl ? scoreClip(u, portraitUrl) : Promise.resolve(100)))
    );
    art = await saveArtifacts(order.id, { clipScores: scores });
  }
  if (!art.scoreUrl) {
    art = await saveArtifacts(order.id, { scoreUrl: await generateScore(resolved.score) });
  }
  const clipUrls = art.clipUrls!;
  const clipScores = art.clipScores!;
  const scoreUrl = art.scoreUrl!;

  const lowest = clipScores.length ? Math.min(...clipScores) : 100;
  console.log(`[film] clip identity scores order=${order.id}: [${clipScores.join(", ")}] (lowest ${lowest})`);

  console.log(`[film] assembling order=${order.id}`);
  const [masterUrl, socialUrl] = await assemble(order.id, petName, clipUrls, scoreUrl, loglines);

  // Persist the per-shot audit into dedicated fields (filmArtifacts is cleared
  // on completion) so the admin drift view has it at Gate 2.
  await prisma.order.update({
    where: { id: order.id },
    data: { shotClipUrls: clipUrls, shotIdentityScores: clipScores.map((s) => Math.round(s)) },
  });

  await completeFilmGeneration(order.id, masterUrl, socialUrl);
}

async function assemble(
  orderId: string,
  petName: string,
  clipUrls: string[],
  scoreUrl: string,
  loglines: { intro: string; turn: string; rise: string; tagline: string }
): Promise<[string, string]> {
  const dir = await mkdtemp(path.join(tmpdir(), `mt-film-${orderId}-`));
  try {
    // Trailer captions burned onto the footage — announcement rhythm:
    // shot0 intro · shot1 STARRING [name] · shot3 turn · shot4 rise.
    // Shots 2 and 5 stay clean so the climax breathes.
    // The "turn" beat now carries the pet's name; a non-Latin name (e.g. カミュ)
    // must use the JP font or ffmpeg renders tofu. Latin names keep the display
    // font for the full cinematic look.
    const asciiName = /^[\x00-\x7F]*$/.test(petName);
    const captions: Record<number, { text: string; font?: string; sup?: string }> = {
      0: { text: loglines.intro },
      1: { text: petName, font: FONT_NAME, sup: TITLE_CARDS.starring },
      3: { text: loglines.turn, ...(asciiName ? {} : { font: FONT_NAME }) },
      4: { text: loglines.rise },
    };
    const normShots: string[] = [];
    for (let i = 0; i < clipUrls.length; i++) {
      const raw = path.join(dir, `raw${i}.mp4`);
      const norm = path.join(dir, `shot${i}.mp4`);
      await download(clipUrls[i], raw);
      await normaliseClip(raw, norm, captions[i]);
      normShots.push(norm);
    }

    // Cards: brand opening + name/tagline/COMING SOON closing (movie-poster feel).
    const openCard = path.join(dir, "open.mp4");
    const closeCard = path.join(dir, "close.mp4");
    await titleCard(openCard, OPEN_SECONDS, [
      { text: TITLE_CARDS.opening, size: 90, y: "(h-text_h)/2", font: FONT_DISPLAY },
    ]);
    await titleCard(closeCard, CLOSE_SECONDS, [
      { text: petName, size: 156, y: "h/2-160", font: FONT_NAME },
      { text: loglines.tagline, size: 84, y: "h/2+30", font: FONT_DISPLAY },
      { text: TITLE_CARDS.closing, size: 44, y: "h/2+150", font: FONT_DISPLAY },
      { text: TITLE_CARDS.comingSoon, size: 58, y: "h/2+215", font: FONT_DISPLAY },
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
  // Keep filmArtifacts (clips + music): the admin's single-shot re-render
  // reuses them so fixing one cut never re-spends on the other five or the score.
  console.log(`[film] order=${orderId} -> AWAITING_ADMIN_APPROVAL`);
}

/**
 * Single-shot re-render — the admin's Gate-2 fix for "this one cut is off".
 * Re-animates ONE clip from its customer-approved still (identity-gated, with
 * the strengthened anti-CG negative prompt), reuses the other five clips and
 * the music from filmArtifacts, reassembles, and returns the order to
 * AWAITING_ADMIN_APPROVAL. Cost ≈ one clip (~$0.67) + scoring; never re-spends
 * on the rest of the film.
 */
export type ShotFixOptions = {
  /** true = regenerate the STILL first (look/style problems), then animate. */
  reshoot?: boolean;
  /** Admin's note on WHY — injected into the generation prompts to steer the retry. */
  reason?: string;
};

export async function runShotRerender(
  order: Order,
  shotIndex: number,
  opts: ShotFixOptions = {}
): Promise<void> {
  assertEnv("FAL_KEY");
  fal.config({ credentials: process.env.FAL_KEY });

  let still = order.chosenStills[shotIndex];
  if (!still) throw new Error(`order ${order.id} has no chosen still for shot ${shotIndex}`);
  const world = order.world ?? "deepspace"; // atmosphere-only fallback, see runFilmGeneration
  const petName = order.petName ?? "Your Star";
  const resolved = resolveWorld(order);
  const loglines = resolved.loglines;
  const portraitUrl = order.identityPortraitUrl ?? undefined;

  // Working set from artifacts, falling back to the persisted per-shot fields
  // (orders completed before artifacts were kept only have the latter).
  const art: FilmArtifacts = (order.filmArtifacts as FilmArtifacts) ?? {};
  const clipUrls = [...(art.clipUrls ?? order.shotClipUrls)];
  const clipScores = [...(art.clipScores ?? order.shotIdentityScores)];
  if (!clipUrls[shotIndex]) throw new Error(`order ${order.id} has no clip to replace at shot ${shotIndex}`);

  if (opts.reshoot) {
    // Look/style problem: the still itself is retaken (reason steers it),
    // then animated fresh.
    still = await reshootCutStill(order, shotIndex, opts.reason);
  }

  console.log(
    `[film] re-render shot ${shotIndex} order=${order.id} mode=${opts.reshoot ? "reshoot" : "reanimate"}${opts.reason ? ` reason="${opts.reason}"` : ""}`
  );
  const fixed = await generateGatedClip(still, world, shotIndex, order.id, portraitUrl, opts.reason);
  clipUrls[shotIndex] = fixed.url;
  clipScores[shotIndex] = fixed.score;

  const scoreUrl = art.scoreUrl ?? (await generateScore(resolved.score));
  await saveArtifacts(order.id, { clipUrls, clipScores, scoreUrl });

  console.log(`[film] assembling (shot ${shotIndex} fixed) order=${order.id}`);
  const [masterUrl, socialUrl] = await assemble(order.id, petName, clipUrls, scoreUrl, loglines);

  await prisma.order.update({
    where: { id: order.id },
    data: { shotClipUrls: clipUrls, shotIdentityScores: clipScores.map((s) => Math.round(s)) },
  });

  await completeFilmGeneration(order.id, masterUrl, socialUrl);
}

/**
 * Kick for the admin dashboard's single-shot fix (mirrors kickFilmGeneration's
 * 3-way branch — see FILM-ASYNC-SPEC.md §3):
 *   1. MOCK — no-op, order stays VIDEO_GENERATING.
 *   2. No TRIGGER_SECRET_KEY (local dev) — run inline, same as before Trigger.dev.
 *   3. Otherwise (Vercel/production) — offload to Trigger.dev.
 */
export async function kickShotRerender(
  order: Order,
  shotIndex: number,
  opts: ShotFixOptions = {}
): Promise<void> {
  if (process.env.VIDEO_PIPELINE_MOCK === "1") {
    console.log(`[film:MOCK] re-render shot ${shotIndex} (${opts.reshoot ? "reshoot" : "reanimate"}) order=${order.id} — no compute spent, order stays VIDEO_GENERATING`);
    return;
  }
  if (!process.env.TRIGGER_SECRET_KEY) {
    void runShotRerender(order, shotIndex, opts).catch(async (e) => {
      console.error(`[film] shot ${shotIndex} re-render failed order=${order.id}`, e);
      // The previously finished film is untouched — return the order to review
      // instead of stranding it in VIDEO_GENERATING.
      await transitionOrder(
        order.id,
        OrderStatus.VIDEO_GENERATING,
        OrderStatus.AWAITING_ADMIN_APPROVAL,
        "system",
        {},
        `shot ${shotIndex + 1} re-render failed — original film kept`
      ).catch((err) => console.error(`[film] re-render revert failed order=${order.id}`, err));
    });
    return;
  }
  await tasks.trigger<typeof rerenderShotTask>("rerender-shot", {
    orderId: order.id,
    shotIndex,
    reshoot: opts.reshoot,
    reason: opts.reason,
  });
}

/**
 * Entry point from Gate 1 approval — kicks the film pipeline. 3-way branch
 * (see FILM-ASYNC-SPEC.md §3):
 *   1. MOCK — no-op, order stays VIDEO_GENERATING (drives e2e/tests for free).
 *   2. No TRIGGER_SECRET_KEY (local dev) — run inline, same as before
 *      Trigger.dev (the owner's localhost real-generation workflow).
 *   3. Otherwise (Vercel/production) — offload to Trigger.dev (Hobby's 60s
 *      limit can't run this in-process).
 */
export async function kickFilmGeneration(order: Order): Promise<void> {
  if (process.env.VIDEO_PIPELINE_MOCK === "1") {
    // No-op: leave the order in VIDEO_GENERATING so the state machine can be
    // driven by tests / a manual callback without spending compute.
    console.log(`[film:MOCK] kick order=${order.id} — no compute spent, order stays VIDEO_GENERATING`);
    return;
  }
  if (!process.env.TRIGGER_SECRET_KEY) {
    void runFilmGeneration(order).catch(async (e) => {
      console.error(`[film] local run failed order=${order.id}`, e);
      // Don't send a paid/approved customer back to Gate 1 — surface it to
      // the admin as FAILED (see FAILED-STATE-SPEC.md) for a one-click retry.
      await transitionOrder(
        order.id,
        OrderStatus.VIDEO_GENERATING,
        OrderStatus.FAILED,
        "system",
        { failureReason: String(e).slice(0, 500) },
        "film generation failed after retries"
      ).catch((err) => console.error(`[film] revert failed order=${order.id}`, err));
    });
    return;
  }
  await tasks.trigger<typeof generateFilmTask>("generate-film", { orderId: order.id });
}

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
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
 * Film pipeline — the trailer assembler (TRAILER-EDIT-SPEC.md v2).
 *
 * Kicked at Gate 1 approval. By the time we get here the customer has already
 * picked one take per cut in the storyboard wizard (lib/stills-pipeline.ts
 * generates the 18 candidates BEFORE Gate 1), so this pipeline no longer
 * generates any customer-facing stills — it just animates the six the
 * customer chose, then CUTS them into a real trailer instead of playing them
 * back to back:
 *   1. 3 no-pet "insert" B-roll stills (nano-banana, no Kling spend) — §4
 *   2. each chosen still (order.chosenStills) -> SHOT_SECONDS Kling clip (i2v, silent)
 *   3. original score via Stable Audio 2.5
 *   4. assemble a BEAT EDL (Edit Decision List, not a 6-shot concat): each
 *      clip is trimmed to a 2-3.5s beat (twice — once wide, once as a
 *      "punch-in" reframe of the SAME footage), interleaved with black title
 *      cards and Ken-Burns inserts, normalized so the whole thing is EXACTLY
 *      60.0s, graded (2.35:1 matte + grain + grade) and scored with an SFX
 *      bed on top of the music (buildEdl / assembleToFiles below)
 *   5. centre-crop the same EDL again (no matte, vertical cards) -> 9:16 cut
 *   6. upload both to fal storage, -> AWAITING_ADMIN_APPROVAL
 *
 * Why the rewrite (owner's live-review postmortem, see TRAILER-EDIT-SPEC.md
 * §0): a single 8s i2v shot per cut read as "a cheap GIF" because real
 * trailers cut every 1.5-3s — pace comes from editing, not from motion within
 * one shot. Kling's motion budget is also capped by the identity gate (push it
 * further and the pet drifts), so the fix lives entirely on the edit side:
 * shorter clips, harder cuts, real B-roll, cards instead of burned-in
 * captions, and an SFX bed. This also LOWERS Kling spend (5s cuts, §5) even
 * though the finished trailer now has more, punchier cuts.
 *
 * Cost ~ 6×SHOT_SECONDS×$0.084 video + ~3×$0.02 insert stills + $0.20 music
 * (≈ $2.8 at 5s) + gate re-rolls; stills were already spent at Gate 1.
 * Dev/localhost only (heavy, long-running); on Vercel this moves behind a
 * queue/worker (n8n phase). VIDEO_PIPELINE_MOCK=1 short-circuits e2e.
 */

// Env-overridable so the tier can be A/B'd or rolled back without a deploy.
// standard -> pro: pro trades more $/s for tighter start-frame adherence,
// which is the same direction as the cfg_scale bump below (less drift, at
// the cost of some stiffness) — worth the spend after the profile-drift
// production incident. NOTE: swap the KLING_MODEL env var to instantly
// revert to standard if the pro endpoint id turns out to be wrong or the
// tier underperforms.
// Also the fix for FILM-QUALITY-V3-SPEC.md §2.2(f)'s upscale-double-dip
// (standard is 720p -> scale=1920:1080 upscales it -> punch-in upscales it
// AGAIN): pro is already 1080p native, so new generations skip the first
// upscale entirely. Clips already shot on standard before this default
// stays as-is — this only improves clips generated from here on.
const KLING_MODEL = process.env.KLING_MODEL ?? "fal-ai/kling-video/v3/pro/image-to-video";
const MUSIC_MODEL = "fal-ai/stable-audio-25/text-to-audio";
// Text-to-image (NOT /edit) — insert B-roll has no pet in it at all, so there
// is nothing to anchor an edit model to (spec §4.2).
const INSERT_STILL_MODEL = "fal-ai/nano-banana-pro";

// House setting (spec §5): every beat the EDL below can build is <=3.5s, and
// a punch-in beat REUSES its wide beat's footage (§1.1) rather than consuming
// fresh seconds, so a 5s Kling source clip covers every beat that references
// it. Down from 8s — cheaper AND the old 8s number no longer means anything
// structural (it used to be one whole shot; now it's just raw material a beat
// trims from). Kling duration enum is 3-15s, so 5 is legal either way.
// Re-assembly / single-shot re-render both trim from source, so mixed 5s/8s
// clips across old + new orders are handled identically (spec §5).
const SHOT_SECONDS = 5;

// Trailer total (spec §1.3) — the EDL below is normalized to land EXACTLY
// here, in every case (with or without inserts, see buildEdl).
const TRAILER_SECONDS = 60.0;

/* ------------------------------------------------------------------ */
/* Encode quality (FILM-QUALITY-V3-SPEC.md §2) — every libx264 call in  */
/* this file reads its CRF/preset/fps from here, so there is ONE knob  */
/* per concern instead of N call sites to keep in sync by hand.        */
/* ------------------------------------------------------------------ */

// `-preset veryfast` with no `-crf` used to mean "whatever x264's own default
// is" (~CRF 23) at EVERY encode stage — fine for a preview, not for a $249
// delivered film. Two tiers, not one:
//   - INTERMEDIATE: normalise -> beat render -> card/Ken-Burns render -> the
//     9:16 derive-crop. Four-ish re-encode generations happen here before the
//     customer ever sees a frame, so intermediates are held NEAR-LOSSLESS
//     (CRF 14 is visually indistinguishable from source) to stop generational
//     decay from compounding across those passes.
//   - FINAL: the grade pass (applyGrade) — the LAST video encode before the
//     `-c:v copy` audio mux. Only runs once per film, so it can afford a
//     slower preset for a better quality/bitrate trade at delivery time.
const CRF_INTERMEDIATE = 14;
const PRESET_INTERMEDIATE = "fast";
const CRF_FINAL = 17;
const PRESET_FINAL = "slow";

// Single frame rate every rendered beat (clip, card, Ken Burns insert) shares,
// because ffmpeg's `concat` demuxer requires every segment it stitches to
// already agree on fps — reconciling that AFTER the fact isn't an option.
// This file used to force `fps=24` in normaliseClip (see below) — a straight
// frame DROP via the `fps` filter, not a real pulldown, so on Kling's native
// 30fps output it only ever threw away 1 frame in 5 for no benefit (spec
// §2.2(d)). Kling is the only clip source, so 30 (its native rate) is now the
// house rate everywhere instead of down-converting to a number nothing
// actually shoots at.
export const FILM_FPS = 30;

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

/**
 * Probe a local media file's duration by parsing ffmpeg's own stderr
 * "Duration:" line — no ffprobe dependency in this repo (same technique
 * scripts/test-assemble.ts uses to assert output durations). `ffmpeg -i` with
 * no output file just probes the input and exits non-zero; that's expected
 * here, only stderr is read.
 *
 * Used by assembleToFiles to find out how much footage a source clip
 * ACTUALLY has before asking the EDL to trim a beat from it (see
 * clampToSourceDurations below) — buildEdl's scaling has no visibility into
 * real file lengths on its own.
 */
function probeDurationSeconds(file: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG_BIN, ["-i", file], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("close", () => {
      const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
      if (!m) return reject(new Error(`could not parse duration from ffmpeg output for ${file}:\n${stderr.slice(-500)}`));
      resolve(parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseFloat(m[3]));
    });
    proc.on("error", reject);
  });
}

/**
 * Adopt a source that may be a remote (fal) URL or an already-local file
 * path: URLs get downloaded into `dest`, local paths are used AS-IS. This
 * dual mode is what lets scripts/test-assemble.ts drive the real
 * assembleToFiles() against synthetic local fixtures instead of real
 * generated media — no code fork between "test" and "production" paths.
 */
async function fetchOrLocal(src: string, dest: string): Promise<string> {
  if (/^https?:\/\//.test(src)) {
    await download(src, dest);
    return dest;
  }
  return src;
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
 * Animate a chosen still into a SHOT_SECONDS silent clip with a per-shot
 * camera move. This is now raw MATERIAL for the EDL, not a finished shot —
 * the assembler trims 2-3.5s beats out of it (possibly twice — a wide framing
 * and a punch-in reframe of the same footage, spec §1.1).
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
      duration: String(durationSec),
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

/**
 * One no-pet atmospheric B-roll still (spec §4.2). Text-to-image, not i2v —
 * Ken Burns (renderInsertBeat, below) supplies all the motion an insert
 * needs, so this never touches Kling. Inserts NEVER enter clipUrls/
 * shotClipUrls/shotIdentityScores or any identity-scoring loop (spec §4.4) —
 * there is no pet in the frame to score.
 */
async function generateInsertStill(subject: string): Promise<string> {
  const r = await fal.subscribe(INSERT_STILL_MODEL, {
    input: {
      // Text-to-image only — no negative_prompt input on this endpoint, so
      // the "no animals/people" constraint is folded directly into the
      // prompt text (also true of every WORLD_INSERTS entry, see film-script.ts).
      prompt: `${subject}, cinematic still, absolutely no animals, no pets, no people, no humans, no text, no watermark, moody lighting, atmospheric, 16:9 film still`,
      num_images: 1,
      resolution: "2K",
      aspect_ratio: "16:9",
      output_format: "png",
    },
  });
  const url = (r.data as { images?: { url?: string }[] })?.images?.[0]?.url;
  if (!url) throw new Error("insert still result missing url");
  return url;
}

/** scorePrompt comes from resolveWorld(order).score — static WORLD_SCORES for presets, Claude's bundle for custom orders. */
async function generateScore(scorePrompt: string): Promise<string> {
  const r = await fal.subscribe(MUSIC_MODEL, {
    input: {
      prompt: scorePrompt,
      seconds_total: TRAILER_SECONDS,
      num_inference_steps: 8,
    },
  });
  const url = (r.data as { audio?: { url?: string } })?.audio?.url;
  if (!url) throw new Error("music result missing url");
  return url;
}

/**
 * Normalise a clip to 1920x1080 / FILM_FPS / h264 / silent. Trailer captions
 * used to be burned in here (a gold lower-third drawtext); spec §1.4 moves
 * ALL trailer copy onto black title cards instead (renderCardBeat below), so
 * this is purely a format-normalization step now — no text, no per-shot
 * branching. Clean footage also means a punch-in crop (§1.1) can never clip
 * off a caption, which used to be a real failure mode.
 *
 * NOT merged with renderClipBeat (FILM-QUALITY-V3-SPEC.md §2.2(b)): this runs
 * ONCE per source clip regardless of how many beats reuse it (a wide beat and
 * its punch-in reframe share the same normalised source, spec §1.1), while
 * renderClipBeat runs once per BEAT and additionally trims + optionally
 * punch-in-crops. Folding them into one pass would mean re-deriving the
 * 1920x1080 base frame from raw input for every beat referencing a clip
 * instead of once, which complicates the trim/punch-in math for no CRF
 * benefit — §2.2(a)'s CRF_INTERMEDIATE already keeps this intermediate
 * near-lossless, so the bigger win (stopping generational decay) is already
 * captured without the merge.
 */
async function normaliseClip(input: string, output: string): Promise<void> {
  await ffmpeg([
    "-i", input,
    "-vf", `scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,fps=${FILM_FPS}`,
    "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", PRESET_INTERMEDIATE, "-crf", String(CRF_INTERMEDIATE),
    output,
  ]);
}

type CardLine = { text: string; size: number; y: string; font: string };

/**
 * A solid title card clip with centred gold text. `width`/`height` let the
 * SAME line definitions (authored for the 1920-wide master) render correctly
 * at the 1080-wide 9:16 social resolution too (spec §3.1): every `y` value
 * here is an ffmpeg expression relative to `h`/`w` (the canvas being
 * rendered), so only the font size needs an explicit width-proportional
 * scale — text that's readable at 1920px stays readable at 1080px.
 */
async function titleCard(
  output: string,
  seconds: number,
  lines: CardLine[],
  width = 1920,
  height = 1080
): Promise<void> {
  const scale = width / 1920;
  const draw = lines
    .map(
      (l) =>
        `drawtext=fontfile='${l.font}':text='${esc(l.text)}':fontcolor=0xe8b64c:fontsize=${Math.max(
          1,
          Math.round(l.size * scale)
        )}:x=(w-text_w)/2:y=${l.y}`
    )
    .join(",");
  await ffmpeg([
    "-f", "lavfi", "-i", `color=c=0x0b0a10:s=${width}x${height}:d=${seconds.toFixed(3)}:r=${FILM_FPS}`,
    "-vf", draw,
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", PRESET_INTERMEDIATE, "-crf", String(CRF_INTERMEDIATE),
    output,
  ]);
}

/**
 * Auto-shrink a card's headline for long copy (a long logline, or a long JP
 * pet name) so it never overflows the frame; short copy keeps its full
 * authored size. FONT_DISPLAY (Bebas, condensed) fits more characters per
 * line than FONT_NAME (Noto, wider glyphs), hence the different budgets.
 */
function fitFontSize(text: string, font: string, base: number): number {
  const budget = font === FONT_DISPLAY ? 30 : 20;
  const shrunk = Math.round((base * budget) / Math.max(text.length, budget));
  return Math.max(Math.round(base * 0.55), Math.min(base, shrunk));
}

/**
 * Every card's text content + layout, keyed by CardId. Centralized here so
 * the EDL template only has to say WHICH card a beat is, never HOW it looks.
 * petName always renders in FONT_NAME (JP-capable, per house convention);
 * loglines render in FONT_DISPLAY UNLESS they contain a non-Latin pet name
 * (the "turn" beat weaves the name into the sentence — see resolveWorld).
 */
function cardLinesFor(
  card: CardId,
  petName: string,
  loglines: { intro: string; turn: string; rise: string; tagline: string }
): CardLine[] {
  const asciiName = /^[\x00-\x7F]*$/.test(petName);
  switch (card) {
    case "open":
      return [
        { text: TITLE_CARDS.opening, size: fitFontSize(TITLE_CARDS.opening, FONT_DISPLAY, 90), y: "(h-text_h)/2", font: FONT_DISPLAY },
      ];
    case "intro":
      return [
        { text: loglines.intro, size: fitFontSize(loglines.intro, FONT_DISPLAY, 68), y: "(h-text_h)/2", font: FONT_DISPLAY },
      ];
    case "starring":
      return [
        { text: TITLE_CARDS.starring, size: 40, y: "h/2-100", font: FONT_DISPLAY },
        { text: petName, size: fitFontSize(petName, FONT_NAME, 120), y: "h/2-10", font: FONT_NAME },
      ];
    case "turn": {
      const font = asciiName ? FONT_DISPLAY : FONT_NAME;
      return [{ text: loglines.turn, size: fitFontSize(loglines.turn, font, 68), y: "(h-text_h)/2", font }];
    }
    case "rise":
      return [
        { text: loglines.rise, size: fitFontSize(loglines.rise, FONT_DISPLAY, 68), y: "(h-text_h)/2", font: FONT_DISPLAY },
      ];
    case "finale":
      return [
        { text: petName, size: fitFontSize(petName, FONT_NAME, 156), y: "h/2-160", font: FONT_NAME },
        { text: loglines.tagline, size: fitFontSize(loglines.tagline, FONT_DISPLAY, 84), y: "h/2+30", font: FONT_DISPLAY },
      ];
    case "comingSoon":
      return [{ text: TITLE_CARDS.comingSoon, size: 58, y: "(h-text_h)/2", font: FONT_DISPLAY }];
    case "brand":
      return [{ text: TITLE_CARDS.closing, size: 44, y: "(h-text_h)/2", font: FONT_DISPLAY }];
  }
}

/* ------------------------------------------------------------------ */
/* Beat EDL (Edit Decision List) — TRAILER-EDIT-SPEC.md §1              */
/* ------------------------------------------------------------------ */

type CardId = "open" | "intro" | "starring" | "turn" | "rise" | "finale" | "comingSoon" | "brand";

type EdlBeat =
  | { kind: "clip"; clip: number; punchIn: number; seconds: number }
  | { kind: "card"; card: CardId; seconds: number }
  | { kind: "insert"; insert: number; seconds: number };

// Punch-in zoom factor (FILM-QUALITY-V3-SPEC.md §1.2(b)): ffmpeg
// `crop=iw/Z:ih/Z:x:y,scale=1920:1080`. Was 1.35 — combined with the (now
// removed, see gradeFilterChain) 2.35:1 matte crop, ~25% of the frame's
// height was being discarded from the top, and SHOT_FRAMINGS deliberately
// puts the pet's face near the TOP of frame, so ears and the top of the head
// were structurally cut off in every punch-in beat. Dropping the matte fixes
// most of it; dropping the zoom to 1.2 (still a visible reframe) shrinks the
// remaining discarded band, and PUNCH_IN_Y_BIAS below fixes where that band
// comes from. PUNCH_IN_ZOOM_MAX is the hard ceiling the spec calls out — the
// assertion below is a cheap guard against nudging the tuning knob past it by
// accident later.
export const PUNCH_IN_ZOOM = 1.2;
const PUNCH_IN_ZOOM_MAX = 1.5;
const NO_PUNCH_IN = 1;
if (PUNCH_IN_ZOOM > PUNCH_IN_ZOOM_MAX) {
  throw new Error(`PUNCH_IN_ZOOM (${PUNCH_IN_ZOOM}) exceeds PUNCH_IN_ZOOM_MAX (${PUNCH_IN_ZOOM_MAX})`);
}

// A CENTRE crop cuts off the head: SHOT_FRAMINGS composes the face toward the
// TOP of frame (see film-script.ts), so a symmetric crop discards headroom the
// framing put there on purpose. This biases the punch-in crop window DOWN
// instead — `crop=iw/Z:ih/Z:(iw-ow)/2:(ih-oh)*PUNCH_IN_Y_BIAS` — so 3/4 of
// whatever height the zoom discards comes off the BOTTOM of frame (feet,
// ground — low story-importance) and only 1/4 comes off the top, protecting
// the ears/head the still was framed to show.
export const PUNCH_IN_Y_BIAS = 0.25;

/**
 * The default beat template (spec §1.2) — 6 clips (each used twice: once
 * wide, once as a punch-in reframe of the SAME footage, §1.1), 3 no-pet
 * inserts, 8 title cards. Authored `seconds` here are the UNSCALED lengths
 * from the spec table (raw total ≈51.7s); buildEdl() below scales every
 * clip/insert beat so the assembled total lands on EXACTLY 60.0s (§1.3).
 *
 * This is a plain data literal on purpose: reordering the trailer, swapping
 * which cut gets the climax, or retiming a beat is a one-line edit here —
 * nothing else in the assembler needs to change.
 */
const EDL_TEMPLATE: readonly EdlBeat[] = [
  { kind: "card", card: "open", seconds: 2.0 },
  { kind: "clip", clip: 0, punchIn: NO_PUNCH_IN, seconds: 3.0 },
  { kind: "card", card: "intro", seconds: 2.0 },
  { kind: "clip", clip: 0, punchIn: PUNCH_IN_ZOOM, seconds: 2.0 },
  { kind: "clip", clip: 1, punchIn: NO_PUNCH_IN, seconds: 2.5 },
  { kind: "card", card: "starring", seconds: 2.2 },
  { kind: "clip", clip: 1, punchIn: PUNCH_IN_ZOOM, seconds: 2.0 },
  { kind: "insert", insert: 0, seconds: 2.0 },
  { kind: "clip", clip: 2, punchIn: NO_PUNCH_IN, seconds: 2.5 },
  { kind: "clip", clip: 2, punchIn: PUNCH_IN_ZOOM, seconds: 2.0 },
  { kind: "card", card: "turn", seconds: 2.0 },
  { kind: "clip", clip: 3, punchIn: NO_PUNCH_IN, seconds: 2.5 },
  { kind: "insert", insert: 1, seconds: 2.0 },
  { kind: "clip", clip: 3, punchIn: PUNCH_IN_ZOOM, seconds: 2.0 },
  { kind: "clip", clip: 4, punchIn: NO_PUNCH_IN, seconds: 2.5 },
  { kind: "card", card: "rise", seconds: 2.0 },
  { kind: "clip", clip: 4, punchIn: PUNCH_IN_ZOOM, seconds: 2.0 },
  { kind: "insert", insert: 2, seconds: 2.0 },
  { kind: "clip", clip: 5, punchIn: NO_PUNCH_IN, seconds: 2.5 },
  { kind: "clip", clip: 5, punchIn: PUNCH_IN_ZOOM, seconds: 3.5 }, // climax punch-in, held longer
  { kind: "card", card: "finale", seconds: 3.0 },
  { kind: "card", card: "comingSoon", seconds: 2.0 },
  { kind: "card", card: "brand", seconds: 1.5 },
];

// Rounding granularity for the 60s normalization (spec §1.3: "フレーム単位
// （1/30s）に丸め"). Working in INTEGER frames (not floating seconds) means
// summed beat lengths can never drift from 60.000s by float error.
const FRAME_UNIT_SECONDS = 1 / 30;

function secondsToFrames(seconds: number): number {
  return Math.round(seconds / FRAME_UNIT_SECONDS);
}

function framesToSeconds(frames: number): number {
  return frames * FRAME_UNIT_SECONDS;
}

const TRAILER_FRAMES = secondsToFrames(TRAILER_SECONDS);

export type ScaledBeat = EdlBeat & { frames: number };

/**
 * Pure function, no I/O, no randomness (spec §1.3 — a re-assembly of the same
 * order, or a single-shot re-render, must produce the same EDL every time,
 * same reasoning as getShotMotion's stable hash). `clipDurationsSeconds`, if
 * given, is itself just numbers (probed by the CALLER — see assembleToFiles —
 * not by this function), so passing it doesn't reintroduce I/O here; the same
 * durations always produce the same output.
 *
 * Scales every clip/insert beat by ONE factor so the total lands EXACTLY on
 * 60.0s; card beats keep their authored length (stretching a card reads as
 * dead air). When `hasInserts` is false the 3 insert beats are dropped BEFORE
 * scaling, so the freed time is absorbed by the clip beats automatically —
 * the mandatory graceful-degradation path for an order with no insert stills
 * (spec §4.3/§4.4) still lands on exactly 60.0s, with no special-casing
 * downstream.
 *
 * Whatever integer-frame remainder is left after rounding every beat is
 * absorbed by the LAST scalable (non-card) beat, so the sum is always
 * exactly TRAILER_FRAMES.
 *
 * FILM-QUALITY-V3 bugfix: the scale factor above has NO idea how long the
 * real source clips are — dropping the 3 insert beats (no-inserts case)
 * raises the scale enough that a beat can ask a short SHOT_SECONDS(5s) clip
 * to hand over MORE than 5s, and renderClipBeat's `-t` just silently trims to
 * whatever ffmpeg can read, so the finished film came out short with no
 * error (caught by scripts/test-assemble.ts's no-inserts run: master landed
 * at 59.87s, not 60.0s). `clipDurationsSeconds[clipIndex]` — the PROBED
 * duration of each normalised source clip, passed in by the caller — lets
 * this function clamp every clip beat to what its source can actually give,
 * and clampToSourceDurations (below) redistributes whatever a clamp removes
 * so the total still lands on exactly TRAILER_FRAMES. Omitting the argument
 * (as the structural EDL-shape tests in test-assemble.ts do) skips clamping
 * entirely and reproduces the exact pre-fix output — no behavior change for
 * callers that don't have real files to probe.
 */
export function buildEdl(hasInserts: boolean, clipDurationsSeconds?: number[]): ScaledBeat[] {
  const template = hasInserts ? EDL_TEMPLATE : EDL_TEMPLATE.filter((b) => b.kind !== "insert");

  const cardFrames = template
    .filter((b) => b.kind === "card")
    .reduce((sum, b) => sum + secondsToFrames(b.seconds), 0);
  const scalableRawFrames = template
    .filter((b) => b.kind !== "card")
    .reduce((sum, b) => sum + secondsToFrames(b.seconds), 0);
  const scale = (TRAILER_FRAMES - cardFrames) / scalableRawFrames;

  let scaled: ScaledBeat[] = template.map((b) => ({
    ...b,
    frames: b.kind === "card" ? secondsToFrames(b.seconds) : Math.round(secondsToFrames(b.seconds) * scale),
  }));

  const drift = TRAILER_FRAMES - scaled.reduce((sum, b) => sum + b.frames, 0);
  for (let i = scaled.length - 1; i >= 0; i--) {
    if (scaled[i].kind !== "card") {
      scaled[i] = { ...scaled[i], frames: scaled[i].frames + drift };
      break;
    }
  }

  if (clipDurationsSeconds) {
    scaled = clampToSourceDurations(scaled, clipDurationsSeconds);
  }

  return scaled;
}

/**
 * Clamps every "clip" beat to (at most) its own source clip's probed
 * duration, redistributing whatever a clamp removes to beats that still have
 * headroom so the assembled total is UNCHANGED at exactly TRAILER_FRAMES —
 * see buildEdl's doc comment above for why this exists.
 *
 * Redistribution order: "insert" beats first (a Ken-Burns push-in on a still
 * image has no real upper bound — it can always absorb more), THEN other
 * still-uncapped "clip" beats. Split evenly across whatever receiver pool
 * exists at each pass — simple and deterministic, and a beat that receives
 * more than IT can hold just gets caught and clamped on the next pass.
 *
 * Iterates because redistributing can itself push a previously-fine beat
 * over ITS OWN cap (e.g. two beats sharing one short clip); bounded by
 * `beats.length` since every pass either caps at least one more beat or
 * exits with excess === 0.
 *
 * If literally every beat with headroom is exhausted (every clip AND every
 * insert already maxed — only possible with pathologically short sources)
 * the residual is parked on the LAST card beat instead of silently shipping
 * a short film, and one line is logged so it's visible in production logs
 * rather than a silent truncation nobody notices until an owner complains.
 *
 * Deterministic: the same beats + the same probed durations always
 * redistribute identically, so a later re-assemble or single-shot
 * re-render (which re-probes the same cached clip URLs) reproduces the
 * exact same EDL.
 */
function clampToSourceDurations(beats: ScaledBeat[], clipDurationsSeconds: number[]): ScaledBeat[] {
  // Math.floor, not round: never ask ffmpeg to trim MORE than a source
  // actually contains. Missing/undefined duration data for a clip index
  // means "don't clamp it" (Infinity), not "clamp to zero" — safer default.
  const capFramesFor = (clipIndex: number): number =>
    Math.max(0, Math.floor(secondsToFrames(clipDurationsSeconds[clipIndex] ?? Infinity)));

  const result: ScaledBeat[] = beats.map((b) => ({ ...b }));
  // A beat is "capped" once its frames are pinned to its source's max; capped
  // beats never receive redistributed time (they have none left to give).
  const capped = new Set<number>();

  for (let iter = 0; iter < result.length + 1; iter++) {
    let excess = 0;
    result.forEach((b, i) => {
      if (b.kind !== "clip" || capped.has(i)) return;
      const cap = capFramesFor(b.clip);
      if (b.frames > cap) {
        excess += b.frames - cap;
        result[i] = { ...b, frames: cap };
        capped.add(i);
      }
    });
    if (excess === 0) break;

    const receivers = result
      .map((b, i) => ({ b, i }))
      .filter(({ b, i }) => b.kind === "insert" || (b.kind === "clip" && !capped.has(i)));

    if (receivers.length === 0) {
      // Nothing left with headroom — extend the closing card rather than
      // ship a short film.
      for (let i = result.length - 1; i >= 0; i--) {
        if (result[i].kind === "card") {
          console.warn(
            `[film] EDL source clips too short to fill ${TRAILER_SECONDS}s even fully clamped — extending the closing card by ${framesToSeconds(excess).toFixed(3)}s`
          );
          result[i] = { ...result[i], frames: result[i].frames + excess };
          break;
        }
      }
      break;
    }

    // Even split, remainder onto the first receiver — simple and
    // deterministic; any receiver that overshoots ITS cap gets caught on the
    // next iteration.
    const share = Math.floor(excess / receivers.length);
    let remainder = excess - share * receivers.length;
    receivers.forEach(({ i }) => {
      const bonus = remainder > 0 ? 1 : 0;
      if (bonus) remainder--;
      result[i] = { ...result[i], frames: result[i].frames + share + bonus };
    });
  }

  return result;
}

/* ------------------------------------------------------------------ */
/* Per-beat rendering                                                   */
/* ------------------------------------------------------------------ */

/**
 * Builds the crop/scale filter for one punch-in reframe (spec §1.2(b)/§2.2(e)).
 * Exported (not just internal to renderClipBeat) so scripts/test-assemble.ts
 * can assert the upward y-bias directly against this exact string rather than
 * re-deriving it — one source of truth for both the render path and the test.
 */
export function punchInFilter(punchIn: number): string {
  // `flags=lanczos` (spec §2.2(e)): the punch-in always upsamples (crop then
  // scale back to 1920x1080), and lanczos is noticeably sharper than the
  // default bilinear scaler on an upscale.
  return punchIn > 1
    ? `crop=iw/${punchIn}:ih/${punchIn}:(iw-ow)/2:(ih-oh)*${PUNCH_IN_Y_BIAS},scale=1920:1080:flags=lanczos`
    : "scale=1920:1080:flags=lanczos";
}

/**
 * Render one "clip" beat: trim the SAME [0, seconds] window of the source
 * clip that every other beat referencing this clip also trims (spec §1.1 —
 * a wide beat and its punch-in reframe are the identical footage, cut
 * differently), optionally punch-in cropped, always re-encoded to a fresh
 * 1920x1080 segment (re-encoding, not stream-copy, guarantees a clean
 * keyframe at the segment boundary for the concat step below).
 */
async function renderClipBeat(sourceNorm: string, output: string, seconds: number, punchIn: number): Promise<void> {
  await ffmpeg([
    "-ss", "0", "-t", seconds.toFixed(3), "-i", sourceNorm,
    "-vf", punchInFilter(punchIn),
    "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", PRESET_INTERMEDIATE, "-crf", String(CRF_INTERMEDIATE), "-r", String(FILM_FPS),
    output,
  ]);
}

// Ken Burns tuning (spec §4.2) — gentle zoom-in, no pan: enough motion that an
// insert doesn't read as a static photo, subtle enough it doesn't look like a
// slideshow. Upsampling to 4K before the zoompan keeps the crop sharp. Frame
// rate is FILM_FPS (§2.2(d)) — inserts must match every other beat's fps for
// concat, so there is no separate Ken-Burns-only fps constant any more.
const KEN_BURNS_ZOOM_END = 1.15;

/** Render one "insert" beat: a still + Ken Burns push-in, no Kling involved. */
async function renderInsertBeat(stillPath: string, output: string, seconds: number): Promise<void> {
  const frames = Math.max(1, Math.round(seconds * FILM_FPS));
  const zoomStep = (KEN_BURNS_ZOOM_END - 1) / frames;
  await ffmpeg([
    "-loop", "1", "-i", stillPath,
    "-t", seconds.toFixed(3),
    "-vf",
    `scale=3840:2160,zoompan=z='min(zoom+${zoomStep.toFixed(6)},${KEN_BURNS_ZOOM_END})':d=${frames}:s=1920x1080:fps=${FILM_FPS}`,
    "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", PRESET_INTERMEDIATE, "-crf", String(CRF_INTERMEDIATE),
    output,
  ]);
}

async function concatSegments(dir: string, segments: string[], output: string): Promise<void> {
  const listFile = path.join(dir, `concat-${path.basename(output)}.txt`);
  await writeFile(listFile, segments.map((f) => `file '${f}'`).join("\n"));
  await ffmpeg(["-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", output]);
}

// --- Finish / grade (spec §3; matte removal + grain retune per
// FILM-QUALITY-V3-SPEC.md §1.2(a)/§2.2(c)) — every knob here is intentionally
// subtle and named so tuning (or disabling a term — just delete it from the
// chain below) is a one-line edit in this one place.
//
// REMOVED: MATTE_ASPECT (was 2.35) and its crop+pad branch. The 2.35:1
// cinescope matte cropped ~24% off the frame's height, stacked on TOP of the
// punch-in crop above — between the two, ~25% was being cut from the top of
// frame, and SHOT_FRAMINGS puts the pet's face there on purpose, so ears/head
// were structurally clipped. The face IS the product; a "cinematic" letterbox
// that decapitates it is a net loss the cards/cuts/SFX already cover without.
// Do NOT re-add a centre-crop matte here without ALSO applying the punch-in's
// upward y-bias (PUNCH_IN_Y_BIAS) to it — a centre crop alone reintroduces
// the exact bug this removal fixes.
const GRAIN_STRENGTH = 3; // noise=alls=N — was 6, halved: at the OLD implicit ~CRF23, grain that heavy collapsed into block noise before delivery (spec §2.2(c)). Re-evaluate raising this once the CRF_FINAL/CRF_INTERMEDIATE change below has been live a while and grain-vs-compression is reassessed.
const GRADE_SATURATION = 1.06;
const GRADE_CONTRAST = 1.04;
const GRADE_SHADOW_BLUE = 0.02; // colorbalance shadow term — a hint of teal, not a full teal/orange grade
const GRADE_MID_WARM = 0.015; // colorbalance midtone term — a hint of warmth, pairs with the shadow cool
const VIGNETTE_ANGLE = "PI/5"; // soft falloff, not a spotlight

/**
 * Shared post-stage filter chain: grade + grain + vignette. Used for BOTH the
 * widescreen master and the 9:16 social cut — there is no more per-aspect
 * branching here since the matte (the only aspect-dependent term) is gone.
 * Applied ONCE to the fully concatenated timeline rather than per-beat: one
 * ffmpeg pass instead of N, and it guarantees the texture reads as continuous
 * across every cut, card and insert instead of drifting beat-to-beat.
 */
// Exported (spec §7 item 4): scripts/test-assemble.ts asserts directly against
// this exact string — that no centre-crop matte (`crop=`/`pad=`) has crept
// back in — rather than re-deriving the chain itself.
export function gradeFilterChain(): string {
  return [
    `eq=saturation=${GRADE_SATURATION}:contrast=${GRADE_CONTRAST}`,
    `colorbalance=rs=0:gs=0:bs=${GRADE_SHADOW_BLUE}:rm=${GRADE_MID_WARM}:gm=0:bm=-${GRADE_MID_WARM}`,
    `noise=alls=${GRAIN_STRENGTH}:allf=t+u`,
    `vignette=${VIGNETTE_ANGLE}`,
  ].join(",");
}

async function applyGrade(input: string, output: string, filterChain: string): Promise<void> {
  // FINAL encode (spec §2.2(a)): this is the last video encode before the
  // `-c:v copy` audio mux, so it gets the delivery-quality tier (CRF_FINAL +
  // PRESET_FINAL), not the intermediate one every other libx264 call in this
  // file uses.
  await ffmpeg([
    "-i", input,
    "-vf", filterChain,
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", PRESET_FINAL, "-crf", String(CRF_FINAL),
    output,
  ]);
}

/* ------------------------------------------------------------------ */
/* Audio — music + SFX bed (spec §2)                                    */
/* ------------------------------------------------------------------ */

const SFX_DIR = path.join(process.cwd(), "public/sfx");
const SFX_FILES = { boom: "boom.wav", riser: "riser.wav", whoosh: "whoosh.wav" } as const;
type SfxName = keyof typeof SFX_FILES;

// Levels relative to the music bed (spec §2.2) — boom sits at unity (it's the
// accent that punches through a duck), riser and whoosh sit lower so they
// support the music instead of fighting it.
const SFX_LEVEL_DB: Record<SfxName, number> = { boom: 0, riser: -3, whoosh: -6 };
const MUSIC_DUCK_DB = -2.5; // music dips this much under each card's boom hit
const MUSIC_DUCK_SECONDS = 0.6; // duck window length — just the transient, not the whole card
const MUSIC_FADE_OUT_SECONDS = 1.5; // final fade so the 60s mark doesn't cut off abruptly
const RISER_LEAD_SECONDS = 2.5; // riser starts this long before the climax punch-in beat
const WHOOSH_LEAD_SECONDS = 0.15; // whoosh arrives just ahead of the cut it accents
const MIX_SAMPLE_RATE = 44100;
// Not every card gets a whoosh (spec: "全部には付けない...5〜6箇所") — these 5
// are the biggest story beats; open/comingSoon/brand stay clean so the
// bookends don't feel over-produced.
const WHOOSH_CARD_IDS: CardId[] = ["intro", "starring", "turn", "rise", "finale"];

/** Checked ONCE per assembly — spec §2.1's mandatory fallback: any file
 * missing means "assemble without SFX", never a partial/broken mix. */
function sfxFilesAvailable(): boolean {
  return (Object.values(SFX_FILES) as string[]).every((f) => existsSync(path.join(SFX_DIR, f)));
}

function dbToAmplitude(db: number): number {
  return Math.pow(10, db / 20);
}

/** Cumulative start time (seconds) of every beat, in EDL order. */
function beatStartTimes(beats: ScaledBeat[]): number[] {
  const starts: number[] = [];
  let t = 0;
  for (const b of beats) {
    starts.push(t);
    t += framesToSeconds(b.frames);
  }
  return starts;
}

type SfxEvent = { file: SfxName; atSeconds: number };

/** Every SFX one-shot this EDL should fire, with its absolute start time. */
function buildSfxEvents(beats: ScaledBeat[]): SfxEvent[] {
  const starts = beatStartTimes(beats);
  const events: SfxEvent[] = [];
  beats.forEach((b, i) => {
    if (b.kind === "card") {
      events.push({ file: "boom", atSeconds: starts[i] });
      if (WHOOSH_CARD_IDS.includes(b.card)) {
        events.push({ file: "whoosh", atSeconds: Math.max(0, starts[i] - WHOOSH_LEAD_SECONDS) });
      }
    }
  });
  // Riser leads into the climax — the LAST "clip" beat in the EDL (the
  // long punch-in, spec §1.2's b12).
  let climaxStart: number | undefined;
  beats.forEach((b, i) => {
    if (b.kind === "clip") climaxStart = starts[i];
  });
  if (climaxStart !== undefined) {
    events.push({ file: "riser", atSeconds: Math.max(0, climaxStart - RISER_LEAD_SECONDS) });
  }
  return events;
}

/**
 * Builds the final audio track: music with per-card ducking + a final
 * fade-out, plus SFX one-shots placed at each event's timestamp (spec §2.2).
 * Falls back to music-only (no ducking, still fades out) when the SFX files
 * aren't present — the mandatory graceful-degradation path (spec §2.1): a
 * missing garnish must never fail assembly.
 */
async function mixAudio(dir: string, beats: ScaledBeat[], scoreLocalPath: string, totalSeconds: number): Promise<string> {
  const output = path.join(dir, "mix.wav");
  const fadeStart = Math.max(0, totalSeconds - MUSIC_FADE_OUT_SECONDS);

  if (!sfxFilesAvailable()) {
    console.log("[film] SFX files not found in public/sfx — assembling with music only");
    await ffmpeg([
      "-i", scoreLocalPath,
      "-af", `afade=t=out:st=${fadeStart.toFixed(3)}:d=${MUSIC_FADE_OUT_SECONDS}`,
      "-t", totalSeconds.toFixed(3),
      output,
    ]);
    return output;
  }

  const events = buildSfxEvents(beats);
  const starts = beatStartTimes(beats);
  const inputs: string[] = ["-i", scoreLocalPath];
  for (const e of events) inputs.push("-i", path.join(SFX_DIR, SFX_FILES[e.file]));

  const duckWindows = beats
    .map((b, i) => ({ b, i }))
    .filter(({ b }) => b.kind === "card")
    .map(({ i }) => {
      const start = starts[i];
      const end = start + MUSIC_DUCK_SECONDS;
      return `volume=enable='between(t,${start.toFixed(3)},${end.toFixed(3)})':volume=${dbToAmplitude(MUSIC_DUCK_DB).toFixed(4)}`;
    });
  const musicChain = [
    ...duckWindows,
    `afade=t=out:st=${fadeStart.toFixed(3)}:d=${MUSIC_FADE_OUT_SECONDS}`,
    `aformat=sample_rates=${MIX_SAMPLE_RATE}:channel_layouts=stereo`,
  ].join(",");

  const filterParts: string[] = [`[0:a]${musicChain}[music]`];
  const mixLabels = ["[music]"];
  events.forEach((e, idx) => {
    const ms = Math.round(e.atSeconds * 1000);
    const amp = dbToAmplitude(SFX_LEVEL_DB[e.file]);
    const label = `sfx${idx}`;
    filterParts.push(
      `[${idx + 1}:a]adelay=${ms}:all=1,volume=${amp.toFixed(4)},aformat=sample_rates=${MIX_SAMPLE_RATE}:channel_layouts=stereo[${label}]`
    );
    mixLabels.push(`[${label}]`);
  });
  filterParts.push(`${mixLabels.join("")}amix=inputs=${mixLabels.length}:duration=first:dropout_transition=0[a]`);

  await ffmpeg([
    ...inputs,
    "-filter_complex", filterParts.join(";"),
    "-map", "[a]",
    "-t", totalSeconds.toFixed(3),
    output,
  ]);
  return output;
}

/* ------------------------------------------------------------------ */
/* Artifacts + orchestration                                           */
/* ------------------------------------------------------------------ */

/** Persisted intermediate results, so a run resumes without re-spending. */
type FilmArtifacts = {
  clipUrls?: string[];
  clipScores?: number[]; // per-shot identity score, parallel to clipUrls
  scoreUrl?: string;
  // 3 no-pet insert-scene stills (spec §4.2) — cached SEPARATELY from
  // clipUrls/clipScores so they never enter the identity-scoring loop
  // (spec §4.4). undefined = not yet attempted; [] = attempted and
  // unavailable (custom order with no `inserts`, or generation failed —
  // both fall back to an insert-less EDL, never a failed film).
  insertStillUrls?: string[];
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

  // Stage I. Insert stills (spec §4.2) — pure garnish, generated first ("冒頭"
  // per spec §4.2) and cached independently. A failure here is caught and
  // cached as [] rather than thrown: a paying customer's film must never fail
  // over B-roll (spec §4.3/§4.4 graceful degradation).
  if (art.insertStillUrls === undefined) {
    if (resolved.inserts.length >= 3) {
      console.log(`[film] generating 3 insert stills order=${order.id}`);
      try {
        const urls = await Promise.all(resolved.inserts.slice(0, 3).map((subject) => generateInsertStill(subject)));
        art = await saveArtifacts(order.id, { insertStillUrls: urls });
      } catch (e) {
        console.warn(`[film] insert generation failed, continuing without inserts order=${order.id}:`, e);
        art = await saveArtifacts(order.id, { insertStillUrls: [] });
      }
    } else {
      // Legacy order, or a custom order whose generatedScript carries no
      // `inserts` (§4.3 fallback) — no subjects to render from.
      art = await saveArtifacts(order.id, { insertStillUrls: [] });
    }
  }

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
  const insertStillUrls = art.insertStillUrls ?? [];

  const lowest = clipScores.length ? Math.min(...clipScores) : 100;
  console.log(`[film] clip identity scores order=${order.id}: [${clipScores.join(", ")}] (lowest ${lowest})`);

  console.log(`[film] assembling order=${order.id}`);
  const [masterUrl, socialUrl] = await assemble(order.id, petName, clipUrls, insertStillUrls, scoreUrl, loglines);

  // Persist the per-shot audit into dedicated fields (filmArtifacts is cleared
  // on completion) so the admin drift view has it at Gate 2.
  await prisma.order.update({
    where: { id: order.id },
    data: { shotClipUrls: clipUrls, shotIdentityScores: clipScores.map((s) => Math.round(s)) },
  });

  await completeFilmGeneration(order.id, masterUrl, socialUrl);
}

/**
 * Renders every beat of the EDL, mixes audio, grades, and returns LOCAL file
 * paths for the 16:9 master and 9:16 social cut. `clipSources`/
 * `insertSources`/`scoreSource` may be remote (fal) URLs — downloaded into
 * `dir` — or already-local file paths, used as-is; that dual mode is what
 * lets scripts/test-assemble.ts drive this exact function against synthetic
 * local fixtures instead of real generated media, with no fork between test
 * and production code paths. `insertSources` may be [] (no inserts available)
 * — buildEdl() drops the insert beats and normalization still lands on
 * exactly 60.0s (spec §1.3/§4.3), EXCEPT when a source clip is too short to
 * give a scaled-up beat what it asks for — see clampToSourceDurations, fed
 * from the probed clip durations below.
 */
async function assembleToFiles(
  dir: string,
  petName: string,
  clipSources: string[],
  insertSources: string[],
  scoreSource: string,
  loglines: { intro: string; turn: string; rise: string; tagline: string }
): Promise<{ masterPath: string; socialPath: string }> {
  const hasInserts = insertSources.length >= 3;

  // --- Source prep: download (or adopt local paths) + normalize ONCE per
  // clip/insert, however many beats reference it (spec §1.1 — beats reuse the
  // SAME clip/still footage, they don't consume fresh material per beat).
  // Clips are normalised BEFORE buildEdl runs (moved ahead of where it used
  // to sit) because buildEdl now needs each clip's ACTUAL usable duration —
  // see the FILM-QUALITY-V3 bugfix note on buildEdl for why: without it, a
  // no-inserts EDL's higher scale factor could ask a short source clip for
  // more seconds than it has, and the film silently came out short.
  const normClips: string[] = [];
  for (let i = 0; i < clipSources.length; i++) {
    const raw = await fetchOrLocal(clipSources[i], path.join(dir, `clip-raw-${i}.mp4`));
    const norm = path.join(dir, `clip-norm-${i}.mp4`);
    await normaliseClip(raw, norm);
    normClips.push(norm);
  }
  // Probe the NORMALISED clips (not the raw sources) — normalisation can
  // shift a duration by a frame or two (fps conversion), and renderClipBeat
  // trims from the normalised file, so that's the length that actually
  // matters for the clamp.
  const clipDurationsSeconds = await Promise.all(normClips.map((p) => probeDurationSeconds(p)));
  const edl = buildEdl(hasInserts, clipDurationsSeconds);

  const insertStills: string[] = [];
  if (hasInserts) {
    for (let i = 0; i < 3; i++) {
      insertStills.push(await fetchOrLocal(insertSources[i], path.join(dir, `insert-raw-${i}.png`)));
    }
  }
  const scoreLocal = await fetchOrLocal(scoreSource, path.join(dir, "score.wav"));

  // --- Render every beat at 1920x1080 — no grade/matte yet (applied ONCE to
  // the finished timeline below, see gradeFilterChain).
  const wideSegments: string[] = [];
  for (let i = 0; i < edl.length; i++) {
    const beat = edl[i];
    const seconds = framesToSeconds(beat.frames);
    const out = path.join(dir, `wide-${String(i).padStart(2, "0")}.mp4`);
    if (beat.kind === "clip") {
      await renderClipBeat(normClips[beat.clip], out, seconds, beat.punchIn);
    } else if (beat.kind === "insert") {
      await renderInsertBeat(insertStills[beat.insert], out, seconds);
    } else {
      await titleCard(out, seconds, cardLinesFor(beat.card, petName, loglines), 1920, 1080);
    }
    wideSegments.push(out);
  }

  // --- Widescreen master: concat -> shared grade/grain pass (no matte, see
  // gradeFilterChain).
  const rawMaster = path.join(dir, "raw-master.mp4");
  await concatSegments(dir, wideSegments, rawMaster);
  const gradedMaster = path.join(dir, "graded-master.mp4");
  await applyGrade(rawMaster, gradedMaster, gradeFilterChain());

  // --- 9:16 social: same EDL (spec §3.1) — cards are re-rendered natively
  // vertical, clip/insert beats are DERIVED from the widescreen render via a
  // center crop ("中心クロップは現行踏襲" — the same crop the pre-EDL pipeline
  // applied to its finished master). gradeFilterChain has no aspect-dependent
  // branch any more (the matte was the only one), so master and social share
  // the exact same grade call now.
  const vertSegments: string[] = [];
  for (let i = 0; i < edl.length; i++) {
    const beat = edl[i];
    const seconds = framesToSeconds(beat.frames);
    const out = path.join(dir, `vert-${String(i).padStart(2, "0")}.mp4`);
    if (beat.kind === "card") {
      await titleCard(out, seconds, cardLinesFor(beat.card, petName, loglines), 1080, 1920);
    } else {
      await ffmpeg([
        "-i", wideSegments[i],
        "-vf", "crop=ih*9/16:ih,scale=1080:1920",
        "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", PRESET_INTERMEDIATE, "-crf", String(CRF_INTERMEDIATE),
        out,
      ]);
    }
    vertSegments.push(out);
  }
  const rawSocial = path.join(dir, "raw-social.mp4");
  await concatSegments(dir, vertSegments, rawSocial);
  const gradedSocial = path.join(dir, "graded-social.mp4");
  await applyGrade(rawSocial, gradedSocial, gradeFilterChain());

  // --- Audio: one mix shared by both cuts (same EDL -> identical timing, SFX
  // and duck windows regardless of aspect ratio).
  const mixedAudio = await mixAudio(dir, edl, scoreLocal, TRAILER_SECONDS);

  const masterPath = path.join(dir, "master.mp4");
  await ffmpeg([
    "-i", gradedMaster, "-i", mixedAudio,
    "-map", "0:v", "-map", "1:a",
    "-c:v", "copy", "-c:a", "aac", "-shortest",
    masterPath,
  ]);
  const socialPath = path.join(dir, "social.mp4");
  await ffmpeg([
    "-i", gradedSocial, "-i", mixedAudio,
    "-map", "0:v", "-map", "1:a",
    "-c:v", "copy", "-c:a", "aac", "-shortest",
    socialPath,
  ]);

  return { masterPath, socialPath };
}

/**
 * Thin export of assembleToFiles for scripts/test-assemble.ts — runs the
 * EXACT production render path against local synthetic fixtures (no fal, no
 * DB, no upload). Returns local file paths instead of uploading them.
 */
export function assembleForTest(
  dir: string,
  petName: string,
  clipPaths: string[],
  insertPaths: string[],
  scorePath: string,
  loglines: { intro: string; turn: string; rise: string; tagline: string }
): Promise<{ masterPath: string; socialPath: string }> {
  return assembleToFiles(dir, petName, clipPaths, insertPaths, scorePath, loglines);
}

async function assemble(
  orderId: string,
  petName: string,
  clipUrls: string[],
  insertUrls: string[],
  scoreUrl: string,
  loglines: { intro: string; turn: string; rise: string; tagline: string }
): Promise<[string, string]> {
  const dir = await mkdtemp(path.join(tmpdir(), `mt-film-${orderId}-`));
  try {
    const { masterPath, socialPath } = await assembleToFiles(dir, petName, clipUrls, insertUrls, scoreUrl, loglines);
    // Upload both. Filename is ASCII-slugged (fal storage mangles non-ASCII).
    const slug = petName.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "film";
    const masterUrl = await uploadFile(masterPath, `${slug}-marquee-tails.mp4`);
    const socialUrl = await uploadFile(socialPath, `${slug}-marquee-tails-social.mp4`);
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
    "film assembled (beat EDL, 60s trailer)"
  );
  // Keep filmArtifacts (clips + inserts + music): the admin's single-shot
  // re-render reuses them so fixing one cut never re-spends on the other
  // five, the inserts, or the score.
  console.log(`[film] order=${orderId} -> AWAITING_ADMIN_APPROVAL`);
}

/**
 * Single-shot re-render — the admin's Gate-2 fix for "this one cut is off".
 * Re-animates ONE clip from its customer-approved still (identity-gated, with
 * the strengthened anti-CG negative prompt), reuses the other five clips, the
 * insert stills, and the music from filmArtifacts, reassembles, and returns
 * the order to AWAITING_ADMIN_APPROVAL. Cost ≈ one clip (~$0.42 at 5s) +
 * scoring; never re-spends on the rest of the film.
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
  // Inserts are untouched by a shot fix (spec §4.4 isolation) — reuse
  // whatever was cached (possibly []) rather than regenerating.
  const insertStillUrls = art.insertStillUrls ?? [];

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
  const [masterUrl, socialUrl] = await assemble(order.id, petName, clipUrls, insertStillUrls, scoreUrl, loglines);

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

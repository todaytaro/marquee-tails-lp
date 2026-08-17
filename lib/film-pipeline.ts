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
import { FAL_AUDIO_CAP_MS, FAL_IMAGE_CAP_MS, FAL_POLL_CAP_MS, falDeadline } from "./fal-deadline";
import { OrderStatus, type Order } from "@/generated/prisma/client";
import { prisma } from "./db";
import { transitionOrder } from "./orders";
import { TITLE_CARDS, resolveWorld, getShotCamera,
  getShotMotion, stripLeadingPetName, type Loglines } from "./film-script";
import { publicUrl, scoreFrame, scoreIdentity } from "./identity";
import {
  reshootCutStill,
  STYLE_RULES,
  LORA_EDIT_MODEL,
  LORA_SCALE,
  LORA_GUIDANCE_SCALE,
  B1_IMAGE_SIZE,
} from "./stills-pipeline";

/**
 * Film pipeline — the trailer assembler (TRAILER-EDIT-SPEC.md v2).
 *
 * Kicked at Gate 1 approval. By the time we get here the customer has already
 * picked one take per cut in the storyboard wizard (lib/stills-pipeline.ts
 * generates the 18 candidates BEFORE Gate 1), so this pipeline no longer
 * generates any customer-facing stills — it just animates the six the
 * customer chose, then CUTS them into a real trailer instead of playing them
 * back to back:
 *   1. 3 no-pet "insert" B-roll stills (nano-banana), each ALSO animated into
 *      a short Kling clip (real motion instead of Ken Burns on a photo — this
 *      task's change #2; Ken Burns remains the fallback if that animation
 *      fails) — §4
 *   2. each chosen still (order.chosenStills) -> SHOT_SECONDS Seedance clip
 *      (i2v, silent — MOTION-V2-SPEC.md; was Kling, see SEEDANCE_MODEL below)
 *   3. original score via Stable Audio 2.5
 *   4. assemble a BEAT EDL (Edit Decision List, not a 6-shot concat): each
 *      clip is trimmed to a 2-3.5s beat TWICE — once wide (the opening
 *      seconds of the source, full speed), once as a "punch-in" reframe of a
 *      LATER window of the SAME source clip, played back at PUNCH_IN_SPEED
 *      (slow motion) — interleaved with black title cards and animated/
 *      Ken-Burns inserts, normalized so the whole thing is EXACTLY 60.0s,
 *      graded (grain + grade, no cinescope matte) and scored with an SFX bed
 *      on top of the music (buildEdl / assembleToFiles below)
 *   5. centre-crop the same EDL again (vertical cards) -> 9:16 cut
 *   6. upload both to fal storage, -> AWAITING_ADMIN_APPROVAL
 *
 * Why the rewrite (owner's live-review postmortem, see TRAILER-EDIT-SPEC.md
 * §0): a single 8s i2v shot per cut read as "a cheap GIF" because real
 * trailers cut every 1.5-3s — pace comes from editing, not from motion within
 * one shot. The shot clip model's motion budget is also capped by the
 * identity gate (push it further and the pet drifts), so the fix lives
 * entirely on the edit side: shorter clips, harder cuts, real B-roll, cards
 * instead of burned-in captions, and an SFX bed. A LATER owner review of the
 * finished trailer found a second-order version of the same problem: a
 * clip's wide beat and its punch-in beat showed the same moment twice (same
 * [0, seconds] window, just cropped tighter) — reuse itself wasn't the
 * issue, showing the SAME moment twice was. The punch-in/slow-motion +
 * SHOT_SECONDS=8 changes above fix that without any extra spend per pet shot.
 *
 * Cost ~ 6×SHOT_SECONDS×~$0.30/s video (Seedance 2.0 image-to-video,
 * MOTION-V2-SPEC.md §4 — up from Kling's $0.084/s; this task's change #1) +
 * ~3×$0.02 insert stills + ~3×$0.25 insert CLIPS (Kling i2v at its 3s
 * minimum — insert clips stay on Kling, see generateInsertClip's own comment
 * for why — real motion instead of Ken Burns on a static photo, falls back
 * to Ken Burns per-insert if generation fails) + $0.20 music (≈ $17-19 at 8s
 * per MOTION-V2-SPEC.md §4's estimate) + gate re-rolls; stills were already
 * spent at Gate 1.
 * Dev/localhost only (heavy, long-running); on Vercel this moves behind a
 * queue/worker (n8n phase). VIDEO_PIPELINE_MOCK=1 short-circuits e2e.
 */

// --- Ad-studio model (KLING_MODEL) vs. the product's model (SEEDANCE_MODEL) -
//
// KLING_MODEL used to be the PRODUCT's video model too (generateShotClip
// called it directly). MOTION-V2-SPEC.md (decided 2026-08-13) moves shot
// clips to Seedance 2.0 (SEEDANCE_MODEL below) for real motion — yaw, jumps,
// movement — that Kling's identity-gate-driven prompt used to forbid
// outright. KLING_MODEL now exists for exactly ONE caller:
// generateStandaloneClip, the local-only ad-creative path, which STAYS on
// Kling deliberately (not an oversight) — the owner has asked twice that
// product-side generation settings and ad-side settings never change
// together, and that function's own cfg_scale/AD_CLIP_NEGATIVE choices are
// documented, unrelated tuning that has nothing to do with the product's
// video model. generateInsertClip (the other candidate "product path" this
// task named) ALSO stays on KLING_MODEL — see that function's own comment
// for why moving it to Seedance is currently blocked, not skipped by choice.
// Env-overridable so the ad path can still be pointed elsewhere without a
// deploy, same reasoning SEEDANCE_MODEL gets below.
const KLING_MODEL = process.env.KLING_MODEL ?? "fal-ai/kling-video/v3/pro/image-to-video";

// The product's shot-clip video model (MOTION-V2-SPEC.md, decided
// 2026-08-13; this task's change #1). Verified input schema (fal docs,
// confirmed live 2026-08-15): `image_url` (string, required — NOTE: not
// `start_image_url`), `prompt` (string, required), `end_image_url` (string,
// optional), `resolution` (enum 480p|720p|1080p|4k, default 720p),
// `duration` (enum "auto"|"4".."15", default "auto", passed as a STRING —
// 3 is NOT legal here, unlike Kling's 3-15s enum), `aspect_ratio`,
// `generate_audio` (boolean, DEFAULT TRUE — forced false below, see
// generateShotClip), `bitrate_mode`. There is NO `negative_prompt` and NO
// `cfg_scale` on this endpoint — both existed on the old Kling call and both
// are gone from generateShotClip below (kept, deliberately, on the
// ad-studio's KLING_MODEL call above). Env-overridable in the same spirit
// KLING_MODEL always was, so the endpoint can be reverted to Kling (or
// pointed at a different Seedance build) without a deploy.
export const SEEDANCE_MODEL = process.env.SEEDANCE_MODEL ?? "bytedance/seedance-2.0/image-to-video";
const MUSIC_MODEL = "fal-ai/stable-audio-25/text-to-audio";
// Text-to-image (NOT /edit) — insert B-roll has no pet in it at all, so there
// is nothing to anchor an edit model to (spec §4.2).
const INSERT_STILL_MODEL = "fal-ai/nano-banana-pro";

// House setting — REVISED back up from 5s (this task's change #3). The 8->5s
// cut assumed a punch-in beat could just REUSE its wide beat's exact [0,
// seconds] window (old §1.1) — same footage, tighter crop. The owner's
// live-review of the finished trailer called that out precisely: a clip's
// wide beat and its punch-in beat showed the same moment twice, so a repeat
// still read as a repeat even after the crop changed. The fix (this task's
// change #1, see PUNCH_IN_SPEED / punchInSourceWindow below) makes a
// punch-in beat trim a LATER window of the source instead of the same one —
// but that only works if the source actually HAS a meaningfully later
// window to trim from. At 5s, "the closing seconds" and "the opening
// seconds" of a ~2-3.5s beat sat close enough together that there wasn't
// much of a genuinely different moment to find. 8s gives real separation.
// It also compounds with start+end interpolation (FILM-QUALITY-V3-SPEC.md
// §5, OFF in v2 — see USE_END_FRAMES): the pose change (start frame -> end
// frame) plays out across the WHOLE clip, so an early trim and a late trim
// now differ by the pose itself, not just the framing, when that feature is
// on. Seedance's duration enum is "auto"|4-15s (fal docs, confirmed live
// 2026-08-15, MOTION-V2-SPEC.md), so 8 is legal — same was true of Kling's
// 3-15s enum before this task's model swap for shot clips.
// Re-assembly / single-shot re-render both trim from source (using each
// clip's own PROBED duration, never this constant directly — see
// clampToSourceDurations), so mixed 5s/8s clips across old + new orders are
// handled identically; a legacy order's shorter source just has less "later
// window" for punchInSourceWindow to draw from, which the clamp accounts for.
// Exported (like PUNCH_IN_ZOOM/FILM_FPS) so scripts/test-assemble.ts can
// synthesize fixtures at this exact source length instead of a hardcoded
// duplicate of the number.
export const SHOT_SECONDS = 8;

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
// §2.2(d)). 30 (Kling's native rate) is the house rate everywhere; this
// still holds after this task's Seedance swap for shot clips (MOTION-V2-
// SPEC.md) because normaliseClip's `fps=` filter EXPLICITLY resamples every
// clip — Kling (inserts, ad-studio) or Seedance (shot clips) — to this exact
// constant regardless of the source's own native rate, so nothing here
// depends on the two models agreeing.
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

// RETIRED by this task's change #1: Seedance 2.0 (the shot-clip model as of
// MOTION-V2-SPEC.md) has no `negative_prompt` input at all, so this can no
// longer BE a negative prompt for generateShotClip — its MEANING moves into
// that function's own prompt text as prose instead (see generateShotClip
// below). Two terms from the old value are DELIBERATELY DROPPED and must not
// reappear in the prose either: "ears changing" and "tail changing" — meant
// to stop the pet turning into a different dog, but read literally they also
// ban a wagging tail and moving ears, which is the exact liveliness this
// move exists to produce (the shape constraints, "wrong tail length" /
// "wrong ear shape", stay). This constant itself is retired; kept only as
// the historical record of the old negative_prompt value:
//   "blur, distort, low quality, deformed face, extra limbs, warped anatomy,
//   morphing, changing costume, different dog, wrong tongue color, wrong
//   tail length, wrong ear shape, ears changing, tail changing, cartoon, cel
//   shading, 3d render, cgi, plastic sheen, illustration, stylized
//   animation, text, watermark"

/**
 * Submit one video-model clip request and poll to completion within `capMs`.
 * `model` is the fal endpoint id — KLING_MODEL for generateStandaloneClip
 * (ad-studio) and generateInsertClip (blocked from moving to Seedance, see
 * that function's comment), SEEDANCE_MODEL for generateShotClip (this task's
 * change #1, MOTION-V2-SPEC.md). Same queue plumbing and the same deadlines
 * either way — only the endpoint id and the shape of `input` differ per
 * caller.
 */
async function submitClip(model: string, input: Record<string, unknown>, capMs: number): Promise<string> {
  // fal's per-model input union is too wide to satisfy structurally; submit
  // with a narrow cast.
  const { request_id } = await fal.queue.submit(model, {
    input: input as never,
    abortSignal: falDeadline(FAL_POLL_CAP_MS),
  });
  const deadline = Date.now() + capMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 8000));
    // Each round-trip is bounded too. `Date.now() < deadline` is only checked
    // BETWEEN iterations, so without this one hung status call makes the capMs
    // above unenforceable — the same shape of failure that stranded a film run
    // for 23 minutes on an unbounded subscribe (lib/fal-deadline.ts).
    const s = await fal.queue.status(model, {
      requestId: request_id,
      logs: false,
      abortSignal: falDeadline(FAL_POLL_CAP_MS),
    });
    if (s.status === "COMPLETED") {
      const res = await fal.queue.result(model, {
        requestId: request_id,
        abortSignal: falDeadline(FAL_POLL_CAP_MS),
      });
      const url = (res.data as { video?: { url?: string } })?.video?.url;
      if (!url) throw new Error("video model result missing url");
      return url;
    }
  }
  throw new Error(`video model request ${request_id} timed out`);
}

// Kling's negative_prompt for the AD-STUDIO path only (generateStandaloneClip
// — NOT the product, stays on Kling deliberately, see KLING_MODEL's comment
// above). Unchanged by this task (ad-side settings never move together with
// product-side ones, per the owner's standing instruction) — value is byte-
// for-byte what it always was. Used to be phrased as "CLIP_NEGATIVE minus
// every identity-lock term"; spelled out directly now that CLIP_NEGATIVE
// itself is retired (see submitClip's comment above): the quality/style half
// of that old list (blur, distort, low quality, deformed face/limbs/
// anatomy, cartoon/cel-shading/3d-render/cgi/illustration, text/watermark),
// MINUS every identity-lock term ("different dog", "ears changing", "tail
// changing", "changing costume"...) — those exist to stop a customer's pet
// drifting across 8 seconds, and in a 5-second ad teaser they only fight the
// motion we are paying for — PLUS three terms aimed straight at the failure
// this replaced (static image / frozen frame / no motion).
const AD_CLIP_NEGATIVE =
  "static image, frozen frame, no motion, blur, distort, low quality, deformed face, extra limbs, warped anatomy, cartoon, cel shading, 3d render, cgi, plastic sheen, illustration, stylized animation, text, watermark";

/**
 * Animate ONE arbitrary image into a short silent clip — no order, no LoRA,
 * no identity gate. This is the ad-creative path (scripts/ad-clip.ts), kept
 * here rather than in the script so it goes through the same submitClip as
 * the product: same model, same queue deadlines, same negative prompt.
 *
 * NOT the product. generateShotClip below animates a still that a LoRA drew
 * of one specific pet and that a customer approved; this animates whatever
 * you hand it. Over five seconds the drift is small, but the pet is NOT held
 * to being the same individual — so output from here can tease what the
 * product does, and must never be presented as what a customer receives.
 */
export async function generateStandaloneClip(
  imageUrl: string,
  opts: { seconds?: number; motion?: string } = {}
): Promise<string> {
  fal.config({ credentials: process.env.FAL_KEY });
  const seconds = opts.seconds ?? 5; // Kling's duration enum is 3-15s
  const motion =
    opts.motion ??
    "Slow cinematic push-in, gentle parallax, the subject breathing and shifting weight, ambient movement in the background";
  return submitClip(
    KLING_MODEL,
    {
      start_image_url: publicUrl(imageUrl),
      duration: String(seconds),
      // 0.30, NOT the product path's 0.55 (product no longer has a cfg_scale
      // at all post-Seedance-swap, see generateShotClip). That value exists
      // to hold the start frame hard, and generateShotClip's own OLD comment
      // named the cost: "some stiffness". For a customer's film that was the
      // right trade — the whole job is that the dog stays the same dog. Here
      // the job is the opposite, and the first version of this function
      // copied 0.55 across without asking whether its purpose still applied.
      // The result did not move at all: high cfg, plus a negative prompt
      // built to suppress change, plus a prompt saying "no morphing" — three
      // separate brakes and no accelerator.
      cfg_scale: 0.3,
      negative_prompt: AD_CLIP_NEGATIVE,
      prompt: `${motion}. Photorealistic live-action, filmic depth of field, clearly visible continuous motion throughout the shot. The camera moves and the scene is alive — this must not look like a still photograph.`,
    },
    15 * 60 * 1000
  );
}

/**
 * 同一性の縛り。Seedance には negative_prompt の入力口が無いので、Kling 時代に
 * 禁止語リストで表していた内容をここに散文で持っている。**Kling 経路でも同じ
 * 文言を使う** — モデルによって縛りの強さが変わると、Preset と DC で「同じ犬か
 * どうか」の基準が変わってしまうため。Kling には加えて negative_prompt も渡す
 * （持っているものを使わない理由が無い）。
 *
 * 耳の形は 2026-08-15 にオーナーが指摘して追加した。動きを大きくしたクリップで
 * シュナウザーの折れ耳が立ち耳に変わり、他が全部保たれていても別の犬に見えた。
 * 「動くな」ではなく「形と付き方を変えるな」と書き分けてあるのが要点 —
 * 同じ日に "ears changing" を CLIP_NEGATIVE から外したのは、それが尻尾を振る
 * 動きまで潰していたからで、同じ轍を踏まないため。
 */
// IDENTITY_CLAUSE / SEEDANCE_MODEL を export しているのは、使い捨ての検証
// スクリプトが**この文字列そのもの**を読めるようにするため。テスト側にコピーを
// 置くと、本番を直したときに黙ってズレて、「本番と同じ条件で測った」という
// 前提が嘘になる。
/**
 * 背景の仲間の犬に関する節。`crew` が立ったカットにだけ付く。
 *
 * IDENTITY_CLAUSE は全文が「**the pet** は同じ個体のままであれ」で、画面内の
 * 他の犬について一言も言っていない。そして Seedance には negative_prompt が
 * 無い（API に存在しない）ので、この節が背景の犬に効く**唯一の防御**になる。
 *
 * **全部 affirmative で書いてある。** negative_prompt が使えない以上 "never 〜"
 * は positive prompt の中の否定でしかなく、映像モデルはそれを苦手にする。
 * 「〜しない」ではなく「〜のままでいる」で通すこと。書き足すときも同じ。
 *
 * 2026-08-17 に4秒クリップで実測: 数・毛色・四つ足・向き・距離とも保った。
 * **8秒（本番の長さ）では未検証。**変形は時間とともに悪化するので、最初の実注文で
 * 崩れが出たらここを疑う。
 */
const CREW_CLAUSE =
  " Other dogs are visible further back in the scene. They are the pet's crew, and they stay crew:" +
  " they remain at their own distance in the background for the whole clip, the same number of them throughout," +
  " each keeping the coat, colouring, clothing and four-legged body it has in the first frame," +
  " each continuing what it is already doing and staying turned away from the camera." +
  " The foreground belongs to the pet alone.";

export const IDENTITY_CLAUSE =
  "The pet must stay exactly the same individual throughout this clip — identical face, mouth/tongue color, coat markings, costume and tail length — " +
  "lively and moving, but never morphing into a different dog and never changing costume. " +
  "A wagging tail and ears that move with the body are expected here, not a flaw. " +
  "The ears do, however, keep exactly the set and shape they have in the reference frame for the whole clip: folded ears stay folded, drop ears stay dropped. " +
  "They may swing and flick with the motion, but must never prick up, stand erect, rotate upright, or change shape — " +
  "a change of ear carriage reads as a different dog even when everything else holds. " +
  "Photorealistic live-action footage only: no deformed face, extra limbs, or warped anatomy; no cartoon, cel shading, 3D render, CGI, illustration, or stylized animation; no on-screen text or watermark.";

/**
 * Kling 用の negative_prompt。**"ears changing" と "tail changing" は入っていない**
 * — 別の犬の耳・尻尾に変わるなという意図だったが、文字通り読むと尻尾を振る動きも
 * 禁じてしまい、v2 でいちばん出したい動きを潰す。形を縛る "wrong tail length" /
 * "wrong ear shape" は残す（2026-08-15、MOTION-V2-SPEC.md §3.3）。
 */
const CLIP_NEGATIVE =
  "blur, distort, low quality, deformed face, extra limbs, warped anatomy, morphing, changing costume, different dog, " +
  "wrong tongue color, wrong tail length, wrong ear shape, cartoon, cel shading, 3d render, cgi, plastic sheen, " +
  "illustration, stylized animation, text, watermark";

/**
 * Animate a chosen still into a SHOT_SECONDS silent clip with a per-shot
 * camera move. This is now raw MATERIAL for the EDL, not a finished shot —
 * the assembler trims 2-3.5s beats out of it (possibly twice — a wide framing
 * from the opening seconds, and a slow-motion punch-in reframe of a LATER
 * window of the same source clip, this task's change #1).
 *
 * MOTION-V2-SPEC.md (2026-08-13, decided) — this task's change #1: the video
 * model is SEEDANCE_MODEL (Seedance 2.0), not Kling. v1 held identity with
 * FOUR brakes stacked on the start frame — cfg_scale, negative_prompt, the
 * prompt's own "calm, no yaw" language, and a pinned end frame — and the
 * owner's own side-by-side video review judged the result too motion-starved
 * to read as a movie trailer. Seedance's endpoint has neither `cfg_scale`
 * nor `negative_prompt` (the two biggest brakes are gone by contract, not
 * choice), end frames are off everywhere in this file (USE_END_FRAMES, see
 * below), and the ONE remaining brake is this function's own prompt text —
 * which is why CLIP_NEGATIVE's old meaning is folded into the prompt below
 * as prose instead of silently dropped (minus "ears changing"/"tail
 * changing", deliberately — see submitClip's comment for why).
 *
 * Identity through the clip is held by (a) the customer's hand-picked,
 * identity-gated start frame and (b) that prompt text. We do NOT use Kling's
 * `elements` character lock (not applicable to this endpoint anyway) — the
 * storyboard picks already give us six high-identity frames to animate.
 *
 * `endFrameUrl` / `USE_END_FRAMES` (FILM-QUALITY-V3-SPEC.md §5.3 originally;
 * turned OFF for v2 per MOTION-V2-SPEC.md §3.1): pinning the last frame to an
 * approved still was most of what suppressed motion in v1, so v2
 * deliberately stops passing `end_image_url` to the video model — a
 * reversible choice (Seedance supports `end_image_url` too, under that exact
 * name), not a limitation, hence the single `USE_END_FRAMES` switch rather
 * than deleting the plumbing. `endFrameUrl` is still threaded through as a
 * parameter (an existing order may have one cached in
 * `filmArtifacts.endFrameUrls` from before this switch flipped, and
 * runFilmGeneration/runShotRerender still pass it through) — it is simply
 * never attached to the request while `USE_END_FRAMES` is false.
 */
async function generateShotClip(
  stillUrl: string,
  world: string,
  shotIndex: number,
  orderId: string,
  durationSec: number = SHOT_SECONDS,
  directorNote?: string,
  endFrameUrl?: string,
  // This cut's own storyboard text. SHOT_MOTIONS has to be generic — it is
  // bolted onto whichever cut i of whichever arc, sight unseen — and a generic
  // line is exactly what the video model responds to WEAKLY. Measured
  // 2026-08-15 on one still, changing only this text: "the strain already
  // gripping the frame reaches its peak" produced a clip that barely moved,
  // while a prompt naming the actual furniture ("springs up from the captain's
  // chair, leaps down to the bridge floor") moved dramatically. Seedance wants
  // a specific, spatially-grounded action.
  //
  // Under v2 the still ALREADY contains one (TRAILER-STORY-V3-SPEC.md §2e asks
  // the storyboard for the decisive instant of an action), so handing that same
  // sentence to the video model gives it something concrete to finish — and it
  // cannot contradict the frame, because it is what the frame was drawn from.
  // Optional: an order predating this, or a caller without the arc to hand,
  // falls back to SHOT_MOTIONS alone, which is the pre-v2 behaviour.
  action?: string,
  // このカットの背景に仲間の犬が写っているか（Director's Cut のみ、最大2カット
  // — film-script.ts の capCrewCuts が切る）。true のときだけ CREW_CLAUSE を
  // 足す。**全カットに足してはいけない** — 仲間のいないカットに「奥に他の犬が
  // いる」と教えると、モデルはいない犬を描き足す。
  crew?: boolean
): Promise<string> {
  // getShotMotion resolves index 5 (the climax) to one of several variants,
  // picked deterministically from orderId — see film-script.ts for why this
  // must be stable across an original run and any later single-shot re-render.
  // action を持つ注文はカメラだけを添える（被写体が何をするかは action が決める）。
  // 持たない注文（Preset、および action 以前の DC）は従来どおり SHOT_MOTIONS。
  // 両方渡すと矛盾する — 2026-08-15、「開始位置から明確に移動しろ」と
  // 「火花の下で持ち場を守っている」を同時に渡した結果、犬が一度画面外へ出て
  // 戻る破綻クリップが出た。getShotCamera のコメントに経緯がある。
  const camera = action?.trim() ? getShotCamera(shotIndex, orderId) : getShotMotion(shotIndex, orderId);
  const atmosphere = WORLD_ATMOSPHERE[world] ?? "";
  const note = directorNote?.trim() ? ` Director's note, follow it strictly: ${directorNote.trim()}.` : "";
  const actionNote = action?.trim()
    ? ` What happens in this shot, and the only thing that happens: ${action.trim()}. Perform it fully and at full size, as one continuous movement.`
    : "";
  // §5.1: when an end frame is supplied AND USE_END_FRAMES is on, the model's
  // only job is to fill the gap between two already-approved stills — say so
  // explicitly so it doesn't treat the camera/atmosphere text above as
  // license to invent extra motion beyond that transition. USE_END_FRAMES is
  // false in v2, so this is currently always "".
  const interpolationNote =
    USE_END_FRAMES && endFrameUrl
      ? " The final frame of this clip must match the provided end reference image exactly — interpolate smoothly toward it, inventing no motion beyond that transition."
      : "";
  // モデルはプランで選ばない。**action の有無で選ぶ。**
  //   action あり（Director's Cut）… Seedance。$5.47/8秒、大きく動く
  //   action なし（Preset、および action 以前の DC）… Kling。$0.67/8秒、微動
  // Preset は resolveWorld が actions: [null×6] を返すので自動的に Kling 側に
  // 落ちる。条件が1つなので「Seedance なのにカメラだけの指示」といった不整合が
  // 起こりようがない — SHOT_CAMERA と SHOT_MOTIONS の取り違えは 2026-08-15 に
  // 実際に破綻クリップを作っている（getShotCamera のコメント参照）。
  //
  // 単価差は 8 倍あり、1注文あたり $32.8 対 $4.0。Preset を $159 で売る前提の
  // 粗利はこの選択に乗っている（MOTION-V2-SPEC.md §4.1）。
  const useSeedance = !!action?.trim();
  const prompt = `${camera}, ${atmosphere}.${actionNote}${note} This is live-action footage, not a photograph with a moving camera: the animal is in continuous visible motion from the first frame to the last, and its body travels within the frame. ${IDENTITY_CLAUSE}${crew ? CREW_CLAUSE : ""}${interpolationNote}`;

  const input: Record<string, unknown> = useSeedance
    ? {
        image_url: publicUrl(stillUrl), // Seedance は image_url、Kling は start_image_url
        duration: String(durationSec),
        generate_audio: false, // Seedance の既定は TRUE。劇伴は別に作るので切る
        resolution: "1080p",
        prompt,
      }
    : {
        start_image_url: publicUrl(stillUrl),
        duration: String(durationSec),
        generate_audio: false,
        // Kling は negative_prompt と cfg_scale を持っている。0.55 は v1 で
        // 「開始フレームをどれだけ強く保持するか」を 0.4 から詰めた値で、
        // 動きの小ささと引き換えに同一性を買っている。action の無い経路は
        // もともとそのトレードオフを選んだ経路なので、そのまま。
        cfg_scale: 0.55,
        negative_prompt: CLIP_NEGATIVE,
        prompt,
      };
  if (USE_END_FRAMES && endFrameUrl) input.end_image_url = publicUrl(endFrameUrl);
  return submitClip(useSeedance ? SEEDANCE_MODEL : KLING_MODEL, input, 15 * 60 * 1000);
}

// The video identity gate. Clips can hold a strong start frame yet drift into
// "a different dog" mid-motion, so after each clip we sample frames and score
// them against the customer's REAL PHOTO (IDENTITY-FIDELITY-SPEC.md §4 — see
// scoreClip's comment; previously scored against the identity portrait, the
// same bug §1 documents for the stills gate); a clip below the threshold is
// re-rolled. One re-roll caps the added spend (2 animations/shot max).
//
// LORA-STORYBOARD-SPEC.md §4.5: was 75 (deliberately a little below the old
// still gate's 80). The owner's own eyeball-sorted bake-off showed that same
// identity score has NO discriminating power between "looks like my dog" and
// "doesn't look like my dog" in the 75-90 range — stills-pipeline.ts's
// IDENTITY_THRESHOLD dropped to 50 for exactly that reason, and §4.5
// explicitly calls this constant out for the "same treatment". Now a
// catastrophe floor (wrong species / clearly different animal), not a
// likeness bar.
//
// Nothing branches on this value any more — generateGatedClip scores but no
// longer retries — yet it is NOT dead. app/admin/[orderId]/page.tsx keeps its
// own copy of the number (see the "Mirror of lib/film-pipeline
// CLIP_IDENTITY_THRESHOLD" comment there) to colour the Gate-2 drift table,
// so this stays the one place the number is explained. Delete it and the
// admin's traffic light loses its rationale.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const CLIP_IDENTITY_THRESHOLD = 50;
// Same: the re-roll it bounded is gone. Kept as the record of what the old
// behaviour was, and as the switch to turn it back on.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
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
 * couple of seconds in) and a near-end frame, score each against
 * `identityRefUrl`, and return the LOWEST of all axes — one bad frame is
 * enough to make an owner say "that's not my dog" or "that's a cartoon".
 *
 * IDENTITY-FIDELITY-SPEC.md §4: this had the exact same drifted-anchor bug as
 * scoreIdentity's stills-pipeline callers (see lib/identity.ts's header
 * comment) — every caller here used to pass `order.identityPortraitUrl`, an
 * AI-generated image, as the anchor, even though scoreFrame's own prompt
 * asserts "Image 1 is a real photo of a pet". `identityRefUrl` is now the
 * customer's real uploaded photo whenever the caller has one (see
 * runFilmGeneration/runShotRerender below); it falls back to the portrait
 * only when an order has no usable real photo (shouldn't happen — uploads
 * are mandatory — but must never become a new failure mode per HARD
 * CONSTRAINT #3).
 *
 * Sampling is RELATIVE to the actual clip, not the configured shot length:
 * `-ss` offsets exist in any 3-15s Kling cut and `-sseof -1` grabs ~1s before
 * the end, so no duration probe is needed. Never blocks the pipeline: any
 * error scores 100 (pass).
 */
async function scoreClip(clipUrl: string, identityRefUrl: string): Promise<number> {
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
      const s = await scoreFrame(identityRefUrl, url);
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
 * Animate a shot and score it on identity: ONE generation, no re-roll.
 * Retried re-rolls used to run to MAX_CLIP_REROLLS, but across every order
 * that has reached delivery no clip has ever scored below
 * CLIP_IDENTITY_THRESHOLD (36 clips across 6 delivered orders, lowest 50), so
 * the retry was paying for an event that has never happened — and on a
 * Director's Cut shot it pays in Seedance clips at a measured $5.47 each. The
 * owner reviews every finished film at Gate 2 and can re-render a single shot
 * by hand there. Returns the clip URL and
 * its identity score (persisted for the admin drift view at Gate 2).
 */
async function generateGatedClip(
  stillUrl: string,
  world: string,
  shotIndex: number,
  orderId: string,
  identityRefUrl?: string,
  directorNote?: string,
  endFrameUrl?: string,
  action?: string, // this cut's one action — see generateShotClip's `action`
  crew?: boolean // 背景に仲間の犬がいるカットか — see generateShotClip's `crew`
): Promise<{ url: string; score: number }> {
  const url = await generateShotClip(stillUrl, world, shotIndex, orderId, SHOT_SECONDS, directorNote, endFrameUrl, action, crew);
  const score = identityRefUrl ? await scoreClip(url, identityRefUrl) : 100;
  console.log(`[film] shot ${shotIndex}: identity ${score}`);
  return { url, score };
}

/* ------------------------------------------------------------------ */
/* Start+end frame interpolation (FILM-QUALITY-V3-SPEC.md §5)           */
/* ------------------------------------------------------------------ */

// OFF for v2 (MOTION-V2-SPEC.md §3.1, decided 2026-08-13; this task's change
// #1). Pinning the last frame to an approved still was most of what
// suppressed motion in v1 — the model's only job became interpolating
// between two already-approved stills instead of inventing anything. Seedance
// still supports `end_image_url` (this is a deliberate choice, not a
// limitation of the new model — see SEEDANCE_MODEL's comment above), so ONE
// switch controls both effects this needs, reversibly, in one edit:
//   (a) generateShotClip stops attaching `end_image_url` to the request (see
//       the USE_END_FRAMES check there) — this is the one that actually
//       matters for motion.
//   (b) runFilmGeneration skips GENERATING end frames at all for an order
//       that doesn't already have them cached, so a v2 order never pays fal
//       for a still (a) is guaranteed not to consume (see the
//       `art.endFrameUrls === undefined` check there). runShotRerender's own
//       end-frame generation is gated the same way, for the same reason,
//       though the task that introduced this switch named only (b)
//       explicitly — this extension keeps the admin re-render path from
//       quietly re-introducing the wasted spend (a) exists to avoid.
// Existing orders that already have `endFrameUrls` cached in `filmArtifacts`
// are UNAFFECTED either way: (b) only gates NEW generation (the
// `=== undefined` check), so a cached array is read and reused exactly as
// before — it is just never attached to the video request per (a). Flip this
// back to `true` to restore start+end interpolation.
const USE_END_FRAMES = false;

// The end frame IS a still (it becomes a real frame of the finished film,
// same as any chosen storyboard take), so it clears the STILLS bar
// (stills-pipeline.ts's IDENTITY_THRESHOLD), not the looser clip bar
// (CLIP_IDENTITY_THRESHOLD) — kept numerically equal to IDENTITY_THRESHOLD by
// convention, not by import (avoids a stills<->film cycle; see
// IDENTITY_THRESHOLD's own comment for why 50, not 80: LORA-STORYBOARD-
// SPEC.md §4.5 — the same "catastrophe floor, not a likeness bar" reasoning
// applies here, per §4.5's explicit instruction to treat this gate the same).
const END_FRAME_IDENTITY_THRESHOLD = 50;
const MAX_END_FRAME_REROLLS = 1;
// Base seed for end-frame generation — offset far from STILL_SEED
// (stills-pipeline.ts) so a shared order id never collides an end-frame seed
// with a storyboard-take seed.
const END_FRAME_SEED = 84931;

/**
 * The order's trained LoRA, or undefined when it has none (training failed, or
 * the order predates LORA-STORYBOARD-SPEC.md). Both fields are required —
 * a url without its trigger word cannot be prompted.
 */
function orderLora(order: Order): { url: string; triggerWord: string } | undefined {
  return order.loraUrl && order.loraTriggerWord
    ? { url: order.loraUrl, triggerWord: order.loraTriggerWord }
    : undefined;
}

/**
 * Generate ONE candidate end frame (spec §5.2): the SAME scene a few seconds
 * later with exactly ONE change (`endPose`, from SHOT_END_POSES), used as
 * Kling's second anchor so it interpolates between two approved frames
 * instead of inventing motion.
 *
 * Drawn by the order's own LoRA when it has one. This used to be nano-banana
 * unconditionally, and that became untenable the moment the storyboard moved
 * to a per-pet LoRA (LORA-STORYBOARD-SPEC.md §1.3): nano-banana re-draws a dog
 * it has never seen as the breed average, so a cut would open on the
 * customer's dog and close on a stock one — mid-shot, with Kling smoothly
 * morphing between them. The owner's first instinct was to drop start+end
 * over exactly that, which would have cost the motion this feature exists to
 * buy. Handing the end frame to the LoRA keeps both: measured on camyu, the
 * pose moved visibly AND the dog stayed the same animal, which is the pair of
 * outcomes that were in doubt (the LoRA edit path had previously protected an
 * image so completely it refused to change it at all — see §1.3's B3 arm, and
 * note that two identical anchors interpolate to a dead-still shot, the very
 * failure start+end was built to fix).
 *
 * There is deliberately NO nano-banana fallback. An order without a LoRA had
 * its storyboard drawn by nano-banana too, so it is already the degraded
 * product; bolting a second-pass redraw onto that trades a real risk of drift
 * for a nice-to-have, on the one class of order least able to afford it. It
 * would also be a path nothing can verify, since it only ever runs when
 * training failed. One rule instead: the end frame comes from the LoRA or the
 * cut ships as single-frame i2v (generateGatedEndFrame returns null).
 */
async function generateEndFrame(
  startFrameUrl: string,
  endPose: string,
  seed: number,
  lora: { url: string; triggerWord: string }
): Promise<string> {
  // Only the start frame is referenced. The hero sheet used to be passed here
  // as a costume anchor for a model that needed one; this model already
  // carries the animal, and the costume is already in the frame it is editing.
  //
  // No IDENTITY_RULES, for the same reason B1 takes omit them
  // (LORA-STORYBOARD-SPEC.md §2.2): those rules exist to argue a general model
  // out of drifting toward a breed standard, and this one has been taught the
  // individual instead.
  const r = await fal.subscribe(LORA_EDIT_MODEL, {
    input: {
      prompt:
        `The reference image is a frame of a film starring ${lora.triggerWord}, a small dog. Generate the SAME scene a few ` +
        `seconds later: identical dog, identical costume, identical location, lighting and camera framing. The ONLY change: ` +
        `the dog ${endPose}. That change must be OBVIOUS at a glance — this frame must NOT look like a copy of the reference ` +
        `image; the dog's body has clearly moved into the new pose, while its face stays turned the same way and the camera ` +
        `has not moved. ${STYLE_RULES}`,
      image_urls: [publicUrl(startFrameUrl)],
      loras: [{ path: lora.url, scale: LORA_SCALE }],
      num_images: 1,
      image_size: B1_IMAGE_SIZE,
      output_format: "png",
      seed,
      guidance_scale: LORA_GUIDANCE_SCALE, // never raise — §1.8
    },
    abortSignal: falDeadline(FAL_IMAGE_CAP_MS),
  });
  const url = (r.data as { images?: { url?: string }[] })?.images?.[0]?.url;
  if (!url) throw new Error("end frame result missing url");
  return url;
}

/**
 * Generate + identity-gate one shot's end frame, with the mandatory
 * non-fatal fallback posture (spec §5.2/§5.4): re-roll once on a fresh seed,
 * and if it STILL doesn't clear the (stills-grade) identity bar — or the
 * generation call itself throws — give up on start+end for this cut entirely
 * rather than risk shipping a mismatched final frame. Returns null in either
 * case; callers treat null exactly like a `SHOT_END_POSES` entry of `null`
 * (today's single-frame i2v path, unchanged). Never throws.
 *
 * `identityRefUrl` should be the customer's real photo (IDENTITY-FIDELITY-
 * SPEC.md §4 — see scoreClip's comment above for the full story); callers
 * fall back to the portrait only when an order has no real photo.
 */
async function generateGatedEndFrame(
  startFrameUrl: string,
  endPose: string,
  identityRefUrl: string | undefined,
  shotIndex: number,
  lora: { url: string; triggerWord: string } | undefined
): Promise<string | null> {
  if (!lora) {
    console.log(
      `[film] shot ${shotIndex}: no LoRA on this order — skipping start+end, single-frame i2v for this cut`
    );
    return null;
  }
  try {
    let best: { url: string; score: number } | null = null;
    for (let attempt = 0; attempt <= MAX_END_FRAME_REROLLS; attempt++) {
      const seed = END_FRAME_SEED + shotIndex * 100 + attempt * 7919; // same reroll-offset convention as generateGatedTake
      const url = await generateEndFrame(startFrameUrl, endPose, seed, lora);
      const score = identityRefUrl ? await scoreIdentity(identityRefUrl, url) : 100;
      console.log(`[film] shot ${shotIndex} end frame attempt ${attempt}: identity ${score}`);
      if (score >= END_FRAME_IDENTITY_THRESHOLD) return url;
      if (!best || score > best.score) best = { url, score };
    }
    console.warn(
      `[film] shot ${shotIndex}: end frame identity ${best?.score ?? -1} (< ${END_FRAME_IDENTITY_THRESHOLD}) after ${MAX_END_FRAME_REROLLS} reroll(s) — falling back to single-frame i2v for this cut`
    );
    return null;
  } catch (e) {
    console.warn(`[film] shot ${shotIndex}: end frame generation failed — falling back to single-frame i2v for this cut`, e);
    return null;
  }
}

/**
 * One no-pet atmospheric B-roll still (spec §4.2). Text-to-image, not i2v —
 * this is the still generateInsertClip (below) then animates via Kling, and
 * also the fallback frame Ken Burns (renderInsertBeat) uses on its own if
 * that animation fails (this task's change #2). Inserts NEVER enter
 * clipUrls/shotClipUrls/shotIdentityScores or any identity-scoring loop
 * (spec §4.4) — there is no pet in the frame to score, on the still OR the
 * clip generated from it.
 */
async function generateInsertStill(subject: string): Promise<string> {
  const r = await fal.subscribe(INSERT_STILL_MODEL, {
    input: {
      // Text-to-image only — no negative_prompt input on this endpoint, so
      // the "no animals/people" constraint is folded directly into the
      // prompt text (also true of every WORLD_INSERTS entry, see film-script.ts).
      // 「動物一切禁止」から「**人間と犬の顔**だけ禁止」へ（2026-08-17）。
      //
      // なぜ緩めたか: この一行が、語れる物語の種類まで縛っていた。飼い犬と同じ
      // 画に他の種を入れられない（LoRA が役を取り違える）ので、**敵は環境か機械
      // にしかなれなかった** — ストーリー規則7(a) がそう書いてあるのはこの制約の
      // 帰結。だがインサートは**飼い犬が画面にいない**うえに LoRA も通らないので、
      // ここでなら生き物を出せる。結果として「敵は見せられるが、決して出会わない」
      // という予告編の王道が使えるようになる（怪物は断片だけ、全貌は本編に）。
      //
      // なぜ**犬の顔だけ**は禁じ続けるか: ここは LoRA を通らない = 犬の顔を描けば
      // **他人の犬の顔**になる。「あなたの犬の映画」に知らない犬の顔が正面から
      // 入るのは、犬がいないより悪い。鳥・魚・鼠の顔にはこの問題が無いので通す。
      // 人間は従来どおり全面禁止。
      prompt: `${subject}, cinematic still, no people, no humans, no hands, no dog face and no dog looking at the camera, no text, no watermark, moody lighting, atmospheric, 16:9 film still`,
      num_images: 1,
      resolution: "2K",
      aspect_ratio: "16:9",
      output_format: "png",
    },
    abortSignal: falDeadline(FAL_IMAGE_CAP_MS),
  });
  const url = (r.data as { images?: { url?: string }[] })?.images?.[0]?.url;
  if (!url) throw new Error("insert still result missing url");
  return url;
}

// Kling's shortest legal duration (fal's duration enum is 3-15s — the pet
// shots no longer use this same endpoint, see KLING_MODEL/SEEDANCE_MODEL's
// comments above, but generateInsertClip still does, and stays on Kling
// specifically BECAUSE this value is 3: Seedance's own duration enum is
// "auto"|"4".."15" — 3 is illegal there, see generateInsertClip's comment).
// Insert beats are only ~2-2.5s on screen even after 60s normalization
// (EDL_TEMPLATE's raw insert beats are 2.0s, and buildEdl's scale factor is
// ~1.24 at time of writing, so a scaled insert beat stays comfortably under
// 3s) — paying for anything longer than Kling's minimum here would be spend
// with no beat left to show it. Exported so scripts/test-assemble.ts can
// synthesize insert-clip fixtures at this exact length.
export const INSERT_CLIP_SECONDS = 3;

// No pet in frame (spec §4.4) means no identity risk, hence no CLIP_NEGATIVE
// (that constant's whole job is protecting a specific dog's face/tail/ears) —
// this is a much shorter list, just keeping the OTHER house rules an insert
// must never break: no animal/person wandering into frame, no on-screen text.
// 種の名前を列挙するのをやめた（2026-08-17）。generateInsertStill が生き物を
// 許すようになった以上、ここで "animals" を否定し続けると、静止画に写っている
// ものを動かすなと言うことになり打ち消し合う。残すのは飼い犬と取り違えられる
// もの（犬の顔）と、そもそも出してはいけないもの（人間）だけ。
const INSERT_CLIP_NEGATIVE =
  "dog face, dog looking at camera, people, humans, hands, text, watermark, cartoon, cel shading, low quality, blurry, morphing";

/**
 * Animate one insert still into a short Kling clip (this task's change #2 —
 * "Ken Burns on a still is what makes inserts feel like slides"). Reuses the
 * exact same image-to-video queue plumbing as the pet shots (submitClip /
 * KLING_MODEL), but deliberately carries NONE of the identity machinery
 * (generateGatedClip's re-roll/scoring loop, CLIP_IDENTITY_THRESHOLD): there
 * is no pet to gate, so there is nothing to hold still for either — the model
 * is free to invent whatever atmospheric drift it likes, which is exactly
 * what makes a B-roll insert (a sign, a puddle, receding taillights) read as
 * alive rather than an animated photograph.
 *
 * DELIBERATELY STILL ON KLING, NOT SEEDANCE, despite this task naming
 * "generateShotClip and generateInsertClip" as the two product paths to
 * move — this is the one blocked exception, verified rather than guessed:
 * Seedance 2.0's `duration` enum is `"auto"|"4".."15"` (fal docs, confirmed
 * live 2026-08-15) — 3 is NOT a legal value. INSERT_CLIP_SECONDS is 3
 * (Kling's minimum, and the most an on-screen insert beat ever needs — see
 * that constant's own comment), and the same task that named this function
 * as a Seedance migration target also said "INSERT_CLIP_SECONDS stays 3" —
 * those two directives cannot both be satisfied; a duration:"3" request to
 * Seedance is a guaranteed rejection on every call, silently masked by this
 * function's own graceful-degradation fallback to Ken Burns (which would be
 * WORSE than a loud error: it would look shipped while permanently failing).
 * Flagged for the owner rather than resolved by guessing — see this task's
 * report. KLING_MODEL, the negative_prompt below, and everything else here
 * are therefore UNCHANGED from before this task.
 *
 * Never throws to the caller in a way that stalls the film: any failure here
 * is caught by the caller (runFilmGeneration), which caches `null` for this
 * insert index and falls back to Ken Burns for it (renderInsertBeat) — spec:
 * "Ken Burns must remain the fallback".
 */
async function generateInsertClip(stillUrl: string, subject: string): Promise<string> {
  const input: Record<string, unknown> = {
    start_image_url: publicUrl(stillUrl),
    duration: String(INSERT_CLIP_SECONDS),
    generate_audio: false,
    negative_prompt: INSERT_CLIP_NEGATIVE,
    prompt: `${subject}, slow atmospheric drift, subtle cinematic camera motion, no animals, no people, no text.`,
  };
  return submitClip(KLING_MODEL, input, 15 * 60 * 1000);
}

/** scorePrompt comes from resolveWorld(order).score — static WORLD_SCORES for presets, Claude's bundle for custom orders. */
async function generateScore(scorePrompt: string): Promise<string> {
  const r = await fal.subscribe(MUSIC_MODEL, {
    input: {
      prompt: scorePrompt,
      seconds_total: TRAILER_SECONDS,
      num_inference_steps: 8,
    },
    abortSignal: falDeadline(FAL_AUDIO_CAP_MS),
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
  height = 1080,
  // 締めのブランドカードだけが使う。ロゴ画像を中央に置き、その下に文字を敷く。
  // 画像は 2 本目の入力として読み、overlay で合成してから drawtext を掛ける
  // （drawtext は画像を扱えないので、順序はこれしかない）。
  // logo が無ければ従来どおり文字だけ — 画像が欠けてもカードは出る。
  logo?: { file: string; heightPx: number; centerY: number }
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

  // 資産が欠けてもカードは出る、が**黙って出てはいけない**。ロゴを
  // trigger.config.ts の additionalFiles に入れ忘れたせいで、文字だけの
  // ブランドカードが本番納品された（2026-08-16、べっぷ君のDC）。ログにも
  // 何も出ず、完成動画を最後まで見るまで誰も気づけなかった。
  const hasLogo = !!logo && existsSync(logo.file);
  if (logo && !hasLogo) {
    console.warn(
      `[film] brand logo not found at ${logo.file} — closing card will be TEXT ONLY. ` +
        `public/ の資産は trigger.config.ts の additionalFiles に入っているか確認すること。`
    );
  }

  if (logo && hasLogo) {
    const h = Math.round(logo.heightPx * scale);
    const y = Math.round(logo.centerY * scale) - Math.round(h / 2);
    // lumakey で暗部を抜く。ロゴPNGの黒（ほぼ #000）とカード背景（0x0b0a10、
    // わずかに青い黒）は同じではないので、そのまま重ねるとロゴの外周が矩形と
    // して浮く。金色だけを残して背景を透過させれば境界が消える。
    // threshold はロゴの金（明度が高い）と背景の黒の間。tolerance を大きく
    // 取りすぎると金の縁が溶けるので控えめに。
    const chain =
      `[1:v]scale=-1:${h},format=rgba,lumakey=threshold=0.18:tolerance=0.10[logo];` +
      `[0:v][logo]overlay=x=(W-w)/2:y=${y}` +
      (draw ? `[ov];[ov]${draw}` : "");
    await ffmpeg([
      "-f", "lavfi", "-i", `color=c=0x0b0a10:s=${width}x${height}:d=${seconds.toFixed(3)}:r=${FILM_FPS}`,
      "-i", logo.file,
      "-filter_complex", chain,
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", PRESET_INTERMEDIATE, "-crf", String(CRF_INTERMEDIATE),
      output,
    ]);
    return;
  }

  await ffmpeg([
    "-f", "lavfi", "-i", `color=c=0x0b0a10:s=${width}x${height}:d=${seconds.toFixed(3)}:r=${FILM_FPS}`,
    "-vf", draw,
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", PRESET_INTERMEDIATE, "-crf", String(CRF_INTERMEDIATE),
    output,
  ]);
}

/**
 * 締めのブランドカードのロゴ。無ければ文字だけのカードになる（同梱SFXと同じ
 * フォールバック方針 — 資産が欠けてもパイプラインは止まらない）。
 * 高さ 360px は 1080 の 1/3。オーナー提供の 735x506 を高さ基準で入れると
 * 幅 523px、画面幅の 27% に収まる。
 */
const BRAND_LOGO = {
  file: path.join(process.cwd(), "public/brand/mt-logo.png"),
  heightPx: 360,
  centerY: 470, // 中央よりやや上。下に社名を置く余白を作る
};

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
 * (the "turn"/"premise"/"stinger" beats can weave the name into the sentence
 * — see resolveWorld's {name} substitution).
 *
 * "premise"/"stinger" fall back to an empty string when absent (TRAILER-
 * STORY-SPEC.md §1.2) — this function is only ever called for those CardIds
 * when buildEdl already decided the six-card template applies (both fields
 * present, see hasStoryCards below), so the `?? ""` is a defensive last
 * resort, never the normal path.
 */
function cardLinesFor(card: CardId, petName: string, loglines: Loglines): CardLine[] {
  const asciiName = /^[\x00-\x7F]*$/.test(petName);
  switch (card) {
    case "open":
      return [
        { text: TITLE_CARDS.opening, size: fitFontSize(TITLE_CARDS.opening, FONT_DISPLAY, 90), y: "(h-text_h)/2", font: FONT_DISPLAY },
      ];
    case "premise": {
      const text = loglines.premise ?? "";
      const font = asciiName ? FONT_DISPLAY : FONT_NAME;
      return [{ text, size: fitFontSize(text, font, 68), y: "(h-text_h)/2", font }];
    }
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
    case "finale": {
      // The name is already on the line above, so a tagline that leads with it
      // renders it twice — see stripLeadingPetName (lib/film-script.ts) for the
      // order this actually shipped on.
      const tagline = stripLeadingPetName(loglines.tagline, petName);
      return [
        { text: petName, size: fitFontSize(petName, FONT_NAME, 156), y: "h/2-160", font: FONT_NAME },
        { text: tagline, size: fitFontSize(tagline, FONT_DISPLAY, 84), y: "h/2+30", font: FONT_DISPLAY },
      ];
    }
    case "stinger": {
      const text = loglines.stinger ?? "";
      const font = asciiName ? FONT_DISPLAY : FONT_NAME;
      return [{ text, size: fitFontSize(text, font, 68), y: "(h-text_h)/2", font }];
    }
    case "comingSoon":
      return [{ text: TITLE_CARDS.comingSoon, size: 58, y: "(h-text_h)/2", font: FONT_DISPLAY }];
    case "brand":
      // ロゴ（BRAND_LOGO、中心 y=470）の下にサービス名を敷く。ロゴは "MT" の
      // 2文字なので、初見の視聴者にはブランド名が読めない — 最後の1.5秒は
      // サービス名を憶えてもらう唯一の機会なので、文字も残す。
      // ロゴ画像が無ければ文字だけのカードになり、その場合はこの y でも
      // 中央からやや下に出るだけで破綻はしない。
      return [{ text: TITLE_CARDS.closing, size: fitFontSize(TITLE_CARDS.closing, FONT_DISPLAY, 56), y: "h/2+190", font: FONT_DISPLAY }];
  }
}

/* ------------------------------------------------------------------ */
/* Beat EDL (Edit Decision List) — TRAILER-EDIT-SPEC.md §1              */
/* ------------------------------------------------------------------ */

// "open"/"comingSoon" only appear in EDL_TEMPLATE_LEGACY (the backward-compat
// four-card cut, TRAILER-STORY-SPEC.md §1.2); "premise"/"stinger" only appear
// in EDL_TEMPLATE (the current six-card cut, §1.3). Both stay in one union
// because cardLinesFor/render code is shared between the two templates.
type CardId =
  | "open"
  | "premise"
  | "intro"
  | "starring"
  | "turn"
  | "rise"
  | "finale"
  | "stinger"
  | "comingSoon"
  | "brand";

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

// --- Punch-in "different moment" fix (this task's change #1) ---------------
//
// A punch-in beat used to trim the exact SAME [0, seconds] window of the
// source clip that its wide beat already showed — the crop got tighter, but
// the FOOTAGE was identical, so the owner's live-review of the finished
// trailer read it correctly: a clip's wide beat and its punch-in beat show
// the same moment twice, just cropped differently. Two changes fix that
// without spending anything extra:
//
//   1. Trim from the CLOSING seconds of the source instead of the opening
//      ones (punchInSourceWindow below) — the wide beat is the pet at the
//      start of its take, the punch-in is the pet a few seconds later in the
//      SAME take. Genuinely different content, zero extra Kling spend.
//   2. Play that later window back at PUNCH_IN_SPEED (half speed) — a slow
//      push-in on a later moment is standard trailer grammar (deliberate
//      emphasis), not an accident of reusing footage.
//
// PUNCH_IN_SPEED only applies to punch-in beats (punchIn > NO_PUNCH_IN); a
// wide beat is untouched (speed 1, trims from source offset 0, same as ever).
export const PUNCH_IN_SPEED = 0.5;

/**
 * Where a "clip" beat's ffmpeg `-ss`/`-t` window sits inside its NORMALISED
 * source clip, and how much of that source it actually needs.
 *
 * The on-screen duration (`onScreenSeconds`) is fixed by the EDL (buildEdl's
 * 60s normalization) — that can never change, or the assembled film drifts
 * off 60.0s. What CAN change is how much source footage fills that on-screen
 * time: at PUNCH_IN_SPEED (half speed), `setpts` stretches every source
 * second into TWO on-screen seconds, so a punch-in beat only needs HALF as
 * much source as its on-screen length — get this backwards (e.g. request a
 * full `onScreenSeconds` of source and then also slow it down) and the beat
 * plays for twice as long as the EDL asked for, or a short source clip runs
 * out mid-beat. `sourceSeconds` below is exactly `onScreenSeconds *
 * PUNCH_IN_SPEED` for a punch-in beat, `onScreenSeconds` unchanged for a wide
 * one (speed 1).
 *
 * `startSeconds` is where that window begins: 0 for a wide beat ("the opening
 * seconds"), or as close to the very end of the source as `sourceSeconds`
 * allows for a punch-in beat ("the closing seconds") — `Math.max(0, ...)`
 * only matters for a pathologically short source (shorter than the beat's
 * own reduced footage need), and clampToSourceDurations is what keeps that
 * from happening in the first place.
 *
 * Exported (like punchInFilter) so scripts/test-assemble.ts can assert
 * directly against this exact function — wide and punch-in offsets for the
 * same clip must differ — rather than re-deriving the arithmetic itself.
 */
export function punchInSourceWindow(
  sourceDurationSeconds: number,
  onScreenSeconds: number,
  punchIn: number
): { startSeconds: number; sourceSeconds: number } {
  const isPunchIn = punchIn > NO_PUNCH_IN;
  const speed = isPunchIn ? PUNCH_IN_SPEED : 1;
  // Round the source window UP to a whole frame. At 0.5x an ODD on-screen
  // frame count asks for half a source frame — 89 frames on screen needs 44.5
  // — and a trim can only hand back 44, which stretches to 88 and leaves the
  // beat one frame short. Six such beats put the master at 59.80s, and only
  // on the no-inserts EDL, where the scale factor happens to produce odd
  // counts; the with-inserts EDL rounded even and looked fine. Taking the
  // extra frame costs nothing — `-frames:v` in renderClipBeat trims back to
  // the exact EDL length either way — and starting a frame earlier is
  // imperceptible.
  const frames = Math.ceil(onScreenSeconds * speed * FILM_FPS);
  const sourceSeconds = frames / FILM_FPS;
  const startSeconds = isPunchIn ? Math.max(0, sourceDurationSeconds - sourceSeconds) : 0;
  return { startSeconds, sourceSeconds };
}

/**
 * The current beat template (TRAILER-STORY-V3-SPEC.md §4 — this task's
 * change #2). 6 clips (each used twice: once wide, once as a slow-motion
 * punch-in reframe of a LATER window of the same source clip, this task's
 * change #1), 3 no-pet inserts (each with its own animated clip, falling
 * back to Ken Burns — this task's change #2's predecessor), 8 title cards.
 * Authored `seconds` here are the UNSCALED lengths from the spec table;
 * buildEdl() below scales every clip/insert beat so the assembled total
 * lands on EXACTLY 60.0s.
 *
 * REORDERED from the original six-card cut (TRAILER-STORY-V3-SPEC.md §4,
 * this task's change #2). The storyboard reliably comes back from Claude as
 * [build -> peak -> resolution -> ending] no matter how the prompt begs it
 * not to (§4.1 — tried twice, failed twice: cut 4 kept giving away the
 * resolution even when explicitly told not to). Cut 3's punch-in is
 * therefore the true dramatic peak, and `rise` is the last card that still
 * poses a question rather than answering one. In the OLD order, `finale`
 * (the title) sat right after that peak, and the cuts that resolve the story
 * — cut 4 (the answer) and cut 5 (the customer's own chosen ending) — played
 * AFTER the title: the trailer answered its own question before the title
 * even arrived, and the last 6.7s of screen time were three title cards back
 * to back (finale + stinger + brand) with no picture in between at all.
 *
 * The fix moves nothing but POSITION. `finale` now drops in immediately
 * after `rise` — right at the peak, cutting to black on a question, not an
 * answer — and cut 4 (the resolution) and cut 5 (the customer's ending) play
 * AFTER the title, functioning as the answer instead of pre-empting it, with
 * `stinger` and `brand` woven back in around cut 5 instead of stacked at the
 * very end. What plays BEFORE the title, in order: premise -> cut 0 ->
 * intro -> cut 0 -> cut 1 -> starring -> cut 1 -> insert 0 -> cut 2 (x2) ->
 * turn -> insert 1 -> cut 3 (x2) -> rise. What plays AFTER: cut 4 -> insert
 * 2 -> cut 4 -> cut 5 -> stinger -> cut 5 -> brand — so the very last thing
 * on screen is cut 5's punch-in (the pet, the customer's own ending), and
 * `brand` is the only card left after any picture at all, not three in a
 * row.
 *
 * Same 8 cards, same 12 clip beats, same 3 inserts, same per-beat durations
 * as before this reorder — only the ORDER of clip/insert beats relative to
 * the cards changed; the cards' relative order to EACH OTHER did not change
 * (premise still first, stinger still immediately before brand). See
 * buildEdl's doc comment for why that makes the 60.0s total and the scale
 * factor provably unaffected by a pure reorder — verified directly against
 * buildEdl's own output for this exact template, not just argued (this
 * task's own verification script).
 *
 * Card lineup vs. the pre-story cut (EDL_TEMPLATE_LEGACY below): `open`
 * (MARQUEE TAILS PRESENTS) is REPLACED by `premise` in the same lead
 * position — the first thing the audience reads changes from the studio's
 * own name to what the film is ABOUT (§0.1/§1.3 of the original story spec).
 * `comingSoon` is CUT entirely (a "coming soon" card after the title
 * undercuts a stinger). `starring` shrinks 2.2 -> 2.0s. `stinger` is NEW.
 * `brand` is unchanged and stays last. Net: brand-card time 7.7s -> 3.5s
 * funds the story cards' 9.0s -> 13.4s with the SAME 8 total card beats
 * either way.
 *
 * Only used when both `premise` AND `stinger` are present on the order's
 * resolved loglines (see hasStoryCards in assembleToFiles) — otherwise
 * buildEdl falls back to EDL_TEMPLATE_LEGACY so an order authored before this
 * feature still assembles, unchanged (§1.2).
 *
 * This is a plain data literal on purpose: reordering the trailer, swapping
 * which cut gets the climax, or retiming a beat is a one-line edit here —
 * nothing else in the assembler needs to change.
 */
const EDL_TEMPLATE: readonly EdlBeat[] = [
  { kind: "card", card: "premise", seconds: 2.2 },
  { kind: "clip", clip: 0, punchIn: NO_PUNCH_IN, seconds: 3.0 },
  { kind: "card", card: "intro", seconds: 2.0 },
  { kind: "clip", clip: 0, punchIn: PUNCH_IN_ZOOM, seconds: 2.0 },
  { kind: "clip", clip: 1, punchIn: NO_PUNCH_IN, seconds: 2.5 },
  { kind: "card", card: "starring", seconds: 2.0 },
  { kind: "clip", clip: 1, punchIn: PUNCH_IN_ZOOM, seconds: 2.0 },
  { kind: "insert", insert: 0, seconds: 2.0 },
  { kind: "clip", clip: 2, punchIn: NO_PUNCH_IN, seconds: 2.5 },
  { kind: "clip", clip: 2, punchIn: PUNCH_IN_ZOOM, seconds: 2.0 },
  { kind: "card", card: "turn", seconds: 2.0 },
  { kind: "insert", insert: 1, seconds: 2.0 },
  { kind: "clip", clip: 3, punchIn: NO_PUNCH_IN, seconds: 2.5 },
  { kind: "clip", clip: 3, punchIn: PUNCH_IN_ZOOM, seconds: 2.0 },
  { kind: "card", card: "rise", seconds: 2.0 },
  { kind: "card", card: "finale", seconds: 3.0 }, // title lands at the peak, not after the resolution
  { kind: "clip", clip: 4, punchIn: NO_PUNCH_IN, seconds: 2.5 },
  { kind: "insert", insert: 2, seconds: 2.0 },
  { kind: "clip", clip: 4, punchIn: PUNCH_IN_ZOOM, seconds: 2.0 },
  { kind: "clip", clip: 5, punchIn: NO_PUNCH_IN, seconds: 2.5 },
  { kind: "card", card: "stinger", seconds: 2.2 },
  { kind: "clip", clip: 5, punchIn: PUNCH_IN_ZOOM, seconds: 3.5 }, // last thing on screen is the pet, not text
  { kind: "card", card: "brand", seconds: 1.5 },
];

/**
 * The PRE-story four-card cut (TRAILER-STORY-SPEC.md §1.2's mandatory
 * backward-compat path) — byte-for-byte the ORIGINAL EDL_TEMPLATE before this
 * feature, kept verbatim (not derived from EDL_TEMPLATE) so a legacy order's
 * assembled film is provably unchanged: same card set (`open`/`starring`
 * 2.2s/`comingSoon`/`brand`), same story cards (`intro`/`turn`/`rise`/
 * `finale`), same clip/insert beats. Selected whenever an order's resolved
 * loglines are missing `premise` or `stinger` — see hasStoryCards in
 * assembleToFiles. "従来の4枚構成" per spec §1.2/§1.4: nothing about how a
 * pre-feature order looks should change just because the code shipped.
 */
const EDL_TEMPLATE_LEGACY: readonly EdlBeat[] = [
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
export function buildEdl(
  hasInserts: boolean,
  hasStoryCards: boolean,
  clipDurationsSeconds?: number[],
  // Probed duration of each insert's REAL generated Kling clip (this task's
  // change #2), parallel to the 3 insert slots; `undefined` at an index means
  // "no clip for this insert, it renders via Ken Burns" — a still has no real
  // duration cap, so that insert stays unclamped exactly like before this
  // feature existed. Only meaningful when `clipDurationsSeconds` is also
  // given (the real-render path); the structural EDL-shape tests in
  // test-assemble.ts that omit both skip all clamping, unchanged.
  insertClipDurationsSeconds?: (number | undefined)[]
): ScaledBeat[] {
  // hasStoryCards (TRAILER-STORY-SPEC.md §1.2) picks EDL_TEMPLATE (six-card,
  // premise+stinger) when true, EDL_TEMPLATE_LEGACY (today's four-card cut)
  // when false. The caller (assembleToFiles) decides this from whether the
  // order's resolved loglines actually carry BOTH new fields, so a legacy
  // order — or a custom order Claude scripted without them — assembles
  // exactly as it always has, never a partially-populated six-card cut.
  const cardTemplate = hasStoryCards ? EDL_TEMPLATE : EDL_TEMPLATE_LEGACY;
  const template = hasInserts ? cardTemplate : cardTemplate.filter((b) => b.kind !== "insert");

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
    scaled = clampToSourceDurations(scaled, clipDurationsSeconds, insertClipDurationsSeconds ?? []);
  }

  return scaled;
}

/**
 * Clamps every "clip" beat to (at most) its own source clip's probed
 * duration, redistributing whatever a clamp removes to beats that still have
 * headroom so the assembled total is UNCHANGED at exactly TRAILER_FRAMES —
 * see buildEdl's doc comment above for why this exists.
 *
 * Two independent caps feed this, both expressed as "how many ON-SCREEN
 * frames can this beat's source actually sustain":
 *   - "clip" beats (a pet shot): a WIDE beat needs one on-screen frame of
 *     source per on-screen frame shown (speed 1). A PUNCH-IN beat, per this
 *     task's change #1, plays at PUNCH_IN_SPEED — it only consumes
 *     `PUNCH_IN_SPEED` seconds of source per on-screen second, so it can
 *     sustain `sourceCap / PUNCH_IN_SPEED` on-screen frames from the same
 *     source, i.e. TWICE as many at PUNCH_IN_SPEED=0.5. Get this backwards
 *     (treat a punch-in beat like a wide one) and a perfectly fine slow-motion
 *     beat gets clamped as if it needed twice the source it actually does.
 *   - "insert" beats: only capped when this insert has a REAL generated Kling
 *     clip (this task's change #2, insertClipDurationsSeconds[i] defined) —
 *     a still-only (Ken Burns) insert has no real upper bound, same as
 *     before this feature existed, so it stays Infinity/uncapped.
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
function clampToSourceDurations(
  beats: ScaledBeat[],
  clipDurationsSeconds: number[],
  insertClipDurationsSeconds: (number | undefined)[]
): ScaledBeat[] {
  // Math.floor, not round: never ask ffmpeg to trim MORE than a source
  // actually contains. Missing/undefined duration data means "don't clamp
  // it" (Infinity), not "clamp to zero" — safer default.
  const capFramesFor = (beat: ScaledBeat): number => {
    if (beat.kind === "clip") {
      const sourceCapFrames = Math.max(0, Math.floor(secondsToFrames(clipDurationsSeconds[beat.clip] ?? Infinity)));
      const speed = beat.punchIn > NO_PUNCH_IN ? PUNCH_IN_SPEED : 1;
      // Dividing by speed converts "frames of SOURCE available" into "frames
      // of ON-SCREEN beat length this source can sustain at this beat's
      // playback speed" (see the function doc comment above).
      return Math.floor(sourceCapFrames / speed);
    }
    if (beat.kind === "insert") {
      const dur = insertClipDurationsSeconds[beat.insert];
      return dur === undefined ? Infinity : Math.max(0, Math.floor(secondsToFrames(dur)));
    }
    return Infinity; // cards are never clamped
  };

  const result: ScaledBeat[] = beats.map((b) => ({ ...b }));
  // A beat is "capped" once its frames are pinned to its source's max; capped
  // beats never receive redistributed time (they have none left to give).
  const capped = new Set<number>();

  for (let iter = 0; iter < result.length + 1; iter++) {
    let excess = 0;
    result.forEach((b, i) => {
      if ((b.kind !== "clip" && b.kind !== "insert") || capped.has(i)) return;
      const cap = capFramesFor(b);
      if (b.frames > cap) {
        excess += b.frames - cap;
        result[i] = { ...b, frames: cap };
        capped.add(i);
      }
    });
    if (excess === 0) break;

    const receivers = result
      .map((b, i) => ({ b, i }))
      .filter(({ b, i }) => !capped.has(i) && (b.kind === "insert" || b.kind === "clip"));

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
 * Render one "clip" beat: trim ONE window of the source clip — [0,
 * sourceSeconds] for a wide beat ("the opening seconds"), or the LAST
 * `sourceSeconds` of the source for a punch-in beat ("the closing seconds",
 * this task's change #1) — optionally punch-in cropped, optionally
 * slow-motion `setpts`'d back out to its full on-screen length, always
 * re-encoded to a fresh 1920x1080 segment (re-encoding, not stream-copy,
 * guarantees a clean keyframe at the segment boundary for the concat step
 * below).
 *
 * `sourceDurationSeconds` is the PROBED duration of the normalised source
 * clip this beat trims from (the same value buildEdl's clampToSourceDurations
 * used to decide this beat's on-screen `seconds` was even safe to ask for) —
 * required so punchInSourceWindow knows where "the closing seconds" actually
 * are for THIS specific source, not just a nominal SHOT_SECONDS guess.
 */
async function renderClipBeat(
  sourceNorm: string,
  output: string,
  seconds: number,
  punchIn: number,
  sourceDurationSeconds: number
): Promise<void> {
  const isPunchIn = punchIn > NO_PUNCH_IN;
  const { startSeconds, sourceSeconds } = punchInSourceWindow(sourceDurationSeconds, seconds, punchIn);
  const filters = [punchInFilter(punchIn)];
  if (isPunchIn) {
    // Slow motion (this task's change #1): `sourceSeconds` is HALF of `seconds`
    // at PUNCH_IN_SPEED=0.5, so stretching it back out via setpts to fill the
    // beat's full on-screen `seconds` is a 2x multiplier — i.e. 1/PUNCH_IN_SPEED,
    // not PUNCH_IN_SPEED itself (setpts multiplies duration, PUNCH_IN_SPEED is a
    // playback-speed fraction — inverse relationship, easy to get backwards).
    filters.push(`setpts=${(1 / PUNCH_IN_SPEED).toFixed(4)}*PTS`);
    // …then re-sample IN THE FILTER CHAIN, not via the `-r` output option.
    // setpts only rewrites timestamps: the stream still holds the same ~37
    // frames, now spread over twice the wall-clock, so its last frame lands a
    // frame short of the beat's length and the segment ends early. `-r`
    // re-times what it is handed; it does not invent the frames in between.
    // The `fps` filter does, duplicating up to a true FILM_FPS across the
    // stretched timeline. Measured: without this every punch-in beat came out
    // ~0.037s short, and six per film dragged the master to 59.80s.
    filters.push(`fps=${FILM_FPS}`);
  }
  // Printed for every clip beat so the "wide and punch-in trim from different
  // moments" claim is visible in real pipeline logs, not just asserted in
  // scripts/test-assemble.ts.
  console.log(
    `[film] clip beat: ${isPunchIn ? `punch-in @${PUNCH_IN_SPEED}x` : "wide"} on-screen=${seconds.toFixed(2)}s ` +
      `source=[${startSeconds.toFixed(2)}s..${(startSeconds + sourceSeconds).toFixed(2)}s] of ${sourceDurationSeconds.toFixed(2)}s source`
  );
  await ffmpeg([
    // 6 decimal places, NOT the 3 every other `-ss`/`-t` in this file uses:
    // punchInSourceWindow's startSeconds/sourceSeconds come from a
    // SUBTRACTION (sourceDurationSeconds - sourceSeconds), so they're
    // arbitrary floats, not clean authored numbers. Rounding to 3 decimals
    // (~0.0005s of slop) is invisible on its own, but a punch-in beat pairs
    // a LATE, rounded-UP `-ss` with a SHORT, rounded-DOWN `-t` — measured on
    // a real render, that combination skipped the seek target's exact frame
    // AND truncated the trim early, silently dropping 2 of 74 expected
    // frames (a punch-in beat that ran ~0.1s short of its EDL on-screen
    // length, invisible in the 60s-total tolerance but caught by
    // scripts/test-assemble.ts's per-segment duration assertion). 6 decimals
    // (~0.000001s of slop, 30,000x smaller than one frame at FILM_FPS) keeps
    // every trim on the correct side of its frame boundary.
    "-ss", startSeconds.toFixed(6), "-t", sourceSeconds.toFixed(6), "-i", sourceNorm,
    "-vf", filters.join(","),
    // Pin the beat's length in FRAMES, not seconds. The EDL is authored in
    // whole frames, so a beat is a clean integer here but a repeating decimal
    // in seconds — 130 frames is 4.333333…s, and `-t 4.333333` is fractionally
    // under 130 frames, so ffmpeg emits 129 and the beat ends one frame early.
    // Invisible per beat; six punch-ins per film put the master at 59.80s.
    // `-frames:v` states the integer the EDL already knows and leaves nothing
    // to round. (The input `-t` above is a different number whenever slow
    // motion is on — it bounds SOURCE read, not on-screen length.)
    "-frames:v", String(Math.round(seconds * FILM_FPS)),
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

/**
 * Render one "insert" beat as a Ken Burns push-in on a STILL (no Kling
 * involved) — the mandatory fallback path (this task's change #2: "Ken Burns
 * must remain the fallback") for whichever inserts either have no generated
 * clip attempted (legacy order / custom order with no insert stills at all)
 * or had their clip generation fail (see generateInsertClip's caller in
 * runFilmGeneration). Used directly whenever renderInsertClipBeat isn't
 * (assembleToFiles picks between the two per insert index).
 */
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

/**
 * Render one "insert" beat from a REAL generated Kling clip (this task's
 * change #2 — "Ken Burns is what makes them feel like slides"). Trims the
 * clip's opening `seconds` and rescales, same idea as a wide clip beat, but
 * never punch-in cropped or slowed: an insert has no identity gate fighting
 * the video model (spec §4.4 — no pet in frame), so there is nothing forcing
 * a second, tighter cut from the same footage the way a pet shot gets one.
 * Only ever called when a clip was actually generated + cached for this
 * insert index — see assembleToFiles, which falls back to renderInsertBeat
 * (Ken Burns) otherwise.
 */
async function renderInsertClipBeat(sourceNorm: string, output: string, seconds: number): Promise<void> {
  await ffmpeg([
    "-ss", "0", "-t", seconds.toFixed(3), "-i", sourceNorm,
    "-vf", "scale=1920:1080:flags=lanczos",
    "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", PRESET_INTERMEDIATE, "-crf", String(CRF_INTERMEDIATE), "-r", String(FILM_FPS),
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
// Boom sat at unity and was the first thing the owner flinched at. It still
// wants to be the loudest accent in the mix — it just doesn't need to be as
// loud as a sound can be, and pulling it down a few dB costs nothing now that
// BOOM_CARD_IDS stops it firing eight times.
const SFX_LEVEL_DB: Record<SfxName, number> = { boom: -4, riser: -3, whoosh: -6 };
const MUSIC_DUCK_DB = -2.5; // music dips this much under each card's boom hit
const MUSIC_DUCK_SECONDS = 0.6; // duck window length — just the transient, not the whole card
const MUSIC_FADE_OUT_SECONDS = 1.5; // final fade so the 60s mark doesn't cut off abruptly
// Re-aimed by this task's change #3 (TRAILER-STORY-V3-SPEC.md §5.2): after
// change #2 reordered the EDL, the climax is the cut to black INTO the
// `finale` card, not whatever clip beat happens to render last in the
// reordered template (that beat is now the post-title epilogue) — see
// buildSfxEvents below. The constant itself (its length) is unchanged, only
// what it leads into moved.
const RISER_LEAD_SECONDS = 2.5; // riser starts this long before the finale card (the cut to black at the peak)
const WHOOSH_LEAD_SECONDS = 0.15; // whoosh arrives just ahead of the cut it accents
// This task's change #3 (TRAILER-STORY-V3-SPEC.md §5.2): the music drops to
// silence for this long immediately before the `finale` card lands, then
// resumes once the card is on screen — the riser builds into the silence,
// the cut goes quiet, the title appears without the bed under it. Extends
// the existing per-card MUSIC_DUCK_DB mechanism (see mixAudio) rather than
// inventing a new one. UNVERIFIED starting guess (spec §6 item 1) — a tuning
// knob, not a measured value; re-evaluate once someone has actually watched
// the assembled 60s with this in it.
// タイトル直前、ミックス全体（riser を含む）が落ちる長さ。
// タイトル直前、ミックス全体（riser を含む）が落ちる長さ。`null` で無効。
//
// 一度 0.4 秒で入れたが、オーナーの判定は「不自然」「音楽は全部に適用しよう」。
// 予告編の定番ではあっても、この 60 秒には合わなかった — 間を置くほどの尺が
// 無く、切れ目の方が目立つ。**劇伴は 0〜60 秒を通しで鳴らす。**
// 戻すならこの定数に秒数を入れるだけ（実装は残してある）。
const MUSIC_TITLE_GAP_SECONDS: number | null = null;
// タイトルが出たあと、**音楽だけ**が戻らない長さ。boom はこの間に単体で鳴る。
// `null` = 最後まで戻さない。1.0 秒で戻した版をオーナーが聴いて「違和感がある」
// と判定したため（2026-08-15）。復帰が曲の途中から始まるので、無音で作った
// 間をその継ぎ目が壊す。タイトル以降はエピローグで、SFX と映像だけで持つ。
//
// 2026-08-15、CAMYU の素材で組み直して実測したところ、無音 0.4 秒のあと
// 37.90 秒で「タイトル表示・boom・音楽の全開復帰」が同時に起き、オーナーの
// 判定は「ここが不自然」。予告編の型では**タイトルは無音の中に出て、一拍
// 置いてから音楽が戻る** — 打点は boom 単体で足りる。音楽まで同時に戻すと、
// 一番見せたい 1 コマの上で情報が渋滞する。
const MUSIC_TITLE_HOLD_SECONDS: number | null = null;
const MIX_SAMPLE_RATE = 44100;
// Not every card gets a whoosh (spec: "全部には付けない...5〜6箇所") — these 5
// are the biggest story beats; open/comingSoon/brand stay clean so the
// bookends don't feel over-produced.
const WHOOSH_CARD_IDS: CardId[] = ["intro", "starring", "turn", "rise", "finale"];

/*
 * Which cards get the boom. NOT all of them, which is what shipped first: a
 * boom on every one of the eight cards meant three identical hits inside the
 * opening twelve seconds (premise, intro, starring), and the owner heard it
 * immediately — "the same sound about three times, twice would do". A boom is
 * punctuation; used on every card it stops being punctuation and becomes
 * wallpaper, and the loudest wallpaper in the mix at that.
 *
 * These four are the structural beats — the film opening, the two story turns,
 * and the title reveal — and no two of them are adjacent, so the hit always
 * lands after picture rather than after another hit. The cards left out
 * (intro, starring, stinger, brand) still get their whoosh where the list
 * above says so; they just stop competing for the same accent.
 */
const BOOM_CARD_IDS: CardId[] = ["premise", "turn", "rise", "finale"];

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

/**
 * Seconds into the EDL where the `finale` card begins, or undefined if this
 * EDL somehow has none (shouldn't happen — both EDL_TEMPLATE and
 * EDL_TEMPLATE_LEGACY carry exactly one `finale` card each). Shared by the
 * riser retarget and the pre-title music gap (this task's change #3) — both
 * need to know exactly when the cut to black/title happens, and after
 * change #2's reorder that is no longer "the last beat" of anything.
 */
function finaleCardStartSeconds(beats: ScaledBeat[]): number | undefined {
  const starts = beatStartTimes(beats);
  const i = beats.findIndex((b) => b.kind === "card" && b.card === "finale");
  return i >= 0 ? starts[i] : undefined;
}

type SfxEvent = { file: SfxName; atSeconds: number };

/** Every SFX one-shot this EDL should fire, with its absolute start time. */
function buildSfxEvents(beats: ScaledBeat[]): SfxEvent[] {
  const starts = beatStartTimes(beats);
  const events: SfxEvent[] = [];
  beats.forEach((b, i) => {
    if (b.kind === "card") {
      if (BOOM_CARD_IDS.includes(b.card)) {
        events.push({ file: "boom", atSeconds: starts[i] });
      }
      if (WHOOSH_CARD_IDS.includes(b.card)) {
        events.push({ file: "whoosh", atSeconds: Math.max(0, starts[i] - WHOOSH_LEAD_SECONDS) });
      }
    }
  });
  // Riser leads into the CUT TO BLACK where the title lands (this task's
  // change #3, TRAILER-STORY-V3-SPEC.md §5.2). Before change #2's EDL
  // reorder, the last "clip" beat in the EDL WAS the climax, so "aim at the
  // last clip beat" and "aim at the peak" were the same instruction. After
  // the reorder that's no longer true — the last clip beat is now the
  // post-title epilogue (cut 5's resolution, the customer's own ending), and
  // the moment that actually wants a riser building into it is the `finale`
  // card itself.
  const finaleStart = finaleCardStartSeconds(beats);
  if (finaleStart !== undefined) {
    events.push({ file: "riser", atSeconds: Math.max(0, finaleStart - RISER_LEAD_SECONDS) });
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

  // This task's change #3 (TRAILER-STORY-V3-SPEC.md §5.2): a hard-silence
  // window in the MUSIC itself, immediately before the `finale` card lands —
  // computed once here and applied in BOTH branches below (SFX present or
  // not), because silence needs no SFX file to exist; "the music gap should
  // be safe with or without SFX files present" is the whole point of putting
  // it here rather than inside the SFX-only branch. Same `volume=enable=`
  // idiom as MUSIC_DUCK_DB's per-card ducking below, just one deeper,
  // one-off window instead of a per-card dip.
  const finaleStart = finaleCardStartSeconds(beats);
  // 2窓ある。**掛ける先が違う。**
  //   mixGapFilter   … タイトル直前。ミックス全体（riser ごと）を落とす
  //   musicHoldFilter … タイトル後。音楽だけ止めたまま、boom を単体で鳴らす
  const mixGapFilter =
    finaleStart !== undefined && MUSIC_TITLE_GAP_SECONDS !== null
      ? `volume=enable='between(t,${Math.max(0, finaleStart - MUSIC_TITLE_GAP_SECONDS).toFixed(3)},${finaleStart.toFixed(3)})':volume=0`
      : undefined;
  const musicHoldFilter =
    finaleStart !== undefined && MUSIC_TITLE_HOLD_SECONDS !== null
      ? `volume=enable='between(t,${finaleStart.toFixed(3)},${(finaleStart + MUSIC_TITLE_HOLD_SECONDS).toFixed(3)})':volume=0`
      : undefined;

  if (!sfxFilesAvailable()) {
    console.warn(
      "[film] SFX files not found in public/sfx — assembling with MUSIC ONLY (no boom/riser/whoosh). " +
        "trigger.config.ts の additionalFiles を確認すること。"
    );
    const musicOnlyChain = [
      // SFX が無い経路では riser も boom も鳴らないので、2窓は続きの無音になる。
      ...(mixGapFilter ? [mixGapFilter] : []),
      ...(musicHoldFilter ? [musicHoldFilter] : []),
      `afade=t=out:st=${fadeStart.toFixed(3)}:d=${MUSIC_FADE_OUT_SECONDS}`,
    ].join(",");
    await ffmpeg([
      "-i", scoreLocalPath,
      "-af", musicOnlyChain,
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
    // タイトル後のホールドは音楽トラックにだけ掛ける — boom はミックス側に
    // 別入力で入るので、ここで止めても鳴り続ける。タイトル**直前**の無音は
    // riser も落とす必要があるので amix の後（下）。
    ...(musicHoldFilter ? [musicHoldFilter] : []),
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
  // 無音は **ミックス全体** に掛ける。音楽トラックだけに掛けた版を CAMYU の
  // 完成素材で組み直して実測したところ、無音区間の音量は -30dB から -34.7dB に
  // 落ちただけで、無音にならなかった — riser がタイトルの2.5秒前から鳴り始め、
  // その窓の上を鳴り続けるため。予告編の「全部止まってタイトル」は、止まるのが
  // 音楽だけでは成立しない。riser は無音の直前まで駆け上がり、そこで一緒に切れる。
  const mixGap = mixGapFilter ? `,${mixGapFilter}` : "";
  filterParts.push(`${mixLabels.join("")}amix=inputs=${mixLabels.length}:duration=first:dropout_transition=0${mixGap}[a]`);

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
  // Animated Kling clip generated FROM each insert still (this task's change
  // #2), parallel to insertStillUrls (same indices 0-2). Cached SEPARATELY —
  // like insertStillUrls, never enters the identity-scoring loop (spec §4.4:
  // no pet in an insert, nothing to score). undefined = not yet attempted
  // for this order (runFilmGeneration will try once insertStillUrls exists);
  // once attempted this is always a full 3-entry array whose entries are:
  //   string = a generated insert clip — reused as-is on resume/re-render,
  //            never regenerated (same posture as endFrameUrls below).
  //   null   = generation failed for JUST this insert — renders via Ken Burns
  //            (renderInsertBeat) on the cached still instead, permanently
  //            for this cached run. Never fails the whole film (mandatory
  //            fallback).
  // [] = insertStillUrls itself had fewer than 3 entries (legacy order /
  // custom order with no derivable inserts) — nothing to animate, every
  // insert beat is Ken Burns.
  insertClipUrls?: (string | null)[];
  // Start+end interpolation end frames (spec §5.2), one slot per shot,
  // parallel to clipUrls/clipScores. undefined = not yet attempted for this
  // order; once attempted this is always a full-length array (one entry per
  // shot) whose entries are:
  //   string = a generated, identity-gated end frame — reused as-is on
  //            resume/re-render, never regenerated (spec §5.4/§7).
  //   null   = this shot is not enrolled (SHOT_END_POSES[i] is null) OR its
  //            end frame failed to clear the identity gate even after a
  //            re-roll — either way that shot stays on the original
  //            single-frame i2v path, permanently for this cached run.
  // (The spec's own §5.2 note types this `string[]`; `null` entries are the
  // concrete encoding of "attempted, not available" — still a plain JSON
  // array inside the existing filmArtifacts Json column, no schema change.)
  endFrameUrls?: (string | null)[];
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
  durationSec: number,
  endFrameUrl?: string,
  action?: string,
  crew?: boolean
): Promise<string> {
  return generateShotClip(stillUrl, world, shotIndex, orderId, durationSec, undefined, endFrameUrl, action, crew);
}

/**
 * Animate the cached insert stills into real Kling clips, once, and cache the
 * result. Returns the (possibly updated) artifacts.
 *
 * Shared by runFilmGeneration and runShotRerender because it was originally
 * only in the former, and the first re-render after shipping it produced a
 * film whose inserts were still Ken-Burns stills — the owner's report was
 * simply "the inserts weren't moving". A re-render re-assembles the whole
 * film, so anything the assembly reads has to be *ensured* here, not assumed
 * to have been produced by the original run: this cache is empty for every
 * order made before insert clips existed, which is exactly the population
 * most likely to be re-rendered.
 *
 * Cached per insert, so one failure falls back to Ken Burns for that insert
 * alone. Caches `[]` when there aren't three stills to animate, so the check
 * doesn't re-run on every future re-render of an order that has none.
 */
async function ensureInsertClips(
  orderId: string,
  art: FilmArtifacts,
  insertSubjects: string[]
): Promise<FilmArtifacts> {
  if (art.insertClipUrls !== undefined) return art;
  const stillsToAnimate = art.insertStillUrls ?? [];
  if (stillsToAnimate.length < 3) {
    return saveArtifacts(orderId, { insertClipUrls: [] });
  }
  console.log(
    `[film] animating ${stillsToAnimate.length} insert stills (Kling i2v, ${INSERT_CLIP_SECONDS}s min duration) order=${orderId}`
  );
  const urls = await Promise.all(
    stillsToAnimate.slice(0, 3).map(async (stillUrl, i): Promise<string | null> => {
      try {
        return await generateInsertClip(stillUrl, insertSubjects[i] ?? "");
      } catch (e) {
        console.warn(`[film] insert ${i} clip generation failed — falling back to Ken Burns for this insert order=${orderId}:`, e);
        return null;
      }
    })
  );
  return saveArtifacts(orderId, { insertClipUrls: urls });
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

  // IDENTITY-FIDELITY-SPEC.md §4: prefer the customer's real photo as the
  // identity-gate anchor for clips/end-frames, same fix as §2.1 for stills —
  // see scoreClip's comment above for why the portrait alone was the bug.
  // Falls back to the portrait only if this order somehow has no usable
  // uploaded photo (uploads are mandatory, so this is defensive, not the
  // intended path — HARD CONSTRAINT #3: never fail an order over this fix).
  const portraitUrl = order.identityPortraitUrl ?? undefined;
  const realPhotoUrl = order.uploadedPhotoUrls[0] ?? undefined;
  const identityGateRef = realPhotoUrl ? publicUrl(realPhotoUrl) : portraitUrl;
  if (!realPhotoUrl && portraitUrl) {
    console.warn(`[film] order=${order.id}: no real photo available for identity gate — falling back to portrait-anchor gating (pre-fix behavior)`);
  }
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

  // Stage I-b. Insert CLIPS (this task's change #2) — animate each insert
  // still into a real Kling clip instead of leaving it a Ken-Burns-only
  // still. Only attempted once insertStillUrls is settled (immediately
  // above); cached separately and PER-INSERT, because a single insert's
  // generation failing must fall back to Ken Burns for JUST that insert, not
  // drop the whole batch or fail the film ("Ken Burns must remain the
  // fallback"). Skips entirely (caches []) when there aren't 3 stills to
  // animate — nothing for renderInsertClipBeat to use, every insert beat
  // stays Ken Burns, same as it always has been for those orders.
  art = await ensureInsertClips(order.id, art, resolved.inserts);

  // Stage II. Start+end frame interpolation (spec §5.2/§5.4) — OFF for v2
  // (USE_END_FRAMES = false, MOTION-V2-SPEC.md §3.1, this task's change #1):
  // an order with no cached end frames yet simply never generates any, so it
  // never pays fal for a still generateShotClip is guaranteed not to attach
  // to the request (see USE_END_FRAMES's own comment for the full reasoning
  // and the one-switch reversal path). Orders that ALREADY have
  // `endFrameUrls` cached from before this switch flipped are untouched by
  // this gate — it only blocks NEW generation (the `=== undefined` check
  // below), never a defined array, so resume/re-render for those orders is
  // unchanged; the cached urls just stop being attached to the video request
  // (generateShotClip's own USE_END_FRAMES gate).
  //
  // Cached SEPARATELY from clipUrls/clipScores, same reasoning as
  // insertStillUrls above: an `undefined` cache means "not yet attempted"
  // (run it, when the switch is on), while a defined array (even one full of
  // `null`s) means "already attempted, reuse as-is" — a resume must never
  // re-spend on an already-gated end frame.
  //
  // resolved.endPoses (NOT the SHOT_END_POSES constant directly) enrolls only
  // a couple of cuts for preset orders (§5.4's staged rollout); every other
  // cut resolves to `null` here with no fal call at all. For a Director's Cut
  // custom order, resolveWorld already substituted Claude's own story-aware
  // poses in place of the generic SHOT_END_POSES when the order's
  // generatedScript provided them (see resolveWorld/resolveCustomEndPoses in
  // film-script.ts) — this call site doesn't need to know which branch it
  // got, which is the whole point of going through resolveWorld.
  if (USE_END_FRAMES && art.endFrameUrls === undefined) {
    console.log(`[film] generating end frames for interpolated cuts order=${order.id}`);
    const endFrameUrls = await Promise.all(
      shotStillUrls.map((stillUrl, i) => {
        const endPose = resolved.endPoses[i] ?? null;
        if (!endPose) return Promise.resolve(null);
        return generateGatedEndFrame(stillUrl, endPose, identityGateRef, i, orderLora(order));
      })
    );
    art = await saveArtifacts(order.id, { endFrameUrls });
  }

  // Stage C. Three independent, separately-cached steps so a resume only redoes
  // what's missing — crucially, clip GENERATION (Kling, expensive) is decoupled
  // from clip SCORING (VLM, cheap), so a scoring failure never forces a costly
  // re-animate. generateGatedClip scores as it generates (for the re-roll);
  // scoreClip re-scores already-cached clips on resume.
  if (!art.clipUrls) {
    console.log(`[film] animating ${shotStillUrls.length} shots (identity-gated) order=${order.id}`);
    const endFrameUrls = art.endFrameUrls ?? [];
    const gated = await Promise.all(
      shotStillUrls.map((s, i) =>
        generateGatedClip(s, world, i, order.id, identityGateRef, undefined, endFrameUrls[i] ?? undefined, resolved.actions[i] ?? undefined, resolved.crew[i] ?? false)
      )
    );
    art = await saveArtifacts(order.id, {
      clipUrls: gated.map((g) => g.url),
      clipScores: gated.map((g) => g.score),
    });
  }
  if (!art.clipScores) {
    console.log(`[film] scoring ${art.clipUrls!.length} cached clips order=${order.id}`);
    const scores = await Promise.all(
      art.clipUrls!.map((u) => (identityGateRef ? scoreClip(u, identityGateRef) : Promise.resolve(100)))
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
  const insertClipUrls = art.insertClipUrls ?? [];

  const lowest = clipScores.length ? Math.min(...clipScores) : 100;
  console.log(`[film] clip identity scores order=${order.id}: [${clipScores.join(", ")}] (lowest ${lowest})`);

  console.log(`[film] assembling order=${order.id}`);
  const masterUrl = await assemble(
    order.id,
    petName,
    clipUrls,
    insertStillUrls,
    insertClipUrls,
    scoreUrl,
    loglines
  );

  // Persist the per-shot audit into dedicated fields (filmArtifacts is cleared
  // on completion) so the admin drift view has it at Gate 2.
  await prisma.order.update({
    where: { id: order.id },
    data: { shotClipUrls: clipUrls, shotIdentityScores: clipScores.map((s) => Math.round(s)) },
  });

  await completeFilmGeneration(order.id, masterUrl);
}

/**
 * Renders every beat of the EDL, mixes audio, grades, and returns LOCAL file
 * paths for the 16:9 master and 9:16 social cut. `clipSources`/
 * `insertStillSources`/`insertClipSources`/`scoreSource` may be remote (fal)
 * URLs — downloaded into `dir` — or already-local file paths, used as-is;
 * that dual mode is what lets scripts/test-assemble.ts drive this exact
 * function against synthetic local fixtures instead of real generated media,
 * with no fork between test and production code paths. `insertStillSources`
 * may be [] (no inserts available) — buildEdl() drops the insert beats and
 * normalization still lands on exactly 60.0s (spec §1.3/§4.3), EXCEPT when a
 * source clip is too short to give a scaled-up beat what it asks for — see
 * clampToSourceDurations, fed from the probed clip durations below.
 *
 * `insertClipSources[i]` (this task's change #2) is `null`/missing/undefined
 * whenever insert `i` has no generated Kling clip (not attempted, or
 * generation failed) — that insert beat renders via Ken Burns on
 * `insertStillSources[i]` instead (the mandatory fallback). A shorter-than-3
 * array is fine; missing entries are treated the same as `null`.
 */
async function assembleToFiles(
  dir: string,
  petName: string,
  clipSources: string[],
  insertStillSources: string[],
  insertClipSources: (string | null)[],
  scoreSource: string,
  loglines: Loglines
): Promise<{ masterPath: string }> {
  const hasInserts = insertStillSources.length >= 3;
  // Backward compat (TRAILER-STORY-SPEC.md §1.2): the six-card EDL only
  // applies when BOTH new fields are present. An order whose generatedScript
  // predates this feature (or a custom order Claude scripted without them)
  // has one or both undefined here, and falls back to EDL_TEMPLATE_LEGACY —
  // today's four-card cut — rather than assembling a half-populated card.
  const hasStoryCards = Boolean(loglines.premise && loglines.stinger);

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

  const insertStills: string[] = [];
  if (hasInserts) {
    for (let i = 0; i < 3; i++) {
      insertStills.push(await fetchOrLocal(insertStillSources[i], path.join(dir, `insert-raw-${i}.png`)));
    }
  }

  // Insert CLIPS (this task's change #2) — normalise whichever inserts have a
  // real generated Kling clip; the rest stay `null` and render via Ken Burns
  // (renderInsertBeat) instead. Done BEFORE buildEdl for the same reason
  // clips are probed first: buildEdl's clampToSourceDurations needs each
  // insert clip's ACTUAL duration to know it can't hand a beat more seconds
  // than a fixed-length Kling clip actually has.
  const normInsertClips: (string | null)[] = [];
  for (let i = 0; i < 3; i++) {
    const src = insertClipSources[i];
    if (src) {
      const raw = await fetchOrLocal(src, path.join(dir, `insert-clip-raw-${i}.mp4`));
      const norm = path.join(dir, `insert-clip-norm-${i}.mp4`);
      await normaliseClip(raw, norm);
      normInsertClips.push(norm);
    } else {
      normInsertClips.push(null);
    }
  }
  const insertClipDurationsSeconds = await Promise.all(
    normInsertClips.map((p) => (p ? probeDurationSeconds(p) : Promise.resolve(undefined)))
  );

  const edl = buildEdl(hasInserts, hasStoryCards, clipDurationsSeconds, insertClipDurationsSeconds);

  const scoreLocal = await fetchOrLocal(scoreSource, path.join(dir, "score.wav"));

  // --- Render every beat at 1920x1080 — no grade/matte yet (applied ONCE to
  // the finished timeline below, see gradeFilterChain).
  const wideSegments: string[] = [];
  for (let i = 0; i < edl.length; i++) {
    const beat = edl[i];
    const seconds = framesToSeconds(beat.frames);
    const out = path.join(dir, `wide-${String(i).padStart(2, "0")}.mp4`);
    if (beat.kind === "clip") {
      await renderClipBeat(normClips[beat.clip], out, seconds, beat.punchIn, clipDurationsSeconds[beat.clip]);
    } else if (beat.kind === "insert") {
      const clipSrc = normInsertClips[beat.insert];
      if (clipSrc) {
        await renderInsertClipBeat(clipSrc, out, seconds);
      } else {
        await renderInsertBeat(insertStills[beat.insert], out, seconds);
      }
    } else {
      // ロゴは締めの brand カードだけ。他のカードに置くと、物語の途中で
      // ブランドが割り込むことになる。
      await titleCard(
        out,
        seconds,
        cardLinesFor(beat.card, petName, loglines),
        1920,
        1080,
        beat.card === "brand" ? BRAND_LOGO : undefined
      );
    }
    wideSegments.push(out);
  }

  // --- Widescreen master: concat -> shared grade/grain pass (no matte, see
  // gradeFilterChain).
  const rawMaster = path.join(dir, "raw-master.mp4");
  await concatSegments(dir, wideSegments, rawMaster);
  const gradedMaster = path.join(dir, "graded-master.mp4");
  await applyGrade(rawMaster, gradedMaster, gradeFilterChain());

  // NO 9:16 SOCIAL CUT. There used to be one here, derived from the widescreen
  // render by `crop=ih*9/16:ih,scale=1080:1920` — a 607px-wide centre strip of
  // a 1920px frame (68% of the width thrown away) upscaled 1.78x. The code
  // comment justifying it said only "中心クロップは現行踏襲": nobody designed
  // it, it was inherited from the pre-EDL pipeline and carried forward.
  //
  // Every cut in this product is composed wide on purpose — the pet prominent
  // with its world readable behind it — so a centre crop discards the shot.
  // What the customer got was strictly WORSE than posting the 16:9 master to
  // TikTok themselves, which the platform letterboxes cleanly and without
  // throwing away two thirds of the frame.
  //
  // Nothing promised it: no LP copy, no email, no pricing spec, no terms —
  // only a button on the delivery page, removed with it. Deleting it also
  // removes a second full concat + grade + mux pass, roughly half this
  // function's ffmpeg work, from the pipeline whose runtime caused the
  // 2026-08-04 MAX_DURATION_EXCEEDED incident.
  //
  // If a vertical comes back, it should be a per-shot reframe that follows the
  // pet, not a crop and not a blurred letterbox (which only reproduces what
  // TikTok already does automatically).

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
  return { masterPath };
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
  insertStillPaths: string[],
  insertClipPaths: (string | null)[],
  scorePath: string,
  loglines: Loglines
): Promise<{ masterPath: string }> {
  return assembleToFiles(dir, petName, clipPaths, insertStillPaths, insertClipPaths, scorePath, loglines);
}

async function assemble(
  orderId: string,
  petName: string,
  clipUrls: string[],
  insertStillUrls: string[],
  insertClipUrls: (string | null)[],
  scoreUrl: string,
  loglines: Loglines
): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), `mt-film-${orderId}-`));
  try {
    const { masterPath } = await assembleToFiles(
      dir,
      petName,
      clipUrls,
      insertStillUrls,
      insertClipUrls,
      scoreUrl,
      loglines
    );
    // Filename is ASCII-slugged (fal storage mangles non-ASCII).
    const slug = petName.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "film";
    return uploadFile(masterPath, `${slug}-marquee-tails.mp4`);
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
  masterUrl: string
): Promise<void> {
  await transitionOrder(
    orderId,
    OrderStatus.VIDEO_GENERATING,
    OrderStatus.AWAITING_ADMIN_APPROVAL,
    "system",
    { finalVideoUrl: masterUrl },
    "film assembled (beat EDL, 60s trailer)"
  );
  // Keep filmArtifacts (clips + inserts + music): the admin's single-shot
  // re-render reuses them so fixing one cut never re-spends on the other
  // five, the inserts, or the score.
  console.log(`[film] order=${orderId} -> AWAITING_ADMIN_APPROVAL`);
}

/**
 * Single-shot re-render — the admin's Gate-2 fix for "this one cut is off".
 * Re-animates ONE clip from its customer-approved still (identity-scored, not
 * gated — see generateGatedClip), routed by `action` exactly like
 * generateShotClip: a Preset cut (no action) goes to Kling, with the
 * strengthened anti-CG negative prompt, at ~$0.67/8s; a Director's Cut cut
 * (has an action) goes to Seedance — which has no negative_prompt input at
 * all — at a MEASURED $5.47/8s. Reuses the other five clips, the insert
 * stills AND their animated clips, and the music from filmArtifacts,
 * reassembles, and returns the order to AWAITING_ADMIN_APPROVAL. Cost ≈ one
 * clip (~$0.67 Kling / $5.47 Seedance, depending on the cut) + scoring; never
 * re-spends on the rest of the film (spec §4.4 isolation).
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
  // IDENTITY-FIDELITY-SPEC.md §4 — same fix as runFilmGeneration above: prefer
  // the customer's real photo as the identity-gate anchor, falling back to
  // the portrait only if this order has no usable uploaded photo.
  const portraitUrl = order.identityPortraitUrl ?? undefined;
  const realPhotoUrl = order.uploadedPhotoUrls[0] ?? undefined;
  const identityGateRef = realPhotoUrl ? publicUrl(realPhotoUrl) : portraitUrl;
  if (!realPhotoUrl && portraitUrl) {
    console.warn(`[film] order=${order.id}: no real photo available for identity gate — falling back to portrait-anchor gating (pre-fix behavior)`);
  }

  // Working set from artifacts, falling back to the persisted per-shot fields
  // (orders completed before artifacts were kept only have the latter).
  const art: FilmArtifacts = (order.filmArtifacts as FilmArtifacts) ?? {};
  const clipUrls = [...(art.clipUrls ?? order.shotClipUrls)];
  const clipScores = [...(art.clipScores ?? order.shotIdentityScores)];
  if (!clipUrls[shotIndex]) throw new Error(`order ${order.id} has no clip to replace at shot ${shotIndex}`);
  // Insert STILLS are untouched by a shot fix (spec §4.4 isolation) — reuse
  // whatever was cached. Their CLIPS, though, have to be ensured rather than
  // read: an order made before insert clips existed has an empty cache, and a
  // re-render re-assembles the entire film, so reading it here left the
  // inserts as Ken-Burns stills in the re-rendered cut. Ensuring is a no-op
  // once cached, so a second re-render costs nothing.
  const insertStillUrls = art.insertStillUrls ?? [];
  const artWithInsertClips = await ensureInsertClips(order.id, art, resolved.inserts);
  const insertClipUrls = artWithInsertClips.insertClipUrls ?? [];
  // End frames (spec §5.2/§5.4): reuse the cached one for every OTHER shot
  // untouched, same isolation as inserts above. For THIS shot, a reshoot
  // invalidates the cached end frame — it was posed FROM the old still, so it
  // no longer matches the new one — and, if this cut is enrolled (resolved
  // via resolveWorld's endPoses — SHOT_END_POSES for presets, or a custom
  // order's own Claude-authored pose, non-null either way), a fresh end frame
  // is generated + gated from the new still before the clip re-animates. A
  // plain reanimate (no reshoot) reuses the cached end frame as-is, since the
  // still it was posed from hasn't changed.
  //
  // Also gated on USE_END_FRAMES (this task's change #1): the switch's own
  // instructions named only runFilmGeneration's Stage II explicitly, but
  // leaving this admin re-render path ungated would quietly reintroduce the
  // exact wasted spend USE_END_FRAMES exists to avoid — generateShotClip
  // never attaches end_image_url while it's off, so generating a fresh one
  // here just to have it ignored is spend for nothing. Added for
  // consistency; flagged in this task's report as an addition beyond the
  // literal instruction.
  const endFrameUrls = [...(art.endFrameUrls ?? clipUrls.map(() => null))];
  const endPose = resolved.endPoses[shotIndex] ?? null;

  if (opts.reshoot) {
    // Look/style problem: the still itself is retaken (reason steers it),
    // then animated fresh.
    still = await reshootCutStill(order, shotIndex, opts.reason);
    endFrameUrls[shotIndex] = null; // stale — posed from the still just replaced
  }

  if (USE_END_FRAMES && endPose && !endFrameUrls[shotIndex]) {
    endFrameUrls[shotIndex] = await generateGatedEndFrame(
      still,
      endPose,
      identityGateRef,
      shotIndex,
      orderLora(order)
    );
  }

  console.log(
    `[film] re-render shot ${shotIndex} order=${order.id} mode=${opts.reshoot ? "reshoot" : "reanimate"}${opts.reason ? ` reason="${opts.reason}"` : ""}`
  );
  const fixed = await generateGatedClip(
    still,
    world,
    shotIndex,
    order.id,
    identityGateRef,
    opts.reason,
    endFrameUrls[shotIndex] ?? undefined,
    // **action を渡していなかったのはバグ**（2026-08-17 発見・修正）。モデルは
    // プランではなく `action` の有無で決まる（generateShotClip の useSeedance）。
    // 落とすと Director's Cut のカットが Seedance ではなく Kling で撮り直され、
    // 大きく動く5本の中に微動の1本が混ざる。admin が「直した」カットが、直す前
    // より周りから浮くという最悪の壊れ方をしていた。crew も同じ経路で渡す。
    resolved.actions[shotIndex] ?? undefined,
    resolved.crew[shotIndex] ?? false
  );
  clipUrls[shotIndex] = fixed.url;
  clipScores[shotIndex] = fixed.score;

  const scoreUrl = art.scoreUrl ?? (await generateScore(resolved.score));
  await saveArtifacts(order.id, { clipUrls, clipScores, scoreUrl, endFrameUrls });

  console.log(`[film] assembling (shot ${shotIndex} fixed) order=${order.id}`);
  const masterUrl = await assemble(
    order.id,
    petName,
    clipUrls,
    insertStillUrls,
    insertClipUrls,
    scoreUrl,
    loglines
  );

  await prisma.order.update({
    where: { id: order.id },
    data: { shotClipUrls: clipUrls, shotIdentityScores: clipScores.map((s) => Math.round(s)) },
  });

  await completeFilmGeneration(order.id, masterUrl);
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

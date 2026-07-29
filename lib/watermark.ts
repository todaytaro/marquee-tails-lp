import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import { fal } from "@fal-ai/client";

/**
 * Gate-1 preview derivative — watermark + downscale — PRICING-PRODUCT-V2-SPEC.md
 * §3.5(C) "持ち逃げ防止（必須）".
 *
 * THE PROBLEM THIS FILE CLOSES: storyboardOptions used to hold the raw fal CDN
 * URL to each take — full 2K resolution, no mark. A customer could open Gate 1,
 * save those images, then use the pre-production refund path to get $200 back
 * while walking away with usable 2K art for the $49 non-refundable fee. The
 * Director's Cut refund guarantee is only safe to offer if the thing the
 * customer can save before paying in full is deliberately unusable as a
 * finished product.
 *
 * THE FIX: never hand the customer the clean take. Generate an actual
 * derivative FILE — a real composite of pixels, not a CSS overlay a viewer can
 * strip by opening dev tools — that (a) is capped at a modest resolution and
 * (b) has the studio's mark baked into the image data across enough of the
 * frame that no single crop removes it. `sharp` is not a dependency here;
 * ffmpeg already is (ffmpeg-static, used for the title-card/film pipeline), so
 * this reuses that toolchain instead of adding a new one.
 *
 * WHERE THIS RUNS: lib/stills-pipeline.ts calls watermarkTakeForPreview once
 * per generated take (18/order), concurrently, from inside the Trigger.dev
 * `generate-stills` task — which already has ffmpeg via trigger.config.ts's
 * ffmpeg() build extension and ships public/fonts/** (additionalFiles), so no
 * new infra is needed to run this there.
 *
 * NON-FATAL BY DESIGN: a paying customer must never get a broken Gate 1
 * because one take's derivative failed to render or upload. Every failure
 * mode inside watermarkTakeForPreview is caught and falls back to returning
 * the clean url UNCHANGED for that one take (logged, not thrown). That take
 * simply shows unwatermarked at full res in that one case — a narrow,
 * logged exposure on a single take beats failing the customer's entire
 * storyboard. See lib/stills-pipeline.ts normalizeStoryboard for how a
 * "preview === clean" option round-trips through the rest of the system
 * exactly like a legacy pre-this-feature order does.
 */

/* -------------------------------------------------------------------- */
/* Tuning constants — every knob for the mark's look lives here so a     */
/* future adjustment ("too strong", "too weak") is a one-line change.    */
/* -------------------------------------------------------------------- */

// The downscale half of the protection. A watermarked 2K still is still a
// watermarked 2K still — good enough to print. Capping the LONG edge at
// ~1000px reads clearly on any screen (judging likeness — the whole point of
// Gate 1 — needs zero resolution beyond "recognizable on a phone or laptop")
// but is materially poor material for anything beyond screen viewing.
export const PREVIEW_MAX_LONG_EDGE = 1000;

// The mark itself. Studio name + "PREVIEW" (not "SAMPLE"/"DRAFT") reads as
// "this isn't the deliverable" without sounding like an error state.
export const WATERMARK_TEXT = "MARQUEE TAILS · PREVIEW";

// Alpha on the drawtext fontcolor. Tuned low: high enough that the mark is
// unambiguously visible and clearly not an accident, low enough that it never
// competes with reading the pet's face — a mark that obscures the pet's face
// makes Gate 1 (a likeness-judging tool) actively worse, which is a bigger
// product loss than the mark being easy to look past. Verified visually
// against a synthesized 2K test take (scripts/test-watermark.ts) at this value.
export const WATERMARK_OPACITY = 0.38;

// Diagonal tilt, in degrees. Negative = leaning up-left to up-right, the
// classic stock-photo angle. A rotated mark defeats the laziest crop attempt
// (a horizontal band is trivial to crop out top/bottom; a diagonal repeat
// across the whole frame is not) without needing anything fancier than
// ffmpeg's `rotate` filter on a pre-rendered text tile (drawtext itself has no
// rotation option).
export const WATERMARK_ANGLE_DEG = -24;

// Size of the FLAT (pre-rotation) text tile the mark is drawn onto, and the
// font size used to draw it. Chosen so, once rotated and tiled (see GRID
// below) over a ~1000px-wide preview, each mark reads clearly at a glance
// without any single mark dominating the frame.
const WATERMARK_TILE_WIDTH = 380;
const WATERMARK_TILE_HEIGHT = 84;
const WATERMARK_FONT_SIZE = 24;

// Repeat grid, as FRACTIONS of the preview canvas (so it works at any output
// size ffmpeg's overlay filter reports via its own W/H, not a hardcoded pixel
// grid). 3 columns x 2 rows = 6 repeats: dense enough that no plausible crop
// of the frame removes every mark, sparse enough (with WATERMARK_OPACITY this
// low) that it doesn't read as a wall of text. Rows sit at 0.28/0.72 rather
// than straddling dead-center (0.5) — pets are usually framed close to
// center, and Gate 1 is a likeness-judging tool first.
const WATERMARK_GRID: { xFrac: number; yFrac: number }[] = [
  { xFrac: 0.18, yFrac: 0.28 },
  { xFrac: 0.5, yFrac: 0.28 },
  { xFrac: 0.82, yFrac: 0.28 },
  { xFrac: 0.18, yFrac: 0.72 },
  { xFrac: 0.5, yFrac: 0.72 },
  { xFrac: 0.82, yFrac: 0.72 },
];

// Same Latin-only display font the film's title cards already use
// (lib/film-pipeline.ts FONT_DISPLAY) — WATERMARK_TEXT is ASCII, and the font
// is already shipped to Trigger.dev via trigger.config.ts's additionalFiles.
const WATERMARK_FONT = path.join(process.cwd(), "public/fonts/BebasNeue-Regular.ttf");

/* -------------------------------------------------------------------- */
/* ffmpeg plumbing — small, self-contained copy of the pattern used in   */
/* lib/film-pipeline.ts (FFMPEG_PATH ?? ffmpeg-static, spawn + stderr).  */
/* Not imported from there: film-pipeline.ts imports FROM                */
/* stills-pipeline.ts (reshootCutStill) already, so the reverse import   */
/* would be a module cycle. The duplication is a handful of lines.       */
/* -------------------------------------------------------------------- */

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
 * Dual mode, same reasoning as film-pipeline.ts's fetchOrLocal: a remote fal
 * URL gets downloaded, a local file path is used as-is. This is what lets
 * scripts/test-watermark.ts drive the real ffmpeg pipeline against a
 * synthetic local fixture instead of a real generated take.
 */
async function fetchOrLocal(src: string, dest: string): Promise<string> {
  if (/^https?:\/\//.test(src)) {
    await download(src, dest);
    return dest;
  }
  return src;
}

/** ffmpeg drawtext escaping: backslash-escape \, : and ' (same as film-pipeline.ts esc()). */
function esc(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

/* -------------------------------------------------------------------- */
/* Tile build — done ONCE per process and shared across every take       */
/* (the mark's pixels never depend on the input take), memoized so 18    */
/* concurrent watermark calls don't each pay for it.                     */
/* -------------------------------------------------------------------- */

let tilePromise: Promise<string> | null = null;

/**
 * Render WATERMARK_TEXT onto a transparent tile, then rotate that tile onto a
 * larger transparent canvas sized to its own rotated bounding box (`rotw`/
 * `roth`) so nothing gets clipped. Two ffmpeg passes because drawtext has no
 * rotation option of its own — this is the standard workaround (render flat,
 * then rotate the rendered image).
 */
async function buildWatermarkTile(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "mt-watermark-"));
  const flat = path.join(dir, "flat.png");
  const tile = path.join(dir, "tile.png");
  const angleRad = (WATERMARK_ANGLE_DEG * Math.PI) / 180;

  await ffmpeg([
    "-f", "lavfi",
    "-i", `color=c=black@0.0:s=${WATERMARK_TILE_WIDTH}x${WATERMARK_TILE_HEIGHT}:d=1`,
    "-frames:v", "1",
    "-vf",
    // lavfi's `color` source ignores the `@alpha` suffix on its own — by the
    // time `format=rgba` runs the frame is already fully opaque, with no
    // alpha information left to convert (confirmed by probing raw rgba
    // bytes: corner alpha was 255, not 0). `colorchannelmixer=aa=0` forces
    // every pixel's alpha to 0 regardless of what came before, giving a
    // genuinely transparent base for drawtext to paint onto.
    `format=rgba,colorchannelmixer=aa=0,drawtext=fontfile='${esc(WATERMARK_FONT)}':text='${esc(WATERMARK_TEXT)}':fontcolor=white@${WATERMARK_OPACITY}:fontsize=${WATERMARK_FONT_SIZE}:x=(w-text_w)/2:y=(h-text_h)/2`,
    flat,
  ]);

  await ffmpeg([
    "-i", flat,
    "-frames:v", "1",
    "-vf",
    `format=rgba,rotate=angle=${angleRad}:fillcolor=black@0.0:ow=rotw(${angleRad}):oh=roth(${angleRad})`,
    tile,
  ]);

  return tile;
}

function getWatermarkTile(): Promise<string> {
  if (!tilePromise) {
    // On failure, clear the memo so a later call can retry from scratch
    // instead of every subsequent take being permanently stuck on one bad
    // attempt for the lifetime of the process.
    tilePromise = buildWatermarkTile().catch((e) => {
      tilePromise = null;
      throw e;
    });
  }
  return tilePromise;
}

/* -------------------------------------------------------------------- */
/* Per-take derivative                                                   */
/* -------------------------------------------------------------------- */

/**
 * The real transform: downscale `input` so its long edge is capped at
 * PREVIEW_MAX_LONG_EDGE, then stamp WATERMARK_GRID copies of the rotated mark
 * tile across it, writing the composite to `output`. Pure ffmpeg — no fal, no
 * network beyond what the caller already resolved `input` to a local path.
 *
 * The scale expression is a plain width cap (not the more general "cap
 * whichever edge is longer"): every Gate-1 take is generated at a fixed 16:9
 * aspect ratio (see stills-pipeline.ts generateTakeOnce's aspect_ratio param),
 * so width IS the long edge for every real input this ever runs against.
 */
async function renderWatermarkedDerivative(input: string, output: string): Promise<void> {
  const tile = await getWatermarkTile();

  const filters: string[] = [];
  filters.push(`[0:v]scale='min(iw,${PREVIEW_MAX_LONG_EDGE})':-2[base]`);
  filters.push(`[1:v]split=${WATERMARK_GRID.length}${WATERMARK_GRID.map((_, i) => `[t${i}]`).join("")}`);
  let prev = "base";
  WATERMARK_GRID.forEach((pos, i) => {
    const out = i === WATERMARK_GRID.length - 1 ? "out" : `s${i}`;
    // W/H (uppercase) = the running composite's own dimensions; w/h
    // (lowercase) = the overlay (tile) dimensions — both are ffmpeg overlay
    // filter built-ins, not values we compute ourselves.
    filters.push(`[${prev}][t${i}]overlay=x=${pos.xFrac}*W-w/2:y=${pos.yFrac}*H-h/2[${out}]`);
    prev = out;
  });

  await ffmpeg([
    "-i", input,
    "-i", tile,
    "-filter_complex", filters.join(";"),
    "-map", "[out]",
    "-frames:v", "1",
    output,
  ]);
}

/** Upload a local file to fal storage — same shape as film-pipeline.ts's uploadImage. */
async function defaultUpload(filePath: string, name: string): Promise<string> {
  const buf = await readFile(filePath);
  const file = new File([new Uint8Array(buf)], name, { type: "image/png" });
  return fal.storage.upload(file);
}

/** Injectable so tests can exercise the real ffmpeg pipeline without fal/network. */
export type UploadFn = (filePath: string, name: string) => Promise<string>;

/**
 * Public entry point used by lib/stills-pipeline.ts: turn one clean take URL
 * into a watermarked, downscaled preview URL suitable for Gate 1.
 *
 * NEVER THROWS. Any failure — download, ffmpeg, or upload — is caught, logged,
 * and falls back to returning `cleanUrl` UNCHANGED. 18 of these run
 * concurrently per order (stills-pipeline.ts), and one bad take must not cost
 * the customer their whole storyboard; see the file header for why this
 * fallback is an acceptable, narrow, logged exposure rather than a silent bug.
 *
 * `upload` defaults to fal.storage.upload but is injectable so
 * scripts/test-watermark.ts can prove the real watermark+downscale logic
 * (including the success path) with zero fal credentials and zero network —
 * it passes a fake upload that just returns the local output path.
 */
export async function watermarkTakeForPreview(
  cleanUrl: string,
  label: string,
  upload: UploadFn = defaultUpload
): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "mt-preview-"));
  try {
    const input = await fetchOrLocal(cleanUrl, path.join(dir, "clean.png"));
    const output = path.join(dir, "preview.png");
    await renderWatermarkedDerivative(input, output);
    return await upload(output, `${label.replace(/[^a-z0-9]+/gi, "-")}-preview.png`);
  } catch (e) {
    console.warn(`[watermark] ${label}: derivative failed, falling back to clean url unwatermarked`, e);
    return cleanUrl;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

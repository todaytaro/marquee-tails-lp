/**
 * Local functional test for the Gate-1 watermark/downscale derivative
 * (lib/watermark.ts — PRICING-PRODUCT-V2-SPEC.md §3.5(C)).
 *
 * NO database, NO fal.ai, NO Trigger.dev. A synthetic "2K take" is built
 * locally with ffmpeg (lavfi testsrc2, which has enough visual detail that a
 * downscale + watermark is actually visible on inspection, unlike a flat
 * color field), then fed into the REAL watermarkTakeForPreview() — the exact
 * function lib/stills-pipeline.ts calls for every one of the 18 takes per
 * order. fal.storage.upload is never invoked: watermarkTakeForPreview's
 * `upload` parameter is injectable specifically so this test can exercise the
 * real ffmpeg pipeline (download-or-local -> scale+tile -> would-be-upload)
 * without fal credentials or network access — see lib/watermark.ts's JSDoc.
 *
 * Asserts:
 *   1. success path: the derivative's long edge is capped at
 *      PREVIEW_MAX_LONG_EDGE, and it differs from the input (byte size).
 *   2. failure path: pointing the function at a nonexistent input makes
 *      ffmpeg fail, and the function falls back to returning the ORIGINAL
 *      clean url unchanged — AND never calls `upload` (proves the fallback
 *      fires before upload, not because upload itself failed).
 *
 * Also writes the successful derivative to SAMPLE_OUT so a human can look at
 * it directly (does the mark obscure detail? does it read as tiled/diagonal?
 * is PREVIEW_MAX_LONG_EDGE still legible?).
 *
 * Usage: npx tsx scripts/test-watermark.ts
 */
import { spawn } from "node:child_process";
import { mkdtemp, rm, stat, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import { watermarkTakeForPreview, PREVIEW_MAX_LONG_EDGE } from "../lib/watermark";

const FFMPEG_BIN = process.env.FFMPEG_PATH ?? (ffmpegPath as string);

// Written outside any tmp dir this script cleans up, so it survives the run
// for a human to open afterward.
const SAMPLE_OUT = path.join(
  "/private/tmp/claude-501/-Users-kyokyo-Downloads-pictoflow/705ade85-374f-436d-9a18-91cfbff69023/scratchpad",
  "watermark-sample.png"
);

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

/** No ffprobe dependency in this repo (same technique as scripts/test-assemble.ts's
 *  probeDurationSeconds) — parse ffmpeg's own stderr "Video: ... WxH" line. */
function probeDimensions(file: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG_BIN, ["-i", file], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("close", () => {
      const m = stderr.match(/Video:.*?(\d{2,5})x(\d{2,5})/);
      if (!m) return reject(new Error(`could not parse dimensions from ffmpeg output for ${file}:\n${stderr.slice(-500)}`));
      resolve({ width: parseInt(m[1], 10), height: parseInt(m[2], 10) });
    });
    proc.on("error", reject);
  });
}

/** A fake "2K take": 2048x1152 (16:9, matches the real aspect_ratio every
 *  Gate-1 take is generated at — see stills-pipeline.ts generateTakeOnce),
 *  testsrc2 rather than a flat color so the composite is visually meaningful
 *  when a human opens SAMPLE_OUT afterward. */
async function makeFake2KTake(dir: string): Promise<string> {
  const out = path.join(dir, "fake-clean-take.png");
  await ffmpeg(["-f", "lavfi", "-i", "testsrc2=s=2048x1152:d=1", "-frames:v", "1", out]);
  return out;
}

let failures = 0;
function assertTrue(label: string, ok: boolean) {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
  if (!ok) failures++;
}
function assertEqual(label: string, actual: unknown, expected: unknown) {
  const ok = actual === expected;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}: actual=${String(actual)} expected=${String(expected)}`);
  if (!ok) failures++;
}

async function main() {
  const dir = await mkdtemp(path.join(tmpdir(), "mt-watermark-test-"));

  try {
    /* ---------------------------------------------------------------- */
    /* 1. Success path — real ffmpeg watermark+downscale, no fal          */
    /* ---------------------------------------------------------------- */
    const clean = await makeFake2KTake(dir);
    const cleanDims = await probeDimensions(clean);
    const cleanStat = await stat(clean);
    console.log(`\nsynthetic clean take: ${clean} (${cleanDims.width}x${cleanDims.height}, ${cleanStat.size} bytes)`);

    const result = await watermarkTakeForPreview(clean, "test-take", async (filePath) => {
      // Stand-in for fal.storage.upload: copy the local derivative somewhere
      // that survives watermarkTakeForPreview's own tmp-dir cleanup, and
      // return that path AS the "url" — proves the function's control flow
      // (download-or-local -> ffmpeg -> upload -> return) end to end without
      // ever touching fal or the network.
      await copyFile(filePath, SAMPLE_OUT);
      return SAMPLE_OUT;
    });

    assertTrue("success path does NOT fall back to the clean url", result !== clean);
    assertEqual("success path returns the (fake-)uploaded path", result, SAMPLE_OUT);

    const outDims = await probeDimensions(SAMPLE_OUT);
    const outStat = await stat(SAMPLE_OUT);
    console.log(`derivative: ${SAMPLE_OUT} (${outDims.width}x${outDims.height}, ${outStat.size} bytes)`);

    assertTrue(
      `long edge capped at PREVIEW_MAX_LONG_EDGE=${PREVIEW_MAX_LONG_EDGE}px (actual ${outDims.width}x${outDims.height})`,
      Math.max(outDims.width, outDims.height) <= PREVIEW_MAX_LONG_EDGE
    );
    assertTrue(
      `derivative differs from input (${outStat.size} bytes vs ${cleanStat.size} bytes)`,
      outStat.size !== cleanStat.size
    );

    /* ---------------------------------------------------------------- */
    /* 2. Failure path — nonexistent input, must fall back, never upload  */
    /* ---------------------------------------------------------------- */
    const missing = path.join(dir, "does-not-exist.png");
    let uploadCalls = 0;
    const fallback = await watermarkTakeForPreview(missing, "test-fail", async (filePath) => {
      uploadCalls++;
      return filePath;
    });
    assertEqual("ffmpeg failure -> returns the clean url UNCHANGED", fallback, missing);
    assertEqual("ffmpeg failure -> upload is never invoked", uploadCalls, 0);

    console.log(`\nRESULT: ${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
    console.log(`sample derivative saved for manual inspection: ${SAMPLE_OUT}`);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }

  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

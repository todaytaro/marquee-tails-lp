/**
 * Local functional test for the beat-EDL assembler (TRAILER-EDIT-SPEC.md §8,
 * extended by FILM-QUALITY-V3-SPEC.md §7, extended again by
 * TRAILER-STORY-SPEC.md §6).
 * NO database, NO fal.ai, NO Trigger.dev — everything is synthesized locally
 * with ffmpeg (`lavfi` color/testsrc2 sources + a sine-wave "music" track) and
 * fed straight into the REAL production render path (assembleForTest ->
 * assembleToFiles, the exact function runFilmGeneration/runShotRerender call).
 *
 * Asserts:
 *   1. master (16:9) duration is 60.0s ±1 frame
 *   2. social (9:16) duration is 60.0s ±1 frame
 *   3. beat count matches buildEdl() for the with-inserts/without-inserts x
 *      six-card/legacy-four-card EDLs (4 combinations)
 *   4. removing the insert inputs still yields exactly 60.0s (graceful
 *      degradation, spec §4.3/§4.4)
 *   5. running once with the SFX files absent still assembles cleanly
 *      (graceful degradation, spec §2.1) — the real public/sfx/*.wav files
 *      are temporarily renamed out of the way and restored afterward, even
 *      on failure
 *   6. (FILM-QUALITY-V3 §7 item 4) the punch-in filter string carries the
 *      upward y-bias + lanczos scaling, and the grade filter chain contains
 *      no centre-crop matte (crop=/pad=)
 *   7. (FILM-QUALITY-V3 §7 item 5) master/social file sizes are printed AND
 *      asserted larger than the pre-CRF-fix baseline captured from the same
 *      fixtures against the OLD (unset-CRF, preset veryfast) encode settings
 *      — evidence the CRF change actually raised delivered quality/bitrate
 *   8. (TRAILER-STORY-SPEC §6 item 1) a SIX-card EDL (premise+stinger present)
 *      assembles to exactly 60.0000s master AND social
 *   9. (TRAILER-STORY-SPEC §6 item 2 — THE backward-compat assertion) a
 *      FOUR-card/legacy EDL (premise/stinger absent, simulating an order
 *      whose generatedScript predates this feature) ALSO assembles to
 *      exactly 60.0000s master AND social
 *  10. (TRAILER-STORY-SPEC §6 item 5) card order: `premise` is the first
 *      card, `stinger` immediately follows `finale`, and `open`/`comingSoon`
 *      never appear in the six-card EDL (and vice versa for the legacy EDL)
 *  11. (TRAILER-STORY-SPEC §6 item 6) {name} substitution reaches `premise`
 *      and `stinger`, both via the preset path (getLoglines) and the custom/
 *      Director's Cut path (resolveWorld's fill() on a WorldBundle)
 *
 * Usage: npx tsx scripts/test-assemble.ts
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, rm, rename, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import {
  buildEdl,
  assembleForTest,
  punchInFilter,
  gradeFilterChain,
  PUNCH_IN_ZOOM,
  PUNCH_IN_Y_BIAS,
  FILM_FPS,
} from "../lib/film-pipeline";
import { getLoglines, resolveWorld, PERSONALITIES, type Loglines } from "../lib/film-script";

const FFMPEG_BIN = process.env.FFMPEG_PATH ?? (ffmpegPath as string);
const TRAILER_SECONDS = 60.0;
// Master/social are encoded at FILM_FPS (lib/film-pipeline.ts normaliseClip/
// titleCard/renderClipBeat/renderInsertBeat all share this one constant, spec
// §2.2(d)) — "±1 frame" per spec §8 means ±1/FILM_FPS at that output rate.
// FILM_FPS (30) not coincidentally matches the EDL's own FRAME_UNIT_SECONDS
// (1/30s, see buildEdl) now — every beat's authored length is already an
// exact whole number of output frames, so the fps switch from 24 TIGHTENED
// this tolerance rather than requiring it to be loosened.
const FRAME_TOLERANCE_SECONDS = 1 / FILM_FPS;

// Baseline byte sizes captured from THIS EXACT fixture set (6 solid-color
// clips + 3 solid-color inserts + sine-wave music, see makeFakeClip/
// makeFakeInsert/makeFakeMusic below) run through the pre-FILM-QUALITY-V3
// code (no -crf, "-preset veryfast" everywhere, MATTE_ASPECT=2.35 on the
// master). Captured once, before the CRF/matte changes landed, specifically
// so this test could show the encode-quality fix actually raised bitrate
// (spec §7 item 5) instead of asserting against a made-up number.
const PRE_CRF_BASELINE_MASTER_BYTES = 1_645_959;
const PRE_CRF_BASELINE_SOCIAL_BYTES = 1_737_147;

function ffmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG_BIN, ["-y", ...args], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-800)}`))));
    proc.on("error", reject);
  });
}

/** No ffprobe dependency in this repo — parse ffmpeg's own stderr "Duration:"
 * line instead (ffmpeg run with no output just probes and exits non-zero,
 * which is fine — we only read stderr). */
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

let failures = 0;
function assertClose(label: string, actual: number, expected: number, tolerance: number) {
  const diff = Math.abs(actual - expected);
  const ok = diff <= tolerance;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}: actual=${actual.toFixed(4)}s expected=${expected.toFixed(4)}s diff=${diff.toFixed(4)}s tolerance=${tolerance.toFixed(4)}s`);
  if (!ok) failures++;
}
function assertEqual(label: string, actual: unknown, expected: unknown) {
  const ok = actual === expected;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}: actual=${String(actual)} expected=${String(expected)}`);
  if (!ok) failures++;
}
function assertTrue(label: string, ok: boolean) {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
  if (!ok) failures++;
}

const CLIP_COLORS = ["0xd94f4f", "0xd98b4f", "0xd9c94f", "0x6fd94f", "0x4fa8d9", "0x8a4fd9"];
const INSERT_COLORS = ["0x2b2b3d", "0x3d2b2b", "0x2b3d2f"];

/** One fake SHOT_SECONDS(5)-long source "clip" — a solid color field with a
 * big index label, so which source clip landed in which output beat is
 * visually obvious on playback (distinct colors per clip, per spec §8). */
async function makeFakeClip(dir: string, index: number): Promise<string> {
  const out = path.join(dir, `fake-clip-${index}.mp4`);
  await ffmpeg([
    "-f", "lavfi", "-i", `color=c=${CLIP_COLORS[index % CLIP_COLORS.length]}:s=1920x1080:d=5:r=24`,
    "-vf", `drawtext=text='CLIP ${index}':fontcolor=white:fontsize=200:x=(w-text_w)/2:y=(h-text_h)/2`,
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast",
    out,
  ]);
  return out;
}

/** One fake no-pet insert still (a solid color field). */
async function makeFakeInsert(dir: string, index: number): Promise<string> {
  const out = path.join(dir, `fake-insert-${index}.png`);
  await ffmpeg([
    "-f", "lavfi", "-i", `color=c=${INSERT_COLORS[index % INSERT_COLORS.length]}:s=1920x1080`,
    "-vf", `drawtext=text='INSERT ${index}':fontcolor=white:fontsize=140:x=(w-text_w)/2:y=(h-text_h)/2`,
    "-frames:v", "1",
    out,
  ]);
  return out;
}

/** 60s sine-wave "music" track. */
async function makeFakeMusic(dir: string): Promise<string> {
  const out = path.join(dir, "fake-music.wav");
  await ffmpeg(["-f", "lavfi", "-i", `sine=frequency=440:duration=${TRAILER_SECONDS}`, out]);
  return out;
}

// Six-card fixture — premise + stinger both present, so assembleForTest picks
// EDL_TEMPLATE (the current six-card cut, TRAILER-STORY-SPEC.md §1.3).
const LOGLINES_WITH_STORY: Required<Loglines> = {
  premise: "THE TEST SUITE CRIED OUT FOR PROOF.",
  intro: "THE TEST SUITE CRIED OUT FOR A HERO.",
  turn: "IT NEVER EXPECTED THIS FIXTURE.",
  rise: "COVERAGE NEVER ASKED YOUR SIZE.",
  tagline: "TO THE CI AND BACK",
  stinger: "THE FIXTURE STILL WON'T CLEAN UP AFTER ITSELF.",
};

// Legacy fixture — premise/stinger BOTH absent, simulating an order whose
// generatedScript predates this feature (or a preset order run through code
// from before this change). assembleForTest must pick EDL_TEMPLATE_LEGACY
// (today's four-card cut) and still land on exactly 60.0s — this is the
// backward-compat assertion the spec calls out as mandatory (§6 item 2).
const LOGLINES_LEGACY: Loglines = {
  intro: "THE TEST SUITE CRIED OUT FOR A HERO.",
  turn: "IT NEVER EXPECTED THIS FIXTURE.",
  rise: "COVERAGE NEVER ASKED YOUR SIZE.",
  tagline: "TO THE CI AND BACK",
};

const SFX_DIR = path.join(process.cwd(), "public/sfx");
const SFX_FILES = ["boom.wav", "riser.wav", "whoosh.wav"];

/**
 * Restore any *.testhidden left behind by a previous run that died before its
 * finally block could run (a killed process, a Ctrl-C). Without this the repo
 * is left with the committed SFX files apparently DELETED — and committing
 * that state would silently ship a production trailer with no SFX bed, which
 * is exactly the regression this suite exists to catch. Runs before anything
 * else, and is safe when there is nothing to restore.
 */
async function restoreStrandedSfx(): Promise<void> {
  for (const f of SFX_FILES) {
    const hidden = path.join(SFX_DIR, `${f}.testhidden`);
    const real = path.join(SFX_DIR, f);
    if (existsSync(hidden) && !existsSync(real)) {
      await rename(hidden, real);
      console.log(`recovered ${f} from a previous interrupted run`);
    }
  }
}

/** Temporarily rename the real public/sfx/*.wav files out of the way (if
 * present) so we can exercise the "SFX absent" fallback for real, then
 * restore them — even if the test throws. */
async function withSfxHidden<T>(fn: () => Promise<T>): Promise<T> {
  const present = SFX_FILES.filter((f) => existsSync(path.join(SFX_DIR, f)));
  await Promise.all(present.map((f) => rename(path.join(SFX_DIR, f), path.join(SFX_DIR, `${f}.testhidden`))));
  try {
    return await fn();
  } finally {
    await Promise.all(present.map((f) => rename(path.join(SFX_DIR, `${f}.testhidden`), path.join(SFX_DIR, f))));
  }
}

async function main() {
  await restoreStrandedSfx();
  const dir = await mkdtemp(path.join(tmpdir(), "mt-test-assemble-"));
  console.log(`scratch dir: ${dir}`);
  try {
    console.log("\n=== synthesizing fixtures ===");
    const clips = await Promise.all(Array.from({ length: 6 }, (_, i) => makeFakeClip(dir, i)));
    const inserts = await Promise.all(Array.from({ length: 3 }, (_, i) => makeFakeInsert(dir, i)));
    const music = await makeFakeMusic(dir);
    console.log(`6 clips + 3 inserts + 1 music track ready`);

    console.log("\n=== EDL beat counts (spec §1.2/§1.3, TRAILER-STORY-SPEC §1.3) ===");
    // Four combinations: {six-card, legacy-four-card} x {with-inserts, without}.
    // Card COUNT is identical across six-card vs. legacy (8 cards either way —
    // premise+stinger replace open+comingSoon one-for-one, see EDL_TEMPLATE's
    // doc comment) so all four combinations keep the SAME beat counts as
    // before this feature landed — only which CardIds appear changes (checked
    // separately below, in the card-order section).
    const edlStoryWithInserts = buildEdl(true, true);
    const edlStoryNoInserts = buildEdl(false, true);
    const edlLegacyWithInserts = buildEdl(true, false);
    const edlLegacyNoInserts = buildEdl(false, false);
    assertEqual("six-card with-inserts beat count", edlStoryWithInserts.length, 23);
    assertEqual("six-card without-inserts beat count", edlStoryNoInserts.length, 20);
    assertEqual("legacy with-inserts beat count", edlLegacyWithInserts.length, 23);
    assertEqual("legacy without-inserts beat count", edlLegacyNoInserts.length, 20);
    assertEqual("six-card with-inserts insert-beat count", edlStoryWithInserts.filter((b) => b.kind === "insert").length, 3);
    assertEqual("six-card without-inserts insert-beat count", edlStoryNoInserts.filter((b) => b.kind === "insert").length, 0);
    const sumSeconds = (beats: typeof edlStoryWithInserts) => beats.reduce((s, b) => s + b.frames / 30, 0);
    assertClose("six-card with-inserts EDL sum", sumSeconds(edlStoryWithInserts), TRAILER_SECONDS, 1 / 30);
    assertClose("six-card without-inserts EDL sum", sumSeconds(edlStoryNoInserts), TRAILER_SECONDS, 1 / 30);
    assertClose("legacy with-inserts EDL sum", sumSeconds(edlLegacyWithInserts), TRAILER_SECONDS, 1 / 30);
    assertClose("legacy without-inserts EDL sum", sumSeconds(edlLegacyNoInserts), TRAILER_SECONDS, 1 / 30);

    console.log("\n=== card ORDER (TRAILER-STORY-SPEC §1.3, §6 item 5) ===");
    const storyCards = edlStoryWithInserts.filter((b) => b.kind === "card").map((b) => (b as { card: string }).card);
    const legacyCards = edlLegacyWithInserts.filter((b) => b.kind === "card").map((b) => (b as { card: string }).card);
    console.log(`six-card order:  ${storyCards.join(" -> ")}`);
    console.log(`legacy order:    ${legacyCards.join(" -> ")}`);
    assertEqual("six-card EDL: premise is the FIRST card", storyCards[0], "premise");
    assertEqual(
      "six-card EDL: stinger immediately follows finale",
      storyCards[storyCards.indexOf("finale") + 1],
      "stinger"
    );
    assertEqual("six-card EDL: brand is the LAST card", storyCards[storyCards.length - 1], "brand");
    assertTrue("six-card EDL never contains open/comingSoon", !storyCards.includes("open") && !storyCards.includes("comingSoon"));
    assertEqual("legacy EDL: open is the FIRST card", legacyCards[0], "open");
    assertEqual(
      "legacy EDL: comingSoon immediately follows finale",
      legacyCards[legacyCards.indexOf("finale") + 1],
      "comingSoon"
    );
    assertEqual("legacy EDL: brand is the LAST card", legacyCards[legacyCards.length - 1], "brand");
    assertTrue("legacy EDL never contains premise/stinger", !legacyCards.includes("premise") && !legacyCards.includes("stinger"));

    console.log("\n=== {name} substitution in premise/stinger (TRAILER-STORY-SPEC §6 item 6) ===");
    // Preset path: getLoglines fills ALL 12 static sets, including the two new
    // fields (film-script.ts's getLoglines).
    const presetFilled = getLoglines("noir", "brave", "Rex");
    assertTrue("preset stinger substitutes {name}", presetFilled.stinger === "REX STILL CAN'T REACH THE DOORKNOB.");
    assertTrue("preset premise has no leftover {name} token", !presetFilled.premise.includes("{name}"));
    // Custom/Director's Cut path: resolveWorld's fill() must reach premise AND
    // stinger on a WorldBundle, same as it already does for intro/turn/rise/tagline.
    const fakeCustomOrder = {
      id: "test-name-substitution",
      tier: "custom",
      petName: "Rex",
      generatedScript: {
        costume: "x",
        score: "x",
        cuts: Array.from({ length: 6 }, () => ({ scene: "x" })),
        loglines: {
          premise: "SOMETHING IS MISSING: {name}.",
          intro: "i",
          turn: "t",
          rise: "r",
          tagline: "tag",
          stinger: "{name} STILL CAN'T REACH THE DOORKNOB.",
        },
      },
    } as unknown as Parameters<typeof resolveWorld>[0];
    const customResolved = resolveWorld(fakeCustomOrder);
    assertEqual("custom-order premise substitutes {name}", customResolved.loglines.premise, "SOMETHING IS MISSING: REX.");
    assertEqual("custom-order stinger substitutes {name}", customResolved.loglines.stinger, "REX STILL CAN'T REACH THE DOORKNOB.");

    console.log("\n=== all 12 preset logline sets, full arc (TRAILER-STORY-SPEC §6 preset review) ===");
    for (const world of ["deepspace", "storybook", "noir"] as const) {
      for (const personality of PERSONALITIES) {
        const l = getLoglines(world, personality, "Rex");
        console.log(`\n--- ${world} / ${personality} ---`);
        console.log(`premise: ${l.premise}`);
        console.log(`intro:   ${l.intro}`);
        console.log(`turn:    ${l.turn}`);
        console.log(`rise:    ${l.rise}`);
        console.log(`tagline: ${l.tagline}`);
        console.log(`stinger: ${l.stinger}`);
      }
    }

    console.log("\n=== full assemble, SIX-CARD EDL (clips + inserts + SFX present, TRAILER-STORY-SPEC §6 item 1) ===");
    const runDir1 = path.join(dir, "run1");
    const { masterPath, socialPath } = await assembleForTest(
      await ensureDir(runDir1),
      "Test Pet",
      clips,
      inserts,
      music,
      LOGLINES_WITH_STORY
    );
    const masterDur = await probeDurationSeconds(masterPath);
    const socialDur = await probeDurationSeconds(socialPath);
    assertClose("master (16:9) duration", masterDur, TRAILER_SECONDS, FRAME_TOLERANCE_SECONDS);
    assertClose("social (9:16) duration", socialDur, TRAILER_SECONDS, FRAME_TOLERANCE_SECONDS);

    console.log("\n=== encode-quality assertions (FILM-QUALITY-V3-SPEC.md §7 item 4/5) ===");
    // Item 4: punch-in filter carries the upward y-bias + lanczos, and no
    // centre-crop matte survives in the shared grade chain. Asserted against
    // the ACTUAL functions the render path calls (punchInFilter/
    // gradeFilterChain), not a re-derivation of the expected string.
    const punchFilter = punchInFilter(PUNCH_IN_ZOOM);
    assertTrue(
      "punch-in filter biases the crop y-offset toward the bottom (not centred)",
      punchFilter.includes(`(ih-oh)*${PUNCH_IN_Y_BIAS}`)
    );
    assertTrue("punch-in filter is NOT a centre crop (no (ih-oh)/2 term)", !punchFilter.includes("(ih-oh)/2"));
    assertTrue("punch-in filter upscales with lanczos", punchFilter.includes("flags=lanczos"));
    const noPunchFilter = punchInFilter(1);
    assertTrue("no-punch-in (wide) beat has no crop term at all", !noPunchFilter.includes("crop="));
    const grade = gradeFilterChain();
    assertTrue(
      "grade filter chain has no centre-crop matte (no crop=/pad= terms)",
      !grade.includes("crop=") && !grade.includes("pad=")
    );

    // Item 5: master/social must be larger than the pre-CRF-fix baseline
    // captured from the identical fixtures (see PRE_CRF_BASELINE_* above) —
    // direct evidence the explicit CRF (was implicit ~23, now 14/17) raised
    // delivered bitrate rather than a duration-only check that can't see it.
    const masterBytes = (await stat(masterPath)).size;
    const socialBytes = (await stat(socialPath)).size;
    console.log(
      `master.mp4: ${masterBytes} bytes (was ${PRE_CRF_BASELINE_MASTER_BYTES} bytes pre-CRF-fix, ${(
        (masterBytes / PRE_CRF_BASELINE_MASTER_BYTES - 1) *
        100
      ).toFixed(1)}% change)`
    );
    console.log(
      `social.mp4: ${socialBytes} bytes (was ${PRE_CRF_BASELINE_SOCIAL_BYTES} bytes pre-CRF-fix, ${(
        (socialBytes / PRE_CRF_BASELINE_SOCIAL_BYTES - 1) *
        100
      ).toFixed(1)}% change)`
    );
    assertTrue("master.mp4 is larger than the pre-CRF-fix baseline", masterBytes > PRE_CRF_BASELINE_MASTER_BYTES);
    assertTrue("social.mp4 is larger than the pre-CRF-fix baseline", socialBytes > PRE_CRF_BASELINE_SOCIAL_BYTES);

    console.log("\n=== assemble WITHOUT inserts (graceful degradation, spec §4.3/§4.4) ===");
    const runDir2 = path.join(dir, "run2");
    const noInserts = await assembleForTest(await ensureDir(runDir2), "Test Pet", clips, [], music, LOGLINES_WITH_STORY);
    const masterDurNoInserts = await probeDurationSeconds(noInserts.masterPath);
    assertClose("master duration with NO inserts", masterDurNoInserts, TRAILER_SECONDS, FRAME_TOLERANCE_SECONDS);

    console.log("\n=== assemble WITH SFX files temporarily absent (spec §2.1) ===");
    const runDir3 = path.join(dir, "run3");
    await withSfxHidden(async () => {
      const noSfx = await assembleForTest(await ensureDir(runDir3), "Test Pet", clips, inserts, music, LOGLINES_WITH_STORY);
      const masterDurNoSfx = await probeDurationSeconds(noSfx.masterPath);
      assertClose("master duration with SFX absent", masterDurNoSfx, TRAILER_SECONDS, FRAME_TOLERANCE_SECONDS);
      assertTrue("assembly with SFX absent completed without throwing", true);
    });

    console.log(
      "\n=== full assemble, LEGACY FOUR-CARD EDL (premise/stinger absent — THE backward-compat assertion, TRAILER-STORY-SPEC §6 item 2) ==="
    );
    // This is the mandatory regression guard (spec §1.2): an order whose
    // generatedScript predates premise/stinger — including the owner's live
    // test order — must assemble with today's four-card EDL and STILL land on
    // exactly 60.0s. LOGLINES_LEGACY carries no premise/stinger, so
    // assembleToFiles's hasStoryCards check picks EDL_TEMPLATE_LEGACY.
    const runDir4 = path.join(dir, "run4");
    const legacyRun = await assembleForTest(
      await ensureDir(runDir4),
      "Test Pet",
      clips,
      inserts,
      music,
      LOGLINES_LEGACY
    );
    const masterDurLegacy = await probeDurationSeconds(legacyRun.masterPath);
    const socialDurLegacy = await probeDurationSeconds(legacyRun.socialPath);
    assertClose("LEGACY master (16:9) duration", masterDurLegacy, TRAILER_SECONDS, FRAME_TOLERANCE_SECONDS);
    assertClose("LEGACY social (9:16) duration", socialDurLegacy, TRAILER_SECONDS, FRAME_TOLERANCE_SECONDS);

    console.log(`\n=== ${failures === 0 ? "ALL ASSERTIONS PASSED" : `${failures} ASSERTION(S) FAILED`} ===`);
    process.exit(failures === 0 ? 0 : 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** mkdir -p helper — used so each of the 4 assemble runs above gets its own
 * subdirectory (assembleToFiles writes many intermediate files into `dir`
 * and doesn't namespace them itself). */
async function ensureDir(dir: string): Promise<string> {
  await mkdir(dir, { recursive: true });
  return dir;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

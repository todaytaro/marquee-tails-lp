/**
 * Local functional test for the beat-EDL assembler (TRAILER-EDIT-SPEC.md §8,
 * extended by FILM-QUALITY-V3-SPEC.md §7, extended again by
 * TRAILER-STORY-SPEC.md §6, extended again by this task's punch-in/insert-clip/
 * SHOT_SECONDS=8 change).
 * NO database, NO fal.ai, NO Trigger.dev — everything is synthesized locally
 * with ffmpeg (`lavfi` color/testsrc2 sources + a sine-wave "music" track) and
 * fed straight into the REAL production render path (assembleForTest ->
 * assembleToFiles, the exact function runFilmGeneration/runShotRerender call).
 *
 * Asserts:
 *   1. master (16:9) duration is 60.0s ±1 frame
 *      (there is no 9:16 social cut any more — see assembleToFiles)
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
 *   7. (FILM-QUALITY-V3 §7 item 5) the master file size is printed AND
 *      asserted larger than the pre-CRF-fix baseline captured from the same
 *      fixtures against the OLD (unset-CRF, preset veryfast) encode settings
 *      — evidence the CRF change actually raised delivered quality/bitrate
 *   8. (TRAILER-STORY-SPEC §6 item 1) a SIX-card EDL (premise+stinger present)
 *      assembles to exactly 60.0000s
 *   9. (TRAILER-STORY-SPEC §6 item 2 — THE backward-compat assertion) a
 *      FOUR-card/legacy EDL (premise/stinger absent, simulating an order
 *      whose generatedScript predates this feature) ALSO assembles to
 *      exactly 60.0000s
 *  10. (TRAILER-STORY-SPEC §6 item 5) card order: `premise` is the first
 *      card, `stinger` immediately follows `finale`, and `open`/`comingSoon`
 *      never appear in the six-card EDL (and vice versa for the legacy EDL)
 *  11. (TRAILER-STORY-SPEC §6 item 6) {name} substitution reaches `premise`
 *      and `stinger`, both via the preset path (getLoglines) and the custom/
 *      Director's Cut path (resolveWorld's fill() on a WorldBundle)
 *  12. (this task, change #1) a clip's wide beat and its punch-in beat trim
 *      from DIFFERENT source offsets — asserted against punchInSourceWindow
 *      directly AND printed, then verified against the REAL rendered
 *      intermediate segment durations from a live assemble run
 *  13. (this task, change #1) a slow-motion punch-in beat's RENDERED segment
 *      still lands on its exact EDL on-screen duration (±1 frame) despite
 *      consuming only PUNCH_IN_SPEED as much source footage
 *  14. (this task, change #2) a full 60.0000s run with REAL insert CLIPS
 *      present (not just Ken-Burns stills), and a mixed run where only SOME
 *      inserts have a clip (the rest fall back to Ken Burns) also lands on
 *      exactly 60.0000s
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
  punchInSourceWindow,
  gradeFilterChain,
  PUNCH_IN_ZOOM,
  PUNCH_IN_Y_BIAS,
  PUNCH_IN_SPEED,
  SHOT_SECONDS,
  INSERT_CLIP_SECONDS,
  FILM_FPS,
} from "../lib/film-pipeline";
import { getLoglines, resolveWorld, PERSONALITIES, type Loglines } from "../lib/film-script";

const FFMPEG_BIN = process.env.FFMPEG_PATH ?? (ffmpegPath as string);
const TRAILER_SECONDS = 60.0;
// The master is encoded at FILM_FPS (lib/film-pipeline.ts normaliseClip/
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
const INSERT_CLIP_COLORS = ["0x6b2b8a", "0x8a6b2b", "0x2b8a6b"];

/** One fake SHOT_SECONDS(8)-long source "clip" — a solid color field with a
 * big index label, so which source clip landed in which output beat is
 * visually obvious on playback (distinct colors per clip, per spec §8).
 * Length is SHOT_SECONDS itself (this task's change #3, fixtures at the new
 * source length) — every offset/clamping assertion below only means anything
 * if the fixtures are exactly as long as a real Kling clip would be. */
async function makeFakeClip(dir: string, index: number): Promise<string> {
  const out = path.join(dir, `fake-clip-${index}.mp4`);
  await ffmpeg([
    "-f", "lavfi", "-i", `color=c=${CLIP_COLORS[index % CLIP_COLORS.length]}:s=1920x1080:d=${SHOT_SECONDS}:r=24`,
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

/**
 * One fake "insert CLIP" (this task's change #2) — a short animated Kling
 * i2v result never actually happens here (no fal), but a real Kling insert
 * clip IS exactly INSERT_CLIP_SECONDS long, so that's what this fixture
 * synthesizes: a solid color field (a different color family than the still
 * fixtures, so the two are visually distinguishable) at INSERT_CLIP_SECONDS.
 */
async function makeFakeInsertClip(dir: string, index: number): Promise<string> {
  const out = path.join(dir, `fake-insert-clip-${index}.mp4`);
  await ffmpeg([
    "-f", "lavfi", "-i", `color=c=${INSERT_CLIP_COLORS[index % INSERT_CLIP_COLORS.length]}:s=1920x1080:d=${INSERT_CLIP_SECONDS}:r=24`,
    "-vf", `drawtext=text='INSERT CLIP ${index}':fontcolor=white:fontsize=140:x=(w-text_w)/2:y=(h-text_h)/2`,
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast",
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
    const insertClips = await Promise.all(Array.from({ length: 3 }, (_, i) => makeFakeInsertClip(dir, i)));
    const music = await makeFakeMusic(dir);
    console.log(`6 clips (${SHOT_SECONDS}s each) + 3 insert stills + 3 insert clips (${INSERT_CLIP_SECONDS}s each) + 1 music track ready`);

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

    console.log("\n=== punch-in 'different moment' arithmetic (this task, change #1) ===");
    // The exact concern the owner flagged: a clip's wide beat and its
    // punch-in beat used to trim the SAME [0, seconds] source window — same
    // footage, tighter crop. punchInSourceWindow is the pure function
    // renderClipBeat calls to decide that window; called directly here (with
    // clip 0's own EDL beat lengths and the fixture's real SHOT_SECONDS
    // source length) so the "different moment" claim is visible in this
    // output, not just asserted against a hidden internal value.
    const clip0WideBeat = edlStoryWithInserts.find((b) => b.kind === "clip" && b.clip === 0 && b.punchIn === 1) as
      | { clip: number; punchIn: number; frames: number }
      | undefined;
    const clip0PunchInBeat = edlStoryWithInserts.find((b) => b.kind === "clip" && b.clip === 0 && b.punchIn > 1) as
      | { clip: number; punchIn: number; frames: number }
      | undefined;
    if (!clip0WideBeat || !clip0PunchInBeat) throw new Error("expected clip 0 to have both a wide and a punch-in beat");
    const clip0WideOnScreen = clip0WideBeat.frames / 30;
    const clip0PunchInOnScreen = clip0PunchInBeat.frames / 30;
    const wideWindow = punchInSourceWindow(SHOT_SECONDS, clip0WideOnScreen, clip0WideBeat.punchIn);
    const punchInWindow = punchInSourceWindow(SHOT_SECONDS, clip0PunchInOnScreen, clip0PunchInBeat.punchIn);
    console.log(
      `clip 0 source is ${SHOT_SECONDS}s long:\n` +
        `  wide beat:      on-screen=${clip0WideOnScreen.toFixed(2)}s @1x -> source [${wideWindow.startSeconds.toFixed(2)}s .. ${(wideWindow.startSeconds + wideWindow.sourceSeconds).toFixed(2)}s]\n` +
        `  punch-in beat:  on-screen=${clip0PunchInOnScreen.toFixed(2)}s @${PUNCH_IN_SPEED}x -> source [${punchInWindow.startSeconds.toFixed(2)}s .. ${(punchInWindow.startSeconds + punchInWindow.sourceSeconds).toFixed(2)}s]`
    );
    assertTrue("wide beat trims from the OPENING seconds of the source (offset 0)", wideWindow.startSeconds === 0);
    assertTrue(
      "punch-in beat trims from a LATER source offset than the wide beat (a different moment, not a re-crop)",
      punchInWindow.startSeconds > wideWindow.startSeconds
    );
    // Source consumed is on-screen × PUNCH_IN_SPEED rounded UP to a whole
    // frame: an odd on-screen frame count asks for half a source frame at
    // 0.5x, which no trim can return, so the window takes the extra frame and
    // renderClipBeat's -frames:v trims back. Tolerance is exactly one frame —
    // wide enough for that rounding, still tight enough that a wrong speed
    // factor (2x instead of 0.5x, say) fails loudly.
    assertClose(
      "punch-in beat's slow-motion arithmetic: source consumed = on-screen × PUNCH_IN_SPEED (+≤1 frame)",
      punchInWindow.sourceSeconds,
      clip0PunchInOnScreen * PUNCH_IN_SPEED + 0.5 / FILM_FPS,
      0.5 / FILM_FPS + 1e-9
    );
    assertClose(
      "wide beat consumes its full on-screen length of source (no slow motion, speed 1)",
      wideWindow.sourceSeconds,
      clip0WideOnScreen,
      1e-9
    );

    console.log("\n=== {name} substitution in premise/stinger (TRAILER-STORY-SPEC §6 item 6) ===");
    // Preset path: getLoglines fills ALL 12 static sets, including the two new
    // fields (film-script.ts's getLoglines).
    // noir/TIMID, not noir/brave. What is under test is that getLoglines
    // substitutes {name} in the two NEW logline fields for a preset order —
    // so the fixture has to be a set whose stinger actually contains the
    // token. The v3 rewrite (TRAILER-STORY-V3-SPEC.md §3) left only 4 of the
    // 12 stingers using {name} at all: the old set opened eleven of twelve
    // with "{name} STILL ...", which read as one joke in twelve costumes, and
    // the replacements deliberately vary their shape instead. Moving the
    // fixture keeps the assertion exactly as strong; pinning it to whichever
    // set happens to be first is what made it brittle.
    const presetFilled = getLoglines("noir", "timid", "Rex");
    assertTrue("preset stinger substitutes {name}", presetFilled.stinger === "THE WATER LOST. REX STILL AVOIDS THE BATHTUB.");
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
    // No insert CLIPS on this run (insertClipPaths=[]) — the existing
    // still-only (Ken Burns) insert path, unchanged by this task's change #2.
    // Real insert-clip fixtures are exercised separately below.
    const { masterPath } = await assembleForTest(
      await ensureDir(runDir1),
      "Test Pet",
      clips,
      inserts,
      [],
      music,
      LOGLINES_WITH_STORY
    );
    const masterDur = await probeDurationSeconds(masterPath);
    assertClose("master (16:9) duration", masterDur, TRAILER_SECONDS, FRAME_TOLERANCE_SECONDS);

    console.log("\n=== slow-motion punch-in: RENDERED segment still fills its exact on-screen duration (this task, change #1) ===");
    // assembleToFiles writes one "wide-NN.mp4" intermediate per EDL beat into
    // its working dir before concatenating them (runDir1, still on disk —
    // assembleForTest doesn't clean up, only the whole-script scratch dir does,
    // at the very end). Locating clip 0's punch-in beat's OWN rendered segment
    // and probing its actual duration verifies the setpts/-r arithmetic
    // (renderClipBeat) really did stretch HALF the source back out to the
    // beat's full on-screen length in a REAL ffmpeg run — not just in the
    // pure punchInSourceWindow calculation asserted above.
    const clip0PunchInIndex = edlStoryWithInserts.findIndex((b) => b.kind === "clip" && b.clip === 0 && b.punchIn > 1);
    const clip0WideIndex = edlStoryWithInserts.findIndex((b) => b.kind === "clip" && b.clip === 0 && b.punchIn === 1);
    if (clip0PunchInIndex < 0 || clip0WideIndex < 0) throw new Error("expected to locate clip 0's wide + punch-in beats in the EDL");
    const punchInSegmentPath = path.join(runDir1, `wide-${String(clip0PunchInIndex).padStart(2, "0")}.mp4`);
    const wideSegmentPath = path.join(runDir1, `wide-${String(clip0WideIndex).padStart(2, "0")}.mp4`);
    const punchInSegmentDur = await probeDurationSeconds(punchInSegmentPath);
    const wideSegmentDur = await probeDurationSeconds(wideSegmentPath);
    console.log(
      `clip 0 rendered segments: wide=${wideSegmentDur.toFixed(3)}s (expected ${clip0WideOnScreen.toFixed(3)}s), ` +
        `punch-in=${punchInSegmentDur.toFixed(3)}s (expected ${clip0PunchInOnScreen.toFixed(3)}s, slowed ${PUNCH_IN_SPEED}x from ${(clip0PunchInOnScreen * PUNCH_IN_SPEED).toFixed(3)}s of source)`
    );
    assertClose("slow-motion punch-in beat's RENDERED duration matches its EDL on-screen length", punchInSegmentDur, clip0PunchInOnScreen, FRAME_TOLERANCE_SECONDS);
    assertClose("wide beat's RENDERED duration matches its EDL on-screen length", wideSegmentDur, clip0WideOnScreen, FRAME_TOLERANCE_SECONDS);

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

    // Item 5: the master must be larger than the pre-CRF-fix baseline
    // captured from the identical fixtures (see PRE_CRF_BASELINE_* above) —
    // direct evidence the explicit CRF (was implicit ~23, now 14/17) raised
    // delivered bitrate rather than a duration-only check that can't see it.
    const masterBytes = (await stat(masterPath)).size;
    console.log(
      `master.mp4: ${masterBytes} bytes (was ${PRE_CRF_BASELINE_MASTER_BYTES} bytes pre-CRF-fix, ${(
        (masterBytes / PRE_CRF_BASELINE_MASTER_BYTES - 1) *
        100
      ).toFixed(1)}% change)`
    );
    assertTrue("master.mp4 is larger than the pre-CRF-fix baseline", masterBytes > PRE_CRF_BASELINE_MASTER_BYTES);

    console.log("\n=== assemble WITHOUT inserts (graceful degradation, spec §4.3/§4.4) ===");
    const runDir2 = path.join(dir, "run2");
    const noInserts = await assembleForTest(await ensureDir(runDir2), "Test Pet", clips, [], [], music, LOGLINES_WITH_STORY);
    const masterDurNoInserts = await probeDurationSeconds(noInserts.masterPath);
    assertClose("master duration with NO inserts", masterDurNoInserts, TRAILER_SECONDS, FRAME_TOLERANCE_SECONDS);

    console.log("\n=== assemble WITH SFX files temporarily absent (spec §2.1) ===");
    const runDir3 = path.join(dir, "run3");
    await withSfxHidden(async () => {
      const noSfx = await assembleForTest(await ensureDir(runDir3), "Test Pet", clips, inserts, [], music, LOGLINES_WITH_STORY);
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
      [],
      music,
      LOGLINES_LEGACY
    );
    const masterDurLegacy = await probeDurationSeconds(legacyRun.masterPath);
    assertClose("LEGACY master (16:9) duration", masterDurLegacy, TRAILER_SECONDS, FRAME_TOLERANCE_SECONDS);

    console.log(
      "\n=== full assemble WITH REAL INSERT CLIPS (this task, change #2 — all 3 inserts animated, not Ken Burns) ==="
    );
    const runDir5 = path.join(dir, "run5");
    const withInsertClips = await assembleForTest(
      await ensureDir(runDir5),
      "Test Pet",
      clips,
      inserts,
      insertClips,
      music,
      LOGLINES_WITH_STORY
    );
    const masterDurInsertClips = await probeDurationSeconds(withInsertClips.masterPath);
    assertClose("master duration with insert CLIPS present", masterDurInsertClips, TRAILER_SECONDS, FRAME_TOLERANCE_SECONDS);

    console.log(
      "\n=== full assemble with MIXED insert clips (this task, change #2 — per-insert Ken Burns fallback) ==="
    );
    // Only insert 0 has a real generated clip; inserts 1 and 2 simulate a
    // failed generateInsertClip call (cached as `null`) and must fall back to
    // Ken Burns individually — proving one insert's failure doesn't take the
    // other two (or the film) down with it.
    const runDir6 = path.join(dir, "run6");
    const mixedInsertClips: (string | null)[] = [insertClips[0], null, null];
    const mixedRun = await assembleForTest(
      await ensureDir(runDir6),
      "Test Pet",
      clips,
      inserts,
      mixedInsertClips,
      music,
      LOGLINES_WITH_STORY
    );
    const masterDurMixed = await probeDurationSeconds(mixedRun.masterPath);
    assertClose("master duration with MIXED insert clips/Ken-Burns fallback", masterDurMixed, TRAILER_SECONDS, FRAME_TOLERANCE_SECONDS);

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

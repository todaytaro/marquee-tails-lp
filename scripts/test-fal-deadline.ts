/**
 * Tests for lib/fal-deadline.ts. No API key, no network, no DB.
 *
 * What these actually prove: that the guard fires, that it fires with an error
 * that says what happened, and that it does not fire early. The one thing a
 * unit test cannot prove is that @fal-ai/client honours the signal in its poll
 * loop — that was verified by reading the shipped source (see the module's
 * header comment), because a test for it would need a hanging fal endpoint.
 *
 * Usage: npx tsx scripts/test-fal-deadline.ts
 */
import {
  falDeadline,
  FAL_IMAGE_CAP_MS,
  FAL_VISION_CAP_MS,
  FAL_AUDIO_CAP_MS,
  FAL_TRAIN_CAP_MS,
  FAL_POLL_CAP_MS,
} from "../lib/fal-deadline";

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`  ok    ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log("falDeadline");

  // Not aborted on creation: a deadline that starts already-fired would abort
  // every call instantly, which would look exactly like fal being down.
  const fresh = falDeadline(60_000);
  check("is not aborted immediately", fresh.aborted === false);

  // Fires after the cap.
  const short = falDeadline(40);
  await sleep(120);
  check("aborts once the cap elapses", short.aborted === true);
  check(
    "abort reason is an Error",
    short.reason instanceof Error,
    `reason was ${Object.prototype.toString.call(short.reason)}`
  );
  const msg = short.reason instanceof Error ? short.reason.message : String(short.reason);
  check(
    "abort reason names the deadline",
    /deadline/i.test(msg),
    `message was ${JSON.stringify(msg)}`
  );

  // Does NOT fire early. The interesting failure here is a cap that somehow
  // resolves to 0/NaN — setTimeout would then fire on the next tick and every
  // fal call in the pipeline would abort before it started.
  const later = falDeadline(5_000);
  await sleep(150);
  check("has not aborted well before its cap", later.aborted === false);

  // An aborted signal rejects the fetch-shaped contract fal relies on: the
  // signal carries our reason, not a bare DOMException, so whatever logs the
  // failure prints something diagnosable.
  const forFetch = falDeadline(30);
  await sleep(100);
  const rejected = await new Promise<unknown>((resolve) => {
    // Mimics how undici/fetch surfaces an aborted signal: reject with reason.
    if (forFetch.aborted) resolve(forFetch.reason);
    else resolve(null);
  });
  check(
    "aborted signal's reason is usable as a thrown error",
    rejected instanceof Error && /\d+s deadline/.test(rejected.message),
    `got ${rejected instanceof Error ? rejected.message : String(rejected)}`
  );

  console.log("\ncaps");
  const caps: Array<[string, number]> = [
    ["FAL_POLL_CAP_MS", FAL_POLL_CAP_MS],
    ["FAL_VISION_CAP_MS", FAL_VISION_CAP_MS],
    ["FAL_IMAGE_CAP_MS", FAL_IMAGE_CAP_MS],
    ["FAL_AUDIO_CAP_MS", FAL_AUDIO_CAP_MS],
    ["FAL_TRAIN_CAP_MS", FAL_TRAIN_CAP_MS],
  ];
  for (const [name, ms] of caps) {
    check(`${name} is a positive finite number`, Number.isFinite(ms) && ms > 0, String(ms));
  }
  // Ordering is the actual invariant worth pinning: a poll round-trip must not
  // be allowed to outlast a generation, and nothing may outlast training.
  check(
    "caps are ordered poll < vision < image < audio < train",
    FAL_POLL_CAP_MS < FAL_VISION_CAP_MS &&
      FAL_VISION_CAP_MS < FAL_IMAGE_CAP_MS &&
      FAL_IMAGE_CAP_MS < FAL_AUDIO_CAP_MS &&
      FAL_AUDIO_CAP_MS < FAL_TRAIN_CAP_MS
  );
  // The incident this module exists for: a film run died at 1800s. Every image
  // cap has to leave room for several sequential calls inside that budget, and
  // training's cap has to exceed its own MEASURED ~45 minutes.
  check("image cap leaves room for several calls inside a 1800s task", FAL_IMAGE_CAP_MS * 5 <= 1800_000);
  check("train cap exceeds the measured ~45min training time", FAL_TRAIN_CAP_MS > 45 * 60 * 1000);

  console.log(failures === 0 ? "\nall passed" : `\n${failures} FAILED`);
  if (failures > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

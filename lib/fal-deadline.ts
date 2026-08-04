/**
 * Deadlines for fal calls.
 *
 * WHY THIS EXISTS: `fal.subscribe` submits to fal's queue and polls until the
 * request finishes. Given no signal, "until" has no upper bound.
 *
 * On 2026-08-04 a Director's Cut film run (Trigger.dev `generate-film`,
 * production run `euoonp01`) logged `[film] generating end frames for
 * interpolated cuts` at 6m41s and then produced nothing at all for 23 minutes,
 * until Trigger.dev killed it: `MAX_DURATION_EXCEEDED — run exceeded maximum
 * compute time (maxDuration) of 1800 seconds`. One `fal-ai/flux-2/lora/edit`
 * call — for a single image, the only end frame that order needed — never
 * returned.
 *
 * The cost of that is worse than the lost half hour. A max-duration kill is
 * NOT retried and does NOT run `onFailure`, so the order was left sitting in
 * VIDEO_GENERATING with no failure recorded anywhere, while the customer
 * watched a "now filming" screen that would never advance. Recovering it
 * needed a human in the admin UI.
 *
 * And the stage that hung already had a complete fallback:
 * `generateGatedEndFrame` catches, returns null, and the cut ships as
 * single-frame i2v (FILM-QUALITY-V3-SPEC.md §5.2/§5.4). It never got to use
 * it — a call that never returns also never throws. A deadline is what makes
 * the fallbacks this pipeline already has reachable.
 *
 * The convention is not new. `submitClip` (lib/film-pipeline.ts) has always
 * polled Kling inside an explicit 15-minute cap, because video generation was
 * understood to be the slow, flaky part. It was the image, vision and audio
 * `fal.subscribe` calls — the ones assumed to be fast — that had no bound at
 * all, which is exactly why nobody noticed for months.
 *
 * WHY abortSignal AND NOT THE CLIENT'S OWN `timeout` OPTION: `subscribe` does
 * accept `timeout`, and it would be the better primitive — it also asks fal to
 * CANCEL the queued request, where an abort only stops us listening. But
 * @fal-ai/client 1.10.1 documents it as "currently, the timeout is not
 * enforced" (src/queue.d.ts), so it is not something to hang a guarantee on.
 * The abortSignal path was read in the shipped source instead and does hold:
 * `subscribeToStatus` forwards the signal into every poll and rejects the whole
 * promise from the catch, and the poll interval is 500ms, so an abort surfaces
 * as a throw within half a second of the deadline.
 *
 * The honest limit of this: aborting is OUR side only. A fal job that is
 * genuinely stuck keeps running, and may still bill, after we stop waiting for
 * it. This buys back the pipeline, not the money.
 */

/**
 * Image generation and editing (nano-banana, flux-2 lora/edit, flux-2 lora).
 * These normally return in 10-60s. Five minutes is not a performance budget,
 * it's the line past which the call is considered broken rather than slow.
 */
export const FAL_IMAGE_CAP_MS = 5 * 60 * 1000;

/**
 * VLM calls (identity scoring, anatomy gate, pet description). Seconds
 * normally. These sit inside gates whose failure path is "pass through" or
 * "fall back", so a hung one silently stalls a whole storyboard.
 */
export const FAL_VISION_CAP_MS = 3 * 60 * 1000;

/** Music generation — one call per film, under a minute in practice. */
export const FAL_AUDIO_CAP_MS = 10 * 60 * 1000;

/**
 * A single queue submit / status / result HTTP round-trip (submitClip's poll
 * loop). These are metadata calls, not generation, so seconds. They get their
 * own bound because submitClip's `while (Date.now() < deadline)` can only
 * check the clock BETWEEN iterations — one hung `queue.status` await and the
 * 15-minute cap it looks like it enforces never comes due.
 */
export const FAL_POLL_CAP_MS = 2 * 60 * 1000;

/**
 * LoRA training. MEASURED at ~45 minutes on this product's settings
 * (LORA-STORYBOARD-SPEC.md §2.1 — the figure was originally guessed at
 * "several to 15 minutes", which is how a task timeout got set too low once
 * already). 90 minutes is double the measured value, deliberately: a training
 * run that is merely slow must not be killed, because the retry re-spends the
 * whole ~$2 and another 45 minutes.
 */
export const FAL_TRAIN_CAP_MS = 90 * 60 * 1000;

/**
 * An AbortSignal that fires after `capMs`, aborting with an error that names
 * the deadline it blew rather than a bare "operation was aborted".
 *
 * Callers pass the result straight to `fal.subscribe`'s `abortSignal`. The
 * rejection surfaces at the call site as an ordinary throw, so every existing
 * try/catch and re-roll path handles it with no further change — which is the
 * point: this adds a failure mode that the pipeline's own safety nets already
 * know how to absorb, in place of one they can't see.
 */
export function falDeadline(capMs: number): AbortSignal {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error(`fal call exceeded its ${Math.round(capMs / 1000)}s deadline`)),
    capMs
  );
  // unref: a deadline that is still pending after the call it guarded has
  // already returned must not hold the event loop open. Without this, a 20s
  // image generation would keep the process alive for the remaining ~4m40s of
  // its cap — turning a guard against hangs into a cause of them.
  timer.unref?.();
  return controller.signal;
}

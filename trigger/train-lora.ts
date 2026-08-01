import { task, tasks } from "@trigger.dev/sdk";
import { prisma } from "@/lib/db";
import { runLoraTraining } from "@/lib/stills-pipeline";
import type { generateStillsTask } from "./stills";

/**
 * Trigger.dev task for per-order LoRA training (LORA-STORYBOARD-SPEC.md
 * §2.1, §2.7). Kicked from lib/stills-pipeline.ts#kickLoraTraining — the new
 * front door for the whole storyboard pipeline (submit-photos and
 * approve-treatment call kickLoraTraining now, not kickStillsGeneration
 * directly; see those routes and lib/stills-pipeline.ts#kickLoraTraining).
 *
 * WHY THIS IS ITS OWN TASK, SEPARATE FROM "generate-stills": training
 * measured at ~45 minutes (n=1, fal queue time included — see
 * LORA-STORYBOARD-SPEC.md §2.1's correction). §2.1 originally assumed "a few
 * minutes to ~15", and the stills task's `maxDuration` was bumped to 3600s on
 * that wrong number with training folded into it as its own Stage 0. The
 * corrected math: ~45 min training + a stills chain that already justified a
 * 1800s (30 min) ceiling on its own = up to ~75 min combined, which the 3600s
 * bump did NOT cover — a duration-kill mid-run would have thrown away the
 * completed 45 minutes of training and then RETRAINED on retry. That is
 * exactly the failure this spec exists to prevent, made worse.
 *
 * THE FIX IS FAILURE ISOLATION, NOT SPEED: once loraUrl/loraTriggerWord are
 * persisted (via runLoraTraining, below), "generate-stills" can fail and
 * retry as many times as its own `retry.maxAttempts` allows without EVER
 * retraining — it only ever reads those two fields off the order record
 * (lib/stills-pipeline.ts#runStillsGeneration no longer calls trainPetLora at
 * all).
 *
 * THE CONTRACT THIS TASK MUST NEVER BREAK: "generate-stills" gets triggered
 * no matter what happens here — a training failure must never become an
 * order failure (same posture as this spec's §8 proof 5).
 *   - runLoraTraining (-> trainPetLora) already swallows an ORDINARY training
 *     failure internally and simply returns without setting loraUrl — that
 *     is NOT a thrown error, so `run` below reaches the final trigger() call
 *     exactly as if training had succeeded, just without a LoRA (the order
 *     falls back to the pre-B1 nano-banana chain for every take).
 *   - If something upstream of that throws instead (the order lookup, the
 *     persist inside runLoraTraining, or the trigger() call itself), `run` is
 *     retried (see `retry` below) — the reuse check inside runLoraTraining
 *     (an order that already carries loraUrl skips training) means a retry
 *     of THIS task can never re-train a LoRA that was already persisted.
 *   - If every retry is exhausted and `run` still never reached the final
 *     trigger() call, `onFailure` is the last resort: it triggers
 *     "generate-stills" directly, so even a total infrastructure failure on
 *     this task can't strand the order the way a naive design could.
 */
export const trainPetLoraTask = task({
  id: "train-pet-lora",
  // No ffmpeg/CPU-heavy work here — downloading the order's photos, zipping
  // them in memory, and polling the fal trainer's queue is I/O-bound, not
  // compute-bound, so this doesn't need the large-1x machine the stills/film
  // tasks use for ffmpeg. Omitted (default machine), same posture as
  // generate-poster (also no ffmpeg — see trigger/poster.ts).
  //
  // ~45 min measured (n=1, fal queue time included) + real headroom for
  // queue variance on a second data point we don't have yet — NOT the
  // original "≤15 min" estimate LORA-STORYBOARD-SPEC.md §2.1 first assumed
  // and this repo's earlier maxDuration bump was sized on.
  maxDuration: 3600,
  retry: { maxAttempts: 2 },
  run: async ({ orderId }: { orderId: string }) => {
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    // Never throws for an ordinary training failure — see this file's doc
    // comment above. Persists loraUrl/loraTriggerWord on success; leaves them
    // null on failure (already logged inside trainPetLora).
    await runLoraTraining(order);
    // ALWAYS continue to stills — whether training/persisting just
    // succeeded, failed, or was skipped because this order already had a
    // cached LoRA. This line must run regardless of what happened above; it
    // is what makes a training failure NOT an order failure.
    await tasks.trigger<typeof generateStillsTask>("generate-stills", { orderId });
  },
  onFailure: async ({ payload, error }) => {
    // Only reached if `run` itself threw across every retry attempt (e.g.
    // the order lookup or the final trigger() call kept failing) — NOT
    // reached for an ordinary training failure, which runLoraTraining/
    // trainPetLora already swallow internally without throwing. Last resort:
    // still get the order into the stills task rather than stranding it in
    // IMAGE_GENERATING with no storyboard and no path forward — same
    // "never die" posture as generate-stills's own onFailure, just one task
    // earlier in the chain.
    console.error(
      `[trigger:train-lora] order=${payload.orderId} failed after retries — forcing the stills task without confirming a LoRA`,
      error
    );
    await tasks
      .trigger<typeof generateStillsTask>("generate-stills", { orderId: payload.orderId })
      .catch((e) =>
        console.error(
          `[trigger:train-lora] could not even trigger the stills task after training-task exhaustion order=${payload.orderId}`,
          e
        )
      );
  },
});

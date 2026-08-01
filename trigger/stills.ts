import { task } from "@trigger.dev/sdk";
import { prisma } from "@/lib/db";
import { OrderStatus } from "@/generated/prisma/client";
import { runStillsGeneration } from "@/lib/stills-pipeline";
import { transitionOrder } from "@/lib/orders";

/**
 * Trigger.dev task for the stills/storyboard pipeline (see FILM-ASYNC-SPEC.md
 * §2). Kicked from lib/stills-pipeline.ts#kickStillsGeneration — in
 * production that's called either directly (from this task's own perspective
 * this doesn't matter) or, per LORA-STORYBOARD-SPEC.md §2.7, from
 * trigger/train-lora.ts's "train-pet-lora" task once LoRA training for this
 * order is done (or has given up and fallen back) — this task itself never
 * trains and only ever READS loraUrl/loraTriggerWord off the order record.
 *
 * WHY THIS EXISTS: the storyboard chain (photo analysis -> identity portrait ->
 * hero sheet -> 6 cuts x 3 takes) takes several minutes. It used to run as a
 * floating `void runStillsGeneration(...)` promise, which works under a
 * long-lived `next dev` but NOT on Vercel: the function is frozen the moment
 * the response is returned, so generation was killed part-way and the order sat
 * in IMAGE_GENERATING forever — no storyboard, no error, no revert (the inline
 * .catch() died with the process). The film/poster/rerender pipelines were
 * already moved here; stills was the one that never made the trip.
 *
 * §2.7 history: LoRA training used to run as this task's own Stage 0, and
 * this task's `maxDuration` was bumped to 3600s to cover it. That was based
 * on the spec's original (wrong, unmeasured) "a few minutes to ~15" estimate;
 * the real measurement was ~45 minutes, which would have made the COMBINED
 * task's worst case ~75 minutes — over even the bumped ceiling, and a
 * duration-kill mid-run would have thrown away the completed training and
 * retried it. Training now lives in its own upstream task (train-lora.ts)
 * specifically so this task's `maxDuration` only ever has to cover ITS OWN
 * work again, back to 1800s.
 */
export const generateStillsTask = task({
  id: "generate-stills",
  // large-1x, same as the film task. Stage 4 runs ffmpeg over 2K PNGs to build
  // the Gate-1 watermarked previews, and the first production order to do that
  // crashed outright on the default small-1x — "Crashed" with no compute
  // recorded, the OOM signature the film task hit before its own bump. The
  // render is also throttled now (WATERMARK_CONCURRENCY in lib/stills-pipeline)
  // so the machine size is headroom rather than the fix.
  machine: "large-1x",
  // Back to 1800 (30 min) — LoRA training no longer happens inside this task
  // (see doc comment above), so this only has to cover its own chain again:
  // photo analysis + portrait + hero sheet + 18 gated takes (each now also
  // anatomy-scored), same scope this ceiling was originally sized for.
  maxDuration: 1800,
  retry: { maxAttempts: 2 },
  run: async ({ orderId }: { orderId: string }) => {
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    await runStillsGeneration(order);
  },
  // All retries exhausted: hand the order back to the step the customer can
  // act on, rather than stranding it in IMAGE_GENERATING. Preset orders return
  // to the intake form; a Director's Cut order returns to its approved
  // treatment instead, which would otherwise be lost behind the photo form.
  onFailure: async ({ payload, error }) => {
    console.error(`[trigger:stills] order=${payload.orderId} failed after retries`, error);
    const order = await prisma.order
      .findUnique({ where: { id: payload.orderId }, select: { tier: true } })
      .catch(() => null);
    const to =
      order?.tier === "custom"
        ? OrderStatus.AWAITING_TREATMENT_APPROVAL
        : OrderStatus.UPLOADING;
    await transitionOrder(
      payload.orderId,
      OrderStatus.IMAGE_GENERATING,
      to,
      "system",
      {},
      "stills generation failed after retries — reverted for retry"
    ).catch((e) => console.error(`[trigger:stills] revert failed order=${payload.orderId}`, e));
  },
});

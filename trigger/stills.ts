import { task } from "@trigger.dev/sdk";
import { prisma } from "@/lib/db";
import { OrderStatus } from "@/generated/prisma/client";
import { runStillsGeneration } from "@/lib/stills-pipeline";
import { transitionOrder } from "@/lib/orders";

/**
 * Trigger.dev task for the stills/storyboard pipeline (see FILM-ASYNC-SPEC.md
 * §2). Kicked from lib/stills-pipeline.ts#kickStillsGeneration in production.
 *
 * WHY THIS EXISTS: the storyboard chain (photo analysis -> identity portrait ->
 * hero sheet -> 6 cuts x 3 takes) takes several minutes. It used to run as a
 * floating `void runStillsGeneration(...)` promise, which works under a
 * long-lived `next dev` but NOT on Vercel: the function is frozen the moment
 * the response is returned, so generation was killed part-way and the order sat
 * in IMAGE_GENERATING forever — no storyboard, no error, no revert (the inline
 * .catch() died with the process). The film/poster/rerender pipelines were
 * already moved here; stills was the one that never made the trip.
 */
export const generateStillsTask = task({
  id: "generate-stills",
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

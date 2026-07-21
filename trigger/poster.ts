import { task } from "@trigger.dev/sdk";
import { prisma } from "@/lib/db";
import { runPosterGeneration } from "@/lib/poster-pipeline";

/**
 * Trigger.dev task for the poster pipeline (see FILM-ASYNC-SPEC.md §2).
 * Kicked from lib/poster-pipeline.ts#kickPosterGeneration in production.
 * No ffmpeg/fonts needed (nano-banana image generation only).
 */
export const generatePosterTask = task({
  id: "generate-poster",
  maxDuration: 600,
  retry: { maxAttempts: 2 },
  run: async ({ orderId }: { orderId: string }) => {
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    await runPosterGeneration(order);
  },
  // Current policy: poster failure never blocks the film. No revert — just log
  // (mirrors the previous inline .catch() which only logged).
  onFailure: async ({ payload, error }) => {
    console.error(`[trigger:poster] order=${payload.orderId} failed after retries (film unaffected)`, error);
  },
});

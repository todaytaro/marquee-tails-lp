import { task } from "@trigger.dev/sdk";
import { prisma } from "@/lib/db";
import { OrderStatus } from "@/generated/prisma/client";
import { runFilmGeneration } from "@/lib/film-pipeline";
import { transitionOrder } from "@/lib/orders";

/**
 * Trigger.dev task for the film pipeline (see FILM-ASYNC-SPEC.md §2).
 * Kicked from lib/film-pipeline.ts#kickFilmGeneration in production (Vercel).
 * Pure orchestration — the actual generation logic lives in runFilmGeneration
 * and is not duplicated here.
 */
export const generateFilmTask = task({
  id: "generate-film",
  maxDuration: 1800,
  retry: { maxAttempts: 2 },
  run: async ({ orderId }: { orderId: string }) => {
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    await runFilmGeneration(order);
  },
  // All retries exhausted: don't strand the order in VIDEO_GENERATING, and
  // don't send a paid/approved customer back to Gate 1 — surface it to the
  // admin as FAILED (see FAILED-STATE-SPEC.md) for a one-click retry.
  onFailure: async ({ payload, error }) => {
    console.error(`[trigger:film] order=${payload.orderId} failed after retries`, error);
    await transitionOrder(
      payload.orderId,
      OrderStatus.VIDEO_GENERATING,
      OrderStatus.FAILED,
      "system",
      { failureReason: String(error).slice(0, 500) },
      "film generation failed after retries"
    ).catch((e) => console.error(`[trigger:film] revert failed order=${payload.orderId}`, e));
  },
});

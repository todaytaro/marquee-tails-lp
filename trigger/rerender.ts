import { task } from "@trigger.dev/sdk";
import { prisma } from "@/lib/db";
import { OrderStatus } from "@/generated/prisma/client";
import { runShotRerender } from "@/lib/film-pipeline";
import { transitionOrder } from "@/lib/orders";

type RerenderShotPayload = {
  orderId: string;
  shotIndex: number;
  reshoot?: boolean;
  reason?: string;
};

/**
 * Trigger.dev task for the admin's single-shot re-render (see
 * FILM-ASYNC-SPEC.md §2). Kicked from lib/film-pipeline.ts#kickShotRerender.
 */
export const rerenderShotTask = task({
  id: "rerender-shot",
  // Re-assembles the whole film after swapping one shot, so it runs the same
  // ffmpeg work as generate-film and needs the same machine (small-1x was
  // killed by OOM there — see trigger/film.ts).
  machine: "large-1x",
  maxDuration: 1800,
  retry: { maxAttempts: 2 },
  run: async ({ orderId, shotIndex, reshoot, reason }: RerenderShotPayload) => {
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    await runShotRerender(order, shotIndex, { reshoot, reason });
  },
  // All retries exhausted: the previously finished film is untouched, so
  // return the order to admin review instead of stranding it in
  // VIDEO_GENERATING (mirrors the previous inline .catch() revert).
  onFailure: async ({ payload, error }) => {
    console.error(`[trigger:rerender] shot ${payload.shotIndex} order=${payload.orderId} failed after retries`, error);
    await transitionOrder(
      payload.orderId,
      OrderStatus.VIDEO_GENERATING,
      OrderStatus.AWAITING_ADMIN_APPROVAL,
      "system",
      {},
      `shot ${payload.shotIndex + 1} re-render failed — original film kept`
    ).catch((e) => console.error(`[trigger:rerender] revert failed order=${payload.orderId}`, e));
  },
});

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
  // ffmpeg assembly needs real RAM and real CPU: the run downloads 6 clips,
  // burns captions onto each, builds title cards, then concats and encodes a
  // 1080p master plus a 9:16 social cut. On the default small-1x (0.5 vCPU /
  // 0.5 GB) that ran out of memory and the process was killed outright at
  // ~9.5 min — reported as "Crashed", with no onFailure, which stranded the
  // order in VIDEO_GENERATING. The bigger machine also fixes the encode being
  // painfully slow on half a core.
  machine: "large-1x",
  // 3600s, raised from 1800s after production run `euoonp01` (2026-08-04) was
  // killed by MAX_DURATION_EXCEEDED. Two things made 1800 the wrong number:
  //
  //   1. It was never generous. The two runs that DID succeed took 21m33s and
  //      21m55s — 27% headroom, on a pipeline whose work scales with the plan
  //      (a Director's Cut adds insert clips and end frames a preset skips).
  //   2. A max-duration kill is the worst failure this task has. It is not
  //      retried, `onFailure` below does NOT run, and so the order is left in
  //      VIDEO_GENERATING with no failureReason and a customer watching a
  //      progress screen — recoverable only by a human in the admin UI. Same
  //      hole as the "Crashed" case described above, reached a different way.
  //
  // Raising the ceiling is only safe because every fal call underneath now
  // carries its own deadline (lib/fal-deadline.ts). Without those, this change
  // would just mean waiting an hour for the same hang instead of half an hour.
  maxDuration: 3600,
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

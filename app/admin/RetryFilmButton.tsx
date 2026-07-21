"use client";

import { useState, useTransition } from "react";
import { retryFilmAction } from "./actions";

/**
 * FAILED -> admin retry control (see FAILED-STATE-SPEC.md §5/§6). Fires
 * retryFilmAction, which atomically clears failureReason and moves the order
 * back to VIDEO_GENERATING, then re-kicks the pipeline (resumes from cached
 * filmArtifacts, so already-generated clips/music are never re-spent).
 *
 * On success revalidatePath re-renders the page (status flips to
 * VIDEO_GENERATING and this button unmounts). Failure renders inline instead
 * of throwing, mirroring RerenderShotButton/ApproveForm.
 */
export function RetryFilmButton({ orderId }: { orderId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function fire() {
    setError(null);
    startTransition(async () => {
      const result = await retryFilmAction(orderId);
      if (!result.ok) {
        setError(result.error);
      }
    });
  }

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={fire}
        disabled={isPending}
        className="rounded-[var(--radius-chip)] border border-red-500/60 bg-red-500/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-red-400 transition-colors hover:bg-red-500/20 disabled:pointer-events-none disabled:opacity-60"
      >
        {isPending ? "再実行中…" : "↻ 再実行"}
      </button>
      {error && (
        <p role="alert" className="text-[11px] leading-snug text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}

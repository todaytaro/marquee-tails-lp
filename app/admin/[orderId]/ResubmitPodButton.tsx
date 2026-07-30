"use client";

import { useState, useTransition } from "react";
import { resubmitPodOrderAction } from "../actions";

/**
 * Manual "send this paid add-on to Printify" control.
 *
 * POD submission is fire-and-forget by design (a print failure must never
 * block film delivery), which means a failed submission is invisible to the
 * customer — they were already told their poster is on its way. This is the
 * recovery path lib/mocks.ts#createPodOrder's comment assumes exists.
 *
 * Errors render inline rather than throwing, and the action's own guards mean
 * a double-click cannot produce two prints. Mirrors RetryFilmButton.
 */
export function ResubmitPodButton({ orderId }: { orderId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function fire() {
    setError(null);
    startTransition(async () => {
      const result = await resubmitPodOrderAction(orderId);
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={fire}
        disabled={isPending}
        className="rounded-[var(--radius-chip)] border border-gold/60 bg-gold/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-gold transition-colors hover:bg-gold/20 disabled:pointer-events-none disabled:opacity-60"
      >
        {isPending ? "発注中…" : "↻ Printifyへ発注"}
      </button>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}

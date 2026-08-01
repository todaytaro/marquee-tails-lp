"use client";

import { useState, useTransition } from "react";
import { adminRerollCutAction, approveStoryboardAction } from "../actions";

type ReviewCut = { scene: string; options: string[] };

/**
 * STORYBOARD-ADMIN-GATE-SPEC.md §3.2 — the admin's Gate-1 review screen.
 * Before this feature admin rendered NO storyboard at all (just the B2
 * re-roll count in the section above this one) — this is new UI, not an
 * edit of an existing one.
 *
 * Shown only while an order sits in the review queue (status
 * IMAGE_GENERATING with storyboardOptions populated — see
 * lib/stills-pipeline.ts#completeStillsGeneration). Nothing here is
 * customer-facing yet, so — per §3.2 — there is no preview/clean split to
 * respect: the page passes plain clean urls straight through.
 *
 * Two actions, both server actions in ../actions.ts:
 *   - adminRerollCutAction — regenerates ONE cut's three takes. Uses its own
 *     `adminRerollCount` counter and its own seed band (never
 *     storyboardRerollCount, the customer's B2 budget — see that action's
 *     doc comment).
 *   - approveStoryboardAction — the ONLY way this order reaches
 *     AWAITING_CUSTOMER_APPROVAL and the customer's Gate-1 email. Disabled
 *     client-side whenever the storyboard isn't complete yet (belt only —
 *     the action itself re-checks server-side, since a disabled button is
 *     not a security boundary).
 */
export function StoryboardReviewPanel({
  orderId,
  storyboard,
  numCuts,
  takesPerCut,
}: {
  orderId: string;
  storyboard: ReviewCut[];
  numCuts: number;
  takesPerCut: number;
}) {
  const [error, setError] = useState<string | null>(null);
  const [rerollingCut, setRerollingCut] = useState<number | null>(null);
  const [isApproving, startApprove] = useTransition();
  const [isRerolling, startReroll] = useTransition();

  const isComplete =
    storyboard.length >= numCuts &&
    storyboard.slice(0, numCuts).every((cut) => cut.options.length >= takesPerCut);

  function reroll(cutIndex: number) {
    setError(null);
    setRerollingCut(cutIndex);
    startReroll(async () => {
      const result = await adminRerollCutAction(orderId, cutIndex);
      if (!result.ok) setError(result.error);
      setRerollingCut(null);
    });
  }

  function approve() {
    setError(null);
    startApprove(async () => {
      const result = await approveStoryboardAction(orderId);
      if (!result.ok) setError(result.error);
    });
  }

  const busy = isApproving || isRerolling;

  return (
    <section className="rounded-[var(--radius-card)] border border-gold/30 bg-surface p-4">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-xl tracking-wide text-gold">
          GATE 1 — 絵コンテ確認
        </h2>
        <span className="text-[10px] uppercase tracking-widest text-muted">
          {storyboard.length}/{numCuts} カット
        </span>
      </div>
      <p className="mb-4 text-xs text-muted">
        顧客にはまだ何も送られていません。各カットで犬がフレーム内に読めるか確認してから承認してください。
        気になるカットは引き直せます（顧客の3回のリロール枠はここでは消費しません）。
      </p>

      <div className="space-y-5">
        {storyboard.map((cut, cutIndex) => (
          <div
            key={cutIndex}
            className="rounded-[var(--radius-chip)] border border-hairline p-3"
          >
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-gold/80">
                カット{cutIndex + 1}
              </p>
              <p className="text-[11px] text-muted">{cut.scene}</p>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {cut.options.map((url, takeIndex) => (
                // Plain <img>: these live on external storage (fal.ai).
                <img
                  key={takeIndex}
                  src={url}
                  alt={`カット${cutIndex + 1} テイク${takeIndex + 1}`}
                  className="aspect-video w-full rounded-[var(--radius-chip)] border border-hairline object-cover"
                />
              ))}
            </div>
            <button
              type="button"
              onClick={() => reroll(cutIndex)}
              disabled={busy}
              className="mt-2 w-full rounded-[var(--radius-chip)] border border-hairline px-2 py-1 text-[10px] uppercase tracking-wider text-muted transition-colors hover:border-gold/50 hover:text-gold disabled:pointer-events-none disabled:opacity-50"
            >
              {isRerolling && rerollingCut === cutIndex
                ? "引き直し中…"
                : "↻ このカットを引き直す"}
            </button>
          </div>
        ))}
      </div>

      {error && (
        <p
          role="alert"
          className="mt-4 rounded-[var(--radius-chip)] border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-400"
        >
          {error}
        </p>
      )}

      {!isComplete && (
        <p className="mt-4 rounded-[var(--radius-chip)] border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-400">
          ⚠ 絵コンテがまだ揃っていません（{storyboard.length}/{numCuts}カット）。生成が完了するまで承認できません。
        </p>
      )}

      <button
        type="button"
        onClick={approve}
        disabled={!isComplete || busy}
        className="btn-marquee mt-4 w-full px-6 py-2.5 text-sm tracking-wider disabled:pointer-events-none disabled:opacity-40"
      >
        {isApproving ? "承認中…" : "承認して顧客に送る"}
      </button>
    </section>
  );
}

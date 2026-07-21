"use client";

import { useState, useTransition } from "react";
import { rerenderShotAction } from "../actions";

/**
 * Gate 2 QC: per-shot "send back to production" control. Arming reveals a
 * reason box + two fix levels, because they repair different failure modes:
 *
 *   RE-ANIMATE — same approved still, new motion roll. For motion problems
 *   (weird movement, mid-clip drift). The reason is injected into the Kling
 *   prompt as a director's note.
 *
 *   RE-SHOOT — retake the STILL itself (reason steers the retake), then
 *   animate. For look/style problems ("too CGI", wrong vibe): a clip always
 *   inherits its start frame's look, so re-animating alone can't fix those.
 *
 * On success revalidatePath re-renders the page (status flips to
 * VIDEO_GENERATING and these controls unmount until the film returns).
 */
export function RerenderShotButton({
  orderId,
  shotIndex,
}: {
  orderId: string;
  shotIndex: number;
}) {
  const [armed, setArmed] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function fire(mode: "reanimate" | "reshoot") {
    setError(null);
    startTransition(async () => {
      const result = await rerenderShotAction(orderId, shotIndex, mode, reason);
      if (!result.ok) {
        setError(result.error);
        setArmed(false);
      }
    });
  }

  if (error) {
    return (
      <p role="alert" className="text-center text-[10px] leading-tight text-red-400">
        {error}
      </p>
    );
  }

  if (!armed) {
    return (
      <button
        type="button"
        onClick={() => setArmed(true)}
        className="w-full rounded-[var(--radius-chip)] border border-hairline px-1 py-1 text-[10px] uppercase tracking-wider text-muted transition-colors hover:border-gold/50 hover:text-gold"
      >
        ↻ このカットを修正
      </button>
    );
  }

  return (
    <div className="space-y-1">
      <textarea
        rows={2}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        disabled={isPending}
        placeholder="理由（例：2秒からCGアニメ風に崩れる。実写のまま維持して）"
        className="w-full rounded-[var(--radius-chip)] border border-hairline bg-night px-1.5 py-1 text-[10px] leading-snug text-ivory placeholder:text-muted/60 focus:border-gold/50 focus:outline-none disabled:opacity-50"
      />
      <button
        type="button"
        onClick={() => fire("reanimate")}
        disabled={isPending}
        className="w-full rounded-[var(--radius-chip)] border border-gold/60 bg-gold/10 px-1 py-1 text-[10px] font-semibold uppercase tracking-wider text-gold transition-colors hover:bg-gold/20 disabled:opacity-60"
        title="同じスチルで動きだけ再抽選 — 動きの問題に"
      >
        {isPending ? "…" : "再アニメ（動き）"}
      </button>
      <button
        type="button"
        onClick={() => fire("reshoot")}
        disabled={isPending}
        className="w-full rounded-[var(--radius-chip)] border border-gold/60 bg-gold/10 px-1 py-1 text-[10px] font-semibold uppercase tracking-wider text-gold transition-colors hover:bg-gold/20 disabled:opacity-60"
        title="スチル自体を撮り直してからアニメ化 — 作画・画風の問題に"
      >
        {isPending ? "…" : "撮り直し（作画）"}
      </button>
      <button
        type="button"
        onClick={() => setArmed(false)}
        disabled={isPending}
        className="w-full rounded-[var(--radius-chip)] border border-hairline px-1 py-0.5 text-[10px] uppercase tracking-wider text-muted hover:text-ivory disabled:opacity-60"
      >
        キャンセル
      </button>
    </div>
  );
}

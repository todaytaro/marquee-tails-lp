"use client";

import { useState, useTransition } from "react";
import { markRefundIssuedAction } from "../actions";

/**
 * B2-SAFETY-NET-SPEC.md §4.3 — records that the admin ALREADY issued the
 * $200 refund by hand in the Stripe dashboard. Two-step confirm (arm, then
 * fire) because this is irreversible: it moves the order to CANCELLED and
 * sends the customer a confirmation email — same "explicit confirm step"
 * requirement the spec places on the CUSTOMER-facing refund request
 * (§4.2), applied here to its admin-side counterpart.
 */
export function MarkRefundIssuedButton({ orderId }: { orderId: string }) {
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function fire() {
    setError(null);
    startTransition(async () => {
      const result = await markRefundIssuedAction(orderId);
      if (!result.ok) {
        setError(result.error);
        setArmed(false);
      }
    });
  }

  if (error) {
    return (
      <p role="alert" className="text-xs text-red-400">
        {error}
      </p>
    );
  }

  if (!armed) {
    return (
      <button
        type="button"
        onClick={() => setArmed(true)}
        className="rounded-[var(--radius-chip)] border border-red-500/50 bg-red-500/10 px-3 py-1.5 text-xs font-semibold text-red-400 transition-colors hover:bg-red-500/20"
      >
        $200 返金済みとして記録
      </button>
    );
  }

  return (
    <div className="space-y-2 rounded-[var(--radius-chip)] border border-red-500/40 bg-red-500/5 p-3">
      <p className="text-xs text-red-400">
        先にStripeダッシュボードで実際に$200を返金してください。押すとこの注文はCANCELLED（完了不可）になり、顧客に確認メールが送られます。取り消せません。
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={fire}
          disabled={isPending}
          className="rounded-[var(--radius-chip)] border border-red-500/60 bg-red-500/20 px-3 py-1.5 text-xs font-semibold text-red-300 transition-colors hover:bg-red-500/30 disabled:opacity-60"
        >
          {isPending ? "記録中…" : "確定 — 返金済みとして記録"}
        </button>
        <button
          type="button"
          onClick={() => setArmed(false)}
          disabled={isPending}
          className="rounded-[var(--radius-chip)] border border-hairline px-3 py-1.5 text-xs text-muted transition-colors hover:text-ivory disabled:opacity-60"
        >
          キャンセル
        </button>
      </div>
    </div>
  );
}

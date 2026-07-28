"use client";

import { useState, useTransition } from "react";
import { resendCustomerEmailAction } from "../actions";

/**
 * B-6 — resend the customer's lifecycle email for the order's current
 * status (upload invite / choose-still / delivery). Does not change status.
 * Pattern mirrors RetryFilmButton: useTransition + inline success/error.
 */
export function ResendEmailButton({ orderId }: { orderId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isPending, startTransition] = useTransition();

  function fire() {
    setError(null);
    setSuccess(false);
    startTransition(async () => {
      const result = await resendCustomerEmailAction(orderId);
      if (result.ok) {
        setSuccess(true);
      } else {
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
        className="rounded-[var(--radius-chip)] border border-hairline bg-surface px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted transition-colors hover:border-gold/50 hover:text-gold disabled:pointer-events-none disabled:opacity-60"
      >
        {isPending ? "送信中…" : "案内メールを再送"}
      </button>
      {success && (
        <p className="text-[11px] leading-snug text-green-400">送信しました。</p>
      )}
      {error && (
        <p role="alert" className="text-[11px] leading-snug text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}

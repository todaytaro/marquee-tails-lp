"use client";

import { useState, useTransition } from "react";
import { approveVideoAction } from "../actions";

/**
 * Gate 2 approve form. Calls the server action; on success revalidatePath
 * re-renders the page (status flips to COMPLETED and this form unmounts).
 * TransitionError and server failures come back as {ok:false, error} and
 * render inline instead of throwing.
 */
export function ApproveForm({ orderId }: { orderId: string }) {
  const [adminNote, setAdminNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await approveVideoAction(orderId, adminNote);
      if (!result.ok) {
        setError(result.error);
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label
          htmlFor="adminNote"
          className="mb-1 block text-[10px] uppercase tracking-widest text-muted"
        >
          管理メモ（任意）
        </label>
        <textarea
          id="adminNote"
          name="adminNote"
          rows={3}
          value={adminNote}
          onChange={(e) => setAdminNote(e.target.value)}
          disabled={isPending}
          placeholder="QCメモ・作り直しの経緯など、記録に残すことがあれば…"
          className="w-full rounded-[var(--radius-chip)] border border-hairline bg-night px-3 py-2 text-sm text-ivory placeholder:text-muted/60 focus:border-gold/50 focus:outline-none disabled:opacity-50"
        />
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-[var(--radius-chip)] border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-400"
        >
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="btn-marquee px-6 py-2.5 text-sm tracking-wider disabled:pointer-events-none disabled:opacity-60"
      >
        {isPending ? "承認中…" : "承認して納品"}
      </button>
    </form>
  );
}

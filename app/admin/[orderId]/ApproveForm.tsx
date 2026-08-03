"use client";

import { useState, useTransition } from "react";
import { approveVideoAction } from "../actions";

/**
 * Gate 2 approve form. Calls the server action; on success revalidatePath
 * re-renders the page (status flips to COMPLETED and this form unmounts).
 * TransitionError and server failures come back as {ok:false, error} and
 * render inline instead of throwing.
 *
 * When the customer never picked a poster, the reviewer can pick one here —
 * and ONLY here, at the moment of approval. The customer's own picker stays
 * open right up to this transition (choose-poster accepts
 * AWAITING_ADMIN_APPROVAL), so saving an admin choice any earlier would show
 * the customer "already chosen" and quietly take away a choice that is
 * theirs. Consuming it with the approval closes both questions at once.
 *
 * `posterOptions` is empty (and this section absent) when the customer has
 * already chosen, or when no candidates were rendered.
 */
export function ApproveForm({
  orderId,
  posterOptions = [],
}: {
  orderId: string;
  posterOptions?: string[];
}) {
  const [adminNote, setAdminNote] = useState("");
  const [posterChoice, setPosterChoice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await approveVideoAction(orderId, adminNote, posterChoice ?? undefined);
      if (!result.ok) {
        setError(result.error);
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {posterOptions.length > 0 && (
        <div>
          <p className="mb-1 text-[10px] uppercase tracking-widest text-muted">
            ポスター（顧客が未選択）
          </p>
          <p className="mb-2 text-xs text-muted">
            承認と同時に確定します。選ばなければ従来通り1案目が納品されます。承認するまでは顧客も選べるので、
            顧客が先に選べばそちらが優先されます。
          </p>
          <div className="grid grid-cols-3 gap-2">
            {posterOptions.map((url, i) => {
              const selected = posterChoice === url;
              return (
                <button
                  key={`${i}-${url}`}
                  type="button"
                  onClick={() => setPosterChoice(selected ? null : url)}
                  disabled={isPending}
                  className={`relative aspect-[2/3] overflow-hidden rounded-[var(--radius-chip)] border text-left transition-opacity disabled:pointer-events-none disabled:opacity-50 ${
                    selected ? "border-gold ring-2 ring-gold" : "border-hairline opacity-70 hover:opacity-100"
                  }`}
                >
                  {/* Plain <img>: candidates live on external storage (fal.ai).
                      No title overlay here — this is a pick-one control, and
                      the full composite is already shown in the poster section
                      further up the page. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={url}
                    alt={`ポスター案${i + 1}`}
                    className="h-full w-full object-cover"
                  />
                  <span className="absolute left-1 top-1 rounded bg-night/80 px-1.5 py-0.5 text-[10px] font-semibold text-ivory">
                    {selected ? "★ " : ""}
                    {i + 1}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

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

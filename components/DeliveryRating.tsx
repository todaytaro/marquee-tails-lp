"use client";

import { useState } from "react";

/**
 * DELIVERY-RATING-SPEC.md §4 — the post-delivery star rating. Progressive
 * disclosure by design: the default is one line of five stars with no
 * comment box, so it never pushes the AddonUpsell purchase flow below it
 * off screen (§4 "配置"). Tapping a star reveals the comment field and
 * fires an immediate save of the star alone — a customer who never types a
 * comment still leaves a rating behind. The comment is a separate,
 * explicit "Send" that resubmits stars+comment together to the same
 * endpoint.
 *
 * Optimistic star / revert-on-failure and the inline one-line error follow
 * components/PosterPicker.tsx's pattern exactly — no toast library here
 * either.
 */

type Props = {
  orderId: string;
  approveToken: string;
  petName: string;
  initialStars: number | null;
  initialComment: string | null;
};

const STAR_VALUES = [1, 2, 3, 4, 5] as const;

export default function DeliveryRating({
  orderId,
  approveToken,
  petName,
  initialStars,
  initialComment,
}: Props) {
  const [stars, setStars] = useState(initialStars ?? 0);
  const [comment, setComment] = useState(initialComment ?? "");
  // Once true, stays true for the rest of the session — the comment field
  // and thank-you never re-hide themselves after a star has been saved.
  const [revealed, setRevealed] = useState(initialStars !== null);
  const [savingStars, setSavingStars] = useState(false);
  const [savingComment, setSavingComment] = useState(false);
  // "Thank you — noted." is already on screen from the star save, so a
  // successful Send would otherwise change nothing visible and read as a
  // no-op — the customer taps it again, or assumes their words were lost.
  // Cleared the moment they edit the text again, so a second send is possible.
  const [commentSaved, setCommentSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(nextStars: number, nextComment?: string) {
    const res = await fetch("/api/orders/rate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orderId,
        approveToken,
        stars: nextStars,
        ...(nextComment !== undefined ? { comment: nextComment } : {}),
      }),
    });
    if (!res.ok) throw new Error("save failed");
  }

  async function pick(next: number) {
    if (savingStars || next === stars) return;
    const prev = stars;
    setStars(next); // optimistic — the star lights up instantly
    setSavingStars(true);
    setError(null);
    try {
      await submit(next);
      setRevealed(true); // first successful save opens the comment field
    } catch {
      setStars(prev);
      setError("That didn't save — please tap a star again.");
    } finally {
      setSavingStars(false);
    }
  }

  async function send() {
    if (savingComment || stars === 0) return;
    setSavingComment(true);
    setError(null);
    try {
      await submit(stars, comment);
      setCommentSaved(true);
    } catch {
      setError("That didn't save — please try Send again.");
    } finally {
      setSavingComment(false);
    }
  }

  return (
    <section className="mx-auto mt-10 max-w-md rounded-[var(--radius-card)] border border-gold/40 p-5 text-center">
      <h2 className="font-display text-lg tracking-wide text-ivory">
        {`How was ${petName}'s premiere?`}
      </h2>
      <p className="mt-1 text-xs text-muted">
        {"One tap. It helps more than you'd think."}
      </p>

      <div
        role="radiogroup"
        aria-label={`Rate ${petName}'s premiere`}
        className="mt-3 flex justify-center gap-1"
      >
        {STAR_VALUES.map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={n === stars}
            aria-label={`${n} star${n === 1 ? "" : "s"}`}
            disabled={savingStars}
            onClick={() => pick(n)}
            className={`text-2xl leading-none transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-bright ${
              n <= stars ? "text-gold" : "text-muted hover:text-gold/60"
            }`}
          >
            ★
          </button>
        ))}
      </div>

      {revealed && (
        <div className="mt-4 space-y-3">
          <p className="text-sm text-muted">Thank you — noted.</p>
          <textarea
            value={comment}
            onChange={(e) => {
              setComment(e.target.value);
              setCommentSaved(false);
            }}
            maxLength={2000}
            rows={3}
            placeholder="Anything you want to tell us? (optional)"
            className="w-full rounded-[var(--radius-chip)] border border-hairline bg-night/40 p-2 text-sm text-ivory placeholder:text-muted focus:border-gold/60 focus:outline-none"
          />
          <button
            type="button"
            onClick={send}
            disabled={savingComment || commentSaved}
            className="btn-marquee px-5 py-2 text-sm"
          >
            {commentSaved ? "Sent" : "Send"}
          </button>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-3 text-sm text-gold-bright">
          {error}
        </p>
      )}
    </section>
  );
}

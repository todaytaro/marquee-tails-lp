"use client";

import { useState } from "react";
import Image from "next/image";
import ProductionProgress from "./ProductionProgress";
import { REFUND_AMOUNT_USD, NONREFUNDABLE_FEE_USD } from "@/lib/safety-net";
import { refundConfirmText } from "@/lib/refund-consent";

/**
 * Gate 1 interactive picker — the storyboard wizard. The customer walks one
 * page per cut and picks the take that's "unmistakably my pet" for each. This
 * is the product's core bet: a HUMAN filter on every cut (not just cut 1), so
 * the whole film holds the likeness that owners notice.
 *
 * The API (/api/orders/approve-storyboard) is the source of truth for every
 * guard (token, per-cut option whitelist, atomic status transition); this
 * component just drives the flow and presents outcomes:
 *   200 -> celebratory success state
 *   409 -> "already in production" (double-submit / stale tab), shown gracefully
 *   else -> friendly retry
 *
 * B2-SAFETY-NET-SPEC.md §3/§4 adds two Director's Cut-only ("isCustom") Gate-1
 * levers, both enforced server-side (this component only presents outcomes,
 * same posture as the storyboard approval above):
 *   - up to `rerollCap` free RE-ROLLS of one cut's three takes
 *     (/api/orders/reroll-cut) — no customer instruction, see the route's own
 *     doc comment for why this is a distinct lever from Gate 0's revision
 *     loop or the admin's Gate-2 shot re-render.
 *   - once all are spent, a refund offer (/api/orders/request-refund)
 *     that freezes Gate 1 for this order once accepted.
 * Preset ($99) orders pass isCustom=false and see none of this (spec §7).
 */

type Cut = { scene: string; options: string[] };

type Props = {
  orderId: string;
  approveToken: string;
  petName: string;
  storyboard: Cut[];
  // B2-SAFETY-NET-SPEC.md §7 — Preset has no Gate 0, no fee/refund split, and
  // NO re-roll/refund UI at all. Only a Director's Cut order ever sets this.
  isCustom: boolean;
  // STORYBOARD_REROLL_CAP (lib/safety-net.ts), passed as a prop rather than
  // imported directly so this client component never pulls in anything from
  // that module's neighborhood of server-only code.
  rerollCap: number;
  initialRerollsRemaining: number;
  refundAlreadyRequested: boolean;
};

type Phase = "picking" | "review" | "submitting" | "success" | "already" | "error";
type RerollStatus = "idle" | "rolling" | "error";
type RefundPanel = "hidden" | "confirming" | "submitting" | "error";

/** Local LP assets go through next/image; external CDN URLs use plain img. */
function Still({ src, alt }: { src: string; alt: string }) {
  if (src.startsWith("/")) {
    return (
      <Image
        src={src}
        alt={alt}
        fill
        sizes="(max-width: 640px) 100vw, 33vw"
        className="object-cover"
      />
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} className="absolute inset-0 h-full w-full object-cover" />
  );
}

const NEXT_STEPS = [
  {
    title: "Filming begins now",
    copy: "Every frame you approved is animated into your trailer.",
  },
  {
    title: "Human quality check",
    copy: "A real editor reviews every second before it leaves the studio.",
  },
  {
    title: "Premiere in your inbox",
    copy: "Your finished film arrives by email within 48 hours.",
  },
];

export default function StoryboardWizard({
  orderId,
  approveToken,
  petName,
  storyboard: initialStoryboard,
  isCustom,
  rerollCap,
  initialRerollsRemaining,
  refundAlreadyRequested,
}: Props) {
  const [storyboard, setStoryboard] = useState<Cut[]>(initialStoryboard);
  const total = storyboard.length;
  const [current, setCurrent] = useState(0);
  const [picks, setPicks] = useState<(string | null)[]>(() => Array(total).fill(null));
  // Which scene becomes the movie poster (the hero product) — picked at review.
  const [posterCut, setPosterCut] = useState(0);
  const [phase, setPhase] = useState<Phase>("picking");

  // B2 — re-roll state (§3.2). rerollsRemaining is shared across every cut
  // (the cap is order-wide, not per-cut — spec §1.1).
  const [rerollsRemaining, setRerollsRemaining] = useState(initialRerollsRemaining);
  const [rerollStatus, setRerollStatus] = useState<RerollStatus>("idle");
  const [rerollError, setRerollError] = useState<string | null>(null);

  // B2 — refund state (§4.2).
  const [refundRequested, setRefundRequested] = useState(refundAlreadyRequested);
  const [refundPanel, setRefundPanel] = useState<RefundPanel>("hidden");
  const [refundError, setRefundError] = useState<string | null>(null);

  const cut = storyboard[current];
  const currentPick = picks[current];

  function choose(url: string) {
    setPicks((prev) => {
      const next = [...prev];
      next[current] = url;
      return next;
    });
  }

  function lockAndAdvance() {
    if (!currentPick) return;
    if (current < total - 1) {
      setCurrent(current + 1);
    } else {
      setPhase("review");
    }
  }

  async function submit() {
    if (phase === "submitting") return;
    if (picks.some((p) => !p)) return;
    setPhase("submitting");
    try {
      const res = await fetch("/api/orders/approve-storyboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, approveToken, chosenStills: picks, posterCutIndex: posterCut }),
      });
      if (res.ok) {
        setPhase("success");
      } else if (res.status === 409) {
        setPhase("already");
      } else {
        setPhase("error");
      }
    } catch {
      setPhase("error");
    }
  }

  /**
   * B2 §3.1 — re-roll the CURRENT cut's three takes. One click, no confirm
   * step (unlike the refund below): the spec only requires making clear it
   * can't be undone, which the caption under the button does; it doesn't
   * require a second click the way the irreversible refund does.
   */
  async function reroll() {
    if (rerollStatus === "rolling") return;
    setRerollStatus("rolling");
    setRerollError(null);
    try {
      const res = await fetch("/api/orders/reroll-cut", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, approveToken, cutIndex: current }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.ok) {
        setStoryboard((prev) => {
          const next = [...prev];
          next[current] = data.cut;
          return next;
        });
        // The old pick may not exist among the new takes — force a fresh
        // choice instead of silently keeping a stale selection.
        setPicks((prev) => {
          const next = [...prev];
          next[current] = null;
          return next;
        });
        setRerollsRemaining(data.rerollsRemaining);
        setRerollStatus("idle");
      } else {
        setRerollError(data?.error ?? "That didn't go through. Please try again.");
        setRerollStatus("error");
      }
    } catch {
      setRerollError("That didn't go through. Please try again.");
      setRerollStatus("error");
    }
  }

  /** B2 §4.2 — the refund request, after the confirm step below. */
  async function confirmRefund() {
    setRefundPanel("submitting");
    setRefundError(null);
    try {
      const res = await fetch("/api/orders/request-refund", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, approveToken }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.ok) {
        setRefundRequested(true);
      } else {
        setRefundError(data?.error ?? "That didn't go through. Please try again.");
        setRefundPanel("error");
      }
    } catch {
      setRefundError("That didn't go through. Please try again.");
      setRefundPanel("error");
    }
  }

  /* ---------------------------------------------------------- */
  /* B2 terminal state — refund requested, Gate 1 frozen          */
  /* ---------------------------------------------------------- */

  if (refundRequested) {
    return (
      <div className="mx-auto max-w-xl text-center">
        <p className="text-sm uppercase tracking-[0.3em] text-muted">
          Request received
        </p>
        <p className="mt-3 font-display text-3xl tracking-wide text-gold gold-glow-text sm:text-4xl">
          REFUND REQUESTED
        </p>
        <p className="mt-4 text-muted">
          We&apos;ve recorded your request for a ${REFUND_AMOUNT_USD} refund,
          and production on {petName}&apos;s film stops here. The $
          {NONREFUNDABLE_FEE_USD} concept &amp; storyboard fee stays
          non-refundable — the treatment and storyboard we made for {petName}{" "}
          are yours to keep either way.
        </p>
        <p className="mt-4 text-muted">
          You&apos;ll get a confirmation email once the refund is issued
          (typically 5&ndash;10 business days after that). No further action
          is needed here — you can close this page.
        </p>
      </div>
    );
  }

  /* ---------------------------------------------------------- */
  /* Terminal states                                             */
  /* ---------------------------------------------------------- */

  if (phase === "success") {
    return (
      <div className="mx-auto max-w-2xl text-center">
        <p className="font-display text-4xl tracking-wide text-gold gold-glow-text sm:text-6xl">
          LIGHTS. CAMERA. {petName.toUpperCase()}.
        </p>
        <p className="mt-4 text-muted">
          Your storyboard is locked — all {total} scenes approved. Production has
          officially started.
        </p>

        <ol className="mt-10 space-y-6 text-left">
          {NEXT_STEPS.map((step, i) => (
            <li key={step.title} className="flex gap-4">
              <span
                aria-hidden
                className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-hairline font-display text-gold"
              >
                {i + 1}
              </span>
              <div>
                <p className="font-semibold text-ivory">{step.title}</p>
                <p className="text-sm text-muted">{step.copy}</p>
              </div>
            </li>
          ))}
        </ol>

        <p className="mt-10 text-sm text-muted">
          You can close this page — we&apos;ll email you the moment {petName}&apos;s
          film is ready.
        </p>
      </div>
    );
  }

  if (phase === "already") {
    return (
      <div className="mx-auto max-w-xl rounded-[var(--radius-card)] border border-hairline bg-surface p-8 text-center">
        <p className="font-display text-3xl tracking-wide text-gold">
          ALREADY IN PRODUCTION
        </p>
        <p className="mt-3 text-muted">
          Good news — this storyboard was already approved and {petName}&apos;s
          film is on its way. No further action needed; we&apos;ll email you when
          it&apos;s ready to premiere.
        </p>
      </div>
    );
  }

  /* ---------------------------------------------------------- */
  /* B2 — re-roll counter + refund offer, shared by both views    */
  /* ---------------------------------------------------------- */

  function rerollCounter() {
    if (!isCustom) return null;
    return (
      <p className="text-xs uppercase tracking-[0.2em] text-muted">
        {rerollsRemaining} of {rerollCap} free re-rolls left
      </p>
    );
  }

  function refundOffer() {
    if (!isCustom || rerollsRemaining > 0) return null;
    if (refundPanel === "hidden" || refundPanel === "error") {
      return (
        <div className="mt-3">
          <p className="text-sm text-ivory">
            Still not right? You can stop here — before we film a frame.
          </p>
          <button
            type="button"
            onClick={() => setRefundPanel("confirming")}
            className="mt-1 text-xs text-muted underline decoration-hairline underline-offset-4 transition-colors hover:text-gold"
          >
            Get ${REFUND_AMOUNT_USD} back (the ${NONREFUNDABLE_FEE_USD} concept
            &amp; storyboard fee stays non-refundable)
          </button>
          {refundPanel === "error" && refundError && (
            <p role="alert" className="mt-2 text-sm text-gold-bright">
              {refundError}
            </p>
          )}
        </div>
      );
    }
    return (
      <div className="mx-auto mt-3 max-w-md rounded-[var(--radius-card)] border border-hairline bg-surface p-4 text-left">
        {/*
          refundConfirmText (lib/refund-consent.ts) — this is the EXACT
          string app/api/orders/request-refund/route.ts records as the
          refund.requested evidence event's consent text (CHARGEBACK-DEFENSE-
          SPEC.md §7 proof 4), so the two must never drift apart.
        */}
        <p className="text-sm text-ivory">{refundConfirmText(petName)}</p>
        <div className="mt-3 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={confirmRefund}
            disabled={refundPanel === "submitting"}
            className="rounded-[var(--radius-chip)] border border-gold/50 px-4 py-2 text-sm text-gold transition-colors hover:bg-gold/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {refundPanel === "submitting" ? "Submitting…" : `Yes — refund $${REFUND_AMOUNT_USD} and stop here`}
          </button>
          <button
            type="button"
            onClick={() => setRefundPanel("hidden")}
            disabled={refundPanel === "submitting"}
            className="text-sm text-muted underline decoration-hairline underline-offset-4 transition-colors hover:text-ivory disabled:opacity-50"
          >
            Never mind, keep going
          </button>
        </div>
      </div>
    );
  }

  /* ---------------------------------------------------------- */
  /* Chosen-storyboard filmstrip (accumulates as you pick)       */
  /* ---------------------------------------------------------- */

  const filmstrip = (
    <div className="mt-10">
      <p className="mb-3 text-center text-xs uppercase tracking-[0.3em] text-muted">
        Your storyboard so far
      </p>
      <ol className="flex flex-wrap justify-center gap-2">
        {picks.map((pick, i) => {
          const isCurrent = phase === "picking" && i === current;
          return (
            <li
              key={i}
              className={`relative aspect-video w-16 overflow-hidden rounded-[var(--radius-chip)] border sm:w-20 ${
                pick
                  ? "border-gold/60"
                  : isCurrent
                    ? "border-gold border-dashed"
                    : "border-hairline"
              }`}
            >
              {pick ? (
                <Still src={pick} alt={`Cut ${i + 1} chosen`} />
              ) : (
                <span className="absolute inset-0 flex items-center justify-center font-display text-lg text-muted">
                  {i + 1}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );

  /* ---------------------------------------------------------- */
  /* Review state — all cuts picked, final director's call       */
  /* ---------------------------------------------------------- */

  if (phase === "review" || phase === "submitting" || phase === "error") {
    return (
      <div>
        <div className="text-center">
          <p className="text-sm uppercase tracking-[0.3em] text-muted">
            Director&apos;s final call
          </p>
          <h2 className="mt-3 font-display text-3xl tracking-wide text-gold gold-glow-text sm:text-4xl">
            YOUR STORYBOARD IS SET
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-muted">
            {total} scenes, {total} takes of {petName}, all hand-picked by you.
            Roll the cameras — or step back and re-pick any scene.
          </p>
        </div>

        <div className="mx-auto mt-10 max-w-2xl rounded-[var(--radius-card)] border-2 border-gold bg-gold/10 p-5 text-center gold-glow-box">
          <p className="font-display text-2xl tracking-wide text-gold">
            ★ ONE LAST CALL: PICK {petName.toUpperCase()}&apos;S MOVIE POSTER
          </p>
          <p className="mx-auto mt-2 max-w-xl text-sm text-ivory">
            This becomes the framed one-sheet that ships with the film. Tap
            any scene below to make IT the poster — scene {posterCut + 1} is
            picked for now, but nothing is final until you approve below.
          </p>
        </div>

        <ol className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
          {picks.map((pick, i) => {
            const isPoster = posterCut === i;
            return (
              <li key={i} className="space-y-2">
                <button
                  type="button"
                  onClick={() => setPosterCut(i)}
                  aria-pressed={isPoster}
                  className={`group relative block w-full aspect-video overflow-hidden rounded-[var(--radius-card)] border text-left transition-shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-bright ${
                    isPoster ? "border-gold ring-2 ring-gold gold-glow-box" : "border-hairline hover:border-gold/50"
                  }`}
                >
                  {pick && <Still src={pick} alt={`Cut ${i + 1}`} />}
                  <span className="absolute left-2 top-2 rounded-[var(--radius-chip)] bg-night/70 px-2 py-0.5 font-display text-xs tracking-widest text-ivory">
                    SCENE {i + 1}
                  </span>
                  {/* Bottom banner: always visible, always reads as clickable —
                      no reliance on a lone star glyph nobody notices. */}
                  <span
                    className={`absolute inset-x-0 bottom-0 py-1.5 text-center font-display text-sm tracking-wide transition-colors ${
                      isPoster
                        ? "bg-gold text-night"
                        : "bg-night/80 text-ivory group-hover:bg-gold/80 group-hover:text-night"
                    }`}
                  >
                    {isPoster ? "★ THIS IS THE POSTER" : "Make this the poster"}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCurrent(i);
                    setPhase("picking");
                  }}
                  disabled={phase === "submitting"}
                  className="w-full text-center text-xs text-muted underline decoration-hairline underline-offset-4 transition-colors hover:text-gold disabled:opacity-40"
                >
                  Re-pick
                </button>
              </li>
            );
          })}
        </ol>

        {isCustom && (
          <div className="mx-auto mt-8 max-w-2xl text-center">
            {rerollCounter()}
            {refundOffer()}
          </div>
        )}

        <div className="mt-10 rounded-[var(--radius-card)] border border-hairline bg-surface p-5 text-center sm:flex sm:items-center sm:justify-between sm:gap-6 sm:text-left">
          <div>
            <p className="text-sm text-muted">
              Production starts the moment you approve. 48h to premiere.
            </p>
            {phase === "error" && (
              <p className="mt-1 text-sm text-gold-bright" role="alert">
                That didn&apos;t go through — the projector jammed. Please try
                again.
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={submit}
            disabled={phase === "submitting"}
            className="btn-marquee mt-4 w-full px-6 py-3 text-base disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none sm:mt-0 sm:w-auto sm:shrink-0"
          >
            {phase === "submitting"
              ? "Rolling…"
              : phase === "error"
                ? "Try again — start production"
                : "That's my pet — start production"}
          </button>
        </div>
      </div>
    );
  }

  /* ---------------------------------------------------------- */
  /* Picking state — one page per cut                            */
  /* ---------------------------------------------------------- */

  return (
    <div>
      <div className="text-center">
        <p className="text-sm uppercase tracking-[0.3em] text-muted">
          Scene {current + 1} of {total} · Director&apos;s choice
        </p>
        <h2 className="mt-3 font-display text-3xl tracking-wide text-gold gold-glow-text sm:text-4xl">
          PICK YOUR {petName.toUpperCase()}
        </h2>
        <p className="mx-auto mt-4 max-w-2xl text-muted">
          {cut.scene.charAt(0).toUpperCase() + cut.scene.slice(1)}.
        </p>
        <p className="mx-auto mt-2 max-w-2xl text-sm text-muted">
          Three takes of this scene — pick the one that&apos;s unmistakably them.
        </p>
        {/*
          A line explaining the watermarks used to sit here, and came out with
          them (WATERMARK_PREVIEWS_ENABLED in lib/stills-pipeline.ts). With the
          marks off it would be describing something the customer cannot see —
          telling a paying customer their clean artwork is watermarked would
          invent a flaw rather than excuse one. Restore it in the same change
          that turns the marks back on; it read:

            These proof sheets are watermarked previews. Your finished film is
            rendered clean and at full quality — no marks, nothing held back.
        */}
      </div>

      {/* progress bar */}
      <div className="mx-auto mt-6 flex max-w-md gap-1.5">
        {storyboard.map((_, i) => (
          <span
            key={i}
            aria-hidden
            className={`h-1 flex-1 rounded-full ${
              picks[i] ? "bg-gold" : i === current ? "bg-gold/40" : "bg-hairline"
            }`}
          />
        ))}
      </div>

      <div
        role="radiogroup"
        aria-label={`Takes for scene ${current + 1}`}
        className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3"
      >
        {cut.options.map((src, i) => {
          const isSelected = currentPick === src;
          return (
            <button
              // options can repeat (mock reuses assets); key by index + url.
              key={`${i}-${src}`}
              type="button"
              role="radio"
              aria-checked={isSelected}
              onClick={() => choose(src)}
              disabled={rerollStatus === "rolling"}
              className={`group relative aspect-video overflow-hidden rounded-[var(--radius-card)] border text-left transition-shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-bright disabled:cursor-not-allowed disabled:opacity-50 ${
                isSelected
                  ? "border-gold ring-2 ring-gold gold-glow-box"
                  : "border-hairline hover:border-gold/50"
              }`}
            >
              <Still src={src} alt={`${petName} — scene ${current + 1} take ${i + 1}`} />
              <span className="absolute left-3 top-3 z-10 rounded-[var(--radius-chip)] bg-night/70 px-2 py-1 font-display text-sm tracking-widest text-ivory">
                TAKE {i + 1}
              </span>
              <span
                aria-hidden
                className={`absolute right-3 top-3 z-10 flex h-7 w-7 items-center justify-center rounded-full transition-opacity ${
                  isSelected
                    ? "bg-gold text-night opacity-100"
                    : "bg-night/70 text-muted opacity-0 group-hover:opacity-100"
                }`}
              >
                ✓
              </span>
              <span
                aria-hidden
                className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-night/80 to-transparent"
              />
            </button>
          );
        })}
      </div>

      {/* B2 §3.2 — re-roll control + free-re-roll counter (Director's Cut
          only). Always visible once earned/available so the "3 free
          re-rolls" promise reads as real, not hidden. */}
      {isCustom && (
        <div className="mx-auto mt-6 max-w-2xl text-center">
          {rerollCounter()}
          {rerollsRemaining > 0 ? (
            <div className="mt-2">
              <button
                type="button"
                onClick={reroll}
                disabled={rerollStatus === "rolling"}
                className="text-sm text-gold underline decoration-hairline underline-offset-4 transition-colors hover:text-gold-bright disabled:cursor-not-allowed disabled:opacity-50"
              >
                {rerollStatus === "rolling"
                  ? "Re-rolling this scene…"
                  : `Not loving these three? Re-roll this scene (${rerollsRemaining} left)`}
              </button>
              <p className="mt-1 text-xs text-muted">
                This spends one of your free re-rolls and can&apos;t be
                undone — we&apos;ll paint three brand-new takes of this exact
                scene.
              </p>
              {rerollStatus === "rolling" && (
                <ProductionProgress
                  messages={[
                    `Re-rolling scene ${current + 1}…`,
                    "Re-casting the shot…",
                    "Painting three new takes…",
                  ]}
                  estimateSeconds={45}
                />
              )}
              {rerollStatus === "error" && rerollError && (
                <p role="alert" className="mt-2 text-sm text-gold-bright">
                  {rerollError}
                </p>
              )}
            </div>
          ) : (
            refundOffer()
          )}
        </div>
      )}

      {/* nav bar */}
      <div className="mt-8 flex items-center justify-between gap-4">
        <button
          type="button"
          onClick={() => setCurrent(Math.max(0, current - 1))}
          disabled={current === 0 || rerollStatus === "rolling"}
          className="text-sm text-muted transition-colors hover:text-gold disabled:opacity-30"
        >
          ← Previous scene
        </button>
        <button
          type="button"
          onClick={lockAndAdvance}
          disabled={!currentPick || rerollStatus === "rolling"}
          className="btn-marquee px-6 py-3 text-base disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
        >
          {current < total - 1 ? "Lock this frame →" : "Review storyboard →"}
        </button>
      </div>

      {filmstrip}
    </div>
  );
}

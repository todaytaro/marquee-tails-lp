"use client";

import { useState } from "react";
import Image from "next/image";

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
 */

type Cut = { scene: string; options: string[] };

type Props = {
  orderId: string;
  approveToken: string;
  petName: string;
  storyboard: Cut[];
};

type Phase = "picking" | "review" | "submitting" | "success" | "already" | "error";

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
  storyboard,
}: Props) {
  const total = storyboard.length;
  const [current, setCurrent] = useState(0);
  const [picks, setPicks] = useState<(string | null)[]>(() => Array(total).fill(null));
  // Which scene becomes the movie poster (the hero product) — picked at review.
  const [posterCut, setPosterCut] = useState(0);
  const [phase, setPhase] = useState<Phase>("picking");

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
          These previews are watermarked and downscaled on purpose
          (PRICING-PRODUCT-V2-SPEC.md §3.5(C)) — but a customer who has just
          paid $249 and is shown marked-up, soft artwork with no explanation
          reads it as the product being cheap. Say it plainly, right where the
          marks are visible: this is the proof sheet, the film is clean.
          Deliberately does NOT invent a friendlier reason for the marks; the
          reassurance that matters is what the finished film looks like.
        */}
        <p className="mx-auto mt-3 max-w-2xl text-xs text-muted">
          These proof sheets are watermarked previews. Your finished film is
          rendered clean and at full quality — no marks, nothing held back.
        </p>
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
              className={`group relative aspect-video overflow-hidden rounded-[var(--radius-card)] border text-left transition-shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-bright ${
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

      {/* nav bar */}
      <div className="mt-8 flex items-center justify-between gap-4">
        <button
          type="button"
          onClick={() => setCurrent(Math.max(0, current - 1))}
          disabled={current === 0}
          className="text-sm text-muted transition-colors hover:text-gold disabled:opacity-30"
        >
          ← Previous scene
        </button>
        <button
          type="button"
          onClick={lockAndAdvance}
          disabled={!currentPick}
          className="btn-marquee px-6 py-3 text-base disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
        >
          {current < total - 1 ? "Lock this frame →" : "Review storyboard →"}
        </button>
      </div>

      {filmstrip}
    </div>
  );
}

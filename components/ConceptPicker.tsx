"use client";

import { useState } from "react";
import Image from "next/image";

/**
 * Gate 1 interactive picker — the ONLY interactive piece of the customer
 * approval page. Radio-style selection over the generated concept stills,
 * then a single POST to /api/orders/approve-image.
 *
 * The API is the source of truth for every guard (token, image whitelist,
 * atomic status transition); this component just presents the outcomes:
 *   200 -> celebratory success state
 *   409 -> "already approved" (double-click / stale tab), shown gracefully
 *   else -> friendly retry
 */

type Props = {
  orderId: string;
  approveToken: string;
  petName: string;
  images: string[];
};

type Phase = "idle" | "submitting" | "success" | "already" | "error";

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
    <img
      src={src}
      alt={alt}
      className="absolute inset-0 h-full w-full object-cover"
    />
  );
}

const NEXT_STEPS = [
  {
    title: "Filming begins now",
    copy: "Your approved still becomes the opening shot of the trailer.",
  },
  {
    title: "Human quality check",
    copy: "A real editor reviews every frame before it leaves the studio.",
  },
  {
    title: "Premiere in your inbox",
    copy: "Your finished film arrives by email within 48 hours.",
  },
];

export default function ConceptPicker({
  orderId,
  approveToken,
  petName,
  images,
}: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");

  async function submit() {
    if (!selected || phase === "submitting") return;
    setPhase("submitting");
    try {
      const res = await fetch("/api/orders/approve-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId,
          approveToken,
          selectedImageUrl: selected,
        }),
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
        <p className="font-display text-4xl sm:text-6xl tracking-wide text-gold gold-glow-text">
          LIGHTS. CAMERA. {petName.toUpperCase()}.
        </p>
        <p className="mt-4 text-muted">
          Your opening shot is locked. Production has officially started.
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
          You can close this page — we&apos;ll email you the moment{" "}
          {petName}&apos;s film is ready.
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
          Good news — this shot was already approved and {petName}&apos;s film
          is on its way. No further action needed; we&apos;ll email you when
          it&apos;s ready to premiere.
        </p>
      </div>
    );
  }

  /* ---------------------------------------------------------- */
  /* Selection state                                             */
  /* ---------------------------------------------------------- */

  return (
    <div>
      <div
        role="radiogroup"
        aria-label={`Concept stills for ${petName}`}
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
      >
        {images.map((src, i) => {
          const isSelected = selected === src;
          return (
            <button
              key={src}
              type="button"
              role="radio"
              aria-checked={isSelected}
              onClick={() => setSelected(src)}
              disabled={phase === "submitting"}
              className={`group relative aspect-[4/5] overflow-hidden rounded-[var(--radius-card)] border text-left transition-shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-bright ${
                isSelected
                  ? "border-gold ring-2 ring-gold gold-glow-box"
                  : "border-hairline hover:border-gold/50"
              }`}
            >
              <Still src={src} alt={`${petName} — concept still ${i + 1}`} />
              {/* scene slate */}
              <span className="absolute left-3 top-3 z-10 rounded-[var(--radius-chip)] bg-night/70 px-2 py-1 font-display text-sm tracking-widest text-ivory">
                TAKE {i + 1}
              </span>
              {/* selected badge */}
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
              {/* bottom gradient for legibility */}
              <span
                aria-hidden
                className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-night/80 to-transparent"
              />
            </button>
          );
        })}
      </div>

      {/* confirm bar */}
      <div className="mt-8 rounded-[var(--radius-card)] border border-hairline bg-surface p-5 sm:flex sm:items-center sm:justify-between sm:gap-6">
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
          disabled={!selected || phase === "submitting"}
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

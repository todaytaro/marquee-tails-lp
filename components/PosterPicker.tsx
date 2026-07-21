"use client";

import { useState } from "react";
import MoviePosterOverlay from "./MoviePosterOverlay";

/**
 * The second human-pick moment — while the cameras roll, the customer chooses
 * THE one-sheet from three finished posters. posterOptions are TEXT-FREE key
 * art; MoviePosterOverlay lays the real title block over each one live (CSS,
 * not baked), so what's on screen here is pixel-for-pixel what gets rendered
 * to the print file once approved (lib/poster-print.ts uses the same design).
 * Selection is immediate and can be changed until the film is delivered.
 */

type Props = {
  orderId: string;
  approveToken: string;
  petName: string;
  posterOptions: string[];
  chosenPosterUrl: string | null;
  /** Top teaser line (defaults inside MoviePosterOverlay if omitted). */
  tagline?: string;
  /** Line under the name — the film's own tagline. */
  subtitle?: string;
};

export default function PosterPicker({
  orderId,
  approveToken,
  petName,
  posterOptions,
  chosenPosterUrl,
  tagline,
  subtitle,
}: Props) {
  const [chosen, setChosen] = useState<string | null>(chosenPosterUrl);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  async function pick(url: string) {
    if (saving || url === chosen) return;
    const prev = chosen;
    setChosen(url); // optimistic — the glow moves instantly
    setSaving(true);
    setError(false);
    try {
      const res = await fetch("/api/orders/choose-poster", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, approveToken, posterUrl: url }),
      });
      if (!res.ok) {
        setChosen(prev);
        setError(true);
      }
    } catch {
      setChosen(prev);
      setError(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mx-auto mt-14 max-w-3xl">
      <p className="text-center text-sm uppercase tracking-[0.3em] text-muted">
        While the cameras roll…
      </p>
      <h2 className="mt-3 text-center font-display text-3xl tracking-wide text-gold gold-glow-text sm:text-4xl">
        CHOOSE {petName.toUpperCase()}&apos;S POSTER
      </h2>
      <p className="mx-auto mt-3 max-w-xl text-center text-sm text-muted">
        Three one-sheets of your chosen scene, finished and titled. Pick the one
        that goes to print — this is the wall copy.
      </p>

      <div
        role="radiogroup"
        aria-label={`Poster options for ${petName}`}
        className="mt-8 grid grid-cols-3 gap-3"
      >
        {posterOptions.map((src, i) => {
          const isChosen = chosen === src;
          return (
            <button
              key={`${i}-${src}`}
              type="button"
              role="radio"
              aria-checked={isChosen}
              onClick={() => pick(src)}
              disabled={saving}
              className={`group relative aspect-[2/3] overflow-hidden rounded-[var(--radius-card)] border text-left transition-shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-bright ${
                isChosen ? "border-gold ring-2 ring-gold gold-glow-box" : "border-hairline hover:border-gold/50"
              }`}
            >
              <MoviePosterOverlay src={src} petName={petName} tagline={tagline} subtitle={subtitle} />
              <span
                aria-hidden
                className={`absolute right-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-full transition-opacity ${
                  isChosen ? "bg-gold text-night opacity-100" : "bg-night/70 text-muted opacity-0 group-hover:opacity-100"
                }`}
              >
                ★
              </span>
            </button>
          );
        })}
      </div>

      <p className="mt-4 text-center text-sm" role={error ? "alert" : undefined}>
        {error ? (
          <span className="text-gold-bright">That didn&apos;t save — please tap your pick again.</span>
        ) : chosen ? (
          <span className="text-muted">
            ★ Locked in. You can change your mind any time before delivery.
          </span>
        ) : (
          <span className="text-muted">Tap a poster to choose.</span>
        )}
      </p>
    </section>
  );
}

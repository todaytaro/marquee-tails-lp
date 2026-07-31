"use client";

import { useState } from "react";
import Image from "next/image";

type TierKey = "preset" | "custom";

type Tier = {
  key: TierKey;
  name: string;
  blurb: string;
  price: string;
  items: readonly string[];
  flag: string;
  delivery: string;
  purchasable: boolean;
  featured: boolean;
};

const tiers: readonly Tier[] = [
  {
    key: "preset",
    name: "Preset Worlds",
    blurb: "A ready-made world — your pet cast as the star.",
    price: "$99",
    items: [
      "60-second cinematic trailer in a director-made world",
      "Choose Deep Space Explorer, Storybook Kingdom, or Noir Detective",
      "Your pet, instantly recognizable, across six starring shots",
      "Digital movie poster — included free",
      "HD delivery, 48h after storyboard approval",
    ],
    flag: "Available now",
    delivery: "Instant digital delivery",
    purchasable: true,
    featured: false,
  },
  {
    key: "custom",
    name: "Director's Cut",
    blurb: "No presets — your story, your world, your call.",
    price: "$249",
    items: [
      "A fully bespoke trailer — your story, your world, not a preset",
      "You're the director: shape and approve the written treatment first — up to 2 free revisions",
      "Your call on wardrobe too — one signature look, yours to approve or change",
      "Then approve the storyboard, shot by shot, before we film a frame",
      // B2-SAFETY-NET-SPEC.md §5 disclosure point 1 — must be visible BEFORE
      // purchase, not just at checkout, so "$249 up front" never reads as an
      // AI slot machine. $49 of the $249 is the non-refundable concept &
      // storyboard fee; see the checkout consent line, Terms, Refund Policy
      // and Tokushoho page for the other four disclosure points.
      "Don't love your storyboard? Re-roll any scene up to 3 times free — and if it's still not right before we film, get $200 back ($49 concept & storyboard fee stays non-refundable)",
      "Digital movie poster — included free",
      "Strictly limited slots each day — reserved, not mass-produced",
    ],
    flag: "Limited slots",
    delivery: "Limited slots, by application",
    purchasable: true,
    featured: true,
  },
];

export default function PricingTeaser() {
  const [loadingTier, setLoadingTier] = useState<TierKey | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleBuy(tier: TierKey) {
    setError(null);
    setLoadingTier(tier);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier }),
      });
      const data = await res.json();
      if (data.ok && data.url) {
        window.location.assign(data.url);
        return;
      }
      setError(data.error ?? "Something went wrong. Please try again.");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoadingTier(null);
    }
  }

  return (
    <section
      id="pricing"
      aria-labelledby="pricing-heading"
      className="mx-auto w-full max-w-6xl px-5 py-16 sm:py-24"
    >
      <p className="text-center font-display text-sm uppercase tracking-[0.3em] text-gold">
        Launch pricing
      </p>
      <h2
        id="pricing-heading"
        className="mt-3 text-center font-display uppercase tracking-[0.08em] text-ivory text-[clamp(2rem,6vw,3.25rem)] leading-none"
      >
        Two ways to premiere.
      </h2>
      <p className="mx-auto mt-4 max-w-xl text-center text-sm leading-relaxed text-muted">
        A custom pet portrait alone runs $150+. This is a whole film, poster
        included — in a world we built, or one built entirely around yours.
      </p>

      <div className="relative mt-12">
        {/* Faint radial gold glow, biased toward the featured ticket */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-0 -z-10 h-[420px] w-[420px] max-w-[88vw] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(232,182,76,0.16),transparent_70%)] blur-3xl motion-reduce:opacity-70 md:left-3/4 md:h-[480px] md:w-[480px]"
        />

        <div className="grid gap-6 md:grid-cols-2 md:items-start">
          {tiers.map((tier, index) => {
            const isFeatured = tier.featured;
            return (
              <article
                key={tier.key}
                className={`relative flex flex-col overflow-hidden rounded-card border bg-surface motion-safe:transition-[transform,box-shadow] motion-safe:duration-300 ${
                  isFeatured
                    ? "border-gold/60 gold-glow-box motion-safe:hover:-translate-y-1.5 motion-safe:hover:shadow-[0_0_60px_rgba(232,182,76,0.45)]"
                    : "border-hairline"
                }`}
              >
                {isFeatured && (
                  <div className="film-strip" aria-hidden="true" />
                )}

                {/* Stub zone — ticket number, "Admit one", and a status stamp */}
                <div className="flex items-center justify-between gap-3 px-5 py-4">
                  <div className="flex items-baseline gap-2">
                    <span className="font-display text-2xl leading-none text-gold/70">
                      №&nbsp;{String(index + 1).padStart(2, "0")}
                    </span>
                    <span className="text-[10px] uppercase tracking-[0.3em] text-muted">
                      Admit one
                    </span>
                  </div>
                  {tier.flag && (
                    <span
                      className={`inline-block shrink-0 rounded-chip border px-2.5 py-1 text-center font-display text-[11px] uppercase leading-tight tracking-[0.16em] ${
                        isFeatured
                          ? "-rotate-3 border-gold/50 text-gold-bright"
                          : "border-gold/40 text-gold-bright"
                      }`}
                    >
                      {tier.flag}
                    </span>
                  )}
                </div>

                {/* Perforation — dashed tear line with punched notches at the edges */}
                <div
                  className="relative border-t border-dashed border-gold/25"
                  aria-hidden="true"
                >
                  <span className="ticket-notch left-0 top-0 -translate-x-1/2 -translate-y-1/2" />
                  <span className="ticket-notch right-0 top-0 translate-x-1/2 -translate-y-1/2" />
                </div>

                {/* Body */}
                <div className="flex flex-1 flex-col px-6 pb-6 pt-5">
                  <h3 className="font-display text-xl uppercase tracking-[0.12em] text-ivory">
                    {tier.name}
                  </h3>
                  <p className="mt-1 text-[0.8rem] leading-snug text-muted">
                    {tier.blurb}
                  </p>
                  <p className="mt-2 flex items-baseline gap-2">
                    <span
                      className={`font-display text-[3rem] leading-none tracking-[0.04em] ${
                        isFeatured ? "text-gold gold-glow-text" : "text-gold"
                      }`}
                    >
                      {tier.price}
                    </span>
                    <span className="text-[0.7rem] uppercase tracking-[0.1em] text-muted">
                      USD / one-time
                    </span>
                  </p>
                  <p className="mt-1 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-gold-bright">
                    <span aria-hidden="true">🎬</span> Launch pricing
                  </p>
                  <p className="mt-2 text-[0.8rem] font-medium text-muted">
                    {tier.delivery}
                  </p>
                  <ul className="mt-5 space-y-2.5 border-t border-hairline pt-5">
                    {tier.items.map((item) => (
                      <li
                        key={item}
                        className="flex gap-2.5 text-[0.9rem] leading-snug text-muted"
                      >
                        <span aria-hidden="true" className="mt-px text-gold">
                          ★
                        </span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                  {isFeatured && (
                    <div className="mt-5 flex items-center gap-3 rounded-chip border border-hairline bg-night/60 p-2.5">
                      <Image
                        src="/assets/poster.png"
                        alt="Painterly movie poster of a heroic corgi in a khaki explorer jacket with leather straps, posed on a rocky summit from a dramatic low angle against golden storm clouds, with the bold title TOP BILLING and a faux credit block at the bottom."
                        width={64}
                        height={96}
                        className="h-24 w-16 rounded-[4px] object-cover"
                      />
                      <p className="text-xs leading-relaxed text-muted">
                        Your digital movie poster — same painterly one-sheet
                        style, ready to download.
                      </p>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => handleBuy(tier.key)}
                    disabled={loadingTier !== null || !tier.purchasable}
                    className={
                      tier.purchasable
                        ? "btn-marquee mt-6 w-full py-3 text-sm font-semibold disabled:opacity-60"
                        : "mt-6 w-full cursor-default rounded-chip border border-dashed border-hairline py-3 text-sm font-semibold uppercase tracking-[0.16em] text-muted"
                    }
                  >
                    {tier.purchasable
                      ? loadingTier === tier.key
                        ? "Redirecting…"
                        : `Get ${tier.name}`
                      : "Coming soon"}
                  </button>
                  <p className="mt-3 text-center text-[0.75rem] leading-relaxed text-muted">
                    Printed poster ($59) &amp; gallery canvas ($99) available
                    as add-ons after your film is delivered.
                  </p>
                </div>
              </article>
            );
          })}
        </div>
      </div>

      {error && (
        <p className="mt-6 text-center text-sm text-red-400">{error}</p>
      )}

      <p className="mx-auto mt-10 max-w-md text-center text-sm text-ivory">
        Not recognizably your pet? We remake it free.
      </p>
      <p className="mt-2 text-center text-sm text-muted">
        Secure checkout powered by Stripe. Every order is made to order.
      </p>
    </section>
  );
}

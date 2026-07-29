"use client";

import { useState } from "react";
import Image from "next/image";

/**
 * The post-delivery physical upsell (PRICING-PRODUCT-V2-SPEC.md §5) — shown
 * on the PremiereView (COMPLETED) once a print-ready poster exists. Offered
 * at the emotional peak: the film just premiered, the digital poster is
 * already theirs, and now they can buy it printed and framed.
 *
 * Props are primitives only (no Prisma types in a client component) — same
 * pattern as StoryboardWizard / PosterPicker, which take orderId/approveToken
 * rather than a whole Order.
 *
 * handleBuy mirrors PricingTeaser.handleBuy: loading + error states, POST to
 * the checkout route, then window.location.assign the returned Stripe URL.
 */

type AddonKey = "poster" | "canvas";

type Option = {
  key: AddonKey;
  name: string;
  price: string;
  blurb: string;
};

const OPTIONS: readonly Option[] = [
  {
    key: "poster",
    name: "Printed Poster",
    price: "$59",
    blurb: "Museum-grade paper, ready to frame.",
  },
  {
    key: "canvas",
    name: "Gallery Canvas",
    price: "$99",
    blurb: "Gallery-wrapped canvas, ready to hang.",
  },
];

const ADDON_LABEL: Record<string, string> = {
  poster: "printed poster",
  canvas: "gallery canvas",
};

type Props = {
  orderId: string;
  approveToken: string;
  petName: string;
  posterUrl: string | null;
  purchasedAddon: string | null;
};

export default function AddonUpsell({
  orderId,
  approveToken,
  petName,
  posterUrl,
  purchasedAddon,
}: Props) {
  const [loadingAddon, setLoadingAddon] = useState<AddonKey | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleBuy(addon: AddonKey) {
    setError(null);
    setLoadingAddon(addon);
    try {
      const res = await fetch("/api/addon-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, approveToken, addon }),
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
      setLoadingAddon(null);
    }
  }

  if (purchasedAddon) {
    const label = ADDON_LABEL[purchasedAddon] ?? "keepsake";
    return (
      // Same #keepsake anchor as the offer below: the delivery email's
      // keepsake link must land somewhere sensible even after the customer
      // has already bought (they see the confirmation instead of the offer).
      <section id="keepsake" className="mx-auto mt-14 max-w-xl rounded-card border border-gold/40 bg-surface px-6 py-8 text-center">
        <p className="font-display text-sm uppercase tracking-[0.3em] text-gold">
          Order confirmed
        </p>
        <p className="mt-3 text-lg text-ivory">
          Your {label} is on its way — we&apos;ll email tracking.
        </p>
      </section>
    );
  }

  return (
    // #keepsake — the delivery email's second link targets this section. Both
    // email links point at the same /approve page (the film and the keepsake
    // offer live together), so without an anchor here the keepsake link did
    // nothing the "watch the film" link above it hadn't already done.
    <section id="keepsake" className="mx-auto mt-14 max-w-3xl">
      <p className="text-center font-display text-sm uppercase tracking-[0.3em] text-gold">
        Make it real.
      </p>
      <h2 className="mt-3 text-center font-display text-3xl tracking-wide text-gold gold-glow-text sm:text-4xl">
        HANG {petName.toUpperCase()}&apos;S POSTER
      </h2>
      <p className="mx-auto mt-3 max-w-xl text-center text-sm text-muted">
        Your poster, printed and shipped. The free digital version is already
        yours.
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {OPTIONS.map((opt) => (
          <div
            key={opt.key}
            className="flex flex-col overflow-hidden rounded-card border border-hairline bg-surface p-5"
          >
            <div className="flex items-center gap-3">
              <div className="relative h-24 w-16 shrink-0 overflow-hidden rounded-[4px] border border-hairline">
                {posterUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- customer-selected CDN poster, not a local asset
                  <img
                    src={posterUrl}
                    alt={`${petName}'s poster`}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <Image
                    src="/assets/poster.png"
                    alt={`${petName}'s poster`}
                    fill
                    sizes="64px"
                    className="object-cover"
                  />
                )}
              </div>
              <div>
                <h3 className="font-display text-lg uppercase tracking-[0.08em] text-ivory">
                  {opt.name}
                </h3>
                <p className="font-display text-2xl text-gold">{opt.price}</p>
              </div>
            </div>
            <p className="mt-3 text-sm text-muted">{opt.blurb}</p>
            <button
              type="button"
              onClick={() => handleBuy(opt.key)}
              disabled={loadingAddon !== null}
              className="btn-marquee mt-5 w-full py-3 text-sm font-semibold disabled:opacity-60"
            >
              {loadingAddon === opt.key ? "Redirecting…" : `Get the ${opt.name}`}
            </button>
          </div>
        ))}
      </div>

      {error && (
        <p className="mt-6 text-center text-sm text-red-400" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

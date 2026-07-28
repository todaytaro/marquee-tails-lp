/**
 * Stripe SDK wrapper — server-side only.
 *
 * Returns `null` if Stripe isn't configured (no STRIPE_SECRET_KEY in .env
 * yet — the owner will add real test-mode keys later). Callers must handle
 * that; the rest of the app keeps working since nothing else depends on
 * Stripe yet (this is plumbing only, no Buy button exists on the LP).
 *
 * Same design as ~/Downloads/L-mode/l-mode-app/src/lib/stripe/server.ts:
 * singleton client, env-driven Price ID resolution.
 */

import Stripe from "stripe";

let _client: Stripe | null = null;

/**
 * Idempotent client getter. Returns null if STRIPE_SECRET_KEY isn't set —
 * callers must handle that (checkout API returns 503, rest of the app is
 * unaffected since nothing else depends on Stripe yet).
 */
export function getStripeClient(): Stripe | null {
  if (_client) return _client;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  _client = new Stripe(key, {
    typescript: true,
    appInfo: { name: "marquee-tails", url: process.env.APP_BASE_URL ?? "http://localhost:3100" },
  });
  return _client;
}

export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

/**
 * Pass 1 (PRICING-PRODUCT-V2-SPEC.md): 2 plans — "preset" (Preset Worlds,
 * $99, purchasable) and "custom" (Director's Cut, $249, not sellable yet —
 * see app/api/checkout/route.ts). The old 3-tier model (digital/feature/
 * collector) is fully retired.
 */
export type Tier = "preset" | "custom";

/** Env var naming: STRIPE_PRICE_PRESET / STRIPE_PRICE_CUSTOM. */
export function getPriceId(tier: Tier): string | null {
  switch (tier) {
    case "preset":
      return process.env.STRIPE_PRICE_PRESET || null;
    case "custom":
      return process.env.STRIPE_PRICE_CUSTOM || null;
  }
}

/** Reverse lookup for the webhook: Price ID -> our tier enum. */
export function priceIdToTier(priceId: string): Tier | null {
  if (priceId === process.env.STRIPE_PRICE_PRESET) return "preset";
  if (priceId === process.env.STRIPE_PRICE_CUSTOM) return "custom";
  return null;
}

/**
 * Pass 2 (PRICING-PRODUCT-V2-SPEC.md §5): the post-delivery physical add-on —
 * a SECOND Stripe Checkout offered at COMPLETED, separate from the base plan
 * purchase above. Printed Poster ($59) or Gallery Canvas ($99).
 */
export type AddonType = "poster" | "canvas";

/** Env: STRIPE_PRICE_ADDON_POSTER / STRIPE_PRICE_ADDON_CANVAS. */
export function getAddonPriceId(addon: AddonType): string | null {
  switch (addon) {
    case "poster":
      return process.env.STRIPE_PRICE_ADDON_POSTER || null;
    case "canvas":
      return process.env.STRIPE_PRICE_ADDON_CANVAS || null;
  }
}

/** Reverse lookup for the webhook: Price ID -> add-on type. */
export function priceIdToAddon(priceId: string): AddonType | null {
  if (priceId === process.env.STRIPE_PRICE_ADDON_POSTER) return "poster";
  if (priceId === process.env.STRIPE_PRICE_ADDON_CANVAS) return "canvas";
  return null;
}

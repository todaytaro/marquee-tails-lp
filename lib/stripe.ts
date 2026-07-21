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

export type Tier = "digital" | "feature" | "collector";

/** Env var naming: STRIPE_PRICE_DIGITAL / STRIPE_PRICE_FEATURE / STRIPE_PRICE_COLLECTOR. */
export function getPriceId(tier: Tier): string | null {
  switch (tier) {
    case "digital":
      return process.env.STRIPE_PRICE_DIGITAL || null;
    case "feature":
      return process.env.STRIPE_PRICE_FEATURE || null;
    case "collector":
      return process.env.STRIPE_PRICE_COLLECTOR || null;
  }
}

/** Reverse lookup for the webhook: Price ID -> our tier enum. */
export function priceIdToTier(priceId: string): Tier | null {
  if (priceId === process.env.STRIPE_PRICE_DIGITAL) return "digital";
  if (priceId === process.env.STRIPE_PRICE_FEATURE) return "feature";
  if (priceId === process.env.STRIPE_PRICE_COLLECTOR) return "collector";
  return null;
}

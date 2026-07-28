# Add-on Flow — Implementation Brief (Pass 2 / Phase A remainder)

> Implements the **post-delivery physical add-on purchase** from
> `PRICING-PRODUCT-V2-SPEC.md` §5 ("アドオン決済フロー（新規）").
> The 2-plan LP + Preset base checkout already ship. This adds the SECOND
> Stripe Checkout for a **Printed Poster ($59)** or **Gallery Canvas ($99)**,
> offered at the emotional peak (delivery / `COMPLETED`), then a Printify order.
>
> **Author for this brief: Opus (orchestrator). Implementer: Sonnet.**

---

## Hard constraints (read first)

1. **DO NOT touch the database.** Local `.env` `DATABASE_URL` points at the
   **production** Supabase. So:
   - **Do NOT run** `prisma migrate dev`, `migrate deploy`, `db push`, or any
     command that connects to the DB.
   - Edit `prisma/schema.prisma`, then **hand-author** the migration SQL file
     (format below), then run **only** `npx prisma generate` (schema → client
     types in `generated/prisma`, no DB connection).
   - The owner applies the migration at deploy time. All changes are additive
     nullable columns + one unique index → backward-compatible.
2. **Do NOT break the 2-Gate core.** `transitionOrder` in `lib/orders.ts` stays
   the only status-write path. The add-on flow does **not** add or change any
   `OrderStatus` — it only writes non-status columns. No new state-machine edges.
3. **Idempotency.** The add-on webhook must be safe to replay (Stripe retries).
   Enforce via the unique `addonStripeSessionId` + a guarded `updateMany`.
4. **One physical add-on per order** in this pass (MVP). Guard against a second
   purchase. (Buying both poster + canvas is out of scope; revisit later.)
5. Follow existing house style: file-level comments explaining *why*, the
   `null`-if-unconfigured posture for optional integrations, fire-and-forget
   side effects that never block the main path.

---

## 1. Schema (`prisma/schema.prisma`)

Add to `model Order` (near the existing Printify audit fields
`podOrderId`/`podStatus`, which you will reuse):

```prisma
  // --- Physical add-on (Pass 2 — post-delivery upsell) ---
  // The digital poster ships free with every plan. The printed poster /
  // gallery canvas are an optional SECOND purchase after delivery
  // (status COMPLETED), via their own Stripe Checkout + Printify order.
  // One physical add-on per order in this pass. Shipping is collected at the
  // add-on Checkout and lands in the existing shipping* columns; the Printify
  // order id/status reuse the existing podOrderId/podStatus columns.
  addonType            String?   // "poster" | "canvas"
  addonStripeSessionId String?   @unique // the 2nd Checkout session — idempotency key
  addonPaidCents       Int?      // audit: session.amount_total of the add-on
  addonPurchasedAt     DateTime?
```

The existing `shippingName`/`shippingLine1`/… and `podOrderId`/`podStatus`
columns are reused (their comments say "Feature/Collector only" — update those
comments to say shipping is now filled by the **add-on** checkout).

### Migration file

Create `prisma/migrations/20260728120000_addon_flow/migration.sql`:

```sql
-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "addonType" TEXT,
ADD COLUMN     "addonStripeSessionId" TEXT,
ADD COLUMN     "addonPaidCents" INTEGER,
ADD COLUMN     "addonPurchasedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "Order_addonStripeSessionId_key" ON "Order"("addonStripeSessionId");
```

Then `npx prisma generate` (no DB). Confirm `generated/prisma` now types the
new fields.

---

## 2. Stripe helper (`lib/stripe.ts`)

Add alongside the existing `Tier` helpers (do not remove those):

```ts
export type AddonType = "poster" | "canvas";

/** Env: STRIPE_PRICE_ADDON_POSTER / STRIPE_PRICE_ADDON_CANVAS. */
export function getAddonPriceId(addon: AddonType): string | null {
  switch (addon) {
    case "poster": return process.env.STRIPE_PRICE_ADDON_POSTER || null;
    case "canvas": return process.env.STRIPE_PRICE_ADDON_CANVAS || null;
  }
}

/** Reverse lookup for the webhook: Price ID -> add-on type. */
export function priceIdToAddon(priceId: string): AddonType | null {
  if (priceId === process.env.STRIPE_PRICE_ADDON_POSTER) return "poster";
  if (priceId === process.env.STRIPE_PRICE_ADDON_CANVAS) return "canvas";
  return null;
}
```

---

## 3. Add-on checkout route (`app/api/addon-checkout/route.ts`, NEW)

`POST { orderId: string, approveToken: string, addon: "poster" | "canvas" }`

Steps:
1. Parse/validate JSON. `addon` must be `"poster"|"canvas"` → else 400.
2. Load order by `id: orderId`. Not found → 404.
3. **Auth**: `order.approveToken === approveToken` (constant-time not required;
   it's a cuid) → else 403. (Same token-as-auth model as the approve page.)
4. Guard: `order.status !== "COMPLETED"` → 409 "Available after your film is
   delivered." (Add-ons only at the emotional peak.)
5. Guard: `!order.posterPrintUrl` → 409 "No print-ready poster on this order."
   (Can't fulfil a physical print without the flattened art.)
6. Guard: `order.addonStripeSessionId` already set → 409 "You've already added a
   physical piece to this order."
7. `getStripeClient()` null → 503 "Payments aren't configured yet."
8. `getAddonPriceId(addon)` null → 500 "This add-on isn't configured yet."
9. Create session:
   ```ts
   const base = process.env.APP_BASE_URL ?? "http://localhost:3100";
   const session = await stripe.checkout.sessions.create({
     mode: "payment",
     line_items: [{ price: priceId, quantity: 1 }],
     shipping_address_collection: { allowed_countries: ADDON_SHIP_COUNTRIES },
     client_reference_id: order.id,
     metadata: { kind: "addon", orderId: order.id, addonType: addon },
     consent_collection: { terms_of_service: "required" },
     custom_text: {
       terms_of_service_acceptance: {
         message: "I agree to the [Marquee Tails Terms of Service](URL) and [Refund Policy](URL).",
       },
     },
     success_url: `${base}/approve/${order.approveToken}?addon=success`,
     cancel_url: `${base}/approve/${order.approveToken}`,
   });
   return NextResponse.json({ ok: true, url: session.url });
   ```
   Wrap in try/catch → 500 "Something went wrong on our end." (mirror
   `app/api/checkout/route.ts`).

`ADDON_SHIP_COUNTRIES` (module const) — a sensible launch set the owner can
expand; Printify ships these widely:
```ts
const ADDON_SHIP_COUNTRIES = [
  "US","CA","GB","AU","NZ","IE","JP",
  "DE","FR","ES","IT","NL","BE","AT","SE","DK","FI","NO","PT","PL","CH",
] as const;
```
(Stripe types want `Stripe.Checkout.SessionCreateParams.ShippingAddressCollection.AllowedCountry[]`
— cast/annotate so `tsc` is happy.)

---

## 4. Webhook (`app/api/webhooks/stripe/route.ts`)

Branch the existing `checkout.session.completed` handler on
`session.metadata?.kind === "addon"`. Keep the current **base** path unchanged
as the `else`.

Add-on branch:
1. `orderId = session.metadata.orderId`; `addonType = session.metadata.addonType`
   (validate it's `"poster"|"canvas"`; unknown → log + return 200 so Stripe
   stops retrying).
2. Resolve shipping from `session.collected_information?.shipping_details`
   (same nesting the base path already uses).
3. **Idempotent claim** — atomically attach the add-on only if not already set:
   ```ts
   const { count } = await prisma.order.updateMany({
     where: { id: orderId, addonStripeSessionId: null },
     data: {
       addonType,
       addonStripeSessionId: session.id,
       addonPaidCents: session.amount_total ?? 0,
       addonPurchasedAt: new Date(),
       shippingName: shipping?.name ?? null,
       shippingLine1: shipping?.address?.line1 ?? null,
       shippingLine2: shipping?.address?.line2 ?? null,
       shippingCity: shipping?.address?.city ?? null,
       shippingRegion: shipping?.address?.state ?? null,
       shippingPostalCode: shipping?.address?.postal_code ?? null,
       shippingCountry: shipping?.address?.country ?? null,
     },
   });
   if (count !== 1) {
     // already processed (replay) or order gone — idempotent no-op
     return NextResponse.json({ ok: true, duplicate: true });
   }
   ```
4. Reload the order, then fire side effects (fire-and-forget, never fail the
   webhook): `createPodOrder(order)` (§6) and `sendAddonConfirmationEmail(order)`
   (§7). Wrap each in try/catch + `console.error`.
5. Return 200.

Base branch: unchanged (it still creates the Order row for a plan purchase).
Optionally set `metadata: { kind: "base" }` on the base checkout for symmetry —
not required; absence of `kind` already means base.

---

## 5. Printify (`lib/printify.ts`)

Re-key `configFor` off the **add-on type** (not `tier`) and read IDs from env
so the owner supplies the blueprint/provider/variant IDs confirmed during the
Phase 5 Printify test:

```ts
function configFor(addonType: string | null): TierPrintConfig | null {
  if (addonType !== "poster" && addonType !== "canvas") return null;
  const env = addonType === "poster"
    ? { b: "PRINTIFY_POSTER_BLUEPRINT_ID", p: "PRINTIFY_POSTER_PROVIDER_ID", v: "PRINTIFY_POSTER_VARIANT_ID" }
    : { b: "PRINTIFY_CANVAS_BLUEPRINT_ID", p: "PRINTIFY_CANVAS_PROVIDER_ID", v: "PRINTIFY_CANVAS_VARIANT_ID" };
  const blueprintId = process.env[env.b];
  const printProviderId = process.env[env.p];
  const variantId = process.env[env.v];
  if (!blueprintId || !printProviderId || !variantId) return null;
  return { blueprintId, printProviderId, variantId };
}
```

In `createPrintifyOrder`, call `configFor(order.addonType)` instead of
`configFor(order.tier ?? "")`. Everything else (address_to, print_areas.front =
`order.posterPrintUrl`, error handling) stays. Update the file-level comment:
Printify now fires for a purchased physical **add-on**, not at base checkout.

---

## 6. `createPodOrder` (`lib/mocks.ts`)

Change the guard so it fires when an add-on was purchased:
```ts
export async function createPodOrder(order: Order): Promise<void> {
  if (!order.addonType) {
    console.log(`[pod] skip — order=${order.id} no physical add-on purchased`);
    return;
  }
  // ... existing dynamic import + createPrintifyOrder + podOrderId update + try/catch ...
}
```
Keep the "never let POD failure block delivery" comment/behaviour.

---

## 7. Add-on confirmation email (`lib/mocks.ts`, NEW `sendAddonConfirmationEmail`)

Follow the exact 3-tier pattern (Klaviyo → Resend → console) of
`sendDeliveryEmail`. Klaviyo metric name: `"Addon Purchased"` with properties
`{ order_id, addon_type, pet_name }`. Resend subject/body e.g.:
- subject: `Your ${petName} keepsake is on its way`
- body: a short "We're printing your {printed poster|gallery canvas} and will
  email tracking when it ships." Map `addonType` → human label
  (`poster` → "printed poster", `canvas` → "gallery canvas").
Console fallback mirrors the others.

Also update **`sendDeliveryEmail`**: add one CTA line under the watch/download
link pointing at the approve page (`link`), e.g.:
`<p><a href="${link}">Make it a keepsake — add a printed poster or gallery canvas →</a></p>`
(Only in the Resend HTML branch; the Klaviyo branch is template-owned, leave it.)

---

## 8. Gate-2 delivery (`lib/approvals.ts`)

At Gate 2 the order has no add-on yet, so `createPodOrder` there is now always a
no-op and misleading. **Remove** the `await createPodOrder(updated);` call from
`approveVideo` and drop the now-unused import. Keep the poster-print render (it
produces `posterPrintUrl`, which the add-on flow needs). Update the surrounding
comment: physical fulfilment is now add-on-driven (webhook), not Gate 2.
`sendDeliveryEmail(updated)` stays.

---

## 9. Customer UI — the upsell

### `components/AddonUpsell.tsx` (NEW, client component)

Props (primitives only — no Prisma types in a client component):
`{ orderId: string; approveToken: string; petName: string; posterUrl: string | null; purchasedAddon: string | null }`

Behaviour:
- If `purchasedAddon` is set → render a calm confirmation card: "Your {label} is
  on its way — we'll email tracking." (label map poster/canvas as in §7.)
- Else render two option cards styled to match `components/PricingTeaser.tsx`
  (gold/glass, `btn-marquee`): **Printed Poster — $59** and **Gallery Canvas —
  $99**, each with a small `poster.png`/`posterUrl` thumbnail and a one-line
  value blurb ("Museum-grade paper" / "Gallery-wrapped canvas, ready to hang").
  A button per option POSTs `{ orderId, approveToken, addon }` to
  `/api/addon-checkout` and `window.location.assign(data.url)` on success —
  same handler shape as `PricingTeaser.handleBuy` (loading + error states).
- Section heading like "Make it real." + subcopy "Your poster, printed and
  shipped. Free digital version is already yours."

Keep it self-contained and match the cinema aesthetic (reuse existing utility
classes; no new globals needed).

### Wire into `app/approve/[token]/page.tsx`

In `PremiereView` (the `COMPLETED` view), **below** the download buttons block,
render `<AddonUpsell>` **only when** `order.posterPrintUrl` is set (can't sell a
print we can't produce):
```tsx
{order.posterPrintUrl && (
  <AddonUpsell
    orderId={order.id}
    approveToken={order.approveToken}
    petName={petName}
    posterUrl={order.posterUrl}
    purchasedAddon={order.addonType}
  />
)}
```
(`PremiereView` currently only receives `order` + `petName` — it already has
`order`, so no signature change needed.)

Optional nicety: if `searchParams.addon === "success"` you may show a brief
"Thanks!" note, but the `purchasedAddon` confirmation card already covers the
post-webhook state — keep this minimal / skip if it complicates the server
component.

---

## 10. `.env.example` / docs

If a `.env.example` exists, add the new keys (empty):
`STRIPE_PRICE_ADDON_POSTER`, `STRIPE_PRICE_ADDON_CANVAS`,
`PRINTIFY_POSTER_BLUEPRINT_ID`, `PRINTIFY_POSTER_PROVIDER_ID`,
`PRINTIFY_POSTER_VARIANT_ID`, `PRINTIFY_CANVAS_BLUEPRINT_ID`,
`PRINTIFY_CANVAS_PROVIDER_ID`, `PRINTIFY_CANVAS_VARIANT_ID`.
Do not put real values anywhere.

---

## 11. Verification (static only — no DB, no live Stripe locally)

Run and report output:
- `npx prisma generate` (must succeed; new fields typed)
- `npx tsc --noEmit` (must be 0 errors)
- `npx eslint` on every file you created/changed (must be clean)
- `npm run build` — attempt it; if it hangs or errors **because it tries to
  reach the DB/Stripe** (it shouldn't for these dynamic routes), stop it and
  say so, relying on tsc instead. Report the real result either way.

Do **not** attempt to run the dev server against the DB or create test orders
(that DB is production).

## 12. Report back

Summarise: files changed/created, the exact migration SQL, any deviations from
this brief and why, and the verification results (paste tsc/eslint/build tails).
Flag anything you were unsure about rather than guessing silently.

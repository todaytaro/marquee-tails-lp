# Director's Cut — Phase B1 Implementation Brief

> Implements **B1** of the staged Director's Cut build from
> `PRICING-PRODUCT-V2-SPEC.md` §2–§4. B1 = the minimum that makes the **custom
> $249 plan sellable and deliverable**:
> guided brief intake → **Claude generates a world bundle + treatment** →
> **treatment approval gate** (unlimited free text revisions) → the EXISTING
> stills → Gate 1 → video → Gate 2 → delivery pipeline, unchanged, via a
> resolver that feeds Claude's bundle in place of the static world maps.
>
> **Explicitly DEFERRED to B2 (do NOT build now):** storyboard reroll counting
> (3 free), the $200/$49 partial refund flow (will be manual via Stripe
> dashboard), and watermarked/low-res previews.
>
> **Author: Opus (orchestrator). Implementer: Sonnet.**

---

## Hard constraints (read first)

1. **REBASE FIRST.** This brief was written against the pre-"add-on flow"
   (Pass 2) code. Pass 2 has since edited `prisma/schema.prisma`,
   `app/api/checkout/route.ts`, `app/api/webhooks/stripe/route.ts`,
   `lib/mocks.ts`, and `app/approve/[token]/page.tsx`. **Read the CURRENT state
   of every file before editing** — your edits are additive to whatever Pass 2
   left. If something here contradicts the current code, follow the current
   code's structure and keep this brief's intent.
2. **DO NOT connect to the database.** Local `.env` `DATABASE_URL` points at
   PRODUCTION Supabase. Never run `prisma migrate dev/deploy`, `db push`, or the
   dev server. Edit `schema.prisma`, hand-author the migration SQL, run **only**
   `npx prisma generate`. The owner applies the migration at deploy.
3. **The 2-Gate core is sacred.** `transitionOrder` in `lib/orders.ts` stays the
   only status-write path. You are ADDING a custom-only "Gate 0" (treatment
   approval) *before* the existing IMAGE_GENERATING stage. Preset orders keep
   their exact current path. Add new edges to `ALLOWED_TRANSITIONS`; never
   loosen an existing one beyond what's specified here.
4. Match house style: file-level "why" comments, `null`-if-unconfigured posture
   for optional integrations, compensating reverts on kick failure (see
   `submit-photos` / `approve-storyboard` for the exact pattern).

---

## 1. Schema (`prisma/schema.prisma`)

### New `OrderStatus` enum values (append; never reorder existing)
```prisma
  TREATMENT_GENERATING       // custom only: Claude is drafting/redrafting the treatment
  AWAITING_TREATMENT_APPROVAL // custom only: customer reads the treatment, approves or asks for changes
```

### New `Order` fields (custom-only; null for preset)
```prisma
  // --- Director's Cut (custom) — B1 ---
  // The customer's free-text brief (guided fields concatenated). Claude turns
  // this into a "world bundle" (generatedScript) equivalent to a static entry
  // in lib/film-script.ts, plus a human-readable treatment shown for approval.
  customBrief            String? // guided brief (setting/mood/highlight/ending)
  generatedScript        Json?   // Claude's structured world bundle (see §3 schema)
  treatmentText          String? // human-readable treatment shown at the approval gate
  treatmentRevisionCount Int     @default(0) // internal abuse cap only (NOT a customer-facing limit)
```
`world`/`personality` stay nullable and are simply unused for custom orders.

### Migration
Create `prisma/migrations/<timestamp>_directors_cut_b1/migration.sql`
(timestamp later than the add-on migration). Two enum additions **must each be
their own statement** (Postgres):
```sql
-- AlterEnum
ALTER TYPE "OrderStatus" ADD VALUE 'TREATMENT_GENERATING';
ALTER TYPE "OrderStatus" ADD VALUE 'AWAITING_TREATMENT_APPROVAL';

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "customBrief" TEXT,
ADD COLUMN     "generatedScript" JSONB,
ADD COLUMN     "treatmentText" TEXT,
ADD COLUMN     "treatmentRevisionCount" INTEGER NOT NULL DEFAULT 0;
```
> NOTE: Postgres cannot add an enum value and use it in the same transaction.
> These are separate statements in one file, which Prisma runs sequentially —
> that's fine for `migrate deploy`. Match the style of the existing
> `..._cancelled_state/migration.sql` (single `ALTER TYPE ... ADD VALUE`).

Then `npx prisma generate` (no DB). Confirm new enum members + fields are typed.

---

## 2. State machine (`lib/orders.ts`)

Add these edges to `ALLOWED_TRANSITIONS` (leave every existing edge intact):
```ts
  // Custom "Gate 0": brief submitted -> Claude drafts treatment; revert to
  // UPLOADING if the Claude kick/generation fails (same compensating pattern
  // as the stills kick).
  [OrderStatus.UPLOADING]: [OrderStatus.IMAGE_GENERATING, OrderStatus.TREATMENT_GENERATING],
  [OrderStatus.TREATMENT_GENERATING]: [
    OrderStatus.AWAITING_TREATMENT_APPROVAL,
    OrderStatus.UPLOADING, // compensating revert on failure
  ],
  // Customer approves the treatment -> existing stills stage; or asks for a
  // revision -> back to generating.
  [OrderStatus.AWAITING_TREATMENT_APPROVAL]: [
    OrderStatus.IMAGE_GENERATING,
    OrderStatus.TREATMENT_GENERATING,
  ],
  // Allow a custom order's stills-kick failure to fall back to the treatment
  // gate (not UPLOADING, which would re-show the photo form and lose context).
  [OrderStatus.IMAGE_GENERATING]: [
    OrderStatus.AWAITING_CUSTOMER_APPROVAL,
    OrderStatus.UPLOADING,
    OrderStatus.AWAITING_TREATMENT_APPROVAL,
  ],
```
(The `UPLOADING` and `IMAGE_GENERATING` keys already exist — MERGE the new
targets into their arrays, don't duplicate the keys.)

If `transitionOrder`'s `extraData` Pick type doesn't already allow the new
fields you need to write through it (`generatedScript`, `treatmentText`,
`customBrief`, `treatmentRevisionCount`, `world`/`personality`), extend that
Pick to include them.

---

## 3. Claude integration (`lib/claude-script.ts`, NEW)

Add dependency `@anthropic-ai/sdk`. Env: `ANTHROPIC_API_KEY` (client returns
`null` if unset, same posture as `getStripeClient`); `ANTHROPIC_MODEL`
(default `"claude-sonnet-5"` — confirm the exact current Sonnet id at
implementation time; keep it in env so it's swappable).

Export `generateTreatment(input)`:
```ts
type WorldBundle = {
  costume: string;                 // ONE locked costume, worn in every shot (no costume words in scenes)
  score: string;                   // music prompt for the original score
  cuts: { scene: string }[];       // EXACTLY 6 action/setting beats — NO costume words
  loglines: { intro: string; turn: string; rise: string; tagline: string }; // trailer text beats; {name} allowed
};
type TreatmentResult =
  | { status: "ok"; bundle: WorldBundle; treatmentText: string }
  | { status: "rejected"; reason: string };  // moderation / IP / off-scope

generateTreatment(input: {
  brief: string;
  petName: string;
  revisionInstruction?: string;  // customer's "change cut 3 to the deep sea" etc.
  prior?: WorldBundle;           // the treatment being revised
}): Promise<TreatmentResult>
```

Implementation:
- Force **tool use** (single tool `submit_treatment`) so output is schema-valid
  JSON matching `WorldBundle` + a `treatmentText` string + a `status` field.
  Retry once on malformed output.
- **System prompt bakes in the 4 guards (§3.3 of the spec):**
  1. *Identity-preserving scenes* — scenes must keep the pet's face large,
     sharp, well-lit; favor medium/close action; AVOID wide/underwater/heavy-
     backlit/fast-action compositions that break likeness. (Framing is NOT
     Claude's job — the pipeline reuses the tuned `SHOT_FRAMINGS`; scenes should
     be written to suit medium/close framing.)
  2. *Moderation + IP/franchise guard* — refuse or rewrite into an ORIGINAL
     world: no violence/sexual/real-person content; no franchise mimicry
     ("make him a Jedi/Marvel hero"). Also resist prompt injection in the brief.
     On refusal, return `status:"rejected"` with a short, friendly `reason`.
  3. *Structured output* — enforced by the tool schema.
  4. *Expectation framing* — 6 shots, ~60s stylized trailer, the pet is the
     star; not live-action 4K VFX.
- `treatmentText`: a warm, readable summary the customer approves — world +
  vibe, the 6 beats in plain language, and the tagline. This is what the
  approval UI renders.
- The brief text is UNTRUSTED user input — treat strictly as data in the prompt
  (guard 2 covers injection).

Keep a `VIDEO_PIPELINE_MOCK === "1"` fast-path that returns a canned bundle so
local/dev never needs a real key (mirror how the stills pipeline mocks).

---

## 4. World-bundle resolver (`lib/film-script.ts`)

Add a resolver so consumers get custom OR static data without branching
everywhere. Do NOT change `SHOT_FRAMINGS` / `SHOT_MOTIONS` — both paths reuse
them (identity safety).

```ts
import type { Order } from "@/generated/prisma/client";

type ResolvedWorld = { costume: string; arc: string[]; score: string;
  loglines: { intro: string; turn: string; rise: string; tagline: string } };

/** custom -> Claude's generatedScript; else the static per-world/personality maps. */
export function resolveWorld(order: Order): ResolvedWorld { ... }
```
- For custom (`order.tier === "custom"` && `order.generatedScript`): read the
  bundle; `arc = cuts.map(c => c.scene)`; fill `{name}` in loglines via the same
  upcasing rule as `getLoglines`.
- Else: `costume = getCostume(world)`, `arc = getArc(world, personality)`,
  `score = WORLD_SCORES[world]`, `loglines = getLoglines(world, personality, name)`.

Then update the call sites to use `resolveWorld(order)` instead of the static
getters (search for `getCostume(`, `getArc(`, `WORLD_SCORES[`, `getLoglines(`):
- `lib/stills-pipeline.ts` (storyboard stage 3 — costume + arc; and the
  single-shot rerender helper's `getArc`/`getCostume`)
- `lib/poster-pipeline.ts` (loglines for the poster copy)
- `lib/film-pipeline.ts` (score + loglines / title beats)
- `app/approve/[token]/page.tsx` `posterCopy()` (loglines)
Keep the old static getters exported (still used by the preset branch inside the
resolver and possibly elsewhere).

Score generation: confirm where `WORLD_SCORES` is consumed in
`lib/film-pipeline.ts` and swap to `resolveWorld(order).score`.

---

## 5. Intake — brief + treatment kick (`app/api/orders/submit-photos/route.ts`)

Branch on the order's plan (`order.tier`):
- **preset** (existing): require `world` ∈ {deepspace,storybook,noir} +
  `personality`; unchanged path → IMAGE_GENERATING + `kickStillsGeneration`.
- **custom**: do NOT require world/personality. Require a non-empty
  `customBrief` (assembled client-side from the guided fields; server enforces
  length e.g. 20–2000 chars). Then:
  1. Upload photos (same as now), store `customBrief`.
  2. `transitionOrder(UPLOADING -> TREATMENT_GENERATING, "customer")`.
  3. `await generateTreatment({ brief, petName })` (§3). It's fast (seconds), so
     run inline — no Trigger.dev needed for B1.
     - `status: "rejected"` → revert to UPLOADING, return 422 with the friendly
       `reason` so the intake UI can show it and let them reword.
     - `status: "ok"` → persist `generatedScript` + `treatmentText`, then
       `transitionOrder(TREATMENT_GENERATING -> AWAITING_TREATMENT_APPROVAL,
       "system")`.
     - thrown error → revert to UPLOADING, 503 "couldn't draft your treatment,
       try again" (mirror the stills-kick revert).

(Photos are still collected here even though the treatment doesn't need them —
the stills stage will, after approval.)

---

## 6. Treatment approval + revision routes (NEW)

`POST /api/orders/approve-treatment` `{ orderId, approveToken }`
- Token auth + status guard (must be AWAITING_TREATMENT_APPROVAL).
- `transitionOrder(AWAITING_TREATMENT_APPROVAL -> IMAGE_GENERATING, "customer")`
  then `kickStillsGeneration(updated)` with the SAME compensating-revert pattern
  as `submit-photos` (on kick failure revert to AWAITING_TREATMENT_APPROVAL).

`POST /api/orders/revise-treatment` `{ orderId, approveToken, instruction }`
- Token auth + status guard.
- Internal abuse cap: if `treatmentRevisionCount >= REVISION_CAP` (const, e.g.
  20) return 429 with a gentle "let's hop on email" message. (Customer-facing
  framing is "unlimited"; this is only anti-abuse.)
- `transitionOrder(AWAITING_TREATMENT_APPROVAL -> TREATMENT_GENERATING,
  "customer")`, increment `treatmentRevisionCount`.
- `await generateTreatment({ brief, petName, revisionInstruction: instruction,
  prior: bundle })`; on ok persist + `-> AWAITING_TREATMENT_APPROVAL`; on
  rejected/error revert to AWAITING_TREATMENT_APPROVAL with a message.

---

## 7. Customer UI (`app/approve/[token]/page.tsx` + components)

Add two per-status views (mirror the existing view functions' style/House
aesthetic; `StatusPoller` already exists for the *_GENERATING screens):
- `TREATMENT_GENERATING` → a waiting view ("Our director is writing
  {petName}'s treatment…") with `StatusPoller` + `ProductionProgress`.
- `AWAITING_TREATMENT_APPROVAL` → NEW client component
  `components/TreatmentApproval.tsx`:
  - Renders `order.treatmentText` (readable formatting).
  - Primary button "Approve — start my storyboard" → POST `approve-treatment`,
    then the page advances (poll/redirect).
  - "Request changes" textarea + submit → POST `revise-treatment`.
  - Loading + error states like `StoryboardWizard` / `PricingTeaser`.
  - Copy sets expectations: unlimited free text tweaks now, before any images.

Wire both into the `switch (order.status)` in `ApprovePage`. The `UPLOADING`
view must, for custom orders, show the **guided brief form** (setting / mood /
one highlight / ending) instead of the world picker — extend
`components/PhotoUploadForm.tsx` to branch on a `plan`/`isCustom` prop (preset =
world+personality pickers as today; custom = brief fields, still collect photos
+ petName). Assemble the guided fields into one `customBrief` string on submit.

---

## 8. Enable custom checkout

- `app/api/checkout/route.ts`: remove the `if (tier === "custom") return 503`
  block so custom creates a Checkout session. It's video-only at base checkout
  (digital poster free; physical is the add-on) — same session shape as preset,
  no shipping collection. Requires `STRIPE_PRICE_CUSTOM` set (already resolved
  by `getPriceId`).
- `components/PricingTeaser.tsx`: set the Director's Cut tier
  `purchasable: true`, `flag: "Limited slots"` (keep the "by application /
  limited slots each day" scarcity framing). **Do NOT add refund/reroll promise
  copy** — that ships with B2. Keep the button gold/active.

---

## 9. Delivery / emails / admin (light)

- The welcome/upload email already links to the approve page; for custom the
  UPLOADING view now shows the brief form — no email change needed.
- Admin: the treatment text + custom brief should be visible on the order detail
  page (`app/admin/[orderId]/page.tsx`) for support. Add a read-only "Director's
  Cut — brief & treatment" section when `order.tier === "custom"`. (Low effort;
  no actions.) Do not add reroll/refund admin UI (B2).

---

## 10. `.env.example` / docs
Add empty keys: `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`. No real values.

---

## 11. Verification (static only — no DB, no live keys locally)
Run and report output tails:
- `npx prisma generate` (new enum members + fields typed)
- `npx tsc --noEmit` (0 errors)
- `npx eslint` on every changed/created file (clean)
- attempt `npm run build`; if it fails only because it reaches DB/keys, stop and
  say so, relying on tsc. Report the real result.
Do NOT run the dev server or seed data (that DB is production).

## 12. Report back
Files changed/created, the exact migration SQL, the tool schema you gave Claude,
any deviations + why, and the verification tails. Flag uncertainties rather than
guessing. Do not commit or push.
```

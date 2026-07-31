import { fal } from "@fal-ai/client";
import { tasks } from "@trigger.dev/sdk";
import type { generateStillsTask } from "@/trigger/stills";
import { OrderStatus, type Order } from "@/generated/prisma/client";
import { prisma } from "./db";
import { transitionOrder } from "./orders";
import { sendChooseStillEmail } from "./mocks";
import { resolveWorld, SHOT_FRAMINGS } from "./film-script";
import { VISION_MODEL, VISION_LLM, publicUrl, scoreIdentity } from "./identity";
import { watermarkTakeForPreview } from "./watermark";

/**
 * Storyboard generation — the whole Gate-1 payload, generated BEFORE approval.
 *
 * Likeness is THE conversion moment ("that's my pet!"), and the fix for
 * "cuts 2-6 don't look like my dog" is to put a HUMAN pick on every cut, not
 * just the first. So we front-load the entire storyboard here and let the
 * customer pick one take per cut in the Gate-1 wizard:
 *
 *   Stage 0  describePet      VLM extracts distinguishing features as text
 *                             (coat, mouth/tongue, tail, ears, and — per
 *                             IDENTITY-FIDELITY-SPEC.md §2.3 — how this
 *                             individual deviates from a breed-standard
 *                             example) — injected into every downstream
 *                             prompt so the model can't drift to a generic
 *                             breed prototype.
 *   Stage 1  identityPortrait Neutral studio close-up — locks the face BEFORE
 *                             any costume/scene transformation. Per
 *                             IDENTITY-FIDELITY-SPEC.md §2.4, this is now
 *                             ITSELF gated at 80 against the customer's real
 *                             photo (generateGatedPortrait) before anything
 *                             downstream is built from it — this is the
 *                             single highest-leverage gate in the pipeline,
 *                             since a drifted portrait poisons the hero sheet
 *                             AND all 18 takes.
 *   Stage 2  heroSheet        The pet in the film's LOCKED costume — the
 *                             shared costume anchor for all 18 takes (keeps
 *                             costume identical). NOT the identity anchor —
 *                             see Stage 3.
 *   Stage 3  storyboard       6 cuts × 3 takes = 18 stills. Every take is
 *                             referenced to the customer's REAL photo first
 *                             (identity anchor) + hero sheet (costume anchor)
 *                             + portrait, gated at 80 against the REAL PHOTO
 *                             (IDENTITY-FIDELITY-SPEC.md §2.1 — previously
 *                             gated against the portrait, which is the bug
 *                             that spec fixes), and rendered with a DISTINCT
 *                             seed so the three takes are genuinely different
 *                             ("similar-to-my-pet" is a real axis to choose on).
 *
 * The film pipeline (lib/film-pipeline.ts) no longer generates stills — it just
 * animates the six the customer picked.
 *
 * Cost: ~$0.01 (VLM) + $0.15 (portrait) + $0.15 (hero) + 18×$0.15 (takes) ≈
 * $3.0/order. Ops pattern unchanged: detached async in dev, compensating
 * revert to UPLOADING on failure, VIDEO_PIPELINE_MOCK short-circuit for e2e.
 */

// Exported: film-pipeline.ts reuses this exact model id for §5.2's end-frame
// generation (same nano-banana edit call, different caller) rather than
// hardcoding a second copy of the endpoint id.
export const EDIT_MODEL = "fal-ai/nano-banana-pro/edit";

// Exported: app/api/orders/reroll-cut/route.ts validates cutIndex against
// this same bound (0..NUM_CUTS-1) rather than hardcoding "6" a second time.
export const NUM_CUTS = 6;
// Exported for the same reason as NUM_CUTS above (test enumeration).
export const TAKES_PER_CUT = 3;

export const IDENTITY_RULES =
  "Preserve this exact pet's identity from the reference photos: the same coat colors in the same places, the same fur texture and haircut, the same face structure, eyes, ears and proportions. Do NOT idealize, do NOT groom them differently, do NOT drift toward a generic breed look. No text, no watermark, no humans.";

// Style lock — deepspace especially drifts toward a Pixar/CG look, which owners
// read as "not a real photo of my dog". Injected into every take and hero sheet.
export const STYLE_RULES =
  "Strictly photorealistic live-action photography: real fur texture, natural skin of the nose, true-to-life lighting and lens optics. NOT cartoon, NOT CGI, NOT 3D render, NOT illustration, NOT stylized animation.";

// Per-cut framing lives in film-script (SHOT_FRAMINGS) so each cut has its own
// composition (wide/close/low-angle/…) instead of one identical medium shot.

// Identity gate: takes below this score against the customer's REAL PHOTO
// (IDENTITY-FIDELITY-SPEC.md §2.1 — see generateGatedTake) are re-rolled
// before they ever reach the customer.
const IDENTITY_THRESHOLD = 80;
// Exported: scripts/test-safety-net.ts uses this (plus STILL_SEED/NUM_CUTS/
// TAKES_PER_CUT below) to enumerate every seed the ORIGINAL stage-3
// generation can possibly use, so it can prove rerollSeedBase's seeds never
// land in that set — see rerollSeedBase's comment.
export const MAX_TAKE_REROLLS = 2;
/*
 * OFF until the $200 pre-production refund exists.
 *
 * Watermarking Gate 1 has exactly one justification (PRICING-PRODUCT-V2-SPEC
 * §3.5(C)): stopping someone from paying $249, keeping the storyboard,
 * claiming the $200 back and walking off with 18 usable 2K stills for $49.
 * That refund is B2 and is not built, so right now the customer cannot get
 * their money back and there is nothing to walk away with — the exploit the
 * marks defend against has no entry point.
 *
 * What the marks do cost is real: soft, marked-up artwork at the exact moment
 * the customer first sees their pet as the star, a paragraph of reassurance
 * that only exists to explain the marks, and a production order lost to an OOM
 * in the render pass. Chargebacks don't argue for it either — the finished
 * film ships clean, so the marks protect nothing there.
 *
 * Set this back to `true` in the same change that ships the refund. Nothing
 * else needs touching: with it off, `preview === clean`, which is already the
 * shape a legacy row and a failed watermark render both produce, so every
 * downstream read (normalizeStoryboard, the props-stripping in Gate1View, the
 * pick resolution in approve-storyboard) behaves exactly as it does today.
 */
const WATERMARK_PREVIEWS_ENABLED = false;
// How many Gate-1 preview derivatives to render at once (see stage 4 below).
// Each one decodes a 2K PNG in ffmpeg, so this is a memory ceiling, not a
// rate limit — 4 keeps the peak flat no matter how many takes exist.
const WATERMARK_CONCURRENCY = 4;
// Base seed; each (cut, take, reroll) gets a distinct offset so the three
// takes of a cut are genuinely different renders, not near-duplicates.
// Exported: rerollSeedBase (below) and scripts/test-safety-net.ts both need
// it to reason about the ORIGINAL stage-3 seed range a B2 re-roll must avoid.
export const STILL_SEED = 77021;

/*
 * B2-SAFETY-NET-SPEC.md §3.1 / "THE PARTS THAT WILL BITE": a re-roll that
 * returns the same three images is a re-roll the customer paid for and
 * didn't get, so its seeds must never collide with a seed already used for
 * THAT SAME CUT (a collision against a DIFFERENT cut doesn't matter — that
 * cut's scene text differs, so an identical numeric seed still renders a
 * different image; see generateTakeOnce's prompt, which always includes the
 * scene).
 *
 * Stage 3 (runStillsGeneration) already uses this exact shape for a cut's 3
 * takes: STILL_SEED + cut*100 + take*1000, then generateGatedTake adds its
 * own attempt*7919 on top for up to MAX_TAKE_REROLLS retries. For one cut,
 * across all TAKES_PER_CUT takes and MAX_TAKE_REROLLS+1 attempts, that's
 * `take*1000 + attempt*7919` for take/attempt in 0..2 — 9 values, all
 * distinct (7919 is prime and not a multiple of 1000, so the map is
 * injective), spanning at most 2000 + 2*7919 = 17838 above the cut's base.
 *
 * REROLL_SEED_BAND is chosen far larger than that whole spread (17838), so a
 * re-roll's seed = STILL_SEED + cut*100 + REROLL_SEED_BAND*rerollCount +
 * take*1000 + attempt*7919 lands in its own band, disjoint from band 0 (the
 * original stage-3 generation) BY CONSTRUCTION — not "very unlikely to
 * collide" the way a Date.now()-derived seed (as reshootCutStill below uses
 * for its own, unrelated, admin-only Gate-2 re-render) would be.
 *
 * `rerollCount` is the ORDER-WIDE, atomically-incremented storyboardRerollCount
 * AFTER increment (1, 2, or 3 — see app/api/orders/reroll-cut/route.ts). The
 * guarded `updateMany` there makes each value 1..STORYBOARD_REROLL_CAP occur
 * for AT MOST ONE reroll request across the order's entire lifetime, so even
 * if the SAME cut is re-rolled twice, those two events land in two different
 * bands (e.g. 1 and 2) and can never repeat each other's seeds either —
 * whether or not they touch the same cut.
 */
const REROLL_SEED_BAND = 1_000_000;

/** See the block comment above — exported so scripts/test-safety-net.ts can
 *  prove the no-collision property directly, without a database. */
export function rerollSeedBase(cutIndex: number, rerollCount: number): number {
  return STILL_SEED + cutIndex * 100 + REROLL_SEED_BAND * rerollCount;
}

// FILM-QUALITY-V3-SPEC.md §4.2: generateTakeOnce's prompt had no mouth/tongue
// direction at all, so the model defaulted to "a happy dog" = tongue out —
// correct for `playful`, wrong for every other world/personality (the owner's
// complaint was specifically a 1980s citypop "cool, composed" world reading as
// goofy instead). `playful` is the only personality this should be skipped
// for; every other value, INCLUDING `null` (a custom/Director's Cut order has
// no personality field at all), gets the closed-mouth direction — a custom
// order has no reason to default to the "playful" look just because it has
// no explicit personality.
const CLOSED_MOUTH_DIRECTIVE = "mouth closed, no lolling tongue, composed expression";

/** Per FILM-QUALITY-V3-SPEC.md §4.2 — see CLOSED_MOUTH_DIRECTIVE above. */
function expressionDirective(personality: string | null): string {
  return personality === "playful" ? "" : CLOSED_MOUTH_DIRECTIVE;
}

function assertEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

/**
 * Stage 0 — one VLM pass over the uploads that both (a) extracts the pet's
 * distinguishing features and (b) auto-sorts the photos by angle, so the
 * cleanest FRONT-FACING shot seeds the identity portrait.
 * No per-photo labeling asked of the customer (auto-detect, not manual).
 */
async function analyzePhotos(
  photoUrls: string[]
): Promise<{ description: string; bestFrontalIndex: number; hasFrontal: boolean }> {
  const n = Math.min(photoUrls.length, 6);
  const r = await fal.subscribe(VISION_MODEL, {
    input: {
      model: VISION_LLM,
      image_urls: photoUrls.slice(0, n),
      prompt:
        `These ${n} photos (indexed 0-${n - 1}) show ONE pet. Reply with ONLY minified JSON, no prose:\n` +
        `{"description":"<one dense sentence, max 70 words: exact coat colors and where they appear, fur texture/length/haircut, face shape, eye color/shape, nose, muzzle/beard/eyebrow markings, body build — features only, no name>",` +
        // These four drift the most and owners notice them, so pin each one
        // explicitly and inject verbatim into every generation prompt.
        `"mouth":"<color of the inside of the mouth/tongue and lips, e.g. pink tongue, black lips>",` +
        `"tail":"<tail length and shape, e.g. short docked stub, long feathered, curled over back>",` +
        `"ears":"<ear carriage exactly, e.g. floppy triangular drop ears, upright pointed, semi-erect>",` +
        // IDENTITY-FIDELITY-SPEC.md §1.3/§2.3: "coat colors / fur texture /
        // face shape" alone tends to describe the BREED, not the individual —
        // a generic sentence about a schnauzer's markings is true of
        // thousands of schnauzers. This field explicitly asks for the ways
        // THIS pet deviates from a breed-standard example, which is exactly
        // the information a model needs to avoid drifting back toward the
        // generic breed prototype (the owner's actual complaint: a soft,
        // overgrown, round-faced individual rendered as a neatly-groomed,
        // standard-proportioned example of the breed).
        `"distinguishingFromBreed":"<the 2-3 most important ways this INDIVIDUAL differs from a generic/breed-standard example of the same breed (not a breed description) — MUST cover: (1) current grooming/coat-length state, e.g. freshly trimmed and neat vs overgrown/shaggy and where (2) face shape vs breed-standard, e.g. rounder/softer or more angular/sharp (3) eye size impression vs breed-standard, e.g. proportionally larger/softer-looking or smaller>",` +
        `"best_frontal_index":<index of the photo with the clearest, sharpest FRONT-FACING view of the face, or -1 if none is front-facing>}`,
    },
  });
  const raw = String((r.data as { output?: string; text?: string })?.output ?? (r.data as { text?: string })?.text ?? "");
  try {
    const json = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
    const base = String(json.description ?? "").trim().slice(0, 480);
    const idx = Number.isInteger(json.best_frontal_index) ? json.best_frontal_index : -1;
    if (!base) throw new Error("empty description");
    // Pin the details owners notice most, verbatim, into the description that
    // flows to every downstream prompt (portrait, hero sheet, stills).
    const locked: string[] = [];
    if (json.mouth) locked.push(`mouth/tongue: ${String(json.mouth).trim()}`);
    if (json.tail) locked.push(`tail: ${String(json.tail).trim()}`);
    if (json.ears) locked.push(`ears: ${String(json.ears).trim()}`);
    let desc = locked.length
      ? `${base} MUST MATCH EXACTLY — ${locked.join("; ")}.`
      : base;
    // §2.3/§1.3: pinned separately from the "MUST MATCH EXACTLY" list above —
    // this isn't a literal detail like tongue color, it's an instruction NOT
    // to normalize this individual back toward the breed prototype, which is
    // the exact drift the owner's real-photo comparison caught.
    if (json.distinguishingFromBreed) {
      desc += ` Do NOT idealize toward a generic breed-standard look — this individual's actual grooming/face/eyes: ${String(json.distinguishingFromBreed).trim()}.`;
    }
    return { description: desc, bestFrontalIndex: idx >= 0 && idx < n ? idx : 0, hasFrontal: idx >= 0 };
  } catch {
    // Fallback: use whatever text came back as the description, keep order.
    const desc = raw.replace(/[{}]/g, " ").trim().slice(0, 500);
    if (!desc) throw new Error("vision model returned nothing usable");
    return { description: desc, bestFrontalIndex: 0, hasFrontal: false };
  }
}

/**
 * Stage 1 — neutral close-up that locks the face before any transformation.
 *
 * `seed` lets generateGatedPortrait (below) re-roll a drifted attempt on a
 * fresh seed, the same pattern generateTakeOnce/generateGatedTake already use
 * for stage 3.
 *
 * §2.4: this is the single highest-leverage place in the whole pipeline to
 * fix grooming drift — the portrait is the anchor for the hero sheet AND all
 * 18 takes, so if the portrait "tidies up" the pet's actual coat, every
 * downstream generation inherits that tidied-up look no matter how good the
 * take-level gate (§2.1) is. IDENTITY_RULES already said "do NOT groom them
 * differently", but the owner's actual complaint (soft, overgrown topknot
 * rendered as neatly trimmed) shows that instruction wasn't concrete enough
 * for the model to act on, so it's restated here in specific, literal terms.
 */
async function generateIdentityPortrait(
  photoUrls: string[],
  description: string,
  seed: number
): Promise<string> {
  const r = await fal.subscribe(EDIT_MODEL, {
    input: {
      prompt: `Photorealistic studio portrait photograph of this exact pet from the reference photos: ${description}. Head-and-chest close-up looking toward the camera, plain dark studio background, soft flattering key light, tack-sharp focus on the face. No clothing, no accessories. Reproduce this individual's CURRENT fur exactly as it appears in the reference photos — if it looks overgrown, shaggy, uneven, or due for a trim, render it exactly that overgrown/shaggy/uneven; do NOT trim, shorten, neaten, straighten, or otherwise groom it into a tidier or more "finished" look than the references actually show. ${IDENTITY_RULES}`,
      image_urls: photoUrls,
      num_images: 1,
      resolution: "2K",
      aspect_ratio: "3:4",
      output_format: "png",
      seed,
    },
  });
  const url = (r.data as { images?: { url?: string }[] })?.images?.[0]?.url;
  if (!url) throw new Error("identity portrait result missing image url");
  return url;
}

// Distinct seed family from STILL_SEED (stage 3 takes, below) and
// film-pipeline.ts's END_FRAME_SEED, so a shared order can never have a
// portrait re-roll land on the same numeric seed as a storyboard take or end
// frame (same "keep the bands disjoint" reasoning as rerollSeedBase's
// comment, even though a seed collision here couldn't actually reproduce a
// duplicate image — the portrait prompt is entirely different from a take's
// prompt — this just keeps every generation's seed provenance unambiguous
// when read out of logs).
const PORTRAIT_SEED = 50_000;
// Same reroll budget as a storyboard take (MAX_TAKE_REROLLS) — no reason for
// a stingier retry budget at the one gate everything downstream depends on.
const MAX_PORTRAIT_REROLLS = 2;
// §2.4: same bar as a take (IDENTITY_THRESHOLD) — the portrait is the anchor
// for every take, so it has no business clearing a LOWER bar than the takes
// it anchors.
const PORTRAIT_IDENTITY_THRESHOLD = IDENTITY_THRESHOLD;

/**
 * §2.4 — gate the identity portrait itself against the customer's real
 * photo before anything downstream (hero sheet, all 18 takes) is generated
 * from it. Previously there was NO gate here at all: the portrait was
 * generated once and trusted, so a single bad portrait-generation silently
 * poisoned the entire order. Re-rolls on a fresh seed like generateGatedTake;
 * returns the best attempt regardless so an order is never blocked here.
 *
 * `realPhotoUrl` can be undefined only if the order has no usable uploaded
 * photo at all — uploads are mandatory, so this is a defensive branch, not
 * the intended path. Per HARD CONSTRAINT #3 (never fail an order over this
 * fix), that case skips the gate entirely and generates one ungated
 * portrait — today's pre-fix behavior — rather than throwing.
 */
async function generateGatedPortrait(
  photoUrls: string[],
  description: string,
  realPhotoUrl: string | undefined,
  orderId: string
): Promise<string> {
  if (!realPhotoUrl) {
    console.warn(
      `[stills] order=${orderId}: no real photo available for portrait identity gate — generating ungated portrait (pre-fix behavior)`
    );
    return generateIdentityPortrait(photoUrls, description, PORTRAIT_SEED);
  }
  let best = "";
  let bestScore = -1;
  for (let attempt = 0; attempt <= MAX_PORTRAIT_REROLLS; attempt++) {
    const seed = PORTRAIT_SEED + attempt * 7919; // 7919 (prime): same re-roll-offset convention as generateGatedTake
    const url = await generateIdentityPortrait(photoUrls, description, seed);
    const score = await scoreIdentity(realPhotoUrl, url);
    console.log(`[stills] portrait attempt ${attempt} order=${orderId}: identity ${score} (vs real photo)`);
    if (score > bestScore) {
      bestScore = score;
      best = url;
    }
    if (score >= PORTRAIT_IDENTITY_THRESHOLD) return url;
  }
  console.warn(
    `[stills] order=${orderId}: best portrait identity ${bestScore} (< ${PORTRAIT_IDENTITY_THRESHOLD}), using best attempt — every downstream hero sheet/take will inherit this drift`
  );
  return best;
}

/**
 * Stage 2 — hero sheet: the pet in the film's LOCKED costume, neutral pose.
 * Generated once and referenced by every take, so costume, tail and face stay
 * identical across cuts (the fix for shot-to-shot drift).
 */
async function generateHeroSheet(refs: string[], description: string, costume: string): Promise<string> {
  const r = await fal.subscribe(EDIT_MODEL, {
    input: {
      prompt: `Full-body character reference of this exact pet from the reference images — ${description} — ${costume}. Standing in a neutral three-quarter pose, facing the camera, plain neutral studio background, even soft lighting, the whole body and tail visible and in focus. This is the definitive costumed look of the character. ${STYLE_RULES} ${IDENTITY_RULES}`,
      image_urls: refs,
      num_images: 1,
      resolution: "2K",
      // 16:9 — these stills ARE the film frames (the master trailer is 16:9),
      // so they must be shot landscape or the assembly crop lops off top/bottom.
      aspect_ratio: "16:9",
      output_format: "png",
    },
  });
  const url = (r.data as { images?: { url?: string }[] })?.images?.[0]?.url;
  if (!url) throw new Error("hero sheet missing url");
  return url;
}

/**
 * One raw 16:9 cinematic take — same character, same costume, one scene, one
 * seed.
 *
 * §2.2/§1.2: `hasRealPhotoFirst` tells the prompt what `refs[0]` actually is.
 * Today's prompt used to say "the FIRST reference image is the definitive
 * look of this character — match its costume, fur colors and markings, tail
 * and face EXACTLY", which is why the hero sheet (refs[0] in the old
 * ordering) won every tug-of-war with the real photo: the prompt told the
 * model the hero sheet was definitive for identity too, not just costume.
 * Callers now put the customer's real photo first whenever one is available
 * (see generateGatedTake's callers), so the roles are split explicitly:
 * first reference = this individual's real, definitive look (face, fur,
 * proportions, current grooming); second reference = the costume to copy.
 * The `false` branch is the defensive fallback (no real photo available) and
 * keeps the exact pre-fix wording/ordering, since in that case refs[0] really
 * is the hero sheet again.
 */
async function generateTakeOnce(
  refs: string[],
  hasRealPhotoFirst: boolean,
  description: string,
  costume: string,
  scene: string,
  framing: string,
  expression: string,
  seed: number
): Promise<string> {
  const roleDirective = hasRealPhotoFirst
    ? "The FIRST reference image is a real photo of this individual pet — its definitive REAL-WORLD look: match its exact face, fur colors and markings, proportions, and current grooming/coat length. The SECOND reference image is the film's costume reference sheet — match ONLY the costume/outfit shown in it exactly; it is not the identity anchor, ignore any difference in its fur styling."
    : "The FIRST reference image is the definitive look of this character — match its costume, fur colors and markings, tail and face EXACTLY."; // fallback: no real photo available for this order, see generateGatedTake
  const r = await fal.subscribe(EDIT_MODEL, {
    input: {
      prompt: `${roleDirective} This exact pet (${description}), ${costume}, ${scene}. ${framing}.${expression ? ` ${expression}.` : ""} One cinematic live-action film still, unmistakably the same individual pet, same outfit as the reference, blockbuster cinematography, dramatic lighting, shallow depth of field, film grain. ${STYLE_RULES} ${IDENTITY_RULES}`,
      image_urls: refs,
      num_images: 1,
      resolution: "2K",
      // 16:9 — this take becomes a film frame; the master trailer is 16:9.
      aspect_ratio: "16:9",
      output_format: "png",
      seed,
    },
  });
  const url = (r.data as { images?: { url?: string }[] })?.images?.[0]?.url;
  if (!url) throw new Error("take result missing url");
  return url;
}

/**
 * One gated take: render, score against the customer's REAL photo, re-roll
 * (with a fresh seed) until it clears the threshold or we run out of
 * attempts. Returns the best attempt regardless, so a cut always has three
 * takes to choose from.
 *
 * §2.1/IDENTITY-FIDELITY-SPEC.md §1.1: the gate used to score against the
 * generated portrait (`scoreIdentity(portraitUrl, url)`), even though its own
 * prompt says "Image 1 is the REAL pet" — a lie, since the portrait is
 * AI-generated. That let a take drift further from the actual dog while
 * scoring HIGHER, as long as it drifted the same direction the portrait
 * already had (scores of 80-85 with no real resemblance were that arithmetic
 * working as written). Gating on `realPhotoUrl` instead makes that prompt
 * line true and makes the gate measure the thing the product actually needs:
 * does this take look like the customer's dog.
 *
 * `portraitUrl` is kept as a required param (not folded away) purely as the
 * `realPhotoUrl` fallback target — see below — not because it's scored
 * against.
 *
 * `realPhotoUrl` can be undefined only if the order somehow has no usable
 * uploaded photo — uploads are mandatory, so this shouldn't happen. Per HARD
 * CONSTRAINT #3 this must never become a new failure mode: fall back to
 * gating against the portrait (the exact pre-fix behavior) and log loudly so
 * it surfaces as an anomaly rather than silently regressing.
 *
 * Deliberately does NOT also score against the portrait for a "consistency"
 * log (the spec's §2.1 allows this as optional): that would double the VLM
 * calls this function makes, which contradicts the spec's own cost
 * accounting ("additional cost is near zero — one more image per judgment
 * call", i.e. swap which image is passed, not add a second call). If a
 * portrait-consistency signal is wanted later, add it as its own opt-in
 * logging path rather than doubling every gate call by default.
 */
async function generateGatedTake(
  refs: string[],
  hasRealPhotoFirst: boolean,
  description: string,
  costume: string,
  scene: string,
  framing: string,
  expression: string,
  realPhotoUrl: string | undefined,
  portraitUrl: string,
  baseSeed: number,
  label: string
): Promise<string> {
  const gateRef = realPhotoUrl ?? portraitUrl;
  if (!realPhotoUrl) {
    console.warn(`[stills] ${label}: no real photo available — falling back to portrait-anchor identity gate (pre-fix behavior)`);
  }
  let best = "";
  let bestScore = -1;
  for (let attempt = 0; attempt <= MAX_TAKE_REROLLS; attempt++) {
    // 7919 (prime) keeps re-roll seeds far from other takes' base seeds.
    const seed = baseSeed + attempt * 7919;
    const url = await generateTakeOnce(refs, hasRealPhotoFirst, description, costume, scene, framing, expression, seed);
    const score = await scoreIdentity(gateRef, url);
    console.log(`[stills] ${label} attempt ${attempt}: identity ${score}${realPhotoUrl ? " (vs real photo)" : " (vs portrait, fallback)"}`);
    if (score > bestScore) {
      bestScore = score;
      best = url;
    }
    if (score >= IDENTITY_THRESHOLD) return url;
  }
  console.warn(`[stills] ${label}: best identity ${bestScore} (< ${IDENTITY_THRESHOLD}), using best attempt`);
  return best;
}

/**
 * One Gate-1 take option — TWO urls, never one, so the data model can't be
 * ambiguous about which is safe to hand the customer (PRICING-PRODUCT-V2-SPEC.md
 * §3.5(C)):
 *   preview — watermarked + downscaled (lib/watermark.ts). The ONLY url that
 *             may ever reach the customer's browser before completion.
 *   clean   — the full-res, unwatermarked fal take. Never rendered to the
 *             customer at Gate 1; this is what chosenStills carries forward
 *             and what the film pipeline actually animates.
 * `storyboardOptions` is Prisma `Json?` (no schema change for this feature),
 * so this shape lives entirely inside that JSON blob — see normalizeStoryboard
 * below for how a PRE-this-feature row (options as plain strings) reads back.
 */
export type StillOption = { preview: string; clean: string };

export type StoryboardCut = { scene: string; options: StillOption[] };

/** Intermediate shape used while stills are being generated, before the
 *  watermarking pass runs — options are still bare clean urls here. */
type CleanStoryboardCut = { scene: string; options: string[] };

/**
 * Defensive reader for order.storyboardOptions. Two shapes exist in
 * production data:
 *   - CURRENT (this feature onward): options are {preview, clean} objects.
 *   - LEGACY (every order created before this feature shipped): options are
 *     plain strings — the clean fal url, with no derivative ever generated.
 * A legacy row has no watermarked asset to fall back to, so per this
 * feature's spec ("existing orders ... must keep working ... fall back to
 * showing the clean url when no preview exists") its "preview" IS the clean
 * url — that customer's Gate 1 looks exactly as it always has, nothing new
 * regresses. Never throws: a malformed/foreign-shaped row degrades to an
 * empty storyboard rather than 500ing a customer's Gate-1 page or a
 * blocking an in-flight order — callers already treat "no cuts" as
 * "storyboard not ready yet" (see app/approve/[token]/page.tsx Gate1View).
 */
export function normalizeStoryboard(raw: unknown): StoryboardCut[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((cut): StoryboardCut => {
    const c = cut as { scene?: unknown; options?: unknown };
    const scene = typeof c?.scene === "string" ? c.scene : "";
    const rawOptions = c?.options;
    const options: StillOption[] = Array.isArray(rawOptions)
      ? rawOptions
          .map((opt): StillOption | null => {
            if (typeof opt === "string") return { preview: opt, clean: opt }; // legacy row
            const o = opt as { preview?: unknown; clean?: unknown };
            if (o && typeof o.clean === "string") {
              return { preview: typeof o.preview === "string" ? o.preview : o.clean, clean: o.clean };
            }
            return null;
          })
          .filter((o): o is StillOption => o !== null)
      : [];
    return { scene, options };
  });
}

/**
 * Full generation run — awaitable (scripts/tests), while kickStillsGeneration
 * fires it detached for the request path.
 */
export async function runStillsGeneration(order: Order): Promise<void> {
  const falKey = assertEnv("FAL_KEY");
  fal.config({ credentials: falKey });

  if (order.uploadedPhotoUrls.length === 0) {
    throw new Error(`Order ${order.id} has no uploaded photos`);
  }
  const resolved = resolveWorld(order);
  const costume = resolved.costume;
  const arc = resolved.arc.slice(0, NUM_CUTS);

  // Stage 0/1 are resumable: if this order already carries an extracted feature
  // description AND an identity portrait (e.g. a re-run, or a seed reusing a
  // known-good pet), reuse them instead of re-spending on the VLM + portrait.
  // A fresh customer order has neither, so it runs the full path.
  let description: string;
  let identityPortraitUrl: string;
  let orderedPhotos = order.uploadedPhotoUrls;

  if (order.petDescription && order.identityPortraitUrl) {
    description = order.petDescription;
    identityPortraitUrl = order.identityPortraitUrl;
    console.log(`[stills] reuse cached description + portrait order=${order.id} (skip stage 0/1)`);
  } else {
    console.log(`[stills] stage 0: analyzing photos order=${order.id}`);
    const a = await analyzePhotos(order.uploadedPhotoUrls);
    description = a.description;
    console.log(`[stills] features: ${description}`);
    console.log(`[stills] best frontal: #${a.bestFrontalIndex}${a.hasFrontal ? "" : " (no clear frontal detected)"}`);

    // Put the clearest front-facing photo FIRST — it seeds the identity portrait
    // (the anchor for every downstream generation).
    orderedPhotos = [
      order.uploadedPhotoUrls[a.bestFrontalIndex],
      ...order.uploadedPhotoUrls.filter((_, i) => i !== a.bestFrontalIndex),
    ].filter(Boolean) as string[];

    console.log(`[stills] stage 1: identity portrait order=${order.id}`);
    // §2.4: gate the portrait itself against the real, best-frontal photo
    // BEFORE it becomes the anchor for the hero sheet and all 18 takes.
    identityPortraitUrl = await generateGatedPortrait(orderedPhotos, description, publicUrl(orderedPhotos[0]), order.id);

    await prisma.order.update({
      where: { id: order.id },
      data: { petDescription: description, identityPortraitUrl, uploadedPhotoUrls: orderedPhotos },
    });
  }

  console.log(`[stills] stage 2: hero sheet order=${order.id} world=${order.tier === "custom" ? "custom" : (order.world ?? "deepspace")}`);
  const heroRefs = [identityPortraitUrl, ...orderedPhotos.slice(0, 2)].map(publicUrl);
  const heroSheet = await generateHeroSheet(heroRefs, description, costume);
  // Persist — the admin's Gate-2 re-shoot needs the same costume anchor later.
  await prisma.order.update({ where: { id: order.id }, data: { heroSheetUrl: heroSheet } });

  // Stage 3: 6 cuts × 3 takes, every take anchored to hero sheet + portrait
  // (no shot-0 chaining — the hero sheet is the single shared anchor). Cuts run
  // sequentially so at most TAKES_PER_CUT (3) renders are in flight at once.
  console.log(`[stills] stage 3: ${NUM_CUTS}×${TAKES_PER_CUT} storyboard order=${order.id} arc=${order.personality}`);
  const realPhotoRef = orderedPhotos[0] ? publicUrl(orderedPhotos[0]) : undefined;
  const heroRef = publicUrl(heroSheet);
  const portraitRef = publicUrl(identityPortraitUrl);
  // §2.2: real photo FIRST — see generateTakeOnce's comment for why order
  // matters (the prompt tells the model the FIRST reference is definitive,
  // so whichever image is first is the one the model actually locks onto).
  // Falls back to the pre-fix ordering (hero sheet first) only if this order
  // somehow has no real photo — see generateGatedTake's comment.
  const hasRealPhotoFirst = !!realPhotoRef;
  const refs = hasRealPhotoFirst
    ? [realPhotoRef, heroRef, portraitRef].filter((u): u is string => !!u)
    : [heroRef, portraitRef].filter((u): u is string => !!u);
  // §4.2: computed once from order.personality — null (custom orders have no
  // personality field) falls into the "add the directive" branch, same as
  // brave/easygoing/timid; only playful is exempt.
  const expression = expressionDirective(order.personality);

  const cleanStoryboard: CleanStoryboardCut[] = [];
  for (let cut = 0; cut < arc.length; cut++) {
    const options = await Promise.all(
      Array.from({ length: TAKES_PER_CUT }, (_, take) =>
        generateGatedTake(
          refs,
          hasRealPhotoFirst,
          description,
          costume,
          arc[cut],
          SHOT_FRAMINGS[cut] ?? SHOT_FRAMINGS[0],
          expression,
          realPhotoRef,
          portraitRef,
          STILL_SEED + cut * 100 + take * 1000,
          `cut ${cut} take ${take}`
        )
      )
    );
    cleanStoryboard.push({ scene: arc[cut], options });
  }

  // Stage 4 (PRICING-PRODUCT-V2-SPEC.md §3.5(C)) — watermark + downscale every
  // clean take into its Gate-1 preview derivative.
  //
  // THROTTLED, and not for rate-limit reasons: an earlier pass fired all 18 at
  // once on the theory that local ffmpeg work needs no throttle, and the first
  // production order to run it crashed the task outright — eighteen concurrent
  // 2K decodes plus their downloads exhausted the machine's memory (Trigger.dev
  // showed "Crashed" with no compute recorded, the same signature the film task
  // hit before it moved to large-1x). The task is on large-1x now too, but a
  // fixed-width queue is the actual fix: peak memory stops scaling with the
  // number of takes, so adding cuts later can't quietly re-break this.
  //
  // watermarkTakeForPreview never throws — one take's derivative failing falls
  // back to that take's clean url (logged) rather than failing the order.
  if (!WATERMARK_PREVIEWS_ENABLED) {
    // Off until the refund it defends exists — see WATERMARK_PREVIEWS_ENABLED.
    // preview === clean is the same shape a failed render produces, so nothing
    // downstream can tell the difference.
    console.log(`[stills] stage 4 skipped (watermark previews disabled) order=${order.id}`);
    await completeStillsGeneration(
      order.id,
      cleanStoryboard.map((cut) => ({
        scene: cut.scene,
        options: cut.options.map((clean) => ({ clean, preview: clean })),
      }))
    );
    return;
  }
  console.log(`[stills] stage 4: watermarking ${cleanStoryboard.length}×${TAKES_PER_CUT} previews order=${order.id}`);
  const jobs = cleanStoryboard.flatMap((cut, cutIdx) =>
    cut.options.map((clean, takeIdx) => ({ cutIdx, takeIdx, clean }))
  );
  const previews = new Map<string, string>();
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(WATERMARK_CONCURRENCY, jobs.length) }, async () => {
      for (let i = next++; i < jobs.length; i = next++) {
        const { cutIdx, takeIdx, clean } = jobs[i];
        previews.set(
          `${cutIdx}:${takeIdx}`,
          await watermarkTakeForPreview(clean, `order=${order.id}-cut=${cutIdx}-take=${takeIdx}`)
        );
      }
    })
  );
  const storyboard: StoryboardCut[] = cleanStoryboard.map((cut, cutIdx) => ({
    scene: cut.scene,
    options: cut.options.map((clean, takeIdx) => ({
      clean,
      preview: previews.get(`${cutIdx}:${takeIdx}`) ?? clean,
    })),
  }));

  await completeStillsGeneration(order.id, storyboard);
}

/**
 * Gate-2 re-shoot — regenerate ONE cut's still because its LOOK is off (the
 * admin's reason steers the retake, e.g. "too CGI, make it photoreal"). Same
 * scene/framing/costume as the customer-approved cut, fresh seed, identity
 * gate, style rules enforced. Refs prefer the persisted hero sheet; orders
 * from before it was persisted fall back to another approved cut as the
 * costume anchor. Persists the swap (chosenStills + whitelist) and returns
 * the new still URL for the film pipeline to animate.
 */
export async function reshootCutStill(
  order: Order,
  cutIndex: number,
  reason?: string
): Promise<string> {
  assertEnv("FAL_KEY");
  fal.config({ credentials: process.env.FAL_KEY });

  const portrait = order.identityPortraitUrl;
  if (!portrait) throw new Error(`order ${order.id} has no identityPortraitUrl`);
  const storyboard = (order.storyboardOptions as StoryboardCut[] | null) ?? [];
  const resolved = resolveWorld(order);
  const scene = storyboard[cutIndex]?.scene ?? resolved.arc[cutIndex];
  if (!scene) throw new Error(`order ${order.id} has no scene for cut ${cutIndex}`);
  const description = order.petDescription ?? "the pet shown in the reference images";
  const costume = resolved.costume;

  const costumeAnchorRaw =
    order.heroSheetUrl ?? order.chosenStills.find((_, i) => i !== cutIndex);
  const costumeAnchor = costumeAnchorRaw ? publicUrl(costumeAnchorRaw) : undefined;
  const portraitRef = publicUrl(portrait);
  // §2.1/§2.2: real photo is the gate reference AND goes first in refs, same
  // as every other generateGatedTake caller — see that function's comment.
  const realPhotoRef = order.uploadedPhotoUrls[0] ? publicUrl(order.uploadedPhotoUrls[0]) : undefined;
  const hasRealPhotoFirst = !!realPhotoRef;
  const refs = hasRealPhotoFirst
    ? [realPhotoRef, costumeAnchor, portraitRef].filter((u): u is string => !!u)
    : [costumeAnchor, portraitRef].filter((u): u is string => !!u);

  const directed = reason?.trim()
    ? `${scene}. Director's retake note, follow it strictly: ${reason.trim()}`
    : scene;

  console.log(`[stills] re-shoot cut ${cutIndex} order=${order.id}${reason ? ` reason="${reason}"` : ""}`);
  const url = await generateGatedTake(
    refs,
    hasRealPhotoFirst,
    description,
    costume,
    directed,
    SHOT_FRAMINGS[cutIndex] ?? SHOT_FRAMINGS[0],
    expressionDirective(order.personality),
    realPhotoRef,
    portraitRef,
    // Fresh seed family per re-shoot so the retake never repeats the original.
    STILL_SEED + cutIndex * 100 + (Date.now() % 100000),
    `re-shoot cut ${cutIndex}`
  );

  const chosenStills = [...order.chosenStills];
  chosenStills[cutIndex] = url;
  await prisma.order.update({
    where: { id: order.id },
    data: { chosenStills, conceptImageUrls: [...order.conceptImageUrls, url] },
  });
  return url;
}

/**
 * Gate-1 CUSTOMER re-roll — B2-SAFETY-NET-SPEC.md §3.1. Regenerates ALL
 * THREE takes of one cut (unlike reshootCutStill above, which is the admin's
 * post-approval single-shot Gate-2 tool and only ever produces one take).
 * No customer instruction: same scene/costume/identity as the original,
 * fresh seeds only (see rerollSeedBase above for why they can never repeat
 * that cut's prior artwork).
 *
 * `rerollCount` MUST be the value app/api/orders/reroll-cut/route.ts's
 * guarded `updateMany` just committed (order-wide, 1..STORYBOARD_REROLL_CAP)
 * — it is the sole source of this call's seed-band uniqueness, so the
 * caller reserving the slot atomically BEFORE calling this function (not
 * after) is what makes two concurrent re-rolls of the same cut land in
 * different, non-colliding bands rather than racing each other's seeds.
 *
 * Persists by re-reading the order immediately before writing (rather than
 * trusting the `order` snapshot the caller passed in, which may be tens of
 * seconds stale by the time generation finishes): a concurrent re-roll of a
 * DIFFERENT cut landing in that window must not be clobbered. This is the
 * same non-atomic read-modify-write shape reshootCutStill above already
 * uses for chosenStills — this function is just slightly more careful about
 * WHEN it reads, because a 3-take re-roll takes long enough for that window
 * to matter more.
 */
export async function rerollCutTakes(
  order: Order,
  cutIndex: number,
  rerollCount: number
): Promise<StoryboardCut> {
  assertEnv("FAL_KEY");
  fal.config({ credentials: process.env.FAL_KEY });

  const portrait = order.identityPortraitUrl;
  if (!portrait) throw new Error(`order ${order.id} has no identityPortraitUrl`);

  const storyboard = normalizeStoryboard(order.storyboardOptions);
  const resolved = resolveWorld(order);
  const scene = storyboard[cutIndex]?.scene ?? resolved.arc[cutIndex];
  if (!scene) throw new Error(`order ${order.id} has no scene for cut ${cutIndex}`);

  const description = order.petDescription ?? "the pet shown in the reference images";
  const costume = resolved.costume;
  const framing = SHOT_FRAMINGS[cutIndex] ?? SHOT_FRAMINGS[0];
  const expression = expressionDirective(order.personality);
  const portraitRef = publicUrl(portrait);
  // Same anchor selection as reshootCutStill/generateGatedTake's other
  // callers — a re-roll must lock the same costume/identity as the original
  // 18 takes, or "re-roll" would silently become "redesign".
  const heroRef = order.heroSheetUrl ? publicUrl(order.heroSheetUrl) : undefined;
  // §2.1/§2.2: real photo is the gate reference AND goes first in refs.
  const realPhotoRef = order.uploadedPhotoUrls[0] ? publicUrl(order.uploadedPhotoUrls[0]) : undefined;
  const hasRealPhotoFirst = !!realPhotoRef;
  const refs = hasRealPhotoFirst
    ? [realPhotoRef, heroRef, portraitRef].filter((u): u is string => !!u)
    : [heroRef, portraitRef].filter((u): u is string => !!u);

  console.log(`[stills] re-roll cut ${cutIndex} order=${order.id} (order-wide re-roll #${rerollCount})`);
  const seedBase = rerollSeedBase(cutIndex, rerollCount);
  const cleanTakes = await Promise.all(
    Array.from({ length: TAKES_PER_CUT }, (_, take) =>
      generateGatedTake(
        refs,
        hasRealPhotoFirst,
        description,
        costume,
        scene,
        framing,
        expression,
        realPhotoRef,
        portraitRef,
        seedBase + take * 1000,
        `re-roll cut ${cutIndex} reroll#${rerollCount} take ${take}`
      )
    )
  );

  // Same {preview, clean} shape stage 4 produces — watermarking is currently
  // OFF (WATERMARK_PREVIEWS_ENABLED above), so preview === clean, exactly the
  // shape a legacy/failed-watermark row already reads as.
  const options: StillOption[] = WATERMARK_PREVIEWS_ENABLED
    ? await Promise.all(
        cleanTakes.map(async (clean, i) => ({
          clean,
          preview: await watermarkTakeForPreview(
            clean,
            `order=${order.id}-cut=${cutIndex}-reroll=${rerollCount}-take=${i}`
          ),
        }))
      )
    : cleanTakes.map((clean) => ({ clean, preview: clean }));

  const newCut: StoryboardCut = { scene, options };

  const latest = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
  const latestStoryboard = normalizeStoryboard(latest.storyboardOptions);
  latestStoryboard[cutIndex] = newCut;

  await prisma.order.update({
    where: { id: order.id },
    data: {
      storyboardOptions: latestStoryboard,
      // conceptImageUrls is the flat, never-customer-facing audit trail
      // (see completeStillsGeneration's comment) — append, don't replace.
      conceptImageUrls: [...latest.conceptImageUrls, ...cleanTakes],
    },
  });

  return newCut;
}

export async function kickStillsGeneration(order: Order): Promise<void> {
  if (process.env.VIDEO_PIPELINE_MOCK === "1") {
    console.log(`[stills:MOCK] kick order=${order.id} — no compute spent`);
    // Fabricate a 6-cut × 3-take storyboard from the local world assets so the
    // Gate-1 wizard, e2e and status machine can run for free. Scenes come from
    // the real arc so the wizard copy matches production.
    const arc = resolveWorld(order).arc.slice(0, NUM_CUTS);
    const assets = ["/assets/world-deepspace.png", "/assets/world-storybook.png", "/assets/world-noir.png"];
    const storyboard: StoryboardCut[] = arc.map((scene, cut) => ({
      scene,
      // Rotate the 3 assets per cut so each cut's takes are visually distinct.
      // preview === clean here on purpose — HARD CONSTRAINT: mock mode must
      // work end to end "without ffmpeg surprises". These are static local LP
      // assets (not real generated art), so there's nothing to protect and no
      // reason to spend an ffmpeg pass on them; this is the exact same shape
      // normalizeStoryboard already produces for a pre-this-feature legacy row.
      options: Array.from({ length: TAKES_PER_CUT }, (_, take) => {
        const url = assets[(cut + take) % assets.length];
        return { preview: url, clean: url };
      }),
    }));
    await prisma.order.update({
      where: { id: order.id },
      data: { identityPortraitUrl: assets[0], petDescription: "mock pet — local assets, no compute" },
    });
    await completeStillsGeneration(order.id, storyboard);
    return;
  }

  // Local dev only (no TRIGGER_SECRET_KEY): detached run, several minutes for
  // the full 18-take chain — fine under a long-lived `next dev`. On Vercel this
  // MUST NOT be the path taken: the function is frozen as soon as the response
  // is sent, which killed generation part-way and left the order stuck in
  // IMAGE_GENERATING with no storyboard and no revert. Production goes through
  // Trigger.dev below, same as the film/poster pipelines.
  if (!process.env.TRIGGER_SECRET_KEY) {
    void runStillsGeneration(order).catch(async (e) => {
      console.error(`[stills] local run failed order=${order.id}, reverting`, e);
      // Custom orders go back to their approved treatment, not the photo form.
      const to =
        order.tier === "custom"
          ? OrderStatus.AWAITING_TREATMENT_APPROVAL
          : OrderStatus.UPLOADING;
      await transitionOrder(
        order.id,
        OrderStatus.IMAGE_GENERATING,
        to,
        "system",
        {},
        "stills generation failed — reverted for retry"
      ).catch((revertErr) =>
        console.error(`[stills] revert also failed order=${order.id}`, revertErr)
      );
    });
    return;
  }

  await tasks.trigger<typeof generateStillsTask>("generate-stills", { orderId: order.id });
}

export async function completeStillsGeneration(
  orderId: string,
  storyboard: StoryboardCut[]
): Promise<void> {
  // conceptImageUrls keeps the FLAT list of every take's CLEAN url — never
  // customer-facing (not rendered anywhere in app/ or components/, grep-
  // verified), purely an internal audit trail — so it holds the same clean
  // urls it always has, not the watermarked preview derivatives.
  const flat = storyboard.flatMap((cut) => cut.options.map((o) => o.clean));
  await prisma.order.update({
    where: { id: orderId },
    data: { storyboardOptions: storyboard, conceptImageUrls: flat },
  });
  const order = await transitionOrder(
    orderId,
    OrderStatus.IMAGE_GENERATING,
    OrderStatus.AWAITING_CUSTOMER_APPROVAL,
    "system",
    {},
    `storyboard ready (${storyboard.length} cuts × ${storyboard[0]?.options.length ?? 0} takes)`
  );
  await sendChooseStillEmail(order);
  console.log(`[stills] order=${orderId} -> AWAITING_CUSTOMER_APPROVAL`);
}

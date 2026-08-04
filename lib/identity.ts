import { fal } from "@fal-ai/client";
import { FAL_VISION_CAP_MS, falDeadline } from "./fal-deadline";

/**
 * Identity scoring — the shared "is this the SAME individual pet?" check.
 *
 * Likeness is the moat, so identity is gated at several points in the
 * pipeline and all of them use these two scorers:
 *   - stills-pipeline: the identity portrait itself vs the customer's real
 *     photo (the portrait is the anchor for everything downstream, so it has
 *     to be checked against reality FIRST — see generateGatedPortrait)
 *   - stills-pipeline: every generated storyboard take vs the customer's
 *     real photo (see generateGatedTake)
 *   - film-pipeline:   frames of every animated clip, and every generated
 *     end frame, vs the customer's real photo (catches "the video drifted
 *     into a different dog" before Gate 2)
 *
 * A THIRD scorer, scoreAnatomy (LORA-STORYBOARD-SPEC.md §4.2), lives here too
 * but checks a completely different, single-image question — "does this
 * four-legged animal's anatomy look coherent" — independent of likeness. It
 * runs alongside scoreIdentity at the same gate (generateGatedTake), not in
 * its place.
 *
 * IDENTITY-FIDELITY-SPEC.md §1 documents, with the pre-fix code quoted, why
 * the FIRST argument below must always be an actual uploaded customer photo
 * and NOT a generated image (portrait, hero sheet, or anything downstream of
 * them): both prompts below assert "Image 1 is the/a REAL pet/photo", and
 * before this fix every caller actually passed the AI-generated identity
 * portrait as that first image. That made the gate measure "does this
 * candidate agree with the portrait" instead of "does this candidate look
 * like the actual dog" — and because the portrait is itself one generation
 * removed from the real animal, a candidate could drift FURTHER from the
 * real dog while scoring HIGHER, as long as it drifted in the same direction
 * the portrait already had. Three compounding generations (photos -> portrait
 * -> hero sheet -> takes/clips) made that drift invisible: the gate scored
 * 80-85 against a target that no longer looked like the pet.
 *
 * The parameters are still named generically rather than e.g. `realPhotoUrl`
 * because a couple of callers legitimately do NOT have a real photo in hand:
 * generateGatedPortrait (stills-pipeline.ts) falls back to a no-op gate, and
 * some film-pipeline call sites fall back to the pre-fix portrait-anchor
 * behavior, when an order somehow has no usable uploaded photo (uploads are
 * mandatory, so this is a defensive branch, not the intended path — see each
 * call site's comment for why it does or doesn't have one).
 *
 * Keeping this here (not in either pipeline) avoids a stills↔film import
 * cycle.
 */

export const VISION_MODEL = "openrouter/router/vision";
export const VISION_LLM = "google/gemini-2.5-flash";

/** Resolve possibly-relative asset URLs (/assets/...) to a public absolute URL. */
export function publicUrl(url: string): string {
  if (url.startsWith("http")) return url;
  const base = process.env.PUBLIC_ASSET_BASE ?? "https://marquee-tails-lp.vercel.app";
  return new URL(url, base).toString();
}

/**
 * VLM checks a video frame against `referenceUrl` (a real customer photo
 * whenever the caller has one — see this file's header comment) on TWO axes:
 * identity (same individual pet) and realism (still photoreal live-action, or
 * has the render drifted into CGI/cartoon — Kling clips can "Disneyfy" a few
 * seconds in even from a photoreal start frame). Returns both 0-100 scores.
 * A failed check must never block the pipeline: errors score {100,100}.
 */
export async function scoreFrame(
  referenceUrl: string,
  candidateUrl: string
): Promise<{ identity: number; realism: number }> {
  try {
    const r = await fal.subscribe(VISION_MODEL, {
      input: {
        model: VISION_LLM,
        image_urls: [publicUrl(referenceUrl), publicUrl(candidateUrl)],
        prompt:
          "Image 1 is a real photo of a pet. Image 2 is a frame from an AI-generated film starring the same pet in costume. Score two things:\n" +
          "A) IDENTITY 0-100: how confidently is image 2 the SAME INDIVIDUAL animal — same breed, same coat colors in the same places, same facial markings, same proportions? Ignore costume, background and pose. 100 = unmistakably the same individual.\n" +
          "B) REALISM 0-100: is image 2 photorealistic live-action footage? 100 = indistinguishable from a real film shot of a real animal; 50 = noticeably smoothed/CG-tinged; 0 = obvious CGI / Pixar-style cartoon / illustration.\n" +
          "Reply with ONLY the two integers separated by a comma, e.g. 90,85",
      },
      abortSignal: falDeadline(FAL_VISION_CAP_MS),
    });
    const txt = String(
      (r.data as { output?: string; text?: string })?.output ??
        (r.data as { text?: string })?.text ??
        ""
    );
    const m = txt.match(/(\d{1,3})\s*,\s*(\d{1,3})/);
    if (!m) return { identity: 100, realism: 100 };
    return {
      identity: Math.min(100, parseInt(m[1], 10)),
      realism: Math.min(100, parseInt(m[2], 10)),
    };
  } catch (e) {
    console.warn("[identity] frame check errored, passing through:", e);
    return { identity: 100, realism: 100 };
  }
}

/**
 * VLM checks a candidate image against `referenceUrl` ("same individual pet?
 * same markings?") and returns 0-100. A failed check must never block the
 * pipeline, so on any error we log and return 100 (treat as pass).
 *
 * `referenceUrl` MUST be a real customer photo whenever one is available —
 * see this file's header comment for why (IDENTITY-FIDELITY-SPEC.md §1). The
 * old name for this parameter was `portraitUrl`, which was itself the bug:
 * it documented, in the code, that the generated portrait was the intended
 * anchor, when the whole point of this fix is that it must not be.
 */
export async function scoreIdentity(referenceUrl: string, candidateUrl: string): Promise<number> {
  try {
    const r = await fal.subscribe(VISION_MODEL, {
      input: {
        model: VISION_LLM,
        image_urls: [publicUrl(referenceUrl), publicUrl(candidateUrl)],
        prompt:
          "Image 1 is the REAL pet. Image 2 is an AI render of the same pet in costume. How confidently is the render the SAME INDIVIDUAL animal — same breed, same coat colors in the same places, same facial markings (beard, eyebrows), same proportions? Ignore costume, background and pose. Reply with ONLY an integer 0-100 (100 = unmistakably the same individual).",
      },
      abortSignal: falDeadline(FAL_VISION_CAP_MS),
    });
    const txt = String(
      (r.data as { output?: string; text?: string })?.output ??
        (r.data as { text?: string })?.text ??
        ""
    );
    const n = parseInt(txt.replace(/[^0-9]/g, "").slice(0, 3), 10);
    return Number.isFinite(n) ? Math.min(100, n) : 0;
  } catch (e) {
    console.warn("[identity] check errored, passing through:", e);
    return 100;
  }
}

/**
 * Anatomy gate (LORA-STORYBOARD-SPEC.md §4.2) — a four-legged-animal limb
 * catastrophe check, added at the SAME place and in the SAME shape as
 * scoreIdentity above (see stills-pipeline.ts's generateGatedTake, which
 * calls both together on every attempt). Diffusion models occasionally break
 * anatomy on hard poses (an extra or missing leg, a duplicated/floating paw,
 * limbs fused or attached in the wrong place) — a failure mode that is
 * completely independent of likeness: a take can score perfectly on identity
 * and still show three legs.
 *
 * §4.2's own arithmetic is why this exists even though §1.8 could not prove a
 * measured per-image breakage rate: a storyboard is 18 stills, and even a
 * quiet 5% per-image break rate puts a broken limb somewhere in 60% of
 * orders. "Rarely happens" and "the customer never sees it" are very
 * different claims once the image count is 18, not 1.
 *
 * Never blocks the pipeline: any error (or an unparseable response) returns
 * `ok: true` — a failed check must never turn into an extra, unearned re-roll
 * budget spent on nothing, same posture as scoreIdentity/scoreFrame above.
 */
export async function scoreAnatomy(candidateUrl: string): Promise<{ ok: boolean; detail: string }> {
  try {
    const r = await fal.subscribe(VISION_MODEL, {
      input: {
        model: VISION_LLM,
        image_urls: [publicUrl(candidateUrl)],
        prompt:
          "This is an AI-generated cinematic photo of a four-legged pet (dog or cat) in costume. Look closely at its legs and paws only — ignore costume, background, lighting and pose. Answer two things:\n" +
          "A) legCount: how many legs are clearly visible or clearly implied by the pose (a normal, healthy animal has exactly 4: two front, two hind)? Use -1 if the pose/framing makes this uncountable (e.g. a tight face close-up where no legs are in frame at all).\n" +
          "B) broken: true if there is ANY visible anatomical fault — an extra limb, a missing limb where one should clearly be visible, a duplicated or floating paw, tangled/fused/merged legs, or a limb attached in the wrong place on the body. false if the visible anatomy looks like a normal, coherent animal (including images where legs simply aren't in frame).\n" +
          'Reply with ONLY minified JSON, no prose: {"legCount":<integer>,"broken":<true|false>}',
      },
      abortSignal: falDeadline(FAL_VISION_CAP_MS),
    });
    const raw = String(
      (r.data as { output?: string; text?: string })?.output ??
        (r.data as { text?: string })?.text ??
        ""
    );
    const json = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as {
      legCount?: unknown;
      broken?: unknown;
    };
    const legCount = Number.isInteger(json.legCount) ? (json.legCount as number) : -1;
    const broken = json.broken === true;
    const ok = !broken && (legCount === -1 || legCount === 4);
    return { ok, detail: `legs=${legCount} broken=${broken}` };
  } catch (e) {
    console.warn("[identity] anatomy check errored, passing through:", e);
    return { ok: true, detail: "check errored, passing through" };
  }
}

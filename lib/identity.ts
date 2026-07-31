import { fal } from "@fal-ai/client";

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

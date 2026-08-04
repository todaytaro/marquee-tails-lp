/**
 * DELIVERY-RATING-SPEC.md §2 — the rating's validation pulled out as a pure
 * function so it can be unit tested with no API key, network, or DB (same
 * shape as lib/claude-script.ts's parseToolInput / scripts/test-treatment-
 * parse.ts). The API route (app/api/orders/rate/route.ts) does nothing but
 * call this and persist whatever comes back.
 */

export type RatingInput = { stars?: unknown; comment?: unknown };
export type RatingParsed = { stars: number; comment: string | null };

const MAX_COMMENT_LENGTH = 2000;

/**
 * Throws on anything invalid — the caller turns that into a 400 with the
 * thrown message.
 *
 * `stars` must be a genuine integer 1-5. A numeric STRING like "4" is
 * accepted on purpose (Number() applied explicitly), but `true`/`false` are
 * rejected before Number() ever runs on them — otherwise JS's implicit
 * coercion (`Number(true) === 1`) would let a boolean silently pass as a
 * valid rating.
 */
export function parseRating(input: RatingInput): RatingParsed {
  const { stars: rawStars, comment: rawComment } = input;

  if (typeof rawStars !== "number" && typeof rawStars !== "string") {
    // Catches boolean, null, undefined, objects, arrays in one guard —
    // none of them are a rating, and none of them should reach Number().
    throw new Error("stars is required and must be an integer 1-5.");
  }
  const stars = Number(rawStars);
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
    throw new Error("stars is required and must be an integer 1-5.");
  }

  let comment: string | null = null;
  if (rawComment !== undefined && rawComment !== null) {
    if (typeof rawComment !== "string") {
      throw new Error("comment must be a string.");
    }
    const trimmed = rawComment.trim();
    if (trimmed.length > MAX_COMMENT_LENGTH) {
      // Reject, don't truncate — a silent cut loses words the customer
      // believes they sent. treatmentText got burned by exactly this
      // failure mode (see scripts/test-treatment-parse.ts).
      throw new Error(`comment must be ${MAX_COMMENT_LENGTH} characters or fewer.`);
    }
    comment = trimmed.length > 0 ? trimmed : null;
  }

  return { stars, comment };
}

/**
 * parseRating regression test — no API key, no network, no database.
 *
 * DELIVERY-RATING-SPEC.md §2/§6 — parseRating is the only gate the API
 * route (app/api/orders/rate/route.ts) defers to, so this is where its
 * rules get pinned down: stars must be a genuine 1-5 integer (no implicit
 * boolean coercion, no truncated floats), and a too-long comment must be
 * REJECTED, not silently truncated — the exact failure mode
 * scripts/test-treatment-parse.ts caught with treatmentText, asserted here
 * too.
 *
 * Usage: npx tsx scripts/test-rating-validate.ts
 */
import { parseRating, type RatingParsed } from "../lib/rating";

let failures = 0;

function expectOk(label: string, input: { stars?: unknown; comment?: unknown }, expected?: RatingParsed) {
  try {
    const r = parseRating(input);
    if (expected && (r.stars !== expected.stars || r.comment !== expected.comment)) {
      throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(r)}`);
    }
    console.log(`  ok      ${label}`);
  } catch (e) {
    failures++;
    console.log(`  FAILED  ${label} — ${e instanceof Error ? e.message : String(e)}`);
  }
}

function expectThrow(label: string, input: { stars?: unknown; comment?: unknown }) {
  try {
    parseRating(input);
    failures++;
    console.log(`  FAILED  ${label} — expected a throw, got a result`);
  } catch {
    console.log(`  ok      ${label}`);
  }
}

console.log("parseRating — stars:");
expectOk("stars 5", { stars: 5 }, { stars: 5, comment: null });
expectOk("stars 1", { stars: 1 }, { stars: 1, comment: null });
expectThrow("stars 0", { stars: 0 });
expectThrow("stars 6", { stars: 6 });
expectThrow("stars -1", { stars: -1 });
expectThrow("stars 4.5", { stars: 4.5 });
expectThrow("stars NaN", { stars: NaN });
expectThrow("stars undefined", { stars: undefined });
expectThrow("stars null", { stars: null });
expectThrow("stars true (no implicit boolean coercion to 1)", { stars: true });
// Policy: a numeric STRING is accepted, via an explicit Number() + integer
// check (spec §2 explicitly allows this as long as it's deliberate) — but
// only a clean numeral, never booleans or garbage.
expectOk('stars "4" (numeric string, explicit policy)', { stars: "4" }, { stars: 4, comment: null });
expectThrow('stars "4.5"', { stars: "4.5" });
expectThrow('stars "abc"', { stars: "abc" });

console.log("\nparseRating — comment:");
const twoThousand = "a".repeat(2000);
const twoThousandOne = "a".repeat(2001);
expectOk("comment exactly 2000 chars passes", { stars: 3, comment: twoThousand }, { stars: 3, comment: twoThousand });
expectThrow("comment 2001 chars is rejected, not truncated", { stars: 3, comment: twoThousandOne });
expectOk("whitespace-only comment becomes null", { stars: 3, comment: "   " }, { stars: 3, comment: null });
expectOk("comment omitted is null", { stars: 3 }, { stars: 3, comment: null });
expectThrow("comment as a number is rejected", { stars: 3, comment: 4 });

console.log(failures === 0 ? "\nall passed" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);

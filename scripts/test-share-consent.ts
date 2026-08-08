/**
 * Tests for normalizeShareConsent (lib/share-consent.ts). No network, no DB.
 *
 * The invariant under test is a permissions one, which is why it is worth a
 * test at all: a stored `photos: true, film: false` would be a row claiming a
 * permission we would never act on, and a later reader could easily misread it
 * as "we may publish this customer's photos".
 *
 * Usage: npx tsx scripts/test-share-consent.ts
 */
import { normalizeShareConsent } from "../lib/share-consent";

let failures = 0;
function eq(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ok    ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}\n          got      ${a}\n          expected ${e}`);
  }
}
function throws(name: string, fn: () => unknown) {
  try {
    fn();
    failures++;
    console.log(`  FAIL  ${name} — expected a throw, got a value`);
  } catch {
    console.log(`  ok    ${name}`);
  }
}

console.log("normalizeShareConsent — the four honest combinations");
eq("both no", normalizeShareConsent({ film: false, photos: false }), { film: false, photos: false });
eq("film only", normalizeShareConsent({ film: true, photos: false }), { film: true, photos: false });
eq("both yes", normalizeShareConsent({ film: true, photos: true }), { film: true, photos: true });

console.log("\nnormalizeShareConsent — the impossible one");
// Photos without the film is the state the UI prevents; the endpoint must not
// depend on the UI having done so.
eq(
  "photos without film is forced to false",
  normalizeShareConsent({ film: false, photos: true }),
  { film: false, photos: false }
);

console.log("\nnormalizeShareConsent — rejects anything not a boolean");
// A permission must be an explicit yes. Coercing "false", 0, null or a missing
// field into a decision is how a no silently becomes a yes.
for (const bad of [undefined, null, "true", "false", 0, 1, "", {}, []]) {
  throws(`film = ${JSON.stringify(bad) ?? "undefined"}`, () =>
    normalizeShareConsent({ film: bad, photos: false })
  );
}
for (const bad of [undefined, null, "true", 1]) {
  throws(`photos = ${JSON.stringify(bad) ?? "undefined"}`, () =>
    normalizeShareConsent({ film: true, photos: bad })
  );
}
throws("both missing", () => normalizeShareConsent({}));

console.log(failures === 0 ? "\nall passed" : `\n${failures} FAILED`);
if (failures > 0) process.exit(1);

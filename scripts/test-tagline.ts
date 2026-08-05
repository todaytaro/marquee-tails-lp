/**
 * Tests for stripLeadingPetName (lib/film-script.ts) — the finale title card's
 * pet-name de-duplication. No API key, no network, no DB, no ffmpeg.
 *
 * Usage: npx tsx scripts/test-tagline.ts
 */
import { stripLeadingPetName } from "../lib/film-script";

let failures = 0;
function eq(name: string, actual: string, expected: string) {
  if (actual === expected) {
    console.log(`  ok    ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}\n          got      ${JSON.stringify(actual)}\n          expected ${JSON.stringify(expected)}`);
  }
}

console.log("stripLeadingPetName — strips");
// The exact string that shipped on the first Director's Cut order.
eq("colon", stripLeadingPetName("CAMYU: INTO THE TRENCH", "CAMYU"), "INTO THE TRENCH");
eq("em dash", stripLeadingPetName("CAMYU — INTO THE TRENCH", "CAMYU"), "INTO THE TRENCH");
eq("en dash", stripLeadingPetName("CAMYU – INTO THE TRENCH", "CAMYU"), "INTO THE TRENCH");
eq("hyphen", stripLeadingPetName("CAMYU - INTO THE TRENCH", "CAMYU"), "INTO THE TRENCH");
eq("no space before colon", stripLeadingPetName("CAMYU:INTO THE TRENCH", "CAMYU"), "INTO THE TRENCH");
// fillPetName upper-cases loglines; petName is whatever the customer typed.
eq("case mismatch", stripLeadingPetName("CAMYU: INTO THE TRENCH", "Camyu"), "INTO THE TRENCH");
eq("multi-word name", stripLeadingPetName("MR PICKLES: CASE CLOSED", "Mr Pickles"), "CASE CLOSED");

console.log("\nstripLeadingPetName — leaves alone");
// Every preset tagline already follows the convention; none may be touched.
for (const t of ["CASE CLOSED", "THE LONG WAY HOME", "A TAIL OF VALOR", "NO RUSH OUT HERE", "TROUBLE IN ORBIT"]) {
  eq(`preset ${JSON.stringify(t)}`, stripLeadingPetName(t, "CAMYU"), t);
}
// A name doing real work mid-sentence is not a duplication problem.
eq(
  "name mid-sentence",
  stripLeadingPetName("THE WORLD ACCORDING TO CAMYU", "CAMYU"),
  "THE WORLD ACCORDING TO CAMYU"
);
// Leading name with NO separator is a real tagline, not the failure shape.
eq("name with no separator", stripLeadingPetName("CAMYU RIDES AGAIN", "CAMYU"), "CAMYU RIDES AGAIN");
// A different pet's name must not match.
eq("other name", stripLeadingPetName("REX: CASE CLOSED", "CAMYU"), "REX: CASE CLOSED");

console.log("\nstripLeadingPetName — degenerate input");
// A blank final card is worse than a repeated name, so the original survives.
eq("tagline is only the name", stripLeadingPetName("CAMYU", "CAMYU"), "CAMYU");
eq("tagline is name + colon", stripLeadingPetName("CAMYU:", "CAMYU"), "CAMYU:");
eq("empty petName", stripLeadingPetName("CAMYU: INTO THE TRENCH", ""), "CAMYU: INTO THE TRENCH");
eq("null petName", stripLeadingPetName("CAMYU: INTO THE TRENCH", null), "CAMYU: INTO THE TRENCH");
// Regex-special characters in a pet name must not blow up the pattern.
eq("regex-special name", stripLeadingPetName("C.A.M.Y.U: INTO THE TRENCH", "C.A.M.Y.U"), "INTO THE TRENCH");
eq(
  "regex-special name does not match as wildcard",
  stripLeadingPetName("CXAXMXYXU: INTO THE TRENCH", "C.A.M.Y.U"),
  "CXAXMXYXU: INTO THE TRENCH"
);

console.log(failures === 0 ? "\nall passed" : `\n${failures} FAILED`);
if (failures > 0) process.exit(1);

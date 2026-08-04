/**
 * parseToolInput regression test — no API key, no network, no database.
 *
 * WHY THIS EXISTS: a real $249 Director's Cut order failed twice and reverted
 * because Claude's tool call omitted `status`, and the parser threw
 * `invalid status "undefined"` even though the call carried a complete bundle.
 * `status` IS in the tool's required list; the model dropped it anyway, which
 * is what happens when a schema accumulates as much instruction as this one
 * has. The parser now reads a missing status as "ok" when the bundle is there,
 * and still rejects anything genuinely incomplete — both halves are asserted
 * below, because the loosening is only safe if the validation underneath holds.
 *
 * Usage: npx tsx scripts/test-treatment-parse.ts
 */
import { parseToolInput } from "../lib/claude-script";

const BUNDLE = {
  costume: "a tan belted trench coat",
  score: "warm strings",
  cuts: Array.from({ length: 6 }, (_, i) => ({ scene: `scene ${i + 1}` })),
  loglines: { intro: "a", turn: "b", rise: "c", tagline: "d" },
  treatmentText: "Here is the treatment.",
};

let failures = 0;

function expectOk(label: string, input: unknown) {
  try {
    const r = parseToolInput(input);
    if (r.status !== "ok") throw new Error(`expected ok, got ${r.status}`);
    console.log(`  ok      ${label}`);
  } catch (e) {
    failures++;
    console.log(`  FAILED  ${label} — ${e instanceof Error ? e.message : String(e)}`);
  }
}

function expectRejected(label: string, input: unknown) {
  try {
    const r = parseToolInput(input);
    if (r.status !== "rejected") throw new Error(`expected rejected, got ${r.status}`);
    console.log(`  ok      ${label}`);
  } catch (e) {
    failures++;
    console.log(`  FAILED  ${label} — ${e instanceof Error ? e.message : String(e)}`);
  }
}

function expectThrow(label: string, input: unknown) {
  try {
    parseToolInput(input);
    failures++;
    console.log(`  FAILED  ${label} — expected a throw, got a result`);
  } catch {
    console.log(`  ok      ${label}`);
  }
}

console.log("parseToolInput:");
expectOk('status "ok" with a full bundle', { status: "ok", ...BUNDLE });
// The production failure.
expectOk("status ABSENT with a full bundle", BUNDLE);
expectRejected('status "rejected"', { status: "rejected", reason: "please reword" });
expectRejected('status "rejected" with no reason falls back to a friendly one', { status: "rejected" });

// The loosening must not weaken anything else.
expectThrow('status is garbage', { status: "maybe", ...BUNDLE });
expectThrow("status absent AND nothing else", {});
expectThrow("status absent, missing costume", { ...BUNDLE, costume: "" });
expectThrow("status absent, five cuts", { ...BUNDLE, cuts: BUNDLE.cuts.slice(0, 5) });
expectThrow("status absent, incomplete loglines", { ...BUNDLE, loglines: { intro: "a" } });
expectThrow("status absent, empty treatmentText", { ...BUNDLE, treatmentText: "   " });

console.log(failures === 0 ? "\nall passed" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);

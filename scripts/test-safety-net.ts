/**
 * Local functional test for the B2 Director's Cut safety net
 * (B2-SAFETY-NET-SPEC.md §8 — "prove the five guards ... no DB, no dev
 * server"). NO database, NO fal.ai, NO Trigger.dev, NO Next.js — this calls
 * the pure eligibility functions in lib/safety-net.ts and the seed-derivation
 * helpers in lib/stills-pipeline.ts directly, the same functions the real
 * API routes (app/api/orders/reroll-cut, app/api/orders/request-refund)
 * import and call for their own guard checks.
 *
 * Asserts:
 *   1. A 4th re-roll is refused (canReroll, storyboardRerollCount at cap).
 *   2. A refund request is refused while re-rolls remain (canRequestRefund).
 *   3. A refund request is refused once Gate 1 is approved, i.e. status has
 *      moved past AWAITING_CUSTOMER_APPROVAL (canRequestRefund).
 *   4. Both re-roll and refund are refused for a Preset (non-"custom") order
 *      (canReroll / canRequestRefund).
 *   5. Concurrent double-submit cannot push storyboardRerollCount past the
 *      cap (attemptReroll — see its doc comment for why sequential calls
 *      against one shared row are a faithful stand-in for Postgres
 *      serializing concurrent `updateMany` calls against the same row,
 *      rather than a probabilistic simulation of concurrency).
 *
 * Also proves the re-roll seed-uniqueness property the spec calls out under
 * "THE PARTS THAT WILL BITE": rerollSeedBase's seeds never collide with the
 * seeds the ORIGINAL stage-3 generation could have used for that same cut,
 * nor with any other re-roll's seeds — by construction (disjoint numeric
 * bands), not by probability.
 *
 * Usage: npx tsx scripts/test-safety-net.ts
 */
import {
  canReroll,
  canRequestRefund,
  attemptReroll,
  STORYBOARD_REROLL_CAP,
  type OrderForGuard,
} from "../lib/safety-net";
import {
  rerollSeedBase,
  STILL_SEED,
  NUM_CUTS,
  TAKES_PER_CUT,
  MAX_TAKE_REROLLS,
} from "../lib/stills-pipeline";

let failures = 0;
function assertTrue(label: string, ok: boolean) {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
  if (!ok) failures++;
}
function assertEqual(label: string, actual: unknown, expected: unknown) {
  const ok = actual === expected;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}: actual=${String(actual)} expected=${String(expected)}`);
  if (!ok) failures++;
}

/** A fresh, fully-eligible Director's Cut order sitting at Gate 1, with
 *  overrides applied on top — the baseline every guard test starts from. */
function order(overrides: Partial<OrderForGuard> = {}): OrderForGuard {
  return {
    tier: "custom",
    status: "AWAITING_CUSTOMER_APPROVAL",
    storyboardRerollCount: 0,
    refundRequestedAt: null,
    ...overrides,
  };
}

function main() {
  /* ---------------------------------------------------------------- */
  /* Guard 1 — a 4th re-roll is refused                                 */
  /* ---------------------------------------------------------------- */
  console.log("\n=== Guard 1: 4th re-roll refused ===");
  {
    const capped = order({ storyboardRerollCount: STORYBOARD_REROLL_CAP });
    const under = order({ storyboardRerollCount: STORYBOARD_REROLL_CAP - 1 });
    const atCapResult = canReroll(capped);
    const underCapResult = canReroll(under);
    assertTrue("storyboardRerollCount === CAP -> refused", atCapResult.ok === false);
    assertTrue("storyboardRerollCount === CAP - 1 -> allowed", underCapResult.ok === true);
    // Sanity: a value that somehow exceeded the cap (shouldn't happen given
    // the atomic guard, but the pure function must still fail closed) is
    // also refused, not just the exact boundary.
    const overCapResult = canReroll(order({ storyboardRerollCount: STORYBOARD_REROLL_CAP + 1 }));
    assertTrue("storyboardRerollCount > CAP -> also refused (fails closed)", overCapResult.ok === false);
  }

  /* ---------------------------------------------------------------- */
  /* Guard 2 — refund refused with re-rolls remaining                   */
  /* ---------------------------------------------------------------- */
  console.log("\n=== Guard 2: refund refused with re-rolls remaining ===");
  {
    const oneUsed = order({ storyboardRerollCount: 1 });
    const zeroUsed = order({ storyboardRerollCount: 0 });
    const result1 = canRequestRefund(oneUsed);
    const result0 = canRequestRefund(zeroUsed);
    assertTrue("1 of CAP re-rolls used -> refund refused", result1.ok === false);
    assertTrue("0 of CAP re-rolls used -> refund refused", result0.ok === false);
    if (!result1.ok) {
      assertTrue(
        "reason mentions the remaining re-rolls, not a generic error",
        /re-roll/i.test(result1.reason)
      );
    }
    const allUsed = order({ storyboardRerollCount: STORYBOARD_REROLL_CAP });
    assertTrue("all CAP re-rolls used -> refund allowed", canRequestRefund(allUsed).ok === true);
  }

  /* ---------------------------------------------------------------- */
  /* Guard 3 — refund refused after Gate 1 approval                     */
  /* ---------------------------------------------------------------- */
  console.log("\n=== Guard 3: refund refused after Gate 1 approval ===");
  {
    const pastGate1 = order({ storyboardRerollCount: STORYBOARD_REROLL_CAP, status: "VIDEO_GENERATING" });
    const result = canRequestRefund(pastGate1);
    assertTrue("status moved past AWAITING_CUSTOMER_APPROVAL -> refund refused", result.ok === false);
    // Bonus: re-roll is refused post-approval too (a customer can't spend a
    // "free re-roll" on a storyboard that's already filming).
    assertTrue("status moved past AWAITING_CUSTOMER_APPROVAL -> re-roll also refused", canReroll(pastGate1).ok === false);
  }

  /* ---------------------------------------------------------------- */
  /* Guard 4 — REFUND is Director's Cut only; the RE-ROLL is not        */
  /* ---------------------------------------------------------------- */
  //
  // This block used to assert that a Preset order could not re-roll either.
  // That stopped being true on 2026-08-16, when re-making a delivered film was
  // withdrawn from BOTH plans: with that gone, the storyboard re-roll is the
  // only remedy a customer has left, and taking it from Preset would leave
  // that plan with "approve it, and that's that". See the note at the top of
  // canReroll in lib/safety-net.ts.
  //
  // The assertions were left behind by that change and had been failing ever
  // since — the CODE was right and the TEST was stale, which is the worse of
  // the two ways round: a suite that is expected to be partly red is a suite
  // nobody reads, and the next real breakage lands in the noise.
  console.log("\n=== Guard 4: refund is DC-only; the re-roll is not ===");
  {
    const preset = order({ tier: "preset", storyboardRerollCount: STORYBOARD_REROLL_CAP });
    const presetNullTier = order({ tier: null, storyboardRerollCount: STORYBOARD_REROLL_CAP });
    // The refund split is unchanged: still custom-only (Preset's own $59
    // deduction is handled case by case, not by this guard).
    assertTrue("preset tier -> refund refused (even with CAP used)", canRequestRefund(preset).ok === false);
    assertTrue("null tier (legacy row) -> refund refused", canRequestRefund(presetNullTier).ok === false);
    // ...but the re-roll is now open to every plan, and is refused only for
    // the reasons that apply to everyone: cap spent, wrong status, refund
    // already requested (each of those is covered by Guards 1-3 and 5 above).
    assertTrue("preset tier -> re-roll ALLOWED with 0 used", canReroll(order({ tier: "preset" })).ok === true);
    assertTrue("null tier (legacy row) -> re-roll ALLOWED with 0 used", canReroll(order({ tier: null })).ok === true);
    assertTrue("preset tier -> re-roll refused once the cap is spent", canReroll(preset).ok === false);
  }

  /* ---------------------------------------------------------------- */
  /* Guard 5 — concurrent double-submit cannot exceed the cap           */
  /* ---------------------------------------------------------------- */
  console.log("\n=== Guard 5: concurrent double-submit cannot exceed the cap ===");
  {
    // One shared row, "clicked" 5 times — see attemptReroll's doc comment
    // for why calling it once per simulated click is a faithful stand-in
    // for Postgres serializing concurrent updateMany calls against the row.
    const row = order();
    const results = Array.from({ length: 5 }, () => attemptReroll(row));
    const succeeded = results.filter(Boolean).length;
    assertEqual("exactly CAP of 5 racing attempts succeed", succeeded, STORYBOARD_REROLL_CAP);
    assertEqual("storyboardRerollCount settles at exactly CAP, never above", row.storyboardRerollCount, STORYBOARD_REROLL_CAP);
    assertTrue("attempts 4 and 5 (post-cap) both fail", results[3] === false && results[4] === false);
  }

  /* ---------------------------------------------------------------- */
  /* Bonus — re-roll refused once a refund has been requested           */
  /* ---------------------------------------------------------------- */
  console.log("\n=== Bonus: re-roll frozen after a refund request ===");
  {
    const refunded = order({ storyboardRerollCount: STORYBOARD_REROLL_CAP, refundRequestedAt: new Date() });
    assertTrue("refundRequestedAt set -> re-roll refused", canReroll(refunded).ok === false);
    assertTrue("refundRequestedAt set -> a second refund request refused (one-shot)", canRequestRefund(refunded).ok === false);
  }

  /* ---------------------------------------------------------------- */
  /* Bonus — re-roll seeds can never repeat a cut's prior artwork       */
  /* ---------------------------------------------------------------- */
  console.log("\n=== Bonus: re-roll seeds never collide with stage-3 or each other ===");
  {
    // Enumerate EVERY seed the original stage-3 generation could possibly
    // use for ANY cut: STILL_SEED + cut*100 + take*1000 + attempt*7919 (the
    // exact formula documented next to STILL_SEED in lib/stills-pipeline.ts).
    const stage3Seeds = new Set<number>();
    for (let cutIdx = 0; cutIdx < NUM_CUTS; cutIdx++) {
      for (let take = 0; take < TAKES_PER_CUT; take++) {
        for (let attempt = 0; attempt <= MAX_TAKE_REROLLS; attempt++) {
          stage3Seeds.add(STILL_SEED + cutIdx * 100 + take * 1000 + attempt * 7919);
        }
      }
    }
    assertEqual(
      "stage-3 seed enumeration size (NUM_CUTS x TAKES_PER_CUT x (MAX_TAKE_REROLLS+1), all distinct)",
      stage3Seeds.size,
      NUM_CUTS * TAKES_PER_CUT * (MAX_TAKE_REROLLS + 1)
    );

    // Every re-roll a single order can ever make: rerollCount runs
    // 1..STORYBOARD_REROLL_CAP (order-wide, each value used at most once —
    // see rerollSeedBase's doc comment), for every cut, every take, every
    // generateGatedTake retry attempt.
    const rerollSeeds = new Set<number>();
    let rerollCollisions = 0;
    for (let cutIdx = 0; cutIdx < NUM_CUTS; cutIdx++) {
      for (let rerollCount = 1; rerollCount <= STORYBOARD_REROLL_CAP; rerollCount++) {
        const base = rerollSeedBase(cutIdx, rerollCount);
        for (let take = 0; take < TAKES_PER_CUT; take++) {
          for (let attempt = 0; attempt <= MAX_TAKE_REROLLS; attempt++) {
            const seed = base + take * 1000 + attempt * 7919;
            if (stage3Seeds.has(seed)) rerollCollisions++;
            if (rerollSeeds.has(seed)) rerollCollisions++;
            rerollSeeds.add(seed);
          }
        }
      }
    }
    assertEqual("re-roll seeds never collide with stage-3 seeds or each other", rerollCollisions, 0);
    assertEqual(
      "re-roll seed enumeration size (NUM_CUTS x CAP x TAKES_PER_CUT x (MAX_TAKE_REROLLS+1), all distinct)",
      rerollSeeds.size,
      NUM_CUTS * STORYBOARD_REROLL_CAP * TAKES_PER_CUT * (MAX_TAKE_REROLLS + 1)
    );

    // The property that actually matters (see rerollSeedBase's comment):
    // cross-cut collisions are harmless (different scene text -> different
    // image regardless of seed), so re-confirm the property that DOES
    // matter in isolation — same cut, different re-roll events, never
    // collide with each other or with that cut's own stage-3 seeds.
    const cutUnderTest = 2;
    const sameCutSeeds = new Set<number>();
    let sameCutCollisions = 0;
    for (let take = 0; take < TAKES_PER_CUT; take++) {
      for (let attempt = 0; attempt <= MAX_TAKE_REROLLS; attempt++) {
        sameCutSeeds.add(STILL_SEED + cutUnderTest * 100 + take * 1000 + attempt * 7919);
      }
    }
    for (let rerollCount = 1; rerollCount <= STORYBOARD_REROLL_CAP; rerollCount++) {
      const base = rerollSeedBase(cutUnderTest, rerollCount);
      for (let take = 0; take < TAKES_PER_CUT; take++) {
        for (let attempt = 0; attempt <= MAX_TAKE_REROLLS; attempt++) {
          const seed = base + take * 1000 + attempt * 7919;
          if (sameCutSeeds.has(seed)) sameCutCollisions++;
          sameCutSeeds.add(seed);
        }
      }
    }
    assertEqual(
      `cut ${cutUnderTest}: 3 successive re-rolls never repeat that cut's own prior seeds`,
      sameCutCollisions,
      0
    );
  }

  console.log(`\nRESULT: ${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main();

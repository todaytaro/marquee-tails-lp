import { OrderStatus, type Order } from "@/generated/prisma/client";
import { transitionOrder } from "@/lib/orders";
import { generateTreatment } from "@/lib/claude-script";

/**
 * Shared "generate a treatment for an order already sitting in
 * TREATMENT_GENERATING, then transition it out" step.
 *
 * Both submit-photos (Gate 0, first draft — see its own doc comment) and the
 * admin re-kick path (app/admin/actions.ts#rekickGenerationAction, recovering
 * an order stranded in TREATMENT_GENERATING) start from the exact same shape:
 * an order already in TREATMENT_GENERATING, a brief + pet name to feed
 * generateTreatment(), and the same three possible outcomes:
 *
 *   - "rejected" (moderation/IP/off-scope) -> revert to UPLOADING, caller
 *                                              surfaces `reason`.
 *   - "ok"                                  -> persist generatedScript +
 *                                              treatmentText, advance to
 *                                              AWAITING_TREATMENT_APPROVAL.
 *   - thrown error                          -> revert to UPLOADING (the
 *                                              compensating-revert pattern
 *                                              this whole file exists for).
 *
 * UPLOADING is the only allowed compensating-revert target for
 * TREATMENT_GENERATING (lib/orders.ts's ALLOWED_TRANSITIONS) — not a choice
 * made here, so callers can't ask for anything else.
 *
 * revise-treatment (app/api/orders/revise-treatment/route.ts) is deliberately
 * NOT wired through this: it starts from AWAITING_TREATMENT_APPROVAL, always
 * carries a prior WorldBundle + revisionInstruction, and — critically —
 * reverts to AWAITING_TREATMENT_APPROVAL (the state it came FROM, keeping the
 * customer's last-approved-for-review treatment intact) rather than
 * UPLOADING. Forcing that onto this helper would mean a second revert-target
 * parameter and extra branching for a shape that doesn't actually match, so
 * it stays as its own inline block.
 */

export type RunTreatmentGenerationResult =
  | { status: "ok"; order: Order }
  | { status: "rejected"; reason: string }
  | { status: "error" };

export async function runTreatmentGeneration(
  orderId: string,
  input: { brief: string; petName: string },
  opts: {
    // Attributed to the audit log (StatusEvent.actor) — "system" for the
    // customer-triggered inline call (submit-photos), "admin" for an
    // admin-triggered re-kick, so the two are distinguishable in the
    // chargeback-defense timeline (CHARGEBACK-DEFENSE-SPEC.md §4) without
    // needing a dedicated EvidenceEvent kind for the admin path.
    actor: "system" | "admin";
    successNote: string;
    revertNote: string;
  }
): Promise<RunTreatmentGenerationResult> {
  try {
    const result = await generateTreatment(input);

    if (result.status === "rejected") {
      await transitionOrder(
        orderId,
        OrderStatus.TREATMENT_GENERATING,
        OrderStatus.UPLOADING,
        opts.actor,
        {},
        `treatment rejected: ${result.reason}`
      );
      return { status: "rejected", reason: result.reason };
    }

    const order = await transitionOrder(
      orderId,
      OrderStatus.TREATMENT_GENERATING,
      OrderStatus.AWAITING_TREATMENT_APPROVAL,
      opts.actor,
      { generatedScript: result.bundle, treatmentText: result.treatmentText },
      opts.successNote
    );
    return { status: "ok", order };
  } catch (err) {
    console.error(`[treatment] generation failed, reverting order=${orderId}`, err);
    await transitionOrder(
      orderId,
      OrderStatus.TREATMENT_GENERATING,
      OrderStatus.UPLOADING,
      opts.actor,
      {},
      opts.revertNote
    );
    return { status: "error" };
  }
}

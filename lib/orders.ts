import { OrderStatus, Prisma, type Order } from "@/generated/prisma/client";
import { prisma } from "./db";

/**
 * The state machine, as data. Every status change in the app MUST go through
 * transitionOrder() — there is deliberately no other code path that writes
 * `status`, so skipping a gate is impossible by construction.
 */
const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  // Preset orders go straight to stills. Custom orders take a detour through
  // the Director's Cut "Gate 0" (treatment approval) first.
  [OrderStatus.UPLOADING]: [OrderStatus.IMAGE_GENERATING, OrderStatus.TREATMENT_GENERATING],
  // Custom "Gate 0": brief submitted -> Claude drafts a treatment; revert to
  // UPLOADING if the Claude kick/generation fails (same compensating pattern
  // as the stills kick below).
  [OrderStatus.TREATMENT_GENERATING]: [
    OrderStatus.AWAITING_TREATMENT_APPROVAL,
    OrderStatus.UPLOADING, // compensating revert on failure
  ],
  // Customer approves the treatment -> existing stills stage; or asks for a
  // revision -> back to generating.
  [OrderStatus.AWAITING_TREATMENT_APPROVAL]: [
    OrderStatus.IMAGE_GENERATING,
    OrderStatus.TREATMENT_GENERATING,
  ],
  // Forward to Gate 1 — or compensating revert when stills generation fails.
  // The AWAITING_TREATMENT_APPROVAL target lets a custom order's stills-kick
  // failure fall back to the treatment gate (not UPLOADING, which would
  // re-show the photo form and lose the approved treatment context).
  [OrderStatus.IMAGE_GENERATING]: [
    OrderStatus.AWAITING_CUSTOMER_APPROVAL,
    OrderStatus.UPLOADING,
    OrderStatus.AWAITING_TREATMENT_APPROVAL,
  ],
  // Gate 1: customer approval is the ONLY way into video generation.
  [OrderStatus.AWAITING_CUSTOMER_APPROVAL]: [OrderStatus.VIDEO_GENERATING],
  // Forward to Gate 2 — or compensating revert when the pipeline kick fails
  // (system actor only; keeps orders from being stranded with no video coming)
  // — or FAILED when film generation fails after Trigger.dev exhausts retries.
  [OrderStatus.VIDEO_GENERATING]: [
    OrderStatus.AWAITING_ADMIN_APPROVAL,
    OrderStatus.AWAITING_CUSTOMER_APPROVAL,
    OrderStatus.FAILED,
  ],
  // Gate 2: admin approval is the ONLY way into delivery — or the admin sends
  // a bad shot back to production (single-shot re-render), which returns the
  // order to VIDEO_GENERATING until the fixed film comes back for review.
  [OrderStatus.AWAITING_ADMIN_APPROVAL]: [
    OrderStatus.COMPLETED,
    OrderStatus.VIDEO_GENERATING,
  ],
  [OrderStatus.COMPLETED]: [],
  // The only way out of FAILED is an admin-triggered retry, back into video
  // generation (see app/admin/actions.ts#retryFilmAction).
  [OrderStatus.FAILED]: [OrderStatus.VIDEO_GENERATING],
  // Reserved enum value — currently unused (no transitions in or out). Kept
  // because the DB enum + migration already have it; not part of any flow.
  [OrderStatus.CANCELLED]: [],
};

export class TransitionError extends Error {
  constructor(
    public readonly orderId: string,
    public readonly expectedFrom: OrderStatus,
    public readonly to: OrderStatus
  ) {
    super(
      `Order ${orderId}: illegal or stale transition ${expectedFrom} -> ${to}`
    );
    this.name = "TransitionError";
  }
}

/**
 * Atomically move an order from `from` to `to`.
 *
 * Uses updateMany with a status guard as optimistic concurrency control:
 * if the row is no longer in `from` (double-click, race, replayed webhook),
 * zero rows match and we throw instead of double-firing side effects.
 * Also appends to the audit log in the same transaction.
 */
export async function transitionOrder(
  orderId: string,
  from: OrderStatus,
  to: OrderStatus,
  actor: "customer" | "admin" | "system",
  extraData: Partial<
    Pick<
      Order,
      | "selectedImageUrl"
      | "finalVideoUrl"
      | "socialVideoUrl"
      | "adminNote"
      | "chosenStills"
      | "posterCutIndex"
      | "failureReason"
      | "treatmentText"
      | "customBrief"
      | "treatmentRevisionCount"
    >
  > & {
    // Order["generatedScript"]'s read type (JsonValue | null) includes plain
    // `null`, which Prisma's Json update input rejects (it wants the
    // Prisma.JsonNull sentinel instead) — every caller here always writes a
    // full WorldBundle, never null, so this narrows to Prisma's write type
    // directly rather than fighting the read/write type mismatch.
    generatedScript?: Prisma.InputJsonValue;
  } = {},
  note?: string
): Promise<Order> {
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new TransitionError(orderId, from, to);
  }

  return prisma.$transaction(async (tx) => {
    const { count } = await tx.order.updateMany({
      where: { id: orderId, status: from }, // status guard = the gate
      data: { status: to, ...extraData },
    });
    if (count !== 1) throw new TransitionError(orderId, from, to);

    await tx.statusEvent.create({
      data: { orderId, from, to, actor, note },
    });

    return tx.order.findUniqueOrThrow({ where: { id: orderId } });
  });
}

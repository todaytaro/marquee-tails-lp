import { OrderStatus, type Order } from "@/generated/prisma/client";
import { prisma } from "./db";

/**
 * The state machine, as data. Every status change in the app MUST go through
 * transitionOrder() — there is deliberately no other code path that writes
 * `status`, so skipping a gate is impossible by construction.
 */
const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  [OrderStatus.UPLOADING]: [OrderStatus.IMAGE_GENERATING],
  [OrderStatus.IMAGE_GENERATING]: [OrderStatus.AWAITING_CUSTOMER_APPROVAL],
  // Gate 1: customer approval is the ONLY way into video generation.
  [OrderStatus.AWAITING_CUSTOMER_APPROVAL]: [OrderStatus.VIDEO_GENERATING],
  [OrderStatus.VIDEO_GENERATING]: [OrderStatus.AWAITING_ADMIN_APPROVAL],
  // Gate 2: admin approval is the ONLY way into delivery.
  [OrderStatus.AWAITING_ADMIN_APPROVAL]: [OrderStatus.COMPLETED],
  [OrderStatus.COMPLETED]: [],
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
    Pick<Order, "selectedImageUrl" | "finalVideoUrl" | "adminNote">
  > = {},
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

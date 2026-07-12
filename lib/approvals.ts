import { OrderStatus, type Order } from "@/generated/prisma/client";
import { transitionOrder } from "@/lib/orders";
import { sendDeliveryEmail, createPodOrder } from "@/lib/mocks";

/**
 * Gate 2 domain logic — the single implementation used by BOTH the admin API
 * route (app/api/admin/approve-video) and the dashboard server action
 * (app/admin/actions.ts).
 *
 * Atomically transitions AWAITING_ADMIN_APPROVAL -> COMPLETED via the state
 * machine, then fires delivery side effects. Side effects run only after the
 * transition is committed and cannot fire twice: a second call finds
 * status=COMPLETED and transitionOrder throws TransitionError.
 *
 * Throws TransitionError when the order is not awaiting admin approval;
 * callers translate that into their own 409 / {ok:false} shape.
 */
export async function approveVideo(
  orderId: string,
  adminNote?: string
): Promise<Order> {
  const updated = await transitionOrder(
    orderId,
    OrderStatus.AWAITING_ADMIN_APPROVAL,
    OrderStatus.COMPLETED,
    "admin",
    adminNote ? { adminNote } : {},
    "Gate 2: admin approved final video"
  );

  await sendDeliveryEmail(updated);
  await createPodOrder(updated);

  return updated;
}

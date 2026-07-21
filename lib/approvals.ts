import { OrderStatus, type Order } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { transitionOrder } from "@/lib/orders";
import { sendDeliveryEmail, createPodOrder } from "@/lib/mocks";
import { getLoglines } from "@/lib/film-script";
import { renderPosterPng } from "@/lib/poster-print";

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
  let updated = await transitionOrder(
    orderId,
    OrderStatus.AWAITING_ADMIN_APPROVAL,
    OrderStatus.COMPLETED,
    "admin",
    adminNote ? { adminNote } : {},
    "Gate 2: admin approved final video"
  );

  // Flatten the customer's poster pick (text-free art) into the print-ready
  // PNG that ships to POD — same design as the on-screen MoviePosterOverlay,
  // baked once via satori (lib/poster-print.ts) now that it's final. Never
  // blocks delivery of the finished film: a render failure just leaves
  // posterPrintUrl unset for a manual re-run.
  if (updated.posterUrl && process.env.VIDEO_PIPELINE_MOCK !== "1") {
    try {
      const petName = updated.petName ?? "Your Star";
      const loglines = getLoglines(updated.world ?? "deepspace", updated.personality, petName);
      const posterPrintUrl = await renderPosterPng(updated.posterUrl, {
        petName,
        tagline: loglines.intro,
        subtitle: loglines.tagline,
      });
      updated = await prisma.order.update({ where: { id: updated.id }, data: { posterPrintUrl } });
    } catch (e) {
      console.error(`[approvals] poster print render failed order=${updated.id} (delivery continues)`, e);
    }
  }

  await sendDeliveryEmail(updated);
  await createPodOrder(updated);

  return updated;
}

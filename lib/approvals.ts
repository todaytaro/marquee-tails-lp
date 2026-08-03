import { OrderStatus, type Order } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { transitionOrder } from "@/lib/orders";
import { sendDeliveryEmail } from "@/lib/mocks";
import { resolveWorld } from "@/lib/film-script";
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
  adminNote?: string,
  // The reviewer's poster choice, offered only when the customer hasn't made
  // one. Deliberately supplied HERE rather than saved earlier: the customer
  // can still pick right up until this approval (choose-poster accepts
  // AWAITING_ADMIN_APPROVAL), so an admin choice stored in advance would
  // appear to the customer as "already chosen" and quietly take away the
  // pick that is theirs to make. Arriving with the approval, it cannot —
  // the same transition that consumes it also closes the customer's window.
  adminPosterChoice?: string
): Promise<Order> {
  let updated = await transitionOrder(
    orderId,
    OrderStatus.AWAITING_ADMIN_APPROVAL,
    OrderStatus.COMPLETED,
    "admin",
    adminNote ? { adminNote } : {},
    "Gate 2: admin approved final video"
  );

  // Default the poster to the first candidate when the customer never picked.
  //
  // Everything downstream keys off posterUrl: no pick means no posterPrintUrl,
  // which means the free digital poster promised in BOTH plans is never
  // delivered and the $59/$99 print upsell never renders — the customer
  // quietly loses something they paid for, and we lose the add-on entirely.
  // A default they didn't choose is strictly better than nothing at all: all
  // three candidates are of their pet, in their film's world, and the picker
  // says up front that the first one ships if they don't choose.
  //
  // Only fills a genuine blank, so a real pick is never overwritten — that
  // holds for the admin's choice too. Order of preference: what the customer
  // chose, then what the reviewer chose for them, then candidate 1. The
  // reviewer's choice is a better default than the first candidate (they have
  // actually looked at all three), but it is still only a default.
  if (!updated.posterUrl && updated.posterOptions.length > 0) {
    // Must be one of THIS order's candidates. Anything else is a bug or a
    // tampered form post, and either way we fall back rather than write a
    // poster URL that belongs to nobody.
    const adminPick =
      adminPosterChoice && updated.posterOptions.includes(adminPosterChoice)
        ? adminPosterChoice
        : undefined;
    if (adminPosterChoice && !adminPick) {
      console.warn(
        `[approvals] order=${updated.id} admin poster choice is not one of this order's candidates — ignoring it`
      );
    }
    console.log(
      `[approvals] order=${updated.id} completed with no customer poster pick — using ${
        adminPick ? "the reviewer's choice" : "candidate 1"
      }`
    );
    updated = await prisma.order.update({
      where: { id: updated.id },
      data: { posterUrl: adminPick ?? updated.posterOptions[0] },
    });
  }

  // Flatten the customer's poster pick (text-free art) into the print-ready
  // PNG that ships to POD once (and if) the customer buys a physical add-on
  // — same design as the on-screen MoviePosterOverlay, baked once via satori
  // (lib/poster-print.ts) now that it's final. Never blocks delivery of the
  // finished film: a render failure just leaves posterPrintUrl unset for a
  // manual re-run.
  if (updated.posterUrl && process.env.VIDEO_PIPELINE_MOCK !== "1") {
    try {
      const petName = updated.petName ?? "Your Star";
      const loglines = resolveWorld(updated).loglines;
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

  // Physical fulfilment (Printify) is no longer triggered here — at Gate 2
  // the order has no add-on yet, so createPodOrder would always be a no-op.
  // It now fires from the add-on Checkout webhook once the customer buys a
  // physical poster/canvas post-delivery (Pass 2, PRICING-PRODUCT-V2-SPEC.md
  // §5) — see app/api/webhooks/stripe/route.ts.
  await sendDeliveryEmail(updated);

  return updated;
}

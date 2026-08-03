import { NextResponse } from "next/server";
import { OrderStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { recordEvidence } from "@/lib/evidence";

/**
 * The second human pick — the customer chooses THE poster from the three
 * finished one-sheets, on the "now filming" page while the film renders.
 *
 * POST { orderId, approveToken, posterUrl }
 *
 * Guards:
 * 1. approveToken must match (link auth, no login).
 * 2. posterUrl must be one of the generated posterOptions (no injected URLs).
 * 3. Only while the order is in production or admin review — the pick can be
 *    changed until the admin approves delivery (COMPLETED locks it).
 * No state transition: the pick is data, the 2-gate machine is untouched.
 */
export async function POST(req: Request) {
  let body: { orderId?: string; approveToken?: string; posterUrl?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const { orderId, approveToken, posterUrl } = body;
  if (!orderId || !approveToken || !posterUrl) {
    return NextResponse.json(
      { ok: false, error: "orderId, approveToken and posterUrl are required." },
      { status: 400 }
    );
  }

  const order = await prisma.order.findUnique({ where: { id: orderId } });
  // Same response for "not found" and "bad token" — don't leak which.
  if (!order || order.approveToken !== approveToken) {
    return NextResponse.json({ ok: false, error: "Order not found." }, { status: 404 });
  }

  if (!order.posterOptions.includes(posterUrl)) {
    return NextResponse.json(
      { ok: false, error: "posterUrl is not one of this order's poster options." },
      { status: 400 }
    );
  }

  const pickable =
    order.status === OrderStatus.VIDEO_GENERATING ||
    order.status === OrderStatus.AWAITING_ADMIN_APPROVAL;
  if (!pickable) {
    return NextResponse.json(
      { ok: false, error: `The poster can no longer be changed (current: ${order.status}).` },
      { status: 409 }
    );
  }

  await prisma.order.update({ where: { id: orderId }, data: { posterUrl } });

  // CHARGEBACK-DEFENSE-SPEC.md §3 poster.chosen — never throws (lib/evidence.ts).
  await recordEvidence(orderId, "poster.chosen", { posterUrl }, req);

  return NextResponse.json({ ok: true });
}

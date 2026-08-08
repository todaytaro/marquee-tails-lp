import { NextResponse } from "next/server";
import { OrderStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { recordEvidence } from "@/lib/evidence";
import { normalizeShareConsent } from "@/lib/share-consent";

/**
 * The customer's permission to show their order on Marquee Tails' own social
 * accounts — see lib/share-consent.ts for why this is needed at all (our own
 * /terms §4 closes promotional use off until the customer opens it).
 *
 * POST { orderId, approveToken, film: boolean, photos: boolean }
 *
 * Separate from /api/orders/rate on purpose, even though the two sit in the
 * same place on screen: rating requires stars 1-5, and a customer who ticks a
 * permission box without rating anything must not be rejected for it.
 *
 * Guards mirror choose-poster/rate: token auth with the same 404 for "no such
 * order" and "wrong token", and COMPLETED only — there is nothing to grant
 * permission over until the film exists.
 *
 * Revocation is a normal request with `false`, not a separate endpoint. The
 * licence /terms §4 describes is revocable, so un-ticking has to work, and it
 * is recorded exactly like granting.
 */
export async function POST(req: Request) {
  let body: { orderId?: string; approveToken?: string; film?: unknown; photos?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const { orderId, approveToken } = body;
  if (!orderId || !approveToken) {
    return NextResponse.json(
      { ok: false, error: "orderId and approveToken are required." },
      { status: 400 }
    );
  }

  let consent: { film: boolean; photos: boolean };
  try {
    consent = normalizeShareConsent({ film: body.film, photos: body.photos });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Invalid consent." },
      { status: 400 }
    );
  }

  const order = await prisma.order.findUnique({ where: { id: orderId } });
  // Same response for "not found" and "bad token" — don't leak which.
  if (!order || order.approveToken !== approveToken) {
    return NextResponse.json({ ok: false, error: "Order not found." }, { status: 404 });
  }

  if (order.status !== OrderStatus.COMPLETED) {
    return NextResponse.json(
      { ok: false, error: `Not available until delivery is complete (current: ${order.status}).` },
      { status: 409 }
    );
  }

  const previous = { film: order.shareFilmConsent, photos: order.sharePhotosConsent };
  await prisma.order.update({
    where: { id: orderId },
    data: { shareFilmConsent: consent.film, sharePhotosConsent: consent.photos },
  });

  // The columns hold only the CURRENT answer. This is the audit trail: if a
  // post goes up and the customer later withdraws, these rows are what show
  // permission existed at the time it went up. Never throws (lib/evidence.ts).
  await recordEvidence(orderId, "share.consent", { ...consent, previous }, req);

  return NextResponse.json({ ok: true });
}

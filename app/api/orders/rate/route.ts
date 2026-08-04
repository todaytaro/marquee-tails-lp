import { NextResponse } from "next/server";
import { OrderStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { recordEvidence } from "@/lib/evidence";
import { parseRating } from "@/lib/rating";

/**
 * DELIVERY-RATING-SPEC.md §0/§3 — the customer's own star rating of their
 * finished film, submitted right after they watch it. Not for the LP, not
 * gating anything else: this is chargeback evidence (§0) — a customer who
 * rated their own delivery 4 stars is hard to square with a later "not as
 * described" dispute. No email fires and no OrderStatus changes here.
 *
 * POST { orderId, approveToken, stars, comment? }
 *
 * Guards (see app/api/orders/choose-poster/route.ts — this is the same
 * template):
 * 1. approveToken must match (link auth, no login). Same 404 for "no such
 *    order" and "wrong token" — don't leak which.
 * 2. parseRating() validates stars/comment (400) — pure function, so this
 *    route does no validation of its own beyond calling it.
 * 3. Only accepted once status === COMPLETED (409 otherwise): rating a film
 *    the customer hasn't received yet is meaningless as a satisfaction
 *    signal and worthless as chargeback evidence.
 * 4. Resubmission is allowed — the customer can change their stars. The
 *    columns are overwritten, but the evidence row already written for the
 *    previous value is never touched (EvidenceEvent is append-only).
 */
export async function POST(req: Request) {
  let body: { orderId?: string; approveToken?: string; stars?: unknown; comment?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const { orderId, approveToken, stars: rawStars, comment: rawComment } = body;
  if (!orderId || !approveToken) {
    return NextResponse.json(
      { ok: false, error: "orderId and approveToken are required." },
      { status: 400 }
    );
  }

  let parsed: { stars: number; comment: string | null };
  try {
    parsed = parseRating({ stars: rawStars, comment: rawComment });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Invalid rating." },
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
      { ok: false, error: `Rating isn't open until delivery is complete (current: ${order.status}).` },
      { status: 409 }
    );
  }

  const previousStars = order.ratingStars;
  // `comment` OMITTED means "leave it alone"; `comment: ""` means "clear it".
  // The difference matters because the star and the comment are submitted
  // separately (§4): the UI saves the star the instant it's tapped, with no
  // comment in the body. Writing `parsed.comment` unconditionally would mean
  // that a customer who left a comment and THEN changed their star silently
  // lost what they wrote.
  const commentProvided = rawComment !== undefined;
  await prisma.order.update({
    where: { id: orderId },
    data: {
      ratingStars: parsed.stars,
      ...(commentProvided ? { ratingComment: parsed.comment } : {}),
      ratedAt: new Date(),
    },
  });

  // DELIVERY-RATING-SPEC.md §0/§3 rating.submitted — append-only, so a later
  // re-rating can never erase the fact that the customer once rated it.
  // previousStars rides along precisely so an overwrite still shows up in
  // the evidence row rather than only in the (overwritable) column.
  await recordEvidence(
    orderId,
    "rating.submitted",
    { stars: parsed.stars, hasComment: parsed.comment !== null, previousStars },
    req
  );

  return NextResponse.json({ ok: true });
}

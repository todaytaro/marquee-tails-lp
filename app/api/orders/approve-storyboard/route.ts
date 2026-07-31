import { NextResponse } from "next/server";
import { OrderStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { transitionOrder, TransitionError } from "@/lib/orders";
import { kickFilmGeneration } from "@/lib/film-pipeline";
import { kickPosterGeneration } from "@/lib/poster-pipeline";
import { normalizeStoryboard } from "@/lib/stills-pipeline";

/**
 * Gate 1 — the customer approves their storyboard: one take per cut.
 *
 * POST { orderId, approveToken, chosenStills: string[] }
 *
 * IMPORTANT (PRICING-PRODUCT-V2-SPEC.md §3.5(C)): the browser only ever sees
 * watermarked/downscaled PREVIEW urls (see app/approve/[token]/page.tsx
 * Gate1View, which strips `.clean` before the storyboard prop reaches the
 * client wizard — the clean url must never even round-trip through the
 * page's props, or it would be sitting in plain view in the page source).
 * So `chosenStills` in this request body is the customer's PREVIEW picks, one
 * per cut. This route resolves each pick back to that same option's CLEAN
 * url — server-side, using the order's own stored storyboard, never trusting
 * the client for anything but "which of the 3 previews for this cut" — and
 * THAT clean url is what gets persisted as chosenStills / selectedImageUrl,
 * because that's what the film pipeline animates.
 *
 * Guards, in order:
 * 1. approveToken must match the order (link-based auth, no login).
 * 2. chosenStills must have exactly one entry per cut, and each entry must
 *    match one of THAT cut's generated preview urls (customers cannot inject
 *    arbitrary URLs into the video pipeline, and cannot mix a take into the
 *    wrong cut).
 * 3. Status must be exactly AWAITING_CUSTOMER_APPROVAL — enforced atomically
 *    by transitionOrder, so a double-submit cannot kick the pipeline twice.
 */
export async function POST(req: Request) {
  let body: {
    orderId?: string;
    approveToken?: string;
    chosenStills?: unknown;
    posterCutIndex?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const { orderId, approveToken, chosenStills } = body;
  if (!orderId || !approveToken || !Array.isArray(chosenStills)) {
    return NextResponse.json(
      { ok: false, error: "orderId, approveToken and chosenStills are required." },
      { status: 400 }
    );
  }

  const order = await prisma.order.findUnique({ where: { id: orderId } });
  // Same response for "not found" and "bad token" — don't leak which.
  if (!order || order.approveToken !== approveToken) {
    return NextResponse.json({ ok: false, error: "Order not found." }, { status: 404 });
  }

  // B2-SAFETY-NET-SPEC.md §4.2: once the customer has asked for the $200
  // refund, Gate 1 is frozen for this order — approving the storyboard
  // afterward would kick off production the customer already opted out of.
  // Custom-only in practice (refundRequestedAt is never set on a preset
  // order — see lib/safety-net.ts#canRequestRefund's tier check), so this
  // is a no-op read for every preset order (§7).
  if (order.refundRequestedAt) {
    return NextResponse.json(
      { ok: false, error: "A refund has already been requested for this order — the storyboard can no longer be approved." },
      { status: 409 }
    );
  }

  const storyboard = normalizeStoryboard(order.storyboardOptions);
  if (storyboard.length === 0) {
    return NextResponse.json(
      { ok: false, error: "This order has no storyboard to approve." },
      { status: 409 }
    );
  }

  // One pick per cut, each pick drawn from that cut's own options.
  if (chosenStills.length !== storyboard.length) {
    return NextResponse.json(
      { ok: false, error: `Please pick one still for each of the ${storyboard.length} cuts.` },
      { status: 400 }
    );
  }
  // Match against PREVIEW urls — that's all the client ever saw or submitted.
  const validPicks = chosenStills.every(
    (url, i) => typeof url === "string" && storyboard[i].options.some((o) => o.preview === url)
  );
  if (!validPicks) {
    return NextResponse.json(
      { ok: false, error: "One of the chosen stills is not an option for its cut." },
      { status: 400 }
    );
  }
  // Resolve preview picks -> CLEAN urls. `!` is safe: validPicks above already
  // proved a match exists for every index.
  const picks = (chosenStills as string[]).map(
    (previewUrl, i) => storyboard[i].options.find((o) => o.preview === previewUrl)!.clean
  );

  // Poster scene: defaults to cut 1; reject out-of-range values.
  const rawPoster = body.posterCutIndex;
  const posterCutIndex =
    rawPoster === undefined || rawPoster === null ? 0 : Number(rawPoster);
  if (!Number.isInteger(posterCutIndex) || posterCutIndex < 0 || posterCutIndex >= storyboard.length) {
    return NextResponse.json(
      { ok: false, error: "posterCutIndex must point at one of the cuts." },
      { status: 400 }
    );
  }

  try {
    // chosenStills/posterCutIndex ride along in the SAME atomic, status-guarded
    // write as the transition — a stale/duplicate request (order already past
    // Gate 1) then touches nothing: updateMany's status guard matches zero
    // rows, so TransitionError fires and none of extraData is written. (An
    // earlier version wrote these fields in a separate, unguarded update
    // before the transition; a replayed request could silently overwrite a
    // later admin correction to posterCutIndex.)
    const updated = await transitionOrder(
      order.id,
      OrderStatus.AWAITING_CUSTOMER_APPROVAL,
      OrderStatus.VIDEO_GENERATING,
      "customer",
      { selectedImageUrl: picks[0], chosenStills: picks, posterCutIndex },
      "Gate 1: customer approved storyboard (6 cuts)"
    );

    // Side effect fires only after the transition is committed. If the kick
    // fails (provider down, balance exhausted), compensate: revert to
    // AWAITING_CUSTOMER_APPROVAL so the order is never stranded, and let the
    // customer retry.
    try {
      await kickFilmGeneration(updated);
      // Poster candidates render in parallel with the film; a poster failure
      // never blocks the film (kick logs and continues).
      await kickPosterGeneration(updated);
    } catch (kickErr) {
      console.error(`[approve-storyboard] pipeline kick failed, reverting order=${order.id}`, kickErr);
      await transitionOrder(
        order.id,
        OrderStatus.VIDEO_GENERATING,
        OrderStatus.AWAITING_CUSTOMER_APPROVAL,
        "system",
        {},
        "pipeline kick failed — reverted for retry"
      );
      return NextResponse.json(
        { ok: false, error: "We couldn't start production just now. Please try again in a moment." },
        { status: 503 }
      );
    }

    return NextResponse.json({ ok: true, status: updated.status });
  } catch (err) {
    if (err instanceof TransitionError) {
      return NextResponse.json(
        { ok: false, error: `Order is not awaiting customer approval (current: ${order.status}).` },
        { status: 409 }
      );
    }
    console.error("[approve-storyboard]", err);
    return NextResponse.json(
      { ok: false, error: "Something went wrong on our end." },
      { status: 500 }
    );
  }
}

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/**
 * Lightweight status poll for the customer approval page.
 *
 * GET /api/orders/status?token=<approveToken>
 * -> { status, posterReady } | 404
 *
 * The approveToken authenticates (same as the page); we return the status enum
 * plus one boolean, nothing else. Used by the client StatusPoller to advance
 * the page — no manual refresh.
 *
 * `posterReady` exists because status alone is not enough. The poster options
 * land WHILE the order sits in VIDEO_GENERATING, so a poller watching only the
 * status never fires, and the customer — sitting on a screen that told them to
 * close the page — is never shown the picker at all. Losing that pick costs
 * them the free digital poster and costs us the print/canvas upsell, silently.
 */
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token");
  if (!token) {
    return NextResponse.json({ error: "token required" }, { status: 400 });
  }
  const order = await prisma.order.findUnique({
    where: { approveToken: token },
    select: { status: true, posterOptions: true, posterUrl: true },
  });
  if (!order) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json(
    {
      status: order.status,
      // "there is a poster choice waiting on screen". Flips true when the
      // options finish rendering and false again once a pick is saved, so the
      // poller advances the page on both edges.
      posterReady: order.posterOptions.length > 0 && !order.posterUrl,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

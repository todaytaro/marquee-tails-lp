import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/**
 * Lightweight status poll for the customer approval page.
 *
 * GET /api/orders/status?token=<approveToken>
 * -> { status } | 404
 *
 * The approveToken authenticates (same as the page); we return only the
 * status enum, nothing else. Used by the client StatusPoller to auto-advance
 * the page when generation finishes — no manual refresh.
 */
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token");
  if (!token) {
    return NextResponse.json({ error: "token required" }, { status: 400 });
  }
  const order = await prisma.order.findUnique({
    where: { approveToken: token },
    select: { status: true },
  });
  if (!order) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json(
    { status: order.status },
    { headers: { "Cache-Control": "no-store" } }
  );
}

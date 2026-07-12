import { NextResponse } from "next/server";
import { TransitionError } from "@/lib/orders";
import { approveVideo } from "@/lib/approvals";

/**
 * Gate 2 — the admin approves the finished video.
 *
 * POST { orderId, adminNote? }  with header  x-admin-secret: $ADMIN_API_SECRET
 *
 * Thin HTTP shell around lib/approvals.approveVideo() — the same domain logic
 * the /admin dashboard's server action uses. Only after the transition
 * commits do delivery email + POD order fire.
 */
export async function POST(req: Request) {
  const secret = process.env.ADMIN_API_SECRET;
  if (!secret || req.headers.get("x-admin-secret") !== secret) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  let body: { orderId?: string; adminNote?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body." },
      { status: 400 }
    );
  }

  const { orderId, adminNote } = body;
  if (!orderId) {
    return NextResponse.json(
      { ok: false, error: "orderId is required." },
      { status: 400 }
    );
  }

  try {
    const updated = await approveVideo(orderId, adminNote);
    return NextResponse.json({ ok: true, status: updated.status });
  } catch (err) {
    if (err instanceof TransitionError) {
      return NextResponse.json(
        { ok: false, error: "Order is not awaiting admin approval." },
        { status: 409 }
      );
    }
    console.error("[approve-video]", err);
    return NextResponse.json(
      { ok: false, error: "Something went wrong on our end." },
      { status: 500 }
    );
  }
}

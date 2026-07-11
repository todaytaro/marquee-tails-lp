import { NextResponse } from "next/server";
import { OrderStatus } from "@/generated/prisma/client";
import { transitionOrder, TransitionError } from "@/lib/orders";
import { sendDeliveryEmail, createPodOrder } from "@/lib/mocks";

/**
 * Gate 2 — the admin approves the finished video.
 *
 * POST { orderId, adminNote? }  with header  x-admin-secret: $ADMIN_API_SECRET
 *
 * Only after this transition commits do delivery email + POD order fire.
 * Scaffold auth = shared secret header; swap for real admin session auth
 * when app/admin gets built.
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
    const updated = await transitionOrder(
      orderId,
      OrderStatus.AWAITING_ADMIN_APPROVAL,
      OrderStatus.COMPLETED,
      "admin",
      adminNote ? { adminNote } : {},
      "Gate 2: admin approved final video"
    );

    // Side effects fire only after the transition is committed, and cannot
    // fire twice: a second call finds status=COMPLETED and 409s above.
    await sendDeliveryEmail(updated);
    await createPodOrder(updated);

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

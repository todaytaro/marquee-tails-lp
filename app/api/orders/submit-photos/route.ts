import { NextResponse } from "next/server";
import { fal } from "@fal-ai/client";
import { OrderStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { transitionOrder, TransitionError } from "@/lib/orders";
import { kickStillsGeneration } from "@/lib/stills-pipeline";

/**
 * Intake — the customer submits pet photos + quiz answers.
 *
 * POST multipart/form-data:
 *   orderId, approveToken, petName, world (deepspace|storybook|noir),
 *   photos (4-8 image files, <=10MB each)
 *
 * Photos are uploaded to fal storage (generation models fetch them directly;
 * unguessable public URLs). Then UPLOADING -> IMAGE_GENERATING and the
 * stills pipeline kicks. On kick failure, compensating revert to UPLOADING.
 */

const MAX_PHOTOS = 8;
const MIN_PHOTOS = 4;
const MAX_BYTES = 10 * 1024 * 1024;
const WORLDS = new Set(["deepspace", "storybook", "noir"]);
const PERSONALITIES = new Set(["brave", "easygoing", "playful", "timid"]);

export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid form data." }, { status: 400 });
  }

  const orderId = String(form.get("orderId") ?? "");
  const approveToken = String(form.get("approveToken") ?? "");
  const petName = String(form.get("petName") ?? "").trim().slice(0, 40);
  const world = String(form.get("world") ?? "");
  const personality = String(form.get("personality") ?? "");
  const photos = form.getAll("photos").filter((p): p is File => p instanceof File);

  if (!orderId || !approveToken) {
    return NextResponse.json({ ok: false, error: "orderId and approveToken are required." }, { status: 400 });
  }
  if (!petName) {
    return NextResponse.json({ ok: false, error: "Please tell us your pet's name." }, { status: 400 });
  }
  if (!WORLDS.has(world)) {
    return NextResponse.json({ ok: false, error: "Please pick a world." }, { status: 400 });
  }
  if (!PERSONALITIES.has(personality)) {
    return NextResponse.json({ ok: false, error: "Please pick a personality." }, { status: 400 });
  }
  if (photos.length < MIN_PHOTOS || photos.length > MAX_PHOTOS) {
    return NextResponse.json(
      { ok: false, error: `Please upload ${MIN_PHOTOS}-${MAX_PHOTOS} photos.` },
      { status: 400 }
    );
  }
  for (const p of photos) {
    if (!p.type.startsWith("image/")) {
      return NextResponse.json({ ok: false, error: "Only image files are allowed." }, { status: 400 });
    }
    if (p.size > MAX_BYTES) {
      return NextResponse.json({ ok: false, error: "Each photo must be under 10MB." }, { status: 400 });
    }
  }

  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order || order.approveToken !== approveToken) {
    return NextResponse.json({ ok: false, error: "Order not found." }, { status: 404 });
  }
  if (order.status !== OrderStatus.UPLOADING) {
    return NextResponse.json(
      { ok: false, error: `Photos were already submitted (current: ${order.status}).` },
      { status: 409 }
    );
  }

  try {
    // Upload photos to fal storage — generation models fetch these directly.
    const falKey = process.env.FAL_KEY;
    if (!falKey) throw new Error("FAL_KEY is not set");
    fal.config({ credentials: falKey });
    const uploadedPhotoUrls = await Promise.all(photos.map((p) => fal.storage.upload(p)));

    await prisma.order.update({
      where: { id: order.id },
      data: { petName, world, personality, uploadedPhotoUrls },
    });

    const updated = await transitionOrder(
      order.id,
      OrderStatus.UPLOADING,
      OrderStatus.IMAGE_GENERATING,
      "customer",
      {},
      `photos submitted (${photos.length}), world=${world}`
    );

    try {
      await kickStillsGeneration(updated);
    } catch (kickErr) {
      console.error(`[submit-photos] stills kick failed, reverting order=${order.id}`, kickErr);
      await transitionOrder(
        order.id,
        OrderStatus.IMAGE_GENERATING,
        OrderStatus.UPLOADING,
        "system",
        {},
        "stills kick failed — reverted for retry"
      );
      return NextResponse.json(
        { ok: false, error: "We couldn't start on your stills just now. Please try again in a moment." },
        { status: 503 }
      );
    }

    return NextResponse.json({ ok: true, status: updated.status });
  } catch (err) {
    if (err instanceof TransitionError) {
      return NextResponse.json(
        { ok: false, error: "Photos were already submitted." },
        { status: 409 }
      );
    }
    console.error("[submit-photos]", err);
    return NextResponse.json(
      { ok: false, error: "Something went wrong on our end." },
      { status: 500 }
    );
  }
}

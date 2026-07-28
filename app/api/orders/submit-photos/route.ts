import { NextResponse } from "next/server";
import { fal } from "@fal-ai/client";
import { OrderStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { transitionOrder, TransitionError } from "@/lib/orders";
import { kickStillsGeneration } from "@/lib/stills-pipeline";
import { generateTreatment } from "@/lib/claude-script";

/**
 * Intake — the customer submits pet photos + quiz answers (preset) or photos
 * + a guided brief (custom / Director's Cut).
 *
 * POST multipart/form-data:
 *   orderId, approveToken, petName, photos (4-8 image files, <=10MB each),
 *   + preset: world (deepspace|storybook|noir), personality
 *   + custom: customBrief (20-2000 chars, guided fields assembled client-side)
 *
 * Photos are uploaded to fal storage (generation models fetch them directly;
 * unguessable public URLs) for both tiers.
 *
 * preset (unchanged): UPLOADING -> IMAGE_GENERATING, kick the stills
 * pipeline. On kick failure, compensating revert to UPLOADING.
 *
 * custom (Director's Cut "Gate 0"): UPLOADING -> TREATMENT_GENERATING, then
 * generateTreatment() runs INLINE (seconds, no Trigger.dev needed for B1):
 *   - "rejected"     -> revert to UPLOADING, 422 with the friendly reason so
 *                       the guided brief form can show it and let them reword.
 *   - "ok"            -> persist generatedScript + treatmentText, then
 *                       TREATMENT_GENERATING -> AWAITING_TREATMENT_APPROVAL.
 *   - thrown error    -> revert to UPLOADING, 503 (mirrors the stills-kick
 *                       revert pattern below).
 */

// Custom orders run an inline Claude call (generateTreatment) in this handler.
// Give the function headroom so a slow model response can't be killed
// mid-flight — a killed process skips the compensating revert below and would
// strand the order in TREATMENT_GENERATING with no recovery path.
export const maxDuration = 60;

const MAX_PHOTOS = 8;
const MIN_PHOTOS = 4;
const MAX_BYTES = 10 * 1024 * 1024;
const WORLDS = new Set(["deepspace", "storybook", "noir"]);
const PERSONALITIES = new Set(["brave", "easygoing", "playful", "timid"]);
const BRIEF_MIN = 20;
const BRIEF_MAX = 2000;

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
  const customBrief = String(form.get("customBrief") ?? "").trim().slice(0, BRIEF_MAX);
  const photos = form.getAll("photos").filter((p): p is File => p instanceof File);

  if (!orderId || !approveToken) {
    return NextResponse.json({ ok: false, error: "orderId and approveToken are required." }, { status: 400 });
  }
  if (!petName) {
    return NextResponse.json({ ok: false, error: "Please tell us your pet's name." }, { status: 400 });
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

  const isCustom = order.tier === "custom";

  // Tier-specific field validation — preset needs world+personality, custom
  // needs a guided brief instead (no world/personality picker exists for it).
  if (isCustom) {
    if (customBrief.length < BRIEF_MIN || customBrief.length > BRIEF_MAX) {
      return NextResponse.json(
        { ok: false, error: `Please tell us a bit more about the story (${BRIEF_MIN}-${BRIEF_MAX} characters).` },
        { status: 400 }
      );
    }
  } else {
    if (!WORLDS.has(world)) {
      return NextResponse.json({ ok: false, error: "Please pick a world." }, { status: 400 });
    }
    if (!PERSONALITIES.has(personality)) {
      return NextResponse.json({ ok: false, error: "Please pick a personality." }, { status: 400 });
    }
  }

  try {
    // Upload photos to fal storage — generation models fetch these directly.
    const falKey = process.env.FAL_KEY;
    if (!falKey) throw new Error("FAL_KEY is not set");
    fal.config({ credentials: falKey });
    const uploadedPhotoUrls = await Promise.all(photos.map((p) => fal.storage.upload(p)));

    if (isCustom) {
      await prisma.order.update({
        where: { id: order.id },
        data: { petName, customBrief, uploadedPhotoUrls },
      });

      await transitionOrder(
        order.id,
        OrderStatus.UPLOADING,
        OrderStatus.TREATMENT_GENERATING,
        "customer",
        {},
        `photos submitted (${photos.length}), custom brief received`
      );

      try {
        const result = await generateTreatment({ brief: customBrief, petName });

        if (result.status === "rejected") {
          await transitionOrder(
            order.id,
            OrderStatus.TREATMENT_GENERATING,
            OrderStatus.UPLOADING,
            "system",
            {},
            `treatment rejected: ${result.reason}`
          );
          return NextResponse.json({ ok: false, error: result.reason }, { status: 422 });
        }

        const approved = await transitionOrder(
          order.id,
          OrderStatus.TREATMENT_GENERATING,
          OrderStatus.AWAITING_TREATMENT_APPROVAL,
          "system",
          { generatedScript: result.bundle, treatmentText: result.treatmentText },
          "treatment drafted, awaiting customer approval"
        );
        return NextResponse.json({ ok: true, status: approved.status });
      } catch (treatmentErr) {
        console.error(`[submit-photos] treatment generation failed, reverting order=${order.id}`, treatmentErr);
        await transitionOrder(
          order.id,
          OrderStatus.TREATMENT_GENERATING,
          OrderStatus.UPLOADING,
          "system",
          {},
          "treatment generation failed — reverted for retry"
        );
        return NextResponse.json(
          { ok: false, error: "We couldn't draft your treatment just now. Please try again in a moment." },
          { status: 503 }
        );
      }
    }

    // preset — unchanged.
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

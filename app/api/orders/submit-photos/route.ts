import { NextResponse } from "next/server";
import { OrderStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { transitionOrder, TransitionError } from "@/lib/orders";
import { kickStillsGeneration } from "@/lib/stills-pipeline";
import { generateTreatment } from "@/lib/claude-script";

/**
 * Intake — the customer submits pet photos + quiz answers (preset) or photos
 * + a guided brief (custom / Director's Cut).
 *
 * POST application/json:
 *   orderId, approveToken, petName, photoUrls (4-8 Vercel Blob URLs),
 *   + preset: world (deepspace|storybook|noir), personality
 *   + custom: customBrief (20-2000 chars, guided fields assembled client-side)
 *
 * Photos are uploaded client-side straight to Vercel Blob (see
 * components/PhotoUploadForm.tsx + app/api/orders/upload-token/route.ts)
 * rather than through this route: Vercel rejects any function request body
 * over ~4.5MB before our handler runs, so a server-side multipart upload of
 * real phone photos (5 x several MB) is impossible in production. This route
 * now only ever receives the resulting URLs.
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
const WORLDS = new Set(["deepspace", "storybook", "noir"]);
const PERSONALITIES = new Set(["brave", "easygoing", "playful", "timid"]);
const BRIEF_MIN = 20;
const BRIEF_MAX = 2000;

/**
 * SECURITY: photoUrls now arrive from the client (the browser uploaded them
 * directly to Vercel Blob), so unlike the old server-side fal.storage.upload
 * flow they are no longer inherently trustworthy — they're just strings an
 * attacker's client could set to anything. Without this check, a malicious
 * client could point photoUrls at an arbitrary remote URL, which the fal
 * pipelines would then happily fetch server-side (SSRF-ish request-forgery
 * risk, plus unbounded cost from feeding arbitrary/huge remote content into
 * paid generation models). Constrain every URL to https and to our own
 * Vercel Blob public storage host before trusting it.
 */
function isValidPhotoUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return parsed.protocol === "https:" && parsed.hostname.endsWith(".public.blob.vercel-storage.com");
}

export async function POST(req: Request) {
  let body: {
    orderId?: string;
    approveToken?: string;
    petName?: string;
    world?: string;
    personality?: string;
    customBrief?: string;
    photoUrls?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const orderId = String(body.orderId ?? "");
  const approveToken = String(body.approveToken ?? "");
  const petName = String(body.petName ?? "").trim().slice(0, 40);
  const world = String(body.world ?? "");
  const personality = String(body.personality ?? "");
  const customBrief = String(body.customBrief ?? "").trim().slice(0, BRIEF_MAX);
  const photoUrls = Array.isArray(body.photoUrls)
    ? body.photoUrls.filter((u): u is string => typeof u === "string")
    : [];

  if (!orderId || !approveToken) {
    return NextResponse.json({ ok: false, error: "orderId and approveToken are required." }, { status: 400 });
  }
  if (!petName) {
    return NextResponse.json({ ok: false, error: "Please tell us your pet's name." }, { status: 400 });
  }
  // These two rejections are otherwise invisible in production (a 400 with no
  // log line), and they sit between a working upload and the rest of intake —
  // exactly where a silent failure is most expensive. Log the hostnames rather
  // than the full URLs: enough to tell a wrong-host bug from a wrong-count bug
  // without writing customer photo URLs into the logs.
  const photoHosts = [
    ...new Set(
      photoUrls.map((u) => {
        try {
          return new URL(u).hostname;
        } catch {
          return "unparseable";
        }
      })
    ),
  ].join(",");

  if (photoUrls.length < MIN_PHOTOS || photoUrls.length > MAX_PHOTOS) {
    console.error(
      `[submit-photos] rejected order=${orderId}: got ${photoUrls.length} photoUrls (need ${MIN_PHOTOS}-${MAX_PHOTOS}), hosts=${photoHosts || "none"}`
    );
    return NextResponse.json(
      { ok: false, error: `Please upload ${MIN_PHOTOS}-${MAX_PHOTOS} photos.` },
      { status: 400 }
    );
  }
  if (!photoUrls.every(isValidPhotoUrl)) {
    console.error(
      `[submit-photos] rejected order=${orderId}: photoUrls failed the Blob host check, hosts=${photoHosts}`
    );
    return NextResponse.json({ ok: false, error: "Those photo URLs aren't valid." }, { status: 400 });
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
    // Photos were already uploaded client-side to Vercel Blob (validated
    // above); the fal pipelines fetch these public HTTPS URLs directly, same
    // as they used to fetch fal storage URLs.
    const uploadedPhotoUrls = photoUrls;

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
        `photos submitted (${photoUrls.length}), custom brief received`
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
      `photos submitted (${photoUrls.length}), world=${world}`
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

import { NextResponse } from "next/server";
import { OrderStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { transitionOrder, TransitionError } from "@/lib/orders";
import { kickLoraTraining } from "@/lib/stills-pipeline";
import { runTreatmentGeneration } from "@/lib/treatment";
import { recordEvidence } from "@/lib/evidence";

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
 * runTreatmentGeneration() (lib/treatment.ts) runs generateTreatment() INLINE
 * (seconds, no Trigger.dev needed for B1) and handles the transition out:
 *   - "rejected"     -> revert to UPLOADING, 422 with the friendly reason so
 *                       the guided brief form can show it and let them reword.
 *   - "ok"            -> persist generatedScript + treatmentText, then
 *                       TREATMENT_GENERATING -> AWAITING_TREATMENT_APPROVAL.
 *   - thrown error    -> revert to UPLOADING, 503 (mirrors the stills-kick
 *                       revert pattern below).
 * That helper is shared with the admin re-kick path (app/admin/actions.ts#
 * rekickGenerationAction) that recovers an order stranded by the hazard the
 * next comment describes — see there for why that path exists and its
 * treatmentText guard.
 */

// Custom orders run an inline Claude call (generateTreatment) in this handler.
// Give the function headroom so a slow model response can't be killed
// mid-flight — a killed process skips the compensating revert below (it never
// runs at all) and strands the order in TREATMENT_GENERATING. maxDuration
// alone doesn't make that impossible (a double-submit-and-abort, a timeout, a
// deploy can still kill the function mid-call), so it's a mitigation, not a
// guarantee — the admin re-kick path above is the actual recovery mechanism
// for when this headroom isn't enough.
export const maxDuration = 60;

// LORA-STORYBOARD-SPEC.md §5 (owner-approved) — must match
// components/PhotoUploadForm.tsx's MIN_PHOTOS/MAX_PHOTOS, or the client can
// let a customer submit a photo count this route then rejects.
const MAX_PHOTOS = 12;
const MIN_PHOTOS = 7;
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

  // CHARGEBACK-DEFENSE-SPEC.md §3 photos.submitted — every validation above
  // has passed, so this IS the customer's submission, whatever happens next
  // (recordEvidence never throws — a failed insert here must not block
  // intake, same non-fatal posture as every email send in this app).
  await recordEvidence(
    order.id,
    "photos.submitted",
    { count: photoUrls.length, photoUrls },
    req
  );

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

      const result = await runTreatmentGeneration(
        order.id,
        { brief: customBrief, petName },
        {
          actor: "system",
          successNote: "treatment drafted, awaiting customer approval",
          revertNote: "treatment generation failed — reverted for retry",
        }
      );

      if (result.status === "rejected") {
        return NextResponse.json({ ok: false, error: result.reason }, { status: 422 });
      }
      if (result.status === "error") {
        return NextResponse.json(
          { ok: false, error: "We couldn't draft your treatment just now. Please try again in a moment." },
          { status: 503 }
        );
      }
      return NextResponse.json({ ok: true, status: result.order.status });
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
      // LORA-STORYBOARD-SPEC.md §2.7: kicks LoRA training first now, not
      // stills directly — training's own task chains into stills once it's
      // done (or has given up and fallen back), so this is still the single
      // call that starts the whole pipeline.
      await kickLoraTraining(updated);
    } catch (kickErr) {
      console.error(`[submit-photos] lora/stills kick failed, reverting order=${order.id}`, kickErr);
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

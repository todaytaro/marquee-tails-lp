import { NextResponse } from "next/server";
import { completeVideoGeneration } from "@/lib/video-pipeline";

/**
 * fal.ai queue webhook — production callback for finished video generations.
 *
 * URL carries ?orderId=...&secret=$FAL_WEBHOOK_SECRET (shared-secret auth;
 * upgrade to fal's ED25519 signature verification when hardening).
 *
 * fal payload: { request_id, status: "OK" | "ERROR", payload: { video: { url } } | error }
 * Idempotent: completeVideoGeneration uses the atomic status guard, so a
 * replayed webhook gets a TransitionError and we return 200 (already done).
 */
export async function POST(req: Request) {
  const url = new URL(req.url);
  const secret = process.env.FAL_WEBHOOK_SECRET;
  if (!secret || url.searchParams.get("secret") !== secret) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  const orderId = url.searchParams.get("orderId");
  if (!orderId) {
    return NextResponse.json({ ok: false, error: "orderId missing." }, { status: 400 });
  }

  let body: {
    request_id?: string;
    status?: string;
    payload?: { video?: { url?: string } };
    error?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 });
  }

  if (body.status !== "OK") {
    // Generation failed: keep the order in VIDEO_GENERATING and log loudly.
    // The admin queue shows it aging toward the SLA badge; a FAILED state +
    // auto-retry is a follow-up (see requirements.md リスクレジスタ).
    console.error(
      `[fal-webhook] generation FAILED order=${orderId} request=${body.request_id}`,
      body.error
    );
    return NextResponse.json({ ok: true, noted: "failure logged" });
  }

  const videoUrl = body.payload?.video?.url;
  if (!videoUrl) {
    console.error(`[fal-webhook] OK but no video url order=${orderId}`, body);
    return NextResponse.json({ ok: false, error: "No video url in payload." }, { status: 400 });
  }

  try {
    await completeVideoGeneration(orderId, videoUrl);
  } catch (err) {
    // Replayed webhook after completion: order already moved on. Fine.
    console.warn(`[fal-webhook] transition skipped order=${orderId}:`, err);
  }
  return NextResponse.json({ ok: true });
}

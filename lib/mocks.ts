import type { Order } from "@/generated/prisma/client";

/**
 * Mock side effects — the seams where real integrations plug in later.
 *
 * Real implementations (per requirements.md §4):
 * - kickVideoGeneration -> n8n webhook -> Kling 3.0 shot pipeline -> assembly,
 *   which then calls back to move VIDEO_GENERATING -> AWAITING_ADMIN_APPROVAL
 *   with the finished video URL.
 * - sendDeliveryEmail   -> Klaviyo transactional event / Resend.
 * - createPodOrder      -> Printify order API ($99/$159 tiers only).
 *
 * Each mock logs a structured line so the flow is visible in dev.
 */

export async function kickVideoGeneration(order: Order): Promise<void> {
  console.log(
    `[mock:video-pipeline] kick order=${order.id} still=${order.selectedImageUrl} world=${order.world ?? "?"} — real impl: n8n webhook -> Kling 3.0`
  );
}

export async function sendDeliveryEmail(order: Order): Promise<void> {
  console.log(
    `[mock:email] delivery mail to=${order.customerEmail} order=${order.id} video=${order.finalVideoUrl} — real impl: Klaviyo/Resend`
  );
}

export async function createPodOrder(order: Order): Promise<void> {
  console.log(
    `[mock:pod] Printify order for order=${order.id} (skip for $49 digital-only tier) — real impl: Printify API`
  );
}

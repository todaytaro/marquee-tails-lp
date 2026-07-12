import type { Order } from "@/generated/prisma/client";

/**
 * Mock side effects — the seams where real integrations plug in later.
 *
 * Already real: video generation lives in lib/video-pipeline.ts (fal.ai
 * Kling v3). Still mocked (per requirements.md §4):
 * - sendDeliveryEmail   -> Klaviyo transactional event / Resend.
 * - createPodOrder      -> Printify order API ($99/$159 tiers only).
 *
 * Each mock logs a structured line so the flow is visible in dev.
 */

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

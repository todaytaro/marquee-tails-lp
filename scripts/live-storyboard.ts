/**
 * Live storyboard run — seed a fresh order from an EXISTING order's real assets
 * (photos + description + portrait + LoRA) and generate the 6×3 storyboard for
 * real.
 *
 * STORYBOARD-ADMIN-GATE-SPEC.md §3.1: this now stops at the ADMIN review
 * queue, not Gate 1 — runStillsGeneration finishes with the order still in
 * IMAGE_GENERATING (storyboardOptions populated), and nothing reaches
 * AWAITING_CUSTOMER_APPROVAL until a human approves it from /admin/<orderId>.
 * To drive the customer-facing approval wizard from this script's output,
 * open that admin URL first and press "承認して顧客に送る" — only then does
 * the printed /approve/<token> link show a populated Gate 1.
 *
 * (Before this feature, the pipeline itself transitioned straight to
 * AWAITING_CUSTOMER_APPROVAL and this script's "path" line was ready to drive
 * immediately — that direct path no longer exists.)
 *
 * Reuses the source's petDescription + identityPortraitUrl, so stills-pipeline
 * skips stage 0/1 (no re-analyze, no new portrait) — the pet's identity anchor
 * stays exactly the source's. Also reuses the source's loraUrl/loraTriggerWord
 * (LORA-STORYBOARD-SPEC.md §2.7 — runStillsGeneration only ever READS these
 * fields now, it never trains) so this script exercises the real B1 take path
 * instead of silently falling back to the pre-B1 chain, and without spending
 * ~45 minutes + ~$2 re-training a LoRA the source order already has. Generates:
 * hero sheet + 18 takes ≈ $3 real fal. Approving in the UI afterwards kicks the
 * film pipeline (another ~$2.5).
 *
 * Usage: npx tsx scripts/live-storyboard.ts [sourceShopifyOrderId]
 * NOTE: spends real fal — run only with the owner's OK.
 */
import "dotenv/config";
import { OrderStatus } from "../generated/prisma/client";
import { prisma } from "../lib/db";
import { runStillsGeneration, type StoryboardCut } from "../lib/stills-pipeline";

async function main() {
  const srcId = process.argv[2] ?? "stills-test-514564";
  const src = await prisma.order.findFirstOrThrow({ where: { stripeSessionId: srcId } });
  if (!src.uploadedPhotoUrls.some((u) => u.startsWith("http"))) {
    throw new Error(`source ${srcId} has no uploaded photos to reuse`);
  }

  const order = await prisma.order.create({
    data: {
      stripeSessionId: "live-storyboard-" + Math.floor(Math.random() * 1e6),
      customerEmail: src.customerEmail,
      status: OrderStatus.IMAGE_GENERATING,
      petName: src.petName,
      world: src.world,
      personality: src.personality ?? "brave",
      uploadedPhotoUrls: src.uploadedPhotoUrls,
      petDescription: src.petDescription, // reuse -> pipeline skips stage 0/1
      identityPortraitUrl: src.identityPortraitUrl,
      loraUrl: src.loraUrl, // reuse -> B1 takes without a ~45min re-train (§2.7)
      loraTriggerWord: src.loraTriggerWord,
    },
  });
  console.log(`live-storyboard ${order.id} | ${order.petName}/${order.world}/${order.personality} | src=${srcId}`);

  const t0 = Date.now();
  await runStillsGeneration(order);
  const done = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
  const sb = (done.storyboardOptions as StoryboardCut[] | null) ?? [];
  console.log(`\nstoryboard done in ${Math.round((Date.now() - t0) / 1000)}s | status:${done.status} | cuts:${sb.length}`);
  sb.forEach((cut, c) => {
    console.log(`cut ${c} — ${cut.scene}`);
    cut.options.forEach((o, t) => console.log(`  take${t}: clean=${o.clean} preview=${o.preview}`));
  });
  console.log(`\n=== ADMIN REVIEW (new — STORYBOARD-ADMIN-GATE-SPEC.md) ===`);
  console.log(`status: ${done.status} (stays IMAGE_GENERATING until an admin approves)`);
  console.log(`review: /admin/${done.id}`);
  console.log(`\n=== CUSTOMER APPROVAL (only live after the admin approves above) ===`);
  console.log(`token:  ${done.approveToken}`);
  console.log(`path:   /approve/${done.approveToken}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

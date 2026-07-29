/**
 * Live storyboard run — seed a fresh order from an EXISTING order's real assets
 * (photos + description + portrait) and generate the 6×3 storyboard for real,
 * stopping at Gate 1 (AWAITING_CUSTOMER_APPROVAL) so the approval wizard can be
 * driven in the browser.
 *
 * Reuses the source's petDescription + identityPortraitUrl, so stills-pipeline
 * skips stage 0/1 (no re-analyze, no new portrait) — the pet's identity anchor
 * stays exactly the source's. Generates: hero sheet + 18 takes ≈ $3 real fal.
 * Approving in the UI afterwards kicks the film pipeline (another ~$2.5).
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
  console.log(`\n=== APPROVE ===`);
  console.log(`token:  ${done.approveToken}`);
  console.log(`path:   /approve/${done.approveToken}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

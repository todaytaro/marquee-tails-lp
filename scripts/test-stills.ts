/**
 * Consistency test for the storyboard generator: run the full Gate-1 stills
 * pipeline (portrait + hero sheet + 6 cuts × 3 takes) for a fresh order seeded
 * from an existing customer order's photos, print every take URL (compare faces
 * side by side), then animate ONE take into a 5s clip.
 *
 * Usage: npx tsx scripts/test-stills.ts <sourceApproveToken> [personality]
 * NOTE: spends real fal compute (~18 stills + 1 clip). Do not run without the
 * owner's OK.
 */
import "dotenv/config";
import { OrderStatus } from "../generated/prisma/client";
import { prisma } from "../lib/db";
import { runStillsGeneration, type StoryboardCut } from "../lib/stills-pipeline";
import { generateShotClipForTest } from "../lib/film-pipeline";

async function main() {
  const [token, personality = "brave"] = process.argv.slice(2);
  const src = await prisma.order.findUniqueOrThrow({ where: { approveToken: token } });

  const order = await prisma.order.create({
    data: {
      stripeSessionId: "stills-test-" + Math.floor(Math.random() * 1e6),
      customerEmail: src.customerEmail,
      status: OrderStatus.IMAGE_GENERATING,
      petName: src.petName,
      world: src.world,
      personality,
      uploadedPhotoUrls: src.uploadedPhotoUrls,
    },
  });
  console.log(`stills-test ${order.id} | ${order.petName} | ${order.world}/${personality}`);

  const t0 = Date.now();
  await runStillsGeneration(order);
  const done = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
  const storyboard = (done.storyboardOptions as StoryboardCut[] | null) ?? [];
  console.log(`storyboard done in ${Math.round((Date.now() - t0) / 1000)}s`);
  storyboard.forEach((cut, c) => {
    console.log(`  cut ${c} — ${cut.scene}`);
    cut.options.forEach((o, t) => console.log(`    take ${t}: clean=${o.clean} preview=${o.preview}`));
  });

  const first = storyboard[0]?.options[0];
  if (first) {
    console.log("animating cut 0 / take 0 (5s)…");
    // The film always animates the CLEAN take, never the watermarked preview.
    const clip = await generateShotClipForTest(first.clean, order.world ?? "deepspace", 0, order.id, 5);
    console.log(`  clip: ${clip}`);
    console.log("\n=== CLIP ===");
    console.log(clip);
  }

  console.log("\n=== STORYBOARD ===");
  console.log(JSON.stringify(storyboard));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

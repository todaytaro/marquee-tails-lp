/**
 * Cheap consistency test: generate the hero sheet + 6 chained stills for a
 * fresh order (from an existing customer order's assets), then animate ONLY
 * shot 0 into a 5s clip. Prints the 6 still URLs (compare faces side by side)
 * and the clip URL. ~$1.6 — no full 60s film.
 *
 * Usage: npx tsx scripts/test-stills.ts <sourceApproveToken> [personality]
 */
import "dotenv/config";
import { OrderStatus } from "../generated/prisma/client";
import { prisma } from "../lib/db";
import { prepareStills, generateShotClipForTest } from "../lib/film-pipeline";

async function main() {
  const [token, personality = "brave"] = process.argv.slice(2);
  const src = await prisma.order.findUniqueOrThrow({ where: { approveToken: token } });

  const order = await prisma.order.create({
    data: {
      shopifyOrderId: "stills-test-" + Math.floor(Math.random() * 1e6),
      customerEmail: src.customerEmail,
      status: OrderStatus.VIDEO_GENERATING,
      petName: src.petName,
      world: src.world,
      personality,
      uploadedPhotoUrls: src.uploadedPhotoUrls,
      petDescription: src.petDescription,
      identityPortraitUrl: src.identityPortraitUrl,
      conceptImageUrls: src.conceptImageUrls,
      selectedImageUrl: src.selectedImageUrl,
    },
  });
  console.log(`stills-test ${order.id} | ${order.petName} | ${order.world}/${personality}`);

  const t0 = Date.now();
  const { shotStillUrls, character } = await prepareStills(order);
  console.log(`stills done in ${Math.round((Date.now() - t0) / 1000)}s`);
  shotStillUrls.forEach((u, i) => console.log(`  still${i}: ${u}`));

  console.log("animating shot 0 (5s)…");
  const clip = await generateShotClipForTest(shotStillUrls[0], order.world ?? "deepspace", 0, character, 5);
  console.log(`  clip0: ${clip}`);

  console.log("\n=== STILLS ===");
  console.log(JSON.stringify(shotStillUrls));
  console.log("=== CLIP ===");
  console.log(clip);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

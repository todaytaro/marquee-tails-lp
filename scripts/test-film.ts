/**
 * Dev utility: run the full film pipeline for a fresh order seeded from an
 * existing order's identity assets. Tests stills -> video -> score -> ffmpeg.
 *
 * Usage: npx tsx scripts/test-film.ts <sourceApproveToken> <personality>
 */
import "dotenv/config";
import { OrderStatus } from "../generated/prisma/client";
import { prisma } from "../lib/db";
import { runFilmGeneration } from "../lib/film-pipeline";

async function main() {
  const [token, personality = "brave"] = process.argv.slice(2);
  const src = await prisma.order.findUniqueOrThrow({ where: { approveToken: token } });

  // The film pipeline now animates the 6 stills the customer chose. Reuse the
  // source order's chosenStills if it has them; otherwise fall back to its
  // conceptImageUrls / selected still, padded to 6 so the test always has a
  // full storyboard to animate.
  const pool = (src.chosenStills.length ? src.chosenStills : src.conceptImageUrls).filter(Boolean);
  const seed = pool.length ? pool : (src.selectedImageUrl ? [src.selectedImageUrl] : []);
  if (!seed.length) throw new Error("source order has no stills to animate");
  const chosenStills = Array.from({ length: 6 }, (_, i) => seed[i % seed.length]);

  // Resume the most recent unfinished film-test for these assets if one exists
  // (it carries cached artifacts) — otherwise start a fresh test order.
  let order = await prisma.order.findFirst({
    where: {
      stripeSessionId: { startsWith: "film-test-" },
      status: OrderStatus.VIDEO_GENERATING,
      selectedImageUrl: src.selectedImageUrl,
    },
    orderBy: { createdAt: "desc" },
  });

  if (order) {
    console.log(`resuming existing film-test ${order.id} (cached artifacts reused)`);
  } else {
    order = await prisma.order.create({
      data: {
        stripeSessionId: "film-test-" + Math.floor(Math.random() * 1e6),
        customerEmail: src.customerEmail,
        status: OrderStatus.VIDEO_GENERATING,
        petName: src.petName,
        world: src.world,
        personality,
        uploadedPhotoUrls: src.uploadedPhotoUrls,
        petDescription: src.petDescription,
        identityPortraitUrl: src.identityPortraitUrl,
        conceptImageUrls: src.conceptImageUrls,
        chosenStills,
        selectedImageUrl: chosenStills[0],
      },
    });
  }

  console.log(`film-test order ${order.id} | ${order.petName} | ${order.world}/${personality}`);
  const t0 = Date.now();
  await runFilmGeneration(order);
  const done = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
  console.log(`=== DONE in ${Math.round((Date.now() - t0) / 1000)}s ===`);
  console.log("status:", done.status);
  console.log("master (16:9):", done.finalVideoUrl);
  console.log("social (9:16):", done.socialVideoUrl);
  console.log("admin: http://localhost:3100/admin/" + done.id);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

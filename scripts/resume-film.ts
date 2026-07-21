/**
 * Resume the film pipeline for an order that reverted to Gate 1 after an infra
 * failure (e.g. ffmpeg spawn error inside the Next server). Re-uses everything
 * cached in filmArtifacts (clips + music), so no Kling/music re-spend — only
 * the missing steps (clip scoring, ffmpeg assembly, upload) run.
 *
 * Usage: npx tsx scripts/resume-film.ts <orderId>
 * NOTE: may spend a little real fal (clip identity scoring ~$0.12). Owner OK only.
 */
import "dotenv/config";
import { OrderStatus } from "../generated/prisma/client";
import { prisma } from "../lib/db";
import { transitionOrder } from "../lib/orders";
import { runFilmGeneration } from "../lib/film-pipeline";

async function main() {
  const id = process.argv[2];
  if (!id) throw new Error("usage: resume-film.ts <orderId>");
  let order = await prisma.order.findUniqueOrThrow({ where: { id } });
  console.log(`resume-film ${id} | ${order.petName}/${order.world} | status:${order.status} | chosen:${order.chosenStills.length}`);

  if (order.status === OrderStatus.AWAITING_CUSTOMER_APPROVAL) {
    order = await transitionOrder(
      id,
      OrderStatus.AWAITING_CUSTOMER_APPROVAL,
      OrderStatus.VIDEO_GENERATING,
      "customer",
      {},
      "resume film after infra fix"
    );
    console.log("-> VIDEO_GENERATING");
  }

  const t0 = Date.now();
  await runFilmGeneration(order);
  const done = await prisma.order.findUniqueOrThrow({ where: { id } });
  console.log(`\n=== DONE in ${Math.round((Date.now() - t0) / 1000)}s ===`);
  console.log("status:", done.status);
  console.log("shotIdentityScores:", JSON.stringify(done.shotIdentityScores));
  console.log("master (16:9):", done.finalVideoUrl);
  console.log("social (9:16):", done.socialVideoUrl);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

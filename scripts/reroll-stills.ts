/**
 * Dev utility: re-run concept-still generation (v2 identity-lock) for an
 * existing order, reusing its uploaded photos.
 *
 * Usage: npx tsx scripts/reroll-stills.ts <approveToken>
 */
import "dotenv/config";
import { OrderStatus } from "../generated/prisma/client";
import { prisma } from "../lib/db";
import { runStillsGeneration } from "../lib/stills-pipeline";

async function main() {
  const token = process.argv[2];
  if (!token) throw new Error("usage: reroll-stills.ts <approveToken>");

  const order = await prisma.order.findUnique({ where: { approveToken: token } });
  if (!order) throw new Error("order not found");
  console.log(
    `order ${order.id} | world: ${order.world} | photos: ${order.uploadedPhotoUrls.length} | status: ${order.status}`
  );

  const reset = await prisma.order.update({
    where: { id: order.id },
    data: { status: OrderStatus.IMAGE_GENERATING },
  });

  await runStillsGeneration(reset);

  const done = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
  console.log("=== RESULT ===");
  console.log("description:", done.petDescription);
  console.log("portrait:", done.identityPortraitUrl);
  done.conceptImageUrls.forEach((u, i) => console.log(`take${i + 1}:`, u));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

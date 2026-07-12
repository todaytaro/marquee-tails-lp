/**
 * Seed 4 demo orders, one per interesting lifecycle state, and print their
 * customer + admin URLs.
 *
 * Usage:
 *   npx tsx scripts/seed-demo.ts
 *   # DATABASE_URL from .env (dotenv), BASE_URL optional (default :3000)
 *
 * Idempotent: upserts by shopifyOrderId, so re-running resets the demo
 * orders to their canonical states (approveToken is kept on update, so
 * printed customer links stay stable across runs).
 */
import "dotenv/config";
import { OrderStatus, PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

// Local LP assets stand in for generated stills; public sample video is a
// dev-only stand-in for the pipeline's finalVideoUrl.
const CONCEPTS = [
  "/assets/world-deepspace.png",
  "/assets/world-storybook.png",
  "/assets/world-noir.png",
];
const UPLOADS = ["/assets/poster.png"];
const SAMPLE_VIDEO =
  "https://storage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4";

type DemoOrder = {
  shopifyOrderId: string;
  customerEmail: string;
  status: OrderStatus;
  petName: string;
  world: string;
  uploadedPhotoUrls: string[];
  conceptImageUrls: string[];
  selectedImageUrl: string | null;
  finalVideoUrl: string | null;
  adminNote: string | null;
};

const DEMOS: DemoOrder[] = [
  {
    // (a) Gate 1: customer picks a concept still
    shopifyOrderId: "demo-gate1",
    customerEmail: "demo-gate1@example.com",
    status: OrderStatus.AWAITING_CUSTOMER_APPROVAL,
    petName: "Luna",
    world: "deepspace",
    uploadedPhotoUrls: UPLOADS,
    conceptImageUrls: CONCEPTS,
    selectedImageUrl: null,
    finalVideoUrl: null,
    adminNote: null,
  },
  {
    // (b) video pipeline running
    shopifyOrderId: "demo-filming",
    customerEmail: "demo-filming@example.com",
    status: OrderStatus.VIDEO_GENERATING,
    petName: "Mochi",
    world: "deepspace",
    uploadedPhotoUrls: UPLOADS,
    conceptImageUrls: CONCEPTS,
    selectedImageUrl: "/assets/world-deepspace.png",
    finalVideoUrl: null,
    adminNote: null,
  },
  {
    // (c) Gate 2: admin reviews the finished video
    shopifyOrderId: "demo-gate2",
    customerEmail: "demo-gate2@example.com",
    status: OrderStatus.AWAITING_ADMIN_APPROVAL,
    petName: "Pippin",
    world: "storybook",
    uploadedPhotoUrls: UPLOADS,
    conceptImageUrls: CONCEPTS,
    selectedImageUrl: "/assets/world-storybook.png",
    finalVideoUrl: SAMPLE_VIDEO,
    adminNote: null,
  },
  {
    // (d) delivered
    shopifyOrderId: "demo-done",
    customerEmail: "demo-done@example.com",
    status: OrderStatus.COMPLETED,
    petName: "Nero",
    world: "noir",
    uploadedPhotoUrls: UPLOADS,
    conceptImageUrls: CONCEPTS,
    selectedImageUrl: "/assets/world-noir.png",
    finalVideoUrl: SAMPLE_VIDEO,
    adminNote: "Approved for delivery — demo seed",
  },
];

async function main() {
  console.log(`Seeding ${DEMOS.length} demo orders (${BASE})\n`);

  for (const demo of DEMOS) {
    const { shopifyOrderId, ...fields } = demo;
    const order = await prisma.order.upsert({
      where: { shopifyOrderId },
      create: { shopifyOrderId, ...fields },
      update: fields, // reset to canonical state; approveToken untouched
    });

    console.log(`${shopifyOrderId}  [${order.status}]  ${order.petName} / ${order.world}`);
    console.log(`  customer: ${BASE}/approve/${encodeURIComponent(order.approveToken)}`);
    console.log(`  admin:    ${BASE}/admin/${order.id}\n`);
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});

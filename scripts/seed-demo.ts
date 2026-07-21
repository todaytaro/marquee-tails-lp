/**
 * Seed 4 demo orders, one per interesting lifecycle state, and print their
 * customer + admin URLs.
 *
 * Usage:
 *   npx tsx scripts/seed-demo.ts
 *   # DATABASE_URL from .env (dotenv), BASE_URL optional (default :3000)
 *
 * Idempotent: upserts by stripeSessionId, so re-running resets the demo
 * orders to their canonical states (approveToken is kept on update, so
 * printed customer links stay stable across runs).
 */
import "dotenv/config";
import { OrderStatus, PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { getArc } from "../lib/film-script";

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

/** A mock 6-cut × 3-take storyboard, scenes from the real arc, takes from the
 *  local world assets (rotated so each cut looks distinct in the wizard). */
function mockStoryboard(world: string, personality: string) {
  return getArc(world, personality)
    .slice(0, 6)
    .map((scene, cut) => ({
      scene,
      options: Array.from({ length: 3 }, (_, take) => CONCEPTS[(cut + take) % CONCEPTS.length]),
    }));
}

type DemoOrder = {
  stripeSessionId: string;
  customerEmail: string;
  status: OrderStatus;
  petName: string;
  world: string;
  personality: string;
  uploadedPhotoUrls: string[];
  storyboardOptions?: { scene: string; options: string[] }[];
  chosenStills?: string[];
  shotClipUrls?: string[];
  shotIdentityScores?: number[];
  posterCutIndex?: number;
  posterOptions?: string[];
  posterUrl?: string | null;
  conceptImageUrls: string[];
  selectedImageUrl: string | null;
  finalVideoUrl: string | null;
  adminNote: string | null;
};

const DEMOS: DemoOrder[] = [
  {
    // (a) Gate 1: customer approves the storyboard (6 cuts × 3 takes)
    stripeSessionId: "demo-gate1",
    customerEmail: "demo-gate1@example.com",
    status: OrderStatus.AWAITING_CUSTOMER_APPROVAL,
    petName: "Luna",
    world: "deepspace",
    personality: "brave",
    uploadedPhotoUrls: UPLOADS,
    storyboardOptions: mockStoryboard("deepspace", "brave"),
    conceptImageUrls: CONCEPTS,
    selectedImageUrl: null,
    finalVideoUrl: null,
    adminNote: null,
  },
  {
    // (b) video pipeline running — storyboard already chosen (6 cuts)
    stripeSessionId: "demo-filming",
    customerEmail: "demo-filming@example.com",
    status: OrderStatus.VIDEO_GENERATING,
    petName: "Mochi",
    world: "deepspace",
    personality: "playful",
    uploadedPhotoUrls: UPLOADS,
    chosenStills: Array(6).fill("/assets/world-deepspace.png"),
    posterCutIndex: 0,
    posterOptions: CONCEPTS,
    posterUrl: null,
    conceptImageUrls: CONCEPTS,
    selectedImageUrl: "/assets/world-deepspace.png",
    finalVideoUrl: null,
    adminNote: null,
  },
  {
    // (c) Gate 2: admin reviews the finished video. One shot (#3) drifted —
    // its clip identity score is red, so the admin drift panel flags it.
    stripeSessionId: "demo-gate2",
    customerEmail: "demo-gate2@example.com",
    status: OrderStatus.AWAITING_ADMIN_APPROVAL,
    petName: "Pippin",
    world: "storybook",
    personality: "brave",
    uploadedPhotoUrls: UPLOADS,
    chosenStills: [0, 1, 2, 0, 1, 2].map((i) => CONCEPTS[i]),
    shotClipUrls: Array(6).fill(SAMPLE_VIDEO),
    shotIdentityScores: [92, 88, 71, 95, 90, 84],
    conceptImageUrls: CONCEPTS,
    selectedImageUrl: "/assets/world-storybook.png",
    finalVideoUrl: SAMPLE_VIDEO,
    adminNote: null,
  },
  {
    // (d) delivered
    stripeSessionId: "demo-done",
    customerEmail: "demo-done@example.com",
    status: OrderStatus.COMPLETED,
    petName: "Nero",
    world: "noir",
    personality: "easygoing",
    uploadedPhotoUrls: UPLOADS,
    chosenStills: Array(6).fill("/assets/world-noir.png"),
    conceptImageUrls: CONCEPTS,
    selectedImageUrl: "/assets/world-noir.png",
    finalVideoUrl: SAMPLE_VIDEO,
    adminNote: "Approved for delivery — demo seed",
  },
];

async function main() {
  console.log(`Seeding ${DEMOS.length} demo orders (${BASE})\n`);

  for (const demo of DEMOS) {
    const { stripeSessionId, ...fields } = demo;
    const order = await prisma.order.upsert({
      where: { stripeSessionId },
      create: { stripeSessionId, ...fields },
      update: fields, // reset to canonical state; approveToken untouched
    });

    console.log(`${stripeSessionId}  [${order.status}]  ${order.petName} / ${order.world}`);
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

/**
 * E2E test of the 2-Gate state machine against a running dev server + real DB.
 *
 * Usage:
 *   DATABASE_URL=... ADMIN_API_SECRET=... BASE_URL=http://localhost:3100 \
 *     npx tsx scripts/e2e-state-machine.ts
 *
 * Walks one order through the full lifecycle and asserts every guard:
 * bad token, foreign image URL, double-click, gate skipping, bad admin auth,
 * double-completion, and the audit trail.
 */
import { OrderStatus, PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const SECRET = process.env.ADMIN_API_SECRET ?? "dev-secret";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}`, detail ?? "");
  }
}

async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

async function main() {
  // --- seed: an order sitting at Gate 1 ---
  await prisma.statusEvent.deleteMany({});
  await prisma.order.deleteMany({ where: { shopifyOrderId: "e2e-test-1" } });
  const order = await prisma.order.create({
    data: {
      shopifyOrderId: "e2e-test-1",
      customerEmail: "e2e@example.com",
      status: OrderStatus.AWAITING_CUSTOMER_APPROVAL,
      petName: "Luna",
      world: "deepspace",
      conceptImageUrls: ["https://cdn.example/a.png", "https://cdn.example/b.png"],
    },
  });
  console.log(`Seeded order ${order.id} at AWAITING_CUSTOMER_APPROVAL`);

  // --- Gate 1 guards ---
  console.log("\nGate 1 (customer approval):");
  let r = await post("/api/orders/approve-image", {
    orderId: order.id,
    approveToken: "wrong-token",
    selectedImageUrl: "https://cdn.example/a.png",
  });
  check("wrong token -> 404", r.status === 404, r);

  r = await post("/api/orders/approve-image", {
    orderId: order.id,
    approveToken: order.approveToken,
    selectedImageUrl: "https://evil.example/injected.png",
  });
  check("foreign image URL -> 400", r.status === 400, r);

  r = await post("/api/orders/approve-image", {
    orderId: order.id,
    approveToken: order.approveToken,
    selectedImageUrl: "https://cdn.example/b.png",
  });
  check(
    "valid approval -> 200 VIDEO_GENERATING",
    r.status === 200 && r.json.status === "VIDEO_GENERATING",
    r
  );

  r = await post("/api/orders/approve-image", {
    orderId: order.id,
    approveToken: order.approveToken,
    selectedImageUrl: "https://cdn.example/b.png",
  });
  check("double-click -> 409 (pipeline cannot fire twice)", r.status === 409, r);

  // --- Gate 2 guards ---
  console.log("\nGate 2 (admin approval):");
  r = await post("/api/admin/approve-video", { orderId: order.id });
  check("missing admin secret -> 401", r.status === 401, r);

  r = await post(
    "/api/admin/approve-video",
    { orderId: order.id },
    { "x-admin-secret": SECRET }
  );
  check(
    "approve while still VIDEO_GENERATING -> 409 (gate skip blocked)",
    r.status === 409,
    r
  );

  // simulate the video pipeline callback (system actor)
  const { transitionOrder } = await import("../lib/orders");
  process.env.DATABASE_URL = process.env.DATABASE_URL; // (same DB for lib import)
  await transitionOrder(
    order.id,
    OrderStatus.VIDEO_GENERATING,
    OrderStatus.AWAITING_ADMIN_APPROVAL,
    "system",
    { finalVideoUrl: "https://cdn.example/final.mp4" },
    "mock pipeline finished"
  );
  console.log("  (system) pipeline callback -> AWAITING_ADMIN_APPROVAL");

  r = await post(
    "/api/admin/approve-video",
    { orderId: order.id, adminNote: "looks great" },
    { "x-admin-secret": SECRET }
  );
  check(
    "valid admin approval -> 200 COMPLETED",
    r.status === 200 && r.json.status === "COMPLETED",
    r
  );

  r = await post(
    "/api/admin/approve-video",
    { orderId: order.id },
    { "x-admin-secret": SECRET }
  );
  check("second approval -> 409 (email/POD cannot fire twice)", r.status === 409, r);

  // --- audit trail ---
  console.log("\nAudit log:");
  const events = await prisma.statusEvent.findMany({
    where: { orderId: order.id },
    orderBy: { createdAt: "asc" },
  });
  check(
    "3 transitions recorded with actors",
    events.length === 3 &&
      events[0].actor === "customer" &&
      events[1].actor === "system" &&
      events[2].actor === "admin",
    events.map((e) => `${e.actor}: ${e.from} -> ${e.to}`)
  );
  const final = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
  check(
    "final row: selectedImageUrl + finalVideoUrl + COMPLETED",
    final.status === "COMPLETED" &&
      final.selectedImageUrl === "https://cdn.example/b.png" &&
      final.finalVideoUrl === "https://cdn.example/final.mp4",
    final
  );

  console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
  await prisma.$disconnect();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

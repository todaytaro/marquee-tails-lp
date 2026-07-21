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
import { transitionOrder, TransitionError } from "../lib/orders";

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
  // --- seed: an order sitting at Gate 1 with a 6-cut × 3-take storyboard ---
  await prisma.statusEvent.deleteMany({});
  await prisma.order.deleteMany({ where: { stripeSessionId: "e2e-test-1" } });
  const STORYBOARD = Array.from({ length: 6 }, (_, c) => ({
    scene: `scene ${c + 1}`,
    options: [
      `https://cdn.example/c${c}-0.png`,
      `https://cdn.example/c${c}-1.png`,
      `https://cdn.example/c${c}-2.png`,
    ],
  }));
  // One valid pick per cut (the customer's storyboard choices).
  const validPicks = STORYBOARD.map((cut) => cut.options[0]);
  const order = await prisma.order.create({
    data: {
      stripeSessionId: "e2e-test-1",
      customerEmail: "e2e@example.com",
      status: OrderStatus.AWAITING_CUSTOMER_APPROVAL,
      petName: "Luna",
      world: "deepspace",
      personality: "brave",
      storyboardOptions: STORYBOARD,
      conceptImageUrls: STORYBOARD.flatMap((c) => c.options),
    },
  });
  console.log(`Seeded order ${order.id} at AWAITING_CUSTOMER_APPROVAL`);

  // --- Gate 1 guards ---
  console.log("\nGate 1 (customer approval):");
  let r = await post("/api/orders/approve-storyboard", {
    orderId: order.id,
    approveToken: "wrong-token",
    chosenStills: validPicks,
  });
  check("wrong token -> 404", r.status === 404, r);

  r = await post("/api/orders/approve-storyboard", {
    orderId: order.id,
    approveToken: order.approveToken,
    chosenStills: validPicks.slice(0, 3),
  });
  check("wrong number of picks -> 400", r.status === 400, r);

  r = await post("/api/orders/approve-storyboard", {
    orderId: order.id,
    approveToken: order.approveToken,
    // right length, but one pick is a foreign URL not in that cut's options.
    chosenStills: [...validPicks.slice(0, 5), "https://evil.example/injected.png"],
  });
  check("foreign image URL -> 400", r.status === 400, r);

  r = await post("/api/orders/approve-storyboard", {
    orderId: order.id,
    approveToken: order.approveToken,
    chosenStills: validPicks,
    posterCutIndex: 99,
  });
  check("out-of-range posterCutIndex -> 400", r.status === 400, r);

  r = await post("/api/orders/approve-storyboard", {
    orderId: order.id,
    approveToken: order.approveToken,
    chosenStills: validPicks,
    posterCutIndex: 2,
  });
  check(
    "valid approval -> 200 VIDEO_GENERATING",
    r.status === 200 && r.json.status === "VIDEO_GENERATING",
    r
  );

  // --- poster pick (the second human pick; mock kick seeded posterOptions) ---
  console.log("\nPoster pick:");
  const withPoster = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
  check("mock kick seeded 3 poster options", withPoster.posterOptions.length === 3, withPoster.posterOptions);

  r = await post("/api/orders/choose-poster", {
    orderId: order.id,
    approveToken: "wrong-token",
    posterUrl: withPoster.posterOptions[0],
  });
  check("poster: wrong token -> 404", r.status === 404, r);

  r = await post("/api/orders/choose-poster", {
    orderId: order.id,
    approveToken: order.approveToken,
    posterUrl: "https://evil.example/poster.png",
  });
  check("poster: foreign URL -> 400", r.status === 400, r);

  r = await post("/api/orders/choose-poster", {
    orderId: order.id,
    approveToken: order.approveToken,
    posterUrl: withPoster.posterOptions[1],
  });
  check("poster: valid pick -> 200", r.status === 200, r);

  r = await post("/api/orders/approve-storyboard", {
    orderId: order.id,
    approveToken: order.approveToken,
    chosenStills: validPicks,
  });
  check("double-submit -> 409 (pipeline cannot fire twice)", r.status === 409, r);

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
    "final row: chosenStills(6) + selectedImageUrl(cut1) + poster + finalVideoUrl + COMPLETED",
    final.status === "COMPLETED" &&
      final.chosenStills.length === 6 &&
      final.selectedImageUrl === validPicks[0] &&
      final.posterCutIndex === 2 &&
      final.posterUrl === final.posterOptions[1] &&
      final.finalVideoUrl === "https://cdn.example/final.mp4",
    final
  );

  // Locked after delivery: COMPLETED rejects further poster changes.
  r = await post("/api/orders/choose-poster", {
    orderId: order.id,
    approveToken: order.approveToken,
    posterUrl: final.posterOptions[0],
  });
  check("poster: change after COMPLETED -> 409", r.status === 409, r);

  // --- FAILED state machine (FAILED-STATE-SPEC.md) ---
  // MOCK never fails generation naturally, so drive transitionOrder directly
  // on a dedicated order to prove the two new edges: the admin-retry path
  // back into production, and that FAILED can't skip straight to delivery.
  console.log("\nFAILED state (admin retry):");
  await prisma.order.deleteMany({ where: { stripeSessionId: "e2e-test-failed" } });
  const failedOrder = await prisma.order.create({
    data: {
      stripeSessionId: "e2e-test-failed",
      customerEmail: "e2e-failed@example.com",
      status: OrderStatus.VIDEO_GENERATING,
      petName: "Nova",
      world: "deepspace",
    },
  });

  const toFailed = await transitionOrder(
    failedOrder.id,
    OrderStatus.VIDEO_GENERATING,
    OrderStatus.FAILED,
    "system",
    { failureReason: "kling: request timed out" },
    "film generation failed after retries"
  );
  check(
    "VIDEO_GENERATING -> FAILED (with failureReason)",
    toFailed.status === OrderStatus.FAILED && toFailed.failureReason === "kling: request timed out",
    toFailed
  );

  let illegalErr: unknown;
  try {
    await transitionOrder(
      failedOrder.id,
      OrderStatus.FAILED,
      OrderStatus.COMPLETED,
      "admin",
      {},
      "should be rejected"
    );
  } catch (e) {
    illegalErr = e;
  }
  check("FAILED -> COMPLETED is illegal -> TransitionError", illegalErr instanceof TransitionError, illegalErr);

  const retried = await transitionOrder(
    failedOrder.id,
    OrderStatus.FAILED,
    OrderStatus.VIDEO_GENERATING,
    "admin",
    { failureReason: null },
    "admin retry"
  );
  check(
    "FAILED -> VIDEO_GENERATING (admin retry, failureReason cleared)",
    retried.status === OrderStatus.VIDEO_GENERATING && retried.failureReason === null,
    retried
  );

  let staleErr: unknown;
  try {
    // failedOrder is now VIDEO_GENERATING, not FAILED — repeating the retry
    // (double-click) must hit the status guard and throw, not double-fire.
    await transitionOrder(
      failedOrder.id,
      OrderStatus.FAILED,
      OrderStatus.VIDEO_GENERATING,
      "admin",
      { failureReason: null },
      "admin retry (stale double-click)"
    );
  } catch (e) {
    staleErr = e;
  }
  check("double-click retry on stale status -> TransitionError", staleErr instanceof TransitionError, staleErr);

  console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
  await prisma.$disconnect();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

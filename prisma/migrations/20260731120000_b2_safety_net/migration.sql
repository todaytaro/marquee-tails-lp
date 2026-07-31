-- B2 — Director's Cut safety net (B2-SAFETY-NET-SPEC.md §2).
--
-- NOT APPLIED BY THIS CHANGE. The owner runs this by hand — local .env
-- DATABASE_URL points at PRODUCTION Supabase, so this repo never runs
-- `prisma migrate` / `db push` against it. This file only records the SQL
-- that prisma/schema.prisma's Order model now expects.
--
-- No OrderStatus enum value is added: a refund is an attribute of an order,
-- not a new stage. The terminal state after a refund is the existing
-- CANCELLED value (see lib/orders.ts's new AWAITING_CUSTOMER_APPROVAL ->
-- CANCELLED edge) — nothing to alter on the enum itself.

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "storyboardRerollCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "refundRequestedAt" TIMESTAMP(3),
ADD COLUMN     "refundIssuedAt" TIMESTAMP(3);

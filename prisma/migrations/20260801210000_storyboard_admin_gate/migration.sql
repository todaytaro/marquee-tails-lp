-- Admin storyboard gate — STORYBOARD-ADMIN-GATE-SPEC.md §4.
--
-- NOT APPLIED BY THIS CHANGE. The owner runs this by hand — local .env
-- DATABASE_URL points at PRODUCTION Supabase, so this repo never runs
-- `prisma migrate` / `db push` against it. This file only records the SQL
-- that prisma/schema.prisma's Order model now expects.
--
-- No OrderStatus enum value is added and no existing column changes meaning:
-- the review queue is `status = 'IMAGE_GENERATING' AND "storyboardOptions" IS
-- NOT NULL` (§2), which needs no schema change at all. This single column is
-- purely for seed-band separation (§3.3(b)): an admin re-roll must never be
-- able to draw the same seed as a customer re-roll (storyboardRerollCount),
-- so it gets its own counter rather than sharing that column. Existing rows
-- default to 0, which is correct (no admin has re-rolled any pre-existing
-- order under this feature).

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "adminRerollCount" INTEGER NOT NULL DEFAULT 0;

-- Delivery rating — DELIVERY-RATING-SPEC.md §1.
--
-- NOT APPLIED BY THIS CHANGE. The owner runs this by hand — local .env
-- DATABASE_URL points at PRODUCTION Supabase, so this repo never runs
-- `prisma migrate` / `db push` against it. This file only records the SQL
-- that prisma/schema.prisma's Order model now expects.
--
-- Three columns on Order, not a separate model: one order = one delivery =
-- one rating, so there is no multiplicity for a child table to capture
-- (§1). ratingStars is nullable — null means "not rated yet", never 0.
-- Existing rows default to NULL on all three columns, which is correct (no
-- order has been rated under this feature yet).

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "ratingStars" INTEGER,
ADD COLUMN     "ratingComment" TEXT,
ADD COLUMN     "ratedAt" TIMESTAMP(3);

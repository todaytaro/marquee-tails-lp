-- 無償枠（クリエイター向けシーディング）。
--
-- NOT APPLIED BY THIS CHANGE. The owner runs this by hand — local .env
-- DATABASE_URL points at PRODUCTION Supabase, so this repo never runs
-- `prisma migrate` / `db push` against it. This file only records the SQL
-- that prisma/schema.prisma's Order model now expects.
--
-- One nullable column, no boolean flag: NULL means a normal paid order, and
-- a non-NULL value is both the marker AND the record of who it went to.
-- A separate is_gift boolean could disagree with the name; one column cannot.
--
-- WHY THIS COLUMN HAS TO EXIST AT ALL: a gifted order never goes through
-- Stripe, so it has no `checkout.consent` EvidenceEvent. Without this marker,
-- an order with no consent row is ambiguous — a gift, or a PAID order whose
-- consent record was lost? CHARGEBACK-DEFENSE-SPEC.md is built on the premise
-- that missing evidence is meaningful, and that premise needs this to hold.

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "giftedTo" TEXT;

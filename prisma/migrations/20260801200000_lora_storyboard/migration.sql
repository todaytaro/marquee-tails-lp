-- LoRA storyboard (B1) — LORA-STORYBOARD-SPEC.md §2.1.
--
-- NOT APPLIED BY THIS CHANGE. The owner runs this by hand — local .env
-- DATABASE_URL points at PRODUCTION Supabase, so this repo never runs
-- `prisma migrate` / `db push` against it. This file only records the SQL
-- that prisma/schema.prisma's Order model now expects.
--
-- Both columns are nullable and default to NULL: a null loraUrl means this
-- order has no trained LoRA yet (or training failed), and every take falls
-- back to the pre-B1 nano-banana costume chain (lib/stills-pipeline.ts's
-- generateTakeOnce) — no backfill is required for existing rows.

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "loraUrl" TEXT,
ADD COLUMN     "loraTriggerWord" TEXT;

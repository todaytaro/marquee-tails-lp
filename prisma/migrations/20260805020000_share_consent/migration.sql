-- Social-sharing permission, per order.
--
-- NOT APPLIED BY THIS CHANGE. The owner runs this by hand — local .env
-- DATABASE_URL points at PRODUCTION Supabase, so this repo never runs
-- `prisma migrate` / `db push` against it. This file only records the SQL
-- that prisma/schema.prisma's Order model now expects.
--
-- Two columns, not one: permission to show the finished FILM is a different
-- ask from permission to publish the customer's own submitted PHOTOS (see
-- lib/share-consent.ts). Both default to FALSE, which is the only safe
-- default — /terms §4 says we do not use uploaded photos for any purpose
-- beyond producing the order "without your consent", so absence of a recorded
-- yes must read as no. Existing rows therefore correctly become "no consent",
-- including every order delivered before this feature existed.

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "shareFilmConsent" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sharePhotosConsent" BOOLEAN NOT NULL DEFAULT false;

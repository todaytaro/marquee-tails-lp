-- Rename shopifyOrderId -> stripeSessionId (Shopify was never adopted; this
-- field always held an external-order identifier, now Stripe Checkout
-- Session IDs). Renaming preserves existing rows and their unique index,
-- unlike a drop+add which Prisma's auto-diff would otherwise propose.
ALTER TABLE "Order" RENAME COLUMN "shopifyOrderId" TO "stripeSessionId";
ALTER INDEX "Order_shopifyOrderId_key" RENAME TO "Order_stripeSessionId_key";

-- New fields, populated by the Stripe webhook at checkout completion.
ALTER TABLE "Order" ADD COLUMN "tier" TEXT;
ALTER TABLE "Order" ADD COLUMN "amountPaidCents" INTEGER;

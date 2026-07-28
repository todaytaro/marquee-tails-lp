-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "addonType" TEXT,
ADD COLUMN     "addonStripeSessionId" TEXT,
ADD COLUMN     "addonPaidCents" INTEGER,
ADD COLUMN     "addonPurchasedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "Order_addonStripeSessionId_key" ON "Order"("addonStripeSessionId");

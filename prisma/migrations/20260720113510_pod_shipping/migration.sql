-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "podOrderId" TEXT,
ADD COLUMN     "podStatus" TEXT,
ADD COLUMN     "shippingCity" TEXT,
ADD COLUMN     "shippingCountry" TEXT,
ADD COLUMN     "shippingLine1" TEXT,
ADD COLUMN     "shippingLine2" TEXT,
ADD COLUMN     "shippingName" TEXT,
ADD COLUMN     "shippingPostalCode" TEXT,
ADD COLUMN     "shippingRegion" TEXT;

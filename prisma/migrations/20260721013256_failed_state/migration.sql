-- AlterEnum
ALTER TYPE "OrderStatus" ADD VALUE 'FAILED';

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "failureReason" TEXT;

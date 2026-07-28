-- AlterEnum
ALTER TYPE "OrderStatus" ADD VALUE 'TREATMENT_GENERATING';
ALTER TYPE "OrderStatus" ADD VALUE 'AWAITING_TREATMENT_APPROVAL';

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "customBrief" TEXT,
ADD COLUMN     "generatedScript" JSONB,
ADD COLUMN     "treatmentText" TEXT,
ADD COLUMN     "treatmentRevisionCount" INTEGER NOT NULL DEFAULT 0;

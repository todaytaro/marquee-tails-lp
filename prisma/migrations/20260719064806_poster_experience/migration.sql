-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "posterCutIndex" INTEGER,
ADD COLUMN     "posterOptions" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "posterUrl" TEXT;

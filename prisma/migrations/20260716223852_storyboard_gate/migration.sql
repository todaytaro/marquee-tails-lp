-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "chosenStills" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "storyboardOptions" JSONB;

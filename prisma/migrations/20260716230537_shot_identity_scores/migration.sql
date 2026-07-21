-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "shotClipUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "shotIdentityScores" INTEGER[] DEFAULT ARRAY[]::INTEGER[];

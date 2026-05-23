-- AlterTable
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "featuredUntil" TIMESTAMP(3);
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "promotionTier" TEXT;

-- Add promotion columns to Property (if not already present)
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "featuredUntil" TIMESTAMP(3);
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "promotionTier" TEXT;

-- Add referral/agency columns to User (if not already present)
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "referralCode" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "referredById" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "agencyId" TEXT;

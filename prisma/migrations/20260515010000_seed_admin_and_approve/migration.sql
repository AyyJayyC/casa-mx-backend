-- Ensure promotion columns exist (safety net if previous migration had placeholder)
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "featuredUntil" TIMESTAMP(3);
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "promotionTier" TEXT;

-- Ensure referral fields exist on User
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "referralCode" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "referredById" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "agencyId" TEXT;

-- Approve seller role
UPDATE "UserRole" SET "status" = 'approved' WHERE "userId" = 'afdc2898-25d5-42cd-a551-c28551c8bf7f';

-- Ensure admin role exists and assign to the user
INSERT INTO "UserRole" ("id", "userId", "roleId", "status", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'afdc2898-25d5-42cd-a551-c28551c8bf7f', r.id, 'approved', NOW(), NOW()
FROM "Role" r
WHERE r.name = 'admin'
AND NOT EXISTS (
  SELECT 1 FROM "UserRole" ur WHERE ur."userId" = 'afdc2898-25d5-42cd-a551-c28551c8bf7f' AND ur."roleId" = r.id
);

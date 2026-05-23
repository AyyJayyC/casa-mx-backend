-- CreateTable
CREATE TABLE IF NOT EXISTS "Agency" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "rfc" TEXT,
    "ownerId" TEXT NOT NULL,
    "referredById" TEXT,
    "referralCode" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'inactive',
    "agentLimit" INTEGER NOT NULL DEFAULT 0,
    "billingActive" BOOLEAN NOT NULL DEFAULT false,
    "subscriptionEnds" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Agency_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Agency_ownerId_key" ON "Agency"("ownerId");
CREATE UNIQUE INDEX IF NOT EXISTS "Agency_referralCode_key" ON "Agency"("referralCode");
CREATE INDEX IF NOT EXISTS "Agency_ownerId_idx" ON "Agency"("ownerId");
CREATE INDEX IF NOT EXISTS "Agency_referredById_idx" ON "Agency"("referredById");
CREATE INDEX IF NOT EXISTS "Agency_referralCode_idx" ON "Agency"("referralCode");
CREATE INDEX IF NOT EXISTS "Agency_plan_idx" ON "Agency"("plan");

-- CreateTable
CREATE TABLE IF NOT EXISTS "ReferralEvent" (
    "id" TEXT NOT NULL,
    "referrerId" TEXT,
    "referralCode" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "propertyId" TEXT,
    "linkedUserId" TEXT,
    "visitorIp" TEXT,
    "userAgent" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferralEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ReferralEvent_referralCode_idx" ON "ReferralEvent"("referralCode");
CREATE INDEX IF NOT EXISTS "ReferralEvent_referrerId_idx" ON "ReferralEvent"("referrerId");
CREATE INDEX IF NOT EXISTS "ReferralEvent_eventType_idx" ON "ReferralEvent"("eventType");
CREATE INDEX IF NOT EXISTS "ReferralEvent_createdAt_idx" ON "ReferralEvent"("createdAt");

-- AddForeignKey
ALTER TABLE "Agency" DROP CONSTRAINT IF EXISTS "Agency_ownerId_fkey";
ALTER TABLE "Agency" ADD CONSTRAINT "Agency_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Agency" DROP CONSTRAINT IF EXISTS "Agency_referredById_fkey";
ALTER TABLE "Agency" ADD CONSTRAINT "Agency_referredById_fkey" FOREIGN KEY ("referredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable (add columns to User)
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "referralCode" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "referredById" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "agencyId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "User_referralCode_key" ON "User"("referralCode");
CREATE INDEX IF NOT EXISTS "User_referredById_idx" ON "User"("referredById");
CREATE INDEX IF NOT EXISTS "User_agencyId_idx" ON "User"("agencyId");

-- AddForeignKey
ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "User_agencyId_fkey";
ALTER TABLE "User" ADD CONSTRAINT "User_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "User_referredById_fkey";
ALTER TABLE "User" ADD CONSTRAINT "User_referredById_fkey" FOREIGN KEY ("referredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

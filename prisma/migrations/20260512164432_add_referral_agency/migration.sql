-- AlterTable
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "agencyId" TEXT,
ADD COLUMN IF NOT EXISTS "referralCode" TEXT,
ADD COLUMN IF NOT EXISTS "referredById" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "Agency" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "rfc" TEXT,
    "ownerId" TEXT NOT NULL,
    "referredById" TEXT,
    "referralCode" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Agency_pkey" PRIMARY KEY ("id")
);

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
CREATE UNIQUE INDEX IF NOT EXISTS "Agency_ownerId_key" ON "Agency"("ownerId");
CREATE UNIQUE INDEX IF NOT EXISTS "Agency_referralCode_key" ON "Agency"("referralCode");
CREATE INDEX IF NOT EXISTS "Agency_ownerId_idx" ON "Agency"("ownerId");
CREATE INDEX IF NOT EXISTS "Agency_referredById_idx" ON "Agency"("referredById");
CREATE INDEX IF NOT EXISTS "Agency_referralCode_idx" ON "Agency"("referralCode");
CREATE INDEX IF NOT EXISTS "ReferralEvent_referralCode_idx" ON "ReferralEvent"("referralCode");
CREATE INDEX IF NOT EXISTS "ReferralEvent_referrerId_idx" ON "ReferralEvent"("referrerId");
CREATE INDEX IF NOT EXISTS "ReferralEvent_eventType_idx" ON "ReferralEvent"("eventType");
CREATE INDEX IF NOT EXISTS "ReferralEvent_createdAt_idx" ON "ReferralEvent"("createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "User_referralCode_key" ON "User"("referralCode");
CREATE INDEX IF NOT EXISTS "User_referralCode_idx" ON "User"("referralCode");
CREATE INDEX IF NOT EXISTS "User_referredById_idx" ON "User"("referredById");
CREATE INDEX IF NOT EXISTS "User_agencyId_idx" ON "User"("agencyId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_referredById_fkey" FOREIGN KEY ("referredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "User" ADD CONSTRAINT "User_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Agency" ADD CONSTRAINT "Agency_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Agency" ADD CONSTRAINT "Agency_referredById_fkey" FOREIGN KEY ("referredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: Update User model (nullable password, add phone, creditBalance, profileComplete)
ALTER TABLE "User" ALTER COLUMN "password" DROP NOT NULL;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "phone" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "creditBalance" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "profileComplete" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: Update RentalApplication model (negotiation fields + whatsapp)
ALTER TABLE "RentalApplication" ADD COLUMN IF NOT EXISTS "proposedRent" DOUBLE PRECISION;
ALTER TABLE "RentalApplication" ADD COLUMN IF NOT EXISTS "proposedDeposit" DOUBLE PRECISION;
ALTER TABLE "RentalApplication" ADD COLUMN IF NOT EXISTS "proposedServices" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "RentalApplication" ADD COLUMN IF NOT EXISTS "whatsappUnlocked" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable: CreditPackage
CREATE TABLE IF NOT EXISTS "CreditPackage" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "credits" INTEGER NOT NULL,
    "priceUsd" DOUBLE PRECISION NOT NULL,
    "stripePriceId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditPackage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CreditPackage_active_idx" ON "CreditPackage"("active");

-- CreateTable: CreditTransaction
CREATE TABLE IF NOT EXISTS "CreditTransaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "referenceId" TEXT,
    "referenceType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CreditTransaction_userId_idx" ON "CreditTransaction"("userId");
CREATE INDEX IF NOT EXISTS "CreditTransaction_type_idx" ON "CreditTransaction"("type");
CREATE INDEX IF NOT EXISTS "CreditTransaction_createdAt_idx" ON "CreditTransaction"("createdAt");

-- AddForeignKey
ALTER TABLE "CreditTransaction" ADD CONSTRAINT "CreditTransaction_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: UserDocument
CREATE TABLE IF NOT EXISTS "UserDocument" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "storedFileName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSizeBytes" INTEGER NOT NULL,
    "encryptionIv" TEXT NOT NULL,
    "verificationStatus" TEXT NOT NULL DEFAULT 'pending',
    "verificationNote" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "verifiedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "UserDocument_userId_idx" ON "UserDocument"("userId");
CREATE INDEX IF NOT EXISTS "UserDocument_documentType_idx" ON "UserDocument"("documentType");
CREATE INDEX IF NOT EXISTS "UserDocument_verificationStatus_idx" ON "UserDocument"("verificationStatus");

-- AddForeignKey
ALTER TABLE "UserDocument" ADD CONSTRAINT "UserDocument_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: NegotiationOffer
CREATE TABLE IF NOT EXISTS "NegotiationOffer" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "offerByUserId" TEXT NOT NULL,
    "offerByRole" TEXT NOT NULL,
    "proposedRent" DOUBLE PRECISION NOT NULL,
    "proposedDeposit" DOUBLE PRECISION NOT NULL,
    "proposedServices" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "proposedLeaseTerm" INTEGER,
    "message" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NegotiationOffer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "NegotiationOffer_applicationId_idx" ON "NegotiationOffer"("applicationId");
CREATE INDEX IF NOT EXISTS "NegotiationOffer_offerByUserId_idx" ON "NegotiationOffer"("offerByUserId");
CREATE INDEX IF NOT EXISTS "NegotiationOffer_status_idx" ON "NegotiationOffer"("status");
CREATE INDEX IF NOT EXISTS "NegotiationOffer_createdAt_idx" ON "NegotiationOffer"("createdAt");

-- AddForeignKey
ALTER TABLE "NegotiationOffer" ADD CONSTRAINT "NegotiationOffer_applicationId_fkey"
    FOREIGN KEY ("applicationId") REFERENCES "RentalApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: SocialAccount
CREATE TABLE IF NOT EXISTS "SocialAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "email" TEXT,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "tokenExpiry" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "SocialAccount_provider_providerAccountId_key"
    ON "SocialAccount"("provider", "providerAccountId");
CREATE INDEX IF NOT EXISTS "SocialAccount_userId_idx" ON "SocialAccount"("userId");
CREATE INDEX IF NOT EXISTS "SocialAccount_provider_idx" ON "SocialAccount"("provider");

-- AddForeignKey
ALTER TABLE "SocialAccount" ADD CONSTRAINT "SocialAccount_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

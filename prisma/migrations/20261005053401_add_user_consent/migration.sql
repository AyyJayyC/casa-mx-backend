-- AlterTable
ALTER TABLE "User" ADD COLUMN     "consentVersion" TEXT,
ADD COLUMN     "privacyAcceptedAt" TIMESTAMP(3),
ADD COLUMN     "termsAcceptedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "issuesInvoice" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "petFriendly" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "petFee" DOUBLE PRECISION;
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "petDeposit" DOUBLE PRECISION;
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "childrenWelcome" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Property_issuesInvoice_idx" ON "Property"("issuesInvoice");
CREATE INDEX IF NOT EXISTS "Property_petFriendly_idx" ON "Property"("petFriendly");
CREATE INDEX IF NOT EXISTS "Property_childrenWelcome_idx" ON "Property"("childrenWelcome");

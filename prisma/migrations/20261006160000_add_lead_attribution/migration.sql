-- Additive: lead attribution columns. All nullable → existing rows untouched.

-- AlterTable
ALTER TABLE "PropertyRequest" ADD COLUMN     "referringAgentId" TEXT,
ADD COLUMN     "attributionCode" TEXT,
ADD COLUMN     "attributedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "PropertyOffer" ADD COLUMN     "referringAgentId" TEXT,
ADD COLUMN     "attributionCode" TEXT,
ADD COLUMN     "attributedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "PropertyRequest_referringAgentId_idx" ON "PropertyRequest"("referringAgentId");

-- CreateIndex
CREATE INDEX "PropertyOffer_referringAgentId_idx" ON "PropertyOffer"("referringAgentId");

-- AddForeignKey
ALTER TABLE "PropertyRequest" ADD CONSTRAINT "PropertyRequest_referringAgentId_fkey" FOREIGN KEY ("referringAgentId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyOffer" ADD CONSTRAINT "PropertyOffer_referringAgentId_fkey" FOREIGN KEY ("referringAgentId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

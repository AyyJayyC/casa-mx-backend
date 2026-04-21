-- CreateTable
CREATE TABLE "Negotiation" (
    "id" TEXT NOT NULL,
    "rentalApplicationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "applicantId" TEXT NOT NULL,
    "landlordId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "originalRent" DOUBLE PRECISION NOT NULL,
    "finalRent" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Negotiation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NegotiationOffer" (
    "id" TEXT NOT NULL,
    "negotiationId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "authorRole" TEXT NOT NULL,
    "proposedRent" DOUBLE PRECISION NOT NULL,
    "message" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NegotiationOffer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Negotiation_rentalApplicationId_key" ON "Negotiation"("rentalApplicationId");

-- CreateIndex
CREATE INDEX "Negotiation_rentalApplicationId_idx" ON "Negotiation"("rentalApplicationId");

-- CreateIndex
CREATE INDEX "Negotiation_applicantId_idx" ON "Negotiation"("applicantId");

-- CreateIndex
CREATE INDEX "Negotiation_landlordId_idx" ON "Negotiation"("landlordId");

-- CreateIndex
CREATE INDEX "Negotiation_status_idx" ON "Negotiation"("status");

-- CreateIndex
CREATE INDEX "NegotiationOffer_negotiationId_idx" ON "NegotiationOffer"("negotiationId");

-- CreateIndex
CREATE INDEX "NegotiationOffer_authorId_idx" ON "NegotiationOffer"("authorId");

-- CreateIndex
CREATE INDEX "NegotiationOffer_createdAt_idx" ON "NegotiationOffer"("createdAt");

-- AddForeignKey
ALTER TABLE "NegotiationOffer" ADD CONSTRAINT "NegotiationOffer_negotiationId_fkey" FOREIGN KEY ("negotiationId") REFERENCES "Negotiation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

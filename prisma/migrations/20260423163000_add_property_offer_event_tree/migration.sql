-- AlterTable
ALTER TABLE "PropertyOffer"
ADD COLUMN "latestAmount" DOUBLE PRECISION,
ADD COLUMN "lastActionByRole" TEXT;

-- CreateTable
CREATE TABLE "PropertyOfferEvent" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "parentEventId" TEXT,
    "actorId" TEXT NOT NULL,
    "actorRole" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PropertyOfferEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PropertyOfferEvent_offerId_idx" ON "PropertyOfferEvent"("offerId");
CREATE INDEX "PropertyOfferEvent_parentEventId_idx" ON "PropertyOfferEvent"("parentEventId");
CREATE INDEX "PropertyOfferEvent_actorId_idx" ON "PropertyOfferEvent"("actorId");
CREATE INDEX "PropertyOfferEvent_createdAt_idx" ON "PropertyOfferEvent"("createdAt");

-- AddForeignKey
ALTER TABLE "PropertyOfferEvent" ADD CONSTRAINT "PropertyOfferEvent_offerId_fkey"
    FOREIGN KEY ("offerId") REFERENCES "PropertyOffer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PropertyOfferEvent" ADD CONSTRAINT "PropertyOfferEvent_parentEventId_fkey"
    FOREIGN KEY ("parentEventId") REFERENCES "PropertyOfferEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

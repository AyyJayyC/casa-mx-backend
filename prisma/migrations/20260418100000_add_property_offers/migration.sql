-- CreateTable
CREATE TABLE "PropertyOffer" (
    "id"            TEXT NOT NULL,
    "propertyId"    TEXT NOT NULL,
    "buyerId"       TEXT NOT NULL,
    "status"        TEXT NOT NULL DEFAULT 'pending',
    "offerAmount"   DOUBLE PRECISION NOT NULL,
    "financing"     TEXT NOT NULL,
    "closingDate"   TIMESTAMP(3),
    "message"       TEXT,
    "buyerName"     TEXT NOT NULL,
    "buyerEmail"    TEXT NOT NULL,
    "buyerPhone"    TEXT NOT NULL,
    "sellerNote"    TEXT,
    "counterAmount" DOUBLE PRECISION,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PropertyOffer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PropertyOffer_propertyId_idx" ON "PropertyOffer"("propertyId");
CREATE INDEX "PropertyOffer_buyerId_idx" ON "PropertyOffer"("buyerId");
CREATE INDEX "PropertyOffer_status_idx" ON "PropertyOffer"("status");
CREATE INDEX "PropertyOffer_createdAt_idx" ON "PropertyOffer"("createdAt");

-- AddForeignKey
ALTER TABLE "PropertyOffer" ADD CONSTRAINT "PropertyOffer_propertyId_fkey"
    FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

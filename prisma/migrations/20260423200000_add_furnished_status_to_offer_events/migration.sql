-- AddColumn: proposedFurnishedStatus to PropertyOfferEvent
ALTER TABLE "PropertyOfferEvent" ADD COLUMN "proposedFurnishedStatus" TEXT;

-- AddColumn: agreedFurnishedStatus to PropertyOffer
ALTER TABLE "PropertyOffer" ADD COLUMN "agreedFurnishedStatus" TEXT;

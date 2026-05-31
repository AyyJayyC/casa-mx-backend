-- Performance indexes
CREATE INDEX "User_createdAt_idx" ON "User"("createdAt");

CREATE INDEX "Agency_billingActive_subscriptionEnds_idx" ON "Agency"("billingActive", "subscriptionEnds");

CREATE INDEX "Property_promotionTier_idx" ON "Property"("promotionTier");
CREATE INDEX "Property_featuredUntil_idx" ON "Property"("featuredUntil");
CREATE INDEX "Property_createdAt_idx" ON "Property"("createdAt");
CREATE INDEX "Property_furnished_idx" ON "Property"("furnished");
CREATE INDEX "Property_visibility_idx" ON "Property"("visibility");
CREATE INDEX "Property_monthlyRent_idx" ON "Property"("monthlyRent");

CREATE INDEX "AnalyticsEvent_eventName_entityId_idx" ON "AnalyticsEvent"("eventName", "entityId");

CREATE INDEX "CreditTransaction_referenceId_idx" ON "CreditTransaction"("referenceId");

-- Prevent duplicate rental applications
CREATE UNIQUE INDEX "RentalApplication_propertyId_applicantId_key" ON "RentalApplication"("propertyId", "applicantId");

-- Align status default with Spanish UI
ALTER TABLE "Property" ALTER COLUMN "status" SET DEFAULT 'disponible';

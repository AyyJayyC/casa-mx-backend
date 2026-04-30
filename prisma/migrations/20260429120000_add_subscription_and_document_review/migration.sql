-- Add subscription support and identity document review metadata

ALTER TABLE "User"
ADD COLUMN "stripeCustomerId" TEXT;

CREATE UNIQUE INDEX "User_stripeCustomerId_key" ON "User"("stripeCustomerId");

ALTER TABLE "UserDocument"
ADD COLUMN "reviewStatus" TEXT NOT NULL DEFAULT 'pending',
ADD COLUMN "reviewNote" TEXT,
ADD COLUMN "reviewedByUserId" TEXT,
ADD COLUMN "reviewedAt" TIMESTAMP(3);

CREATE TABLE "UserSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stripeSubscriptionId" TEXT,
    "stripePriceId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'inactive',
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "canceledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserSubscription_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserSubscription_userId_key" ON "UserSubscription"("userId");
CREATE UNIQUE INDEX "UserSubscription_stripeSubscriptionId_key" ON "UserSubscription"("stripeSubscriptionId");
CREATE INDEX "UserSubscription_status_idx" ON "UserSubscription"("status");

ALTER TABLE "UserSubscription"
ADD CONSTRAINT "UserSubscription_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

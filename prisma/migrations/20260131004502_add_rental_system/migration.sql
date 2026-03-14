-- AlterTable
ALTER TABLE "Property" ADD COLUMN     "availableFrom" TIMESTAMP(3),
ADD COLUMN     "furnished" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "leaseTermMonths" INTEGER,
ADD COLUMN     "listingType" TEXT NOT NULL DEFAULT 'for_sale',
ADD COLUMN     "monthlyRent" DOUBLE PRECISION,
ADD COLUMN     "securityDeposit" DOUBLE PRECISION,
ADD COLUMN     "utilitiesIncluded" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "price" DROP NOT NULL;

-- CreateTable
CREATE TABLE "RentalApplication" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "applicantId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "fullName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "employer" TEXT NOT NULL,
    "jobTitle" TEXT NOT NULL,
    "monthlyIncome" DOUBLE PRECISION NOT NULL,
    "employmentDuration" TEXT NOT NULL,
    "desiredMoveInDate" TIMESTAMP(3) NOT NULL,
    "desiredLeaseTerm" INTEGER NOT NULL,
    "numberOfOccupants" INTEGER NOT NULL,
    "reference1Name" TEXT NOT NULL,
    "reference1Phone" TEXT NOT NULL,
    "reference2Name" TEXT,
    "reference2Phone" TEXT,
    "messageToLandlord" TEXT,
    "landlordNote" TEXT,
    "idDocumentUrl" TEXT,
    "incomeProofUrl" TEXT,
    "additionalDocsUrls" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RentalApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RentalApplication_propertyId_idx" ON "RentalApplication"("propertyId");

-- CreateIndex
CREATE INDEX "RentalApplication_applicantId_idx" ON "RentalApplication"("applicantId");

-- CreateIndex
CREATE INDEX "RentalApplication_status_idx" ON "RentalApplication"("status");

-- CreateIndex
CREATE INDEX "RentalApplication_createdAt_idx" ON "RentalApplication"("createdAt");

-- CreateIndex
CREATE INDEX "Notification_userId_read_idx" ON "Notification"("userId", "read");

-- CreateIndex
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");

-- CreateIndex
CREATE INDEX "Property_listingType_idx" ON "Property"("listingType");

-- AddForeignKey
ALTER TABLE "RentalApplication" ADD CONSTRAINT "RentalApplication_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

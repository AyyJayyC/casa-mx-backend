-- Create PropertyDocument table for ownership verification
CREATE TABLE "PropertyDocument" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "propertyId" TEXT NOT NULL,
  "uploaderId" TEXT NOT NULL,
  "documentType" TEXT NOT NULL,
  "fileUrl" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "fileMimeType" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PropertyDocument_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property" ("id") ON DELETE CASCADE,
  CONSTRAINT "PropertyDocument_uploaderId_fkey" FOREIGN KEY ("uploaderId") REFERENCES "User" ("id")
);

-- Add verification fields to Property table
ALTER TABLE "Property" ADD COLUMN "verificationStatus" TEXT NOT NULL DEFAULT 'unverified';
ALTER TABLE "Property" ADD COLUMN "verificationNote" TEXT;

-- Create indexes for PropertyDocument
CREATE INDEX "PropertyDocument_propertyId_idx" ON "PropertyDocument"("propertyId");
CREATE INDEX "PropertyDocument_uploaderId_idx" ON "PropertyDocument"("uploaderId");

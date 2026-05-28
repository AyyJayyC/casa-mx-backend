-- Add updatedAt column to PropertyImage
ALTER TABLE "PropertyImage" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Create composite index on propertyId and order (if not already present)
CREATE INDEX IF NOT EXISTS "PropertyImage_propertyId_order_idx" ON "PropertyImage"("propertyId", "order");

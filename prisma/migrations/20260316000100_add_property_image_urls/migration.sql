-- Add imageUrls array for property pictures
ALTER TABLE "Property"
ADD COLUMN "imageUrls" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

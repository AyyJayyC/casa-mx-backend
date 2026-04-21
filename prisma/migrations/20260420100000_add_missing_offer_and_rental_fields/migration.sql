-- AlterTable: add payment plan fields to PropertyOffer
ALTER TABLE "PropertyOffer" ADD COLUMN IF NOT EXISTS "enganche" DOUBLE PRECISION;
ALTER TABLE "PropertyOffer" ADD COLUMN IF NOT EXISTS "cuotaMensual" DOUBLE PRECISION;
ALTER TABLE "PropertyOffer" ADD COLUMN IF NOT EXISTS "plazoMeses" INTEGER;

-- AlterTable: add negotiation rent field to RentalApplication
ALTER TABLE "RentalApplication" ADD COLUMN IF NOT EXISTS "offeredMonthlyRent" DOUBLE PRECISION;

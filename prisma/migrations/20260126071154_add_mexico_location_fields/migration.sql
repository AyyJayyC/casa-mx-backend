-- AlterTable
ALTER TABLE "Property" ADD COLUMN     "ciudad" TEXT,
ADD COLUMN     "codigoPostal" TEXT,
ADD COLUMN     "colonia" TEXT,
ADD COLUMN     "estado" TEXT NOT NULL DEFAULT 'Ciudad de México',
ALTER COLUMN "address" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "Property_estado_idx" ON "Property"("estado");

-- CreateIndex
CREATE INDEX "Property_ciudad_idx" ON "Property"("ciudad");

-- CreateIndex
CREATE INDEX "Property_colonia_idx" ON "Property"("colonia");

-- CreateIndex
CREATE INDEX "Property_codigoPostal_idx" ON "Property"("codigoPostal");

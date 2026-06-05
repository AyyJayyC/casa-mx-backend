-- AlterTable: change furnished from Boolean to String
-- Convert true -> 'furnished', false -> 'unfurnished'
ALTER TABLE "Property" ADD COLUMN "furnished_new" TEXT;
UPDATE "Property" SET "furnished_new" = CASE WHEN "furnished" = true THEN 'furnished' ELSE 'unfurnished' END;
ALTER TABLE "Property" DROP COLUMN "furnished";
ALTER TABLE "Property" RENAME COLUMN "furnished_new" TO "furnished";

-- CreateTable
CREATE TABLE "TagSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tagType" TEXT NOT NULL DEFAULT 'colonia',
    "tagName" TEXT NOT NULL,
    "tagNormal" TEXT NOT NULL,
    "estado" TEXT,
    "notifyInApp" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TagSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TagSubscription_userId_tagType_tagNormal_key" ON "TagSubscription"("userId", "tagType", "tagNormal");

-- CreateIndex
CREATE INDEX "TagSubscription_tagType_tagNormal_idx" ON "TagSubscription"("tagType", "tagNormal");

-- CreateIndex
CREATE INDEX "TagSubscription_userId_idx" ON "TagSubscription"("userId");

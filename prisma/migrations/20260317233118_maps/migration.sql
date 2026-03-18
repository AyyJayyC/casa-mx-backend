/*
  Warnings:

  - A unique constraint covering the columns `[serviceType]` on the table `UsageLimit` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "ApiUsageLog_createdAt_idx";

-- DropIndex
DROP INDEX "LimitAlert_alertTimestamp_idx";

-- DropIndex
DROP INDEX "UsageLimit_createdAt_idx";

-- CreateIndex
CREATE UNIQUE INDEX "UsageLimit_serviceType_key" ON "UsageLimit"("serviceType");

-- CreateTable ApiUsageLog
CREATE TABLE "ApiUsageLog" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "serviceType" TEXT NOT NULL,
    "requestTimestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,
    "requestDetails" JSONB,
    "responseStatus" TEXT NOT NULL,
    "responseTimeMs" INTEGER,
    "cost" DOUBLE PRECISION,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiUsageLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable UsageLimit
CREATE TABLE "UsageLimit" (
    "id" TEXT NOT NULL,
    "serviceType" TEXT NOT NULL,
    "limitType" TEXT NOT NULL,
    "limitValue" INTEGER NOT NULL,
    "currentUsage" INTEGER NOT NULL DEFAULT 0,
    "resetAt" TIMESTAMP(3),
    "alertThreshold" INTEGER NOT NULL DEFAULT 80,
    "hardStop" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageLimit_pkey" PRIMARY KEY ("id")
);

-- CreateTable LimitAlert
CREATE TABLE "LimitAlert" (
    "id" TEXT NOT NULL,
    "serviceType" TEXT NOT NULL,
    "alertType" TEXT NOT NULL,
    "thresholdPercent" INTEGER NOT NULL,
    "usageAtAlert" INTEGER NOT NULL,
    "limitValue" INTEGER NOT NULL,
    "adminNotified" BOOLEAN NOT NULL DEFAULT false,
    "alertTimestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "LimitAlert_pkey" PRIMARY KEY ("id")
);

-- Indexes for ApiUsageLog
CREATE INDEX "ApiUsageLog_serviceType_idx" ON "ApiUsageLog"("serviceType");
CREATE INDEX "ApiUsageLog_requestTimestamp_idx" ON "ApiUsageLog"("requestTimestamp");
CREATE INDEX "ApiUsageLog_userId_idx" ON "ApiUsageLog"("userId");
CREATE INDEX "ApiUsageLog_responseStatus_idx" ON "ApiUsageLog"("responseStatus");
CREATE INDEX "ApiUsageLog_createdAt_idx" ON "ApiUsageLog"("createdAt");

-- Indexes for UsageLimit
CREATE INDEX "UsageLimit_serviceType_idx" ON "UsageLimit"("serviceType");
CREATE INDEX "UsageLimit_status_idx" ON "UsageLimit"("status");
CREATE INDEX "UsageLimit_createdAt_idx" ON "UsageLimit"("createdAt");

-- Indexes for LimitAlert
CREATE INDEX "LimitAlert_serviceType_idx" ON "LimitAlert"("serviceType");
CREATE INDEX "LimitAlert_alertType_idx" ON "LimitAlert"("alertType");
CREATE INDEX "LimitAlert_resolved_idx" ON "LimitAlert"("resolved");
CREATE INDEX "LimitAlert_alertTimestamp_idx" ON "LimitAlert"("alertTimestamp");

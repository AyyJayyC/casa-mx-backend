-- CreateTable
CREATE TABLE "DebugSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "userEmail" TEXT,
    "sessionStartTime" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sessionEndTime" TIMESTAMP(3),
    "initialRoute" TEXT NOT NULL,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "hasErrors" BOOLEAN NOT NULL DEFAULT false,
    "exported" BOOLEAN NOT NULL DEFAULT false,
    "exportedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DebugSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActionLog" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT,
    "userEmail" TEXT,
    "actionType" TEXT NOT NULL,
    "actionName" TEXT NOT NULL,
    "componentName" TEXT,
    "currentRoute" TEXT NOT NULL,
    "metadata" JSONB,
    "userAgent" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActionLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErrorLog" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT,
    "userEmail" TEXT,
    "errorType" TEXT NOT NULL,
    "errorMessage" TEXT NOT NULL,
    "errorStackTrace" TEXT,
    "errorCode" TEXT,
    "severity" TEXT NOT NULL,
    "componentName" TEXT,
    "currentRoute" TEXT NOT NULL,
    "contextData" JSONB,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "resolvedNote" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ErrorLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiLog" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT,
    "httpMethod" TEXT NOT NULL,
    "apiEndpoint" TEXT NOT NULL,
    "requestHeaders" JSONB,
    "requestBody" JSONB,
    "responseStatus" INTEGER NOT NULL,
    "responseBody" JSONB,
    "responseTimeMs" INTEGER NOT NULL,
    "errorMessage" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DebugSession_userId_idx" ON "DebugSession"("userId");

-- CreateIndex
CREATE INDEX "DebugSession_userEmail_idx" ON "DebugSession"("userEmail");

-- CreateIndex
CREATE INDEX "DebugSession_hasErrors_idx" ON "DebugSession"("hasErrors");

-- CreateIndex
CREATE INDEX "DebugSession_exported_idx" ON "DebugSession"("exported");

-- CreateIndex
CREATE INDEX "DebugSession_sessionStartTime_idx" ON "DebugSession"("sessionStartTime");

-- CreateIndex
CREATE INDEX "DebugSession_createdAt_idx" ON "DebugSession"("createdAt");

-- CreateIndex
CREATE INDEX "ActionLog_sessionId_idx" ON "ActionLog"("sessionId");

-- CreateIndex
CREATE INDEX "ActionLog_userId_idx" ON "ActionLog"("userId");

-- CreateIndex
CREATE INDEX "ActionLog_actionType_idx" ON "ActionLog"("actionType");

-- CreateIndex
CREATE INDEX "ActionLog_timestamp_idx" ON "ActionLog"("timestamp");

-- CreateIndex
CREATE INDEX "ActionLog_createdAt_idx" ON "ActionLog"("createdAt");

-- CreateIndex
CREATE INDEX "ErrorLog_sessionId_idx" ON "ErrorLog"("sessionId");

-- CreateIndex
CREATE INDEX "ErrorLog_userId_idx" ON "ErrorLog"("userId");

-- CreateIndex
CREATE INDEX "ErrorLog_errorType_idx" ON "ErrorLog"("errorType");

-- CreateIndex
CREATE INDEX "ErrorLog_severity_idx" ON "ErrorLog"("severity");

-- CreateIndex
CREATE INDEX "ErrorLog_resolved_idx" ON "ErrorLog"("resolved");

-- CreateIndex
CREATE INDEX "ErrorLog_timestamp_idx" ON "ErrorLog"("timestamp");

-- CreateIndex
CREATE INDEX "ErrorLog_createdAt_idx" ON "ErrorLog"("createdAt");

-- CreateIndex
CREATE INDEX "ApiLog_sessionId_idx" ON "ApiLog"("sessionId");

-- CreateIndex
CREATE INDEX "ApiLog_userId_idx" ON "ApiLog"("userId");

-- CreateIndex
CREATE INDEX "ApiLog_apiEndpoint_idx" ON "ApiLog"("apiEndpoint");

-- CreateIndex
CREATE INDEX "ApiLog_responseStatus_idx" ON "ApiLog"("responseStatus");

-- CreateIndex
CREATE INDEX "ApiLog_timestamp_idx" ON "ApiLog"("timestamp");

-- CreateIndex
CREATE INDEX "ApiLog_createdAt_idx" ON "ApiLog"("createdAt");

-- AddForeignKey
ALTER TABLE "ActionLog" ADD CONSTRAINT "ActionLog_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "DebugSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErrorLog" ADD CONSTRAINT "ErrorLog_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "DebugSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiLog" ADD CONSTRAINT "ApiLog_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "DebugSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

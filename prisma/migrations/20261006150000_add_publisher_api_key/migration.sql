-- AlterTable
ALTER TABLE "Property" ADD COLUMN     "externalId" TEXT;

-- CreateTable
CREATE TABLE "PublisherApiKey" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY['listings:write']::TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "skipIneVerification" BOOLEAN NOT NULL DEFAULT false,
    "revokedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PublisherApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PublisherApiKey_keyHash_key" ON "PublisherApiKey"("keyHash");

-- CreateIndex
CREATE INDEX "PublisherApiKey_userId_idx" ON "PublisherApiKey"("userId");

-- CreateIndex
CREATE INDEX "PublisherApiKey_active_idx" ON "PublisherApiKey"("active");

-- CreateIndex
CREATE UNIQUE INDEX "Property_sellerId_externalId_key" ON "Property"("sellerId", "externalId");

-- AddForeignKey
ALTER TABLE "PublisherApiKey" ADD CONSTRAINT "PublisherApiKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

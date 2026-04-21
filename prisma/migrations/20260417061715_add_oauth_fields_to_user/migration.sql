/*
  Warnings:

  - A unique constraint covering the columns `[provider,providerId]` on the table `User` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "avatarUrl" TEXT,
ADD COLUMN     "provider" TEXT,
ADD COLUMN     "providerId" TEXT,
ALTER COLUMN "password" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "User_provider_idx" ON "User"("provider");

-- CreateIndex
CREATE UNIQUE INDEX "User_provider_providerId_key" ON "User"("provider", "providerId");

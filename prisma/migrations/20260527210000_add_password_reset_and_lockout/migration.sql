-- AlterTable
ALTER TABLE "User" ADD COLUMN "passwordResetToken" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN "passwordResetTokenExpiresAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "User" ADD COLUMN "lockedUntil" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN "lastFailedLoginAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "User_passwordResetToken_key" ON "User"("passwordResetToken");

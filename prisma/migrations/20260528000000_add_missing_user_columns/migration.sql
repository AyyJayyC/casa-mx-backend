-- Add missing User columns that were added via prisma db push on local
-- but never had a proper migration created on Railway.

-- phoneVerified (Boolean, default false)
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "phoneVerified" BOOLEAN NOT NULL DEFAULT false;

-- pendingEmail (String, optional, for email change verification)
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "pendingEmail" TEXT;

-- phone (String, optional, contact phone number)
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "phone" TEXT;

-- whatsapp (String, optional, WhatsApp number with country code)
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "whatsapp" TEXT;

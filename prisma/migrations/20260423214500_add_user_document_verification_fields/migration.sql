-- Ensure UserDocument table exists (for drifted/local DBs)
CREATE TABLE IF NOT EXISTS "UserDocument" (
	"id" TEXT NOT NULL,
	"userId" TEXT NOT NULL,
	"documentType" TEXT NOT NULL,
	"fileUrl" TEXT NOT NULL,
	"fileName" TEXT NOT NULL,
	"fileMimeType" TEXT NOT NULL,
	"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT "UserDocument_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "UserDocument_userId_idx" ON "UserDocument"("userId");
CREATE INDEX IF NOT EXISTS "UserDocument_documentType_idx" ON "UserDocument"("documentType");

DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.table_constraints
		WHERE constraint_name = 'UserDocument_userId_fkey'
			AND table_name = 'UserDocument'
	) THEN
		ALTER TABLE "UserDocument"
			ADD CONSTRAINT "UserDocument_userId_fkey"
			FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
	END IF;
END $$;

-- Add verification fields for account-level documents (e.g., INE)
ALTER TABLE "UserDocument" ADD COLUMN IF NOT EXISTS "isVerified" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "UserDocument" ADD COLUMN IF NOT EXISTS "verifiedAt" TIMESTAMP(3);

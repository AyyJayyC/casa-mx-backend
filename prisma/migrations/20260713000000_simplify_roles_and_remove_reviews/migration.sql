-- Step 1: Create new roles (idempotent)
INSERT INTO "Role" ("id", "name", "createdAt") 
SELECT gen_random_uuid(), 'client', NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Role" WHERE "name" = 'client');

INSERT INTO "Role" ("id", "name", "createdAt") 
SELECT gen_random_uuid(), 'owner', NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Role" WHERE "name" = 'owner');

INSERT INTO "Role" ("id", "name", "createdAt") 
SELECT gen_random_uuid(), 'agent', NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Role" WHERE "name" = 'agent');

-- Step 2: Repoint UserRole records to new roles
UPDATE "UserRole" SET "roleId" = (SELECT id FROM "Role" WHERE "name" = 'client')
  WHERE "roleId" IN (SELECT id FROM "Role" WHERE "name" IN ('buyer', 'tenant'));

UPDATE "UserRole" SET "roleId" = (SELECT id FROM "Role" WHERE "name" = 'owner')
  WHERE "roleId" IN (SELECT id FROM "Role" WHERE "name" IN ('seller', 'landlord'));

UPDATE "UserRole" SET "roleId" = (SELECT id FROM "Role" WHERE "name" = 'agent')
  WHERE "roleId" IN (SELECT id FROM "Role" WHERE "name" = 'wholesaler');

-- Step 3: Deduplicate UserRole records (keep approved over pending, then oldest)
DELETE FROM "UserRole" a
USING "UserRole" b
WHERE a."userId" = b."userId" 
  AND a."roleId" = b."roleId"
  AND (
    a.status < b.status
    OR (a.status = b.status AND a."createdAt" > b."createdAt")
  );

-- Step 4: Delete old Role records
DELETE FROM "Role" WHERE "name" IN ('buyer', 'tenant', 'seller', 'landlord', 'wholesaler');

-- Step 5: Drop Review table and related objects
DROP TABLE IF EXISTS "Review" CASCADE;

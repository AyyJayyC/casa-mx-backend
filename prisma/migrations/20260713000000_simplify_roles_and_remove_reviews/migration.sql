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

-- Step 2: Deduplicate BEFORE repointing.
-- A user can hold several of the roles being merged (e.g. buyer + tenant),
-- which collides with @@unique([userId, roleId]) the moment we repoint them
-- to the same new role. Collapse each (userId, target-role) group to a single
-- row first: keep approved over pending over denied, then the oldest.
WITH ranked AS (
  SELECT ur.id,
         ROW_NUMBER() OVER (
           PARTITION BY ur."userId",
             CASE r."name"
               WHEN 'buyer'      THEN 'client'
               WHEN 'tenant'     THEN 'client'
               WHEN 'seller'     THEN 'owner'
               WHEN 'landlord'   THEN 'owner'
               WHEN 'wholesaler' THEN 'agent'
               ELSE r."name"
             END
           ORDER BY (CASE ur."status" WHEN 'approved' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END),
                    ur."createdAt" ASC
         ) AS rn
  FROM "UserRole" ur
  JOIN "Role" r ON r.id = ur."roleId"
  WHERE r."name" IN ('buyer','tenant','seller','landlord','wholesaler','client','owner','agent')
)
DELETE FROM "UserRole" WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- Step 3: Repoint UserRole records to new roles
UPDATE "UserRole" SET "roleId" = (SELECT id FROM "Role" WHERE "name" = 'client')
  WHERE "roleId" IN (SELECT id FROM "Role" WHERE "name" IN ('buyer', 'tenant'));

UPDATE "UserRole" SET "roleId" = (SELECT id FROM "Role" WHERE "name" = 'owner')
  WHERE "roleId" IN (SELECT id FROM "Role" WHERE "name" IN ('seller', 'landlord'));

UPDATE "UserRole" SET "roleId" = (SELECT id FROM "Role" WHERE "name" = 'agent')
  WHERE "roleId" IN (SELECT id FROM "Role" WHERE "name" IN ('wholesaler'));

-- Step 4: Delete old Role records
DELETE FROM "Role" WHERE "name" IN ('buyer', 'tenant', 'seller', 'landlord', 'wholesaler');

-- Step 5: Drop Review table and related objects
DROP TABLE IF EXISTS "Review" CASCADE;

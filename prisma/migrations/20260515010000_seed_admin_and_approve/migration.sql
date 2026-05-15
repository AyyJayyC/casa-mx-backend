-- Approve seller role for Axel's user
UPDATE "UserRole" SET "status" = 'approved' WHERE "userId" = 'afdc2898-25d5-42cd-a551-c28551c8bf7f';

-- Ensure admin role exists and create admin user if needed
INSERT INTO "UserRole" ("id", "userId", "roleId", "status", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'afdc2898-25d5-42cd-a551-c28551c8bf7f', r.id, 'approved', NOW(), NOW()
FROM "Role" r
WHERE r.name = 'admin'
AND NOT EXISTS (
  SELECT 1 FROM "UserRole" ur WHERE ur."userId" = 'afdc2898-25d5-42cd-a551-c28551c8bf7f' AND ur."roleId" = r.id
);

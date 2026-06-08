---
disable: true
name: prisma-migration
description: Create and run Prisma database migrations safely with Docker-managed PostgreSQL; verify schema changes don't break existing queries
license: MIT
compatibility: opencode
metadata:
  audience: developers
  workflow: database
---

## What I do
- Guide creating Prisma migrations via `npx prisma migrate dev --name <name>`
- Never use `prisma db push` - CI needs `.sql` files
- Verify `docker compose ps` before running migrations (PostgreSQL must be healthy)
- Check schema changes don't break existing queries or cascade deletes

## When to use me
Use when modifying `schema.prisma`, adding/removing models or fields, or when asked to make database schema changes.

## Workflow
1. Read `prisma/schema.prisma` to understand current models
2. Run `docker compose ps` to verify PostgreSQL is running
3. Make schema changes
4. Run `npx prisma migrate dev --name <descriptive_name>` to generate migration
5. Verify migration SQL file was created in `prisma/migrations/`
6. Run tests: `npm test -- --run`

## Key Rules
- Never use `prisma db push` (it skips migration files)
- Add `@map` and `@@map` for table/column naming conventions
- Always add relation fields in pairs (e.g., `user User @relation(...)` + `properties Property[]`)
- Check for existing indexes before adding duplicate ones
- Use `CASCADE` deletes only when explicitly required

# Development Rules — Avoid Repeating Mistakes

> Last updated: 2026-05-12

## 1. Always check if Docker is the infra layer FIRST

The backend uses Docker for PostgreSQL + Redis + backend. Before:
- Installing packages manually
- Hunting for missing shared libraries
- Wondering why PostgreSQL won't start

Run `docker compose ps` or `docker ps` immediately. If Docker is installed, start there.

## 2. WSL paths for Windows projects

Windows project path: `C:\Users\axelj\casa-mx`
WSL mount path: `/mnt/c/Users/axelj/casa-mx`

Always check the WSL mount path first before searching the home directory.

## 3. Prisma schema changes MUST include a migration file

- `prisma db push` applies schema directly — fine for local dev
- `prisma migrate deploy` runs in CI — requires `.sql` files in `prisma/migrations/`
- **Rule:** Every schema change must create a migration file before pushing to `main`
- **How:** Run `prisma migrate dev --name describe_change` locally (use `script -q -c "command" /dev/null` in WSL if TTY needed)
- **If db push was used first:** Migration will conflict. Resolve with:
  ```
  prisma migrate resolve --applied MIGRATION_NAME
  ```

## 4. Never REMOVE existing API endpoints — ADD alongside

When enhancing a route file (e.g., `analytics.ts`):
- Keep old endpoints responding with their original shapes
- Add new endpoints with different paths
- Tests expect the original response structure to stay intact

## 5. Always check which git branch you're on

- `git status` shows active branch
- Don't work on outdated branches like `sec-fix` when `main` is the target
- If branch protection blocks direct push to `main`, use a feature branch + PR

## 6. Check CI workflows early

Before making infrastructure changes:
1. Read `.github/workflows/ci.yml` — How do tests run? What DB? What migration command?
2. Read `.github/workflows/security-scan.yml` — What audit level? What blocks?
3. Match local setup to CI setup (migration commands, Node version, test DB name)

## 7. Check GH PRs and branches before cleaning up

- `gh pr list` shows open PRs — close stale dependabot/copilot PRs regularly
- `git branch -r` shows remote branches — prune after PR close
- Don't close PRs that merged real features without reviewing them first

## 8. Dockerfile: apt-get must come BEFORE USER

```dockerfile
# CORRECT
RUN apt-get update && apt-get install -y curl libssl3 && rm -rf /var/lib/apt/lists/*
RUN chown -R node:node /app
USER node

# WRONG (fails with permission denied)
USER node
RUN apt-get update && apt-get install -y curl libssl3 ...
```

## Quick Reset When Things Are Broken

```bash
# Stop all Docker containers, rebuild, fix migrations
docker compose down
docker compose up -d --build
# If migration failed:
docker exec casamx-backend npx prisma migrate resolve --applied MIGRATION_NAME
# Or from host:
npx prisma migrate resolve --applied MIGRATION_NAME
```

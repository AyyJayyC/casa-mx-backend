---
disable: true
name: docker-management
description: Manage Docker Compose services for local development (PostgreSQL 16, Redis 7, backend); debug health checks and connection issues
license: MIT
compatibility: opencode
metadata:
  audience: developers
  workflow: infrastructure
---

## What I do
- Check Docker service health with `docker compose ps`
- Start/stop/restart services: `docker compose up -d`, `docker compose down`
- View logs: `docker compose logs -f backend|redis|postgres`
- Run commands inside containers: `docker compose exec backend <cmd>`
- Debug connection issues between services

## When to use me
Use when dealing with Docker, PostgreSQL, Redis, or backend service issues. Also when setting up the development environment or debugging infrastructure problems.

## Important Commands
```bash
# Check all services
docker compose ps

# Start all services
docker compose up -d

# View backend logs
docker compose logs -f backend

# Run Prisma commands
docker compose exec backend npx prisma migrate deploy
docker compose exec backend npx prisma db seed

# Debug Redis
docker compose exec redis redis-cli ping

# Debug PostgreSQL
docker compose exec postgres pg_isready
```

## Project-Specific Notes
- Backend runs on port 3001
- PostgreSQL on 5432, Redis on 6379
- Health checks configured for all services
- Migrations run automatically on backend startup
- Redis caches location filter data (24h TTL)
- Graceful fallback to DB if Redis unavailable

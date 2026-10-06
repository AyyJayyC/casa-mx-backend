# CASA MX Backend — Operations

## Current State
- Backend tests: **214/214 passing**
- Production build: ✅ `npm run build`
- Health endpoint: `GET /health`

## Local Runbook
```bash
# from casa-mx-backend
npm install
npm run prisma:generate
npm run dev
```

## Test Commands
```bash
npm test -- --run
```

## Production Readiness Checks
1. Build passes (`npm run build`)
2. Env vars validated (`DATABASE_URL`, `JWT_SECRET`, etc.)
3. DB and Redis reachable
4. `GET /health` returns 200
5. Frontend can authenticate and access protected endpoints

## Railway Runbook
Use the default Railway build flow with one canonical database variable.

### Deploy Settings
```bash
Build Command: npm run build
Start Command: npm run start
Pre-deploy Command: <empty>
```

### Required Production Variables
```bash
NODE_ENV=production
DATABASE_URL=postgresql://...
JWT_SECRET=<32+ characters>
FRONTEND_URL=https://casa-mx.com
MAPS_API_KEY=<google maps api key>
ENABLE_BILLABLE_MAPS=true
```

Optional but expected in production:
```bash
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d
JWT_REFRESH_SECRET=<separate refresh secret>
REDIS_URL=redis://...
```

### Recovery Sequence
1. Deploy to the generated Railway public domain first.
2. Verify build logs show `Deploy $ npm run start`.
3. Verify migrations run once and server boots.
4. Verify `GET /health` returns 200 on the generated Railway domain.
5. Attach `api.casa-mx.com` only after the generated domain is healthy.

## Docker
```bash
docker compose up -d --build
```

---

# Backups, Retention & Restore (pre-launch runbook)

Operational procedures for data durability. Items marked **[OWNER ACTION]**
require a human with Railway/Postgres console access — they are not automated
by code.

## 1. Database backups

- The production database is Postgres managed on Railway.
- **Daily automated backups** must be enabled on the Railway Postgres service
  (Settings → Backups), retention window **≥ 14 days**. **[OWNER ACTION]** —
  verify this is enabled; do not assume it is.
- **Point-in-time recovery (PITR)** requires the Railway plan tier that supports
  it. If PITR is unavailable, the minimum posture is daily logical backups plus
  the weekly encrypted dump below. **[OWNER ACTION]** — confirm the plan and
  enable PITR if offered.

## 2. Off-platform logical dumps

Railway backups are the first line, not the only line. Keep an independent,
encrypted dump:

```bash
# Run from a machine with DATABASE_URL for production (never commit it).
pg_dump "$DATABASE_URL" --format=custom --no-owner --no-privileges \
  | gzip > casamx-$(date +%Y%m%d).dump.gz
```

- Store in an encrypted bucket (S3/R2) in a **different provider/region** than
  the primary database. **[OWNER ACTION]**.
- Retention: **weekly dumps for 8 weeks**, then monthly for 12 months.

## 3. Secrets and credentials

- `JWT_SECRET`, `DATABASE_URL`, `REDIS_URL`, `ADMIN_INITIAL_PASSWORD`, Stripe /
  Resend / Maps keys live in the Railway dashboard, never in the repo.
- **Rotate the production admin password now.** The pre-launch audit found a
  hardcoded admin password in the repo history. Removing the literal is not
  enough — the live credential must be changed. **[OWNER ACTION]**
  - Set a new `ADMIN_INITIAL_PASSWORD` in Railway, then use the (non-production
    only) admin recovery path or change it through the product.
- Rotate any other credential that was ever committed to git.

## 4. Restore drill (do this before launch, then quarterly)

Prove the backups actually restore. A backup you have never restored is a hope,
not a backup.

1. Provision a throwaway Postgres instance (never the production one).
2. Restore the latest dump:
   ```bash
   gunzip -c casamx-YYYYMMDD.dump.gz | pg_restore --clean --no-owner --no-privileges -d "$RESTORE_DATABASE_URL"
   ```
3. Point a temporary backend at the restored DB and run:
   - `npx prisma migrate deploy`
   - `npm test` (smoke) against the restored instance, or at minimum hit
     `/health` and log in as a test user.
4. Record the restore duration and any errors in this file's changelog.
5. Tear the throwaway instance down.

**Targets**: RPO ≤ 24h (15 min if PITR enabled), RTO ≤ 4h.

## 5. Data retention

- **Active accounts**: retained while the account exists.
- **Deleted accounts (ARCO cancelación)**: PII is anonymized immediately; the row
  is soft-deleted (`User.deletedAt`) and cannot log in. Legal/transactional
  records (e.g. credit transactions, payment receipts) are retained in
  anonymized form for the period required by Mexican tax/accounting law
  (generally 5 years), then purged.
- **Backups** may contain pre-deletion data until they age out of the retention
  window; do not restore a backup to "undelete" an ARCO-erased account.

## 6. Redis

- Redis is used for refresh-token state and rate limiting. It is **not** a
  system of record — losing it logs users out and resets rate-limit buckets.
- **Set `REDIS_URL` (with password) on Railway.** **[OWNER ACTION]**.
  Without it, multi-instance deployments do not share refresh/session state.

## Changelog

- 2026-10-06: Added backups / retention / restore-drill runbook.

---

## Canonical References
- `README.md` for setup and architecture basics
- Frontend canonical project history: `../casa-mx/COMPLETE_PROJECT_DOCUMENTATION.md`

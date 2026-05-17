# SEEK.md — Pending Tasks for Casa-MX

Last updated: 2026-05-17 (post security audit)

---

## Security Audit — Remaining Recommendations

### HIGH
- [ ] **Add Sentry integration** (free tier, ~10 min setup)
  - Add `SENTRY_DSN` to `src/config/env.ts`
  - Wire into `app.setErrorHandler` in `src/app.ts:287-309`
  - Replaces current `console.error` JSON log with real error monitoring

- [ ] **Build centralized ownership guard middleware**
  - Current pattern: `if (resource.ownerField !== user.id) return 403` repeated ~20 times
  - Create `requireOwnership(resourceField)` guard in `src/utils/guards.ts`
  - Apply to all PATCH/DELETE routes for consistency

- [ ] **Add global Prisma error handler**
  - P2002 (unique constraint) only handled in 3 routes
  - Add middleware or shared helper for P2002/P2003/P2025 across all create/update routes
  - Prevents generic 500 "Internal server error" for duplicate entries

### MEDIUM
- [ ] **Add structured context to error logging** (77 sites)
  - Current: `fastify.log.error(error)` — no request ID, user ID, URL
  - Add: `fastify.log.error({ err: error, userId, url }, 'message')`

- [ ] **Replace console.error with structured logger** (5 sites)
  - `src/routes/maps.ts:94`, `src/services/maps.service.ts:444`, `src/server.ts:38,52`, `src/config/env.ts:70,72`

- [ ] **Standardize error response format**
  - Some routes return `{ error: '...' }` without `success: false`
  - Affected: `userDocuments.ts`, `admin/maps.ts`, `credits.ts` (webhook)

- [ ] **Add email health check to `/health` endpoint**
  - Report SendGrid connectivity status
  - Alert when `SENDGRID_API_KEY` is missing in production

- [ ] **Add maps monitor recovery mechanism**
  - `src/plugins/mapsMonitor.ts` — if `checkUsage()` fails, backoff instead of silently breaking

### LOW
- [ ] **Consolidate `GET /auth/me` and `GET /users/me`** — near-duplicate endpoints
- [ ] **Remove redundant `verifyJWT` from stacked guards** (12 occurrences)
- [ ] **Disable rate limiting on `POST /credits/webhook`** — Stripe needs burst tolerance
- [ ] **Fix debug session creation returning `'error'` string instead of 500**

---

## Feature Backlog

- [ ] **Agent/agency subscription billing** — `Agency` model has plan/billing fields but no Stripe integration
- [ ] **Frontend: fix mobile login redirect bug** — back button after login gets stuck
- [ ] **Colonia catalog enrichment** — 137 colonias is insufficient; integrate SEPOMEX or INEGI data
- [ ] **Property image S3 upload** — frontend integration with new image endpoints

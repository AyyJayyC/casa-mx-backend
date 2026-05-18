# SEEK.md — Pending Tasks for Casa-MX

Last updated: 2026-05-18 (launch readiness)

---

## Launch Blockers — Done ✅

| # | Task | Status |
|---|------|--------|
| 1 | Row-level permissions fix (propertyRequests leak) | ✅ PR #38 |
| 2 | Stripe webhooks (refund, dispute, payment_failed) | ✅ PR #38 |
| 3 | Email error propagation + empty catch logging | ✅ PR #38 |
| 4 | Stripe error sanitization | ✅ PR #38 |
| 5 | Negotations try/catch | ✅ PR #38 |
| 6 | NOM-247 compliance in all contracts | ✅ PR #39 |
| 7 | Inventory annex in rental contracts | ✅ PR #39 |
| 8 | 32-state legal database (state-legal.json) | ✅ PR #40 |
| 9 | Logo header/footer on contracts | ✅ PR #40 |
| 10 | Compact contracts (4 pages → 2) | ✅ PR #41 |
| 11 | Property features (CFDI, pets, children) | ✅ PR #43 |
| 12 | Frontend: Ruta Clara theme (16 files, clay palette) | ✅ GitHub |
| 13 | Frontend: property form checkboxes + PropertyCard badges | ✅ GitHub |
| 14 | Frontend: colonia free-text input + estado/ciudad fields | ✅ GitHub |
| 15 | Sentry integration | ✅ Today |
| 16 | Remove redundant verifyJWT from stacked guards | ✅ Today |
| 17 | Fix debug session returning 'error' string | ✅ Today |
| 18 | console.error → structured logger (maps route) | ✅ Today |
| 19 | Centralized shared utils (normalizeError, generateReferralCode) | ✅ PR #38 |

---

## Remaining — Post-Launch

### HIGH
- [ ] **Build centralized ownership guard middleware** — `requireOwnership()` in guards.ts

### MEDIUM
- [ ] **Add structured context to error logging** (77 sites — request ID, user ID, URL)
- [ ] **Replace console.error with logger** (2 remaining: maps.service.ts, server.ts)
- [ ] **Standardize error response format** (userDocuments.ts, admin/maps.ts, credits webhook)
- [ ] **Add email health check to `/health` endpoint**
- [ ] **Add maps monitor recovery mechanism**
- [ ] **Add global Prisma error handler** (P2002/P2003/P2025 middleware)

### LOW
- [ ] **Consolidate `GET /auth/me` and `GET /users/me`**
- [ ] **Disable rate limiting on `POST /credits/webhook`**
- [ ] **Agent/agency subscription billing**
- [ ] **Frontend: fix mobile login redirect bug**
- [ ] **Colonia catalog enrichment** (137 → thousands)
- [ ] **Property image S3 upload** (frontend integration)

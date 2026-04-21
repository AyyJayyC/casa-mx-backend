# Auth Durability Evidence (Day 2)

Date: 2026-03-19
Scope: `casa-mx-backend`

## Objective
Move refresh token active/revoked state from route-local in-memory structures to a shared durable store strategy suitable for restart and multi-instance consistency.

## Implementation Summary
- Added shared refresh token store service: `src/services/refreshTokenStore.service.ts`
  - Active refresh JTI key: `auth:refresh:active:{userId}`
  - Revoked refresh JTI key: `auth:refresh:revoked:{jti}`
  - TTL derived from `JWT_REFRESH_EXPIRY`
  - Uses Redis-backed `cacheService` and keeps synchronized in-memory fallback state for resilience/test continuity.
- Updated auth routes in `src/routes/auth.ts`
  - Login writes active refresh JTI via store.
  - Refresh validates revoked + active JTI through store, revokes old JTI, writes new active JTI.
  - Logout clears active JTI and revokes current JTI via store.

## Tests Added/Updated
- `tests/checkpoint2.test.ts`
  - `should persist active refresh token jti in token store`
  - `should revoke old refresh jti and rotate active jti on refresh`

## Validation Commands and Results
```bash
npm run build
npm test -- tests/checkpoint2.test.ts
npm test
```

- Build: **PASS**
- Focused auth test file: **PASS** (`17/17`)
- Full backend suite: **PASS** (`15` files, `218` tests)

## Residual Risk
- Current fallback keeps in-memory state when Redis is unavailable, which preserves runtime continuity but reduces strict cross-instance guarantees during Redis outages.
- Recommended follow-up: promote Redis availability to a launch health gate and alert on token-store fallback usage.

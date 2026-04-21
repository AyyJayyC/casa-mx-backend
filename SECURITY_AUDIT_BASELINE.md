# Security Audit Baseline

Date: 2026-03-19
Scope: `casa-mx-backend` (production dependencies)

## Environment Baseline
- Node.js: `v20.19.0`
- npm: `10.8.2`

## Commands Executed
```bash
npm audit --omit=dev --audit-level=high
npm test
npm run build
```

## Vulnerability Summary (Before Remediation)
- Total vulnerabilities: **9**
- High: **5**
- Moderate: **4**

### High Severity Findings
1. `fastify <=5.7.2`
   - Advisories include DoS and content-type validation bypass paths.
   - Suggested fix: `npm audit fix --force` (upgrades to `fastify@5.8.2`, potentially breaking).

2. `minimatch <=3.1.3`
   - ReDoS risk in wildcard/extglob pattern processing.
   - Suggested fix: `npm audit fix`.

3. `tar <=7.5.10` via `@mapbox/node-pre-gyp` -> `bcrypt`
   - Path traversal / arbitrary file write advisory family.
   - Suggested fix requires breaking upgrade path (`bcrypt@6.0.0` via force fix).

### Moderate Severity Findings
1. `ajv` (ReDoS with `$data` option)
2. `bn.js` (infinite loop risk)
3. `fast-jwt <5.0.6` via `@fastify/jwt <=9.0.1`

## Vulnerability Summary (Current)
- `npm audit --omit=dev`: **0 vulnerabilities**
- `npm audit --omit=dev --audit-level=high`: **0 vulnerabilities**

## Day 1 Verification Results
- Test suite: **PASS** (`15` files, `216` tests)
- Build: **PASS** (`tsc` succeeded)
- Artifact: `TEST_RESULTS_2026-03-20.txt`

## Risk and Go/No-Go
Backend dependency baseline is now **GO (security dependency gate only)** because production vulnerabilities are cleared.

## Immediate Remediation Queue
1. Keep Fastify ecosystem pinned and monitor advisories (`fastify`, `@fastify/*`, `@fastify/jwt`).
2. Keep `bcrypt` chain pinned at patched versions and monitor advisories.
3. Re-run in CI on each release:
   - `npm audit --omit=dev --audit-level=high`
   - `npm test`
   - `npm run build`
4. Require launch gate: **0 high vulnerabilities** in production dependencies.

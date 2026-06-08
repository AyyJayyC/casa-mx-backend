---
name: security-audit
description: Fix security vulnerabilities following the project security audit; apply OWASP best practices for JWT, CSRF, XSS, Docker, secrets management
license: MIT
compatibility: opencode
metadata:
  audience: developers
  workflow: security
---

## What I do
- Guide the agent through fixing known security vulnerabilities listed in `seek.md` (VULN-01 through VULN-25)
- Enforce security best practices: never expose secrets, never read/write .env files, never log PII
- Validate fixes against OWASP Top 10 patterns
- Check each fix doesn't break existing functionality (run `npm test` after changes)

## When to use me
Use when the user asks to fix, audit, or review security issues. Also use when modifying auth routes, JWT handling, Docker configs, or any code touching secrets/PII.

## Fix Workflow
1. Read `seek.md` Security Audit section to find the vulnerability ID and file:line
2. Read the affected file(s) in full before making changes
3. Apply the minimal fix - surgical changes only
4. Run `npm test -- --run` to verify nothing broke
5. If backend changes, check Docker services with `docker compose ps`

## Critical Vulnerabilities (VULN-01 through VULN-06)
- **VULN-01** (backend/src/routes/auth.ts:117-132): JWT exposed in JSON response body. Fix: remove tokens from response, rely on httpOnly cookies.
- **VULN-02** (backend/prisma/schema.prisma:376-378): ApiLog stores raw requestBody/responseBody. Fix: sanitize or remove body fields from ApiLog model.
- **VULN-03** (casa-mx/.gitleaks.toml:32): .env.local in allowlist. Fix: remove from gitleaks path allowlist.
- **VULN-04** (backend/src/routes/auth.ts): No password reset endpoint. Fix: add /auth/forgot-password and /auth/reset-password routes.
- **VULN-05** (All backend routes): No CSRF protection. Fix: add CSRF token middleware.
- **VULN-06** (backend/.env): Secrets on disk. Fix: rotate keys, remove from disk.

## High Vulnerabilities (VULN-07 through VULN-18)
- **VULN-07** (components/map/createMarker.js:33): innerHTML XSS. Fix: use textContent or sanitize HTML.
- **VULN-08** (backend/src/routes/applications.ts:87): Zod type bypass with `(input as any)`. Fix: use proper Zod parsing.
- **VULN-09** (backend/src/routes/properties.ts:301,523): Zod type bypass. Fix: same as VULN-08.
- **VULN-12** (backend/src/routes/auth.ts:270): Logout missing `secure` flag. Fix: add `secure: true` to clearCookie.
- **VULN-13** (backend/src/app.ts:108): CSP disabled. Fix: enable Content-Security-Policy header.
- **VULN-14** (backend/Dockerfile): Container runs as root. Fix: add `USER node` directive.
- **VULN-15** (backend/docker-compose.yml:7): PostgreSQL port exposed. Fix: remove ports mapping or bind to 127.0.0.1 only.
- **VULN-16** (backend/docker-compose.yml:25): Redis no password. Fix: add Redis password.
- **VULN-17** (backend/docker-compose.yml:9-10,46): Hardcoded DB creds. Fix: use environment variables with defaults.

## Verification
After each fix:
- `npm test -- --run` (frontend tests)
- If backend: check `docker compose ps` for healthy services
- Verify no regressions in the changed endpoint/component
- Do NOT commit secrets or .env files

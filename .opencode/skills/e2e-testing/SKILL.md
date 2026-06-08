---
name: e2e-testing
description: Run and debug Playwright E2E tests with axe-core accessibility checks; handle CI-specific issues and flaky test patterns
license: MIT
compatibility: opencode
metadata:
  audience: developers
  workflow: testing
---

## What I do
- Run E2E tests: `npm run test:e2e:auto` (auto-starts dev server)
- Run tests with UI: `npm run test:e2e:headed`
- Debug flaky tests and redirect/auth hydration issues
- Run accessibility checks (axe-core integrated into E2E suite)
- Review Playwright reports and artifacts

## When to use me
Use when running, writing, or debugging E2E tests. Also when adding new features that affect user-facing flows.

## Commands
```bash
# Full E2E (auto-starts server)
npm run test:e2e:auto

# E2E with browser visible
npm run test:e2e:headed

# Specific test file with headed mode
npm run test:e2e:upload:headed

# Unit tests (faster, run first)
npm test -- --run
```

## Common Issues
- **Auth redirect loop**: Wait for auth hydration before asserting route content. Use `page.waitForURL()` with timeout.
- **Backend unavailable**: Verify `docker compose ps` shows healthy services before running E2E.
- **Flaky tests**: Playwright retries once in CI (`retries: 1`). Check for race conditions with `waitForSelector` or `waitForResponse`.
- **Browser binaries**: Run `npx playwright install --with-deps` if first time.

## Test Files
- `tests/e2e/a11y.spec.ts` - Accessibility checks
- `tests/e2e/map.spec.ts` - Map functionality
- `tests/e2e/production-smoke.spec.ts` - Production health checks
- `tests/e2e/publish-upload-live.spec.ts` - Property publishing
- `tests/e2e/rental-flow.spec.ts` - Rental application flow
- `tests/e2e/integrity.spec.ts` - Data integrity

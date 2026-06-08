# Project Instructions

## Before any code change

Ask the user: "Are we working on production or staging?"
- `staging` — work on staging branch (default if not specified)
- `production` — work on main branch (emergency fixes only)

## Automatic staging push

When making code changes on the `staging` branch, ALWAYS commit and push automatically — no need to ask. Vercel and Railway will auto-deploy staging for verification.

## Production deployment rule

NEVER push or merge to `main` (production) without the user explicitly directing you. The user must use a phrase like "merge to production", "push to live", "deploy to production", or "/deploy" before any production deployment occurs.

When changes on `staging` are ready for production, remind the user once (max), then wait for explicit confirmation.

## Emergency production fix sync

When a change is made directly to `main` (production emergency fix), automatically merge or cherry-pick it into `staging` afterward to keep branches in sync. Flag it if production has changes that aren't on staging.

## Reminders

- When staging changes are ready for production, remind the user once (max), then wait
- When production changes exist that aren't on staging, flag it

## Workflow

- Development: `staging` branch → auto-push → Vercel Preview + Railway Staging
- Emergency fix: `main` branch → auto-push → Vercel + Railway Production → sync to `staging`
- Merge: `staging` → `main` (requires explicit "merge to production")

## Repos

- Frontend: `C:\Users\axelj\casa-mx` → Vercel
- Backend: `C:\Users\axelj\casa-mx-backend` → Railway

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

## Docker
```bash
docker compose up -d --build
```

## Canonical References
- `README.md` for setup and architecture basics
- Frontend canonical project history: `../casa-mx/COMPLETE_PROJECT_DOCUMENTATION.md`

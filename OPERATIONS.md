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

## Canonical References
- `README.md` for setup and architecture basics
- Frontend canonical project history: `../casa-mx/COMPLETE_PROJECT_DOCUMENTATION.md`

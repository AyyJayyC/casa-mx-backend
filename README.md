# CASA MX Backend

Production-grade backend API for CASA MX property platform.

## Tech Stack

- **Node.js 18+** + TypeScript
- **Fastify** - High-performance web framework
- **Prisma** - Type-safe ORM
- **PostgreSQL** - Database
- **Vitest** - Testing framework
- **JWT** - Authentication
- **Zod** - Runtime validation

## Prerequisites

- Node.js 18+ LTS
- Docker (for PostgreSQL)
- npm or yarn

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Setup Environment

```bash
cp .env.example .env
# Edit .env with your configuration
```

### 3. Start PostgreSQL

```bash
docker-compose up -d
```

### 4. Run Migrations

```bash
npm run prisma:migrate
npm run prisma:generate
```

### 5. Seed Database

```bash
npm run prisma:seed
```

### 6. Start Development Server

```bash
npm run dev
```

Server will be available at `http://localhost:3001`

## Development

### Run Tests

```bash
npm test              # Run all tests
npm run test:watch    # Watch mode
```

## Debug Logging System

The backend includes a production-ready debug logging system that captures:

- User actions
- Client and server errors
- API request/response metadata

### Admin Endpoints

- GET /admin/debug/sessions
- GET /admin/debug/sessions/:id
- POST /admin/debug/sessions/:id/export
- PATCH /admin/debug/errors/:id/resolve
- DELETE /admin/debug/cleanup

### Database Commands

```bash
npm run prisma:migrate   # Run migrations
npm run prisma:generate  # Generate Prisma client
npm run prisma:seed      # Seed database
npm run prisma:studio    # Open Prisma Studio
```

### Build for Production

```bash
npm run build
npm start
```

## Project Structure

```
src/
├── config/          # Configuration (env, constants)
├── plugins/         # Fastify plugins (prisma, jwt, etc.)
├── routes/          # API routes
├── services/        # Business logic
├── schemas/         # Zod validation schemas
├── utils/           # Utility functions
├── app.ts           # Fastify app setup
└── server.ts        # Entry point

prisma/
├── schema.prisma    # Database schema
└── seed.ts          # Seed data

tests/               # Test files
```

## Checkpoints

This backend is built incrementally following Phase 4 checkpoints:

- ✅ **Checkpoint 0**: Backend Bootstrap
- ⏳ **Checkpoint 1**: Database Models & Migrations
- ⏳ **Checkpoint 2**: Authentication & Admin Bootstrap
- ⏳ **Checkpoint 3**: Authorization & Guards
- ⏳ **Checkpoint 4**: Admin Authority & Audit Logs
- ⏳ **Checkpoint 5**: Backend Analytics API
- ⏳ **Checkpoint 6**: Frontend Migration
- ⏳ **Checkpoint 7**: Hardening & Production Readiness

## Environment Variables

See `.env.example` for all required variables.

Key variables:
- `DATABASE_URL` - PostgreSQL connection string
- `JWT_SECRET` - Secret key for JWT signing (min 32 chars)
- `FRONTEND_URL` - Frontend origin for CORS

## License

MIT

# Stage 1: Build
FROM node:18-slim AS builder

WORKDIR /app

# Build-time placeholder for Prisma schema parsing
ARG DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder?schema=public"
ENV DATABASE_URL=${DATABASE_URL}

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install build dependencies
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Generate Prisma Client
RUN npx prisma generate

# Build TypeScript
RUN npm run build

# Stage 2: Production
FROM node:18-slim

WORKDIR /app

# Install curl and libssl for Prisma
RUN apt-get update && apt-get install -y curl libssl3 && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production

# Copy Prisma schema and migrations
COPY prisma ./prisma

# Copy pre-generated Prisma client from builder (avoids needing DATABASE_URL at build time)
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

# Copy built files from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src/data ./dist/data

# Expose port
EXPOSE 3001

# Run migrations and start server
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]

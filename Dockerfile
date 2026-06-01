FROM node:20-slim AS builder

WORKDIR /app

# Placeholder so Prisma can parse schema during image build.
ARG DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder?schema=public"
ENV DATABASE_URL=${DATABASE_URL}

# Switch to non-root user for building
RUN chown -R node:node /app
USER node

COPY --chown=node:node package*.json ./
COPY --chown=node:node tsconfig.json ./

RUN npm ci

COPY --chown=node:node . .

RUN npx prisma generate
RUN npm run build
# Cache bust — keep this line unique on each deploy to force rebuild
RUN echo "build:$(date +%s)" > /dev/null

FROM node:20-slim

WORKDIR /app

# Install runtime deps as root, then switch to non-root user
RUN apt-get update && apt-get install -y curl libssl3 && rm -rf /var/lib/apt/lists/*
RUN chown -R node:node /app
USER node

COPY package*.json ./
RUN npm ci --omit=dev

COPY prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/dist ./dist

EXPOSE 3001

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
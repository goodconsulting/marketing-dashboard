# syntax=docker/dockerfile:1.4

# ─── Stage 1: build ──────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

# Install native build tools for better-sqlite3
RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# Prune to prod deps only
RUN npm prune --production

# ─── Stage 2: runtime ────────────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app

# Install Caddy for TLS + Basic Auth edge
RUN apk add --no-cache caddy ca-certificates

# Copy production artifacts from builder
COPY --from=builder /app/dist          ./dist
COPY --from=builder /app/dist-server   ./dist-server
COPY --from=builder /app/node_modules  ./node_modules
COPY --from=builder /app/package.json  ./package.json

# Caddy config (basic auth + reverse proxy to node:3000) — provided by Task 6
COPY Caddyfile /etc/caddy/Caddyfile

# Start script: launch caddy + node concurrently
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

ENV NODE_ENV=production
ENV PORT=3000
ENV DB_PATH=/data/stack.db

# Fly's internal port (Caddy listens here)
EXPOSE 8080

CMD ["/docker-entrypoint.sh"]

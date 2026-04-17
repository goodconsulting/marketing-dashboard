# Production Deployment Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deploy the Stack Wellness marketing dashboard to `https://data.stackwellness.com` with HTTP Basic Auth and a Fly.io + Caddy + Node production stack.

**Architecture:** The app currently runs only as a Vite dev-server plugin. We extract the data API handler into a runtime-agnostic module, wrap it in an Express server for production, containerize with Docker, and deploy to Fly.io. Caddy sits in front as the TLS terminator + Basic Auth gate. SQLite lives on a persistent Fly volume. Monthly data updates are pushed from the user's Mac to the production volume via `fly ssh sftp`.

**Tech Stack:** Fly.io, Caddy 2, Node 20, Express 4, TypeScript 5.9, Docker (multi-stage). No changes to React/Vite frontend.

**Design reference:** [`docs/plans/2026-04-17-production-deployment-design.md`](./2026-04-17-production-deployment-design.md)

**Testing approach:** This codebase has no vitest/jest. Verification happens through:
1. `npx tsc --noEmit` — typecheck
2. `npm run build` — must produce `dist/` + `dist-server/`
3. Local smoke test: `npm start` + `curl http://localhost:3000/api/data/health` returns 200
4. Post-deploy: `curl -I https://data.stackwellness.com` returns 401 (auth gate), then with `-u stack:<pw>` returns 200

Prerequisite: user has a Fly.io account and `flyctl` installed (Task 0 handles that).

---

## Phase 0 — Prerequisites (user actions, then Claude verifies)

### Task 0: User signs up for Fly.io + installs flyctl

**This task is for the user, not the agent.** Skip if already done.

**Step 1: Sign up at fly.io**

Go to https://fly.io/signup. Credit card required for account verification but you won't be charged unless you exceed free-tier limits (~$5/month threshold you won't hit with a 3-user internal dashboard).

**Step 2: Install flyctl**

```bash
curl -L https://fly.io/install.sh | sh
```

Add the install path to your shell (the installer prints the exact line).

**Step 3: Authenticate**

```bash
fly auth login
```

Opens a browser, log in, returns to the terminal with "Successfully logged in."

**Step 4: Verify**

```bash
fly auth whoami
```

Expected: your Fly email address.

**Step 5: Pick your shared password**

Pick a 16+ character password that all 3 of you will share. Write it down somewhere Josh and Andy can retrieve it (1Password, Bitwarden, a sealed envelope, whatever). You'll hash it and commit the hash in Task 6.

Report back "Fly.io is set up" before proceeding to Task 1.

---

## Phase 1 — Extract the data API handler so it works outside Vite

### Task 1: Create `server/dataApiHandler.ts` that exports a runtime-agnostic request handler

**Context:** Today `server/viteDataPlugin.ts` defines all `/api/data/*` logic inside `configureServer(server) { server.middlewares.use(...) }`. The handler body is pure Node HTTP (`IncomingMessage` / `ServerResponse`) — not Vite-specific. We move that body to a new file and export it as a factory.

**Files:**
- Create: `server/dataApiHandler.ts`

**Step 1: Read the current plugin to understand what to extract**

Run: `grep -n 'async function handleDataRequest\|async function parseRawBody\|function parseJsonBody\|function json\|function getQuery' server/viteDataPlugin.ts`

Expected output: line numbers for 5 helpers + the `handleDataRequest` async function.

**Step 2: Create the new file with the extracted logic**

Create `server/dataApiHandler.ts`. Content:

```typescript
/**
 * Runtime-agnostic data API handler.
 *
 * Used by:
 *   - server/viteDataPlugin.ts   (development, via Vite middleware)
 *   - server/production.ts       (production, via Express)
 *
 * The handler takes a Node IncomingMessage + ServerResponse and routes
 * all /api/data/* requests. No Vite-specific dependencies.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  getHealthInfo,
  getUploadLog,
  getExpenses,
  getMetaCampaigns,
  getMetaAdSets,
  getGoogleCampaigns,
  getGoogleDaily,
  getToastSales,
  insertToastSales,
  getCRMCustomers,
  getLatestCRMCustomers,
  getMenuIntelligence,
  getIncentivioMetrics,
  getBudgets,
  getAnnualBudgetForYear,
  getOneLinkDaily,
  getDiscountSummary,
  getAmpCampaigns,
  getBillboardMonthly,
  getOtherCampaigns,
  getStageTransitions,
  getStageTransitionMatrix,
  getStageStats,
  getSetting,
  setSetting,
  clearAllData,
} from './db/queries.ts';
import { computeSnapshots } from './db/queries.ts';
import { stageUpload, confirmUpload, cancelUpload } from './api/uploadPipeline.ts';

function parseRawBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function parseJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      if (chunks.length === 0) { resolve(null); return; }
      try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
      catch (err) { reject(err); }
    });
    req.on('error', reject);
  });
}

function json(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function getQuery(url: string): URLSearchParams {
  const qIdx = url.indexOf('?');
  return new URLSearchParams(qIdx >= 0 ? url.substring(qIdx + 1) : '');
}

/**
 * Main request handler. Returns true if the request was handled (matched a
 * known /api/data/* route), false otherwise. Callers should fall through
 * to next middleware when false.
 */
export async function handleDataRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = req.url ?? '';
  const method = req.method ?? 'GET';
  const path = url.split('?')[0];
  const query = getQuery(url);

  if (!path.startsWith('/api/data/') && path !== '/api/data') return false;

  // === ORIGINAL HANDLER BODY FROM viteDataPlugin.ts GOES HERE ===
  // Copy EVERYTHING inside the original `async function handleDataRequest`
  // from the line `if (method === 'GET') {` down through the final
  // `json(res, 404, { error: 'Not found' });` — unchanged.
  // Keep using parseRawBody / parseJsonBody / json / getQuery from above.
  // (In production there's no dev-only proxy, but that's fine — the
  // dev-only routes simply won't be hit.)

  // For compactness in this plan, the engineer should copy lines
  // from server/viteDataPlugin.ts `handleDataRequest` verbatim here.

  return true; // if we reach this without returning earlier, we handled it
}
```

**Important:** DO NOT attempt to rewrite the routing logic. Literally copy the body of the existing `handleDataRequest` in `server/viteDataPlugin.ts` into this function. The only differences from the original:
- Returns `boolean` so callers can fall through on non-matches (handle the early-return case by returning `true`)
- Imports the helpers (parseRawBody etc.) from this same file instead of outer scope — they were moved up above the handler

**Step 3: Typecheck**

```bash
cd /Users/carsongoodale/Desktop/Stack/marketing-dashboard
npx tsc --noEmit
```

Expected: clean exit, 0 errors.

**Step 4: Commit**

```bash
git add server/dataApiHandler.ts
git commit -m "feat(server): extract data API handler into runtime-agnostic module"
```

---

### Task 2: Refactor `server/viteDataPlugin.ts` to delegate to the new handler

**Files:**
- Modify: `server/viteDataPlugin.ts`

**Step 1: Read current content**

```bash
wc -l server/viteDataPlugin.ts
```

~290 lines. Goal: shrink to ~30 lines, all routing logic delegated to `dataApiHandler.ts`.

**Step 2: Replace entire file content**

Overwrite `server/viteDataPlugin.ts` with:

```typescript
/**
 * Vite dev-mode wrapper around the shared data API handler.
 * Used only during `npm run dev`; production uses server/production.ts.
 */
import type { Plugin } from 'vite';
import { handleDataRequest } from './dataApiHandler.ts';
import { initializeDatabase } from './db/queries.ts';

export function dataPlugin(): Plugin {
  return {
    name: 'stack-data-api',
    configureServer(server) {
      initializeDatabase();
      server.middlewares.use(async (req, res, next) => {
        try {
          const handled = await handleDataRequest(req, res);
          if (!handled) next();
        } catch (err) {
          console.error('[Data API]', err);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: String(err) }));
        }
      });
      console.log('[Data API] SQLite initialized — database ready');
      console.log('[Data API] Routes mounted at /api/data/*');
    },
  };
}
```

**Step 3: Verify `initializeDatabase` is exported from queries.ts**

```bash
grep -n 'export function initializeDatabase' server/db/queries.ts
```

Expected: at least one match. If not exported, add `export` keyword to the existing function.

**Step 4: Typecheck + dev-server smoke test**

```bash
npx tsc --noEmit
```

Expected: clean.

```bash
# Kill any existing dev server first
kill $(lsof -ti:5173) 2>/dev/null || true
sleep 1
npm run dev > /tmp/smoke.log 2>&1 &
sleep 5
curl -s http://localhost:5173/api/data/health | head -c 200
```

Expected: JSON response with `"status":"ok"` and a `"tables"` array.

**Step 5: Commit**

```bash
git add server/viteDataPlugin.ts
git commit -m "refactor(server): vite plugin delegates to shared data API handler"
```

---

## Phase 2 — Build a production Node server

### Task 3: Create `server/production.ts`

**Files:**
- Create: `server/production.ts`

**Step 1: Install Express**

```bash
npm install express
npm install -D @types/express
```

**Step 2: Create the production entry file**

```typescript
/**
 * Production Node + Express server.
 *
 * Serves the built React frontend from `dist/` and mounts the shared data
 * API handler at /api/data/*. Used in the Fly.io Docker image.
 *
 * Environment:
 *   PORT    (default: 3000)
 *   DB_PATH (default: ./data/stack.db; prod uses /data/stack.db)
 */
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleDataRequest } from './dataApiHandler.js';
import { initializeDatabase } from './db/queries.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Resolve dist/ relative to this file's location in dist-server/
const DIST_DIR = path.resolve(__dirname, '..', 'dist');
const PORT = Number(process.env.PORT) || 3000;

// Ensure DB is initialized (creates tables if missing)
initializeDatabase();

const app = express();

// Data API
app.use(async (req, res, next) => {
  try {
    const handled = await handleDataRequest(req, res);
    if (!handled) next();
  } catch (err) {
    console.error('[Data API]', err);
    res.status(500).json({ error: String(err) });
  }
});

// Static React bundle
app.use(express.static(DIST_DIR, { maxAge: '1h' }));

// SPA fallback: anything not matched above serves index.html so client-side
// routing works.
app.get('*', (_req, res) => {
  res.sendFile(path.join(DIST_DIR, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`[prod] Stack dashboard listening on :${PORT}`);
  console.log(`[prod] Serving static files from ${DIST_DIR}`);
  console.log(`[prod] DB_PATH = ${process.env.DB_PATH ?? 'default'}`);
});
```

**Step 3: Note the `.js` extensions in imports**

TypeScript compiled to ESM must import with `.js` (even though the source is `.ts`). That's why the imports in `server/production.ts` use `.js`. Don't let this confuse you — it works because `tsc` will compile `dataApiHandler.ts` to `dataApiHandler.js`.

**Step 4: Typecheck**

```bash
npx tsc --noEmit
```

Expected: clean.

**Step 5: Commit**

```bash
git add server/production.ts package.json package-lock.json
git commit -m "feat(server): add Express entry point for production"
```

---

### Task 4: Add `tsconfig.server.json` + build scripts

**Files:**
- Create: `tsconfig.server.json`
- Modify: `package.json`
- Modify: `.gitignore`

**Step 1: Create tsconfig.server.json**

```json
{
  "extends": "./tsconfig.node.json",
  "compilerOptions": {
    "outDir": "./dist-server",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "target": "ES2022",
    "declaration": false,
    "sourceMap": false,
    "noEmit": false,
    "rootDir": "./server",
    "allowImportingTsExtensions": false
  },
  "include": ["server/**/*.ts"],
  "exclude": ["server/viteDataPlugin.ts"]
}
```

Note: we exclude `viteDataPlugin.ts` because it imports Vite types which aren't needed in production.

**Step 2: Update package.json scripts**

Open `package.json`. In the `scripts` object, keep existing entries and modify/add these:

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build && npm run build:server",
    "build:server": "tsc -p tsconfig.server.json",
    "start": "node dist-server/production.js",
    "push-data": "bash scripts/push-to-prod.sh",
    "lint": "eslint .",
    "preview": "vite preview"
  }
}
```

Also add `"type": "module"` at the package.json top level if it's not already there (check with `grep '"type"' package.json`). Express + ESM requires this.

**Step 3: Update .gitignore**

Append:
```
# Production build artifacts
dist-server/
```

**Step 4: Build + smoke test**

```bash
rm -rf dist dist-server
npm run build 2>&1 | tail -20
```

Expected: builds succeed, creates `dist/` (React) and `dist-server/` (compiled server). No errors.

```bash
ls dist-server/
```

Expected: at least `production.js`, `dataApiHandler.js`, `db/`, `api/`, `types.js`.

```bash
kill $(lsof -ti:3000) 2>/dev/null || true
DB_PATH=./data/stack.db PORT=3000 npm start > /tmp/prod-smoke.log 2>&1 &
sleep 3
curl -s http://localhost:3000/api/data/health | head -c 300
```

Expected: JSON health response with tables array.

```bash
curl -s http://localhost:3000/ | head -c 300
```

Expected: the index.html bundle.

Kill the server:
```bash
kill $(lsof -ti:3000)
```

**Step 5: Commit**

```bash
git add tsconfig.server.json package.json .gitignore
git commit -m "build: add prod server tsconfig + build/start scripts"
```

---

## Phase 3 — Containerize with Docker + Caddy

### Task 5: Create `Dockerfile` and `.dockerignore`

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`

**Step 1: Create Dockerfile**

```dockerfile
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

# Caddy config (basic auth + reverse proxy to node:3000)
COPY Caddyfile /etc/caddy/Caddyfile

# Start script: launch caddy + node concurrently
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

ENV NODE_ENV=production
ENV PORT=3000
ENV DB_PATH=/data/stack.db

# Fly's internal port Caddy listens on
EXPOSE 8080

CMD ["/docker-entrypoint.sh"]
```

**Step 2: Create docker-entrypoint.sh**

```bash
#!/bin/sh
set -e
echo "[entrypoint] starting node on :$PORT"
node dist-server/production.js &
NODE_PID=$!

echo "[entrypoint] starting caddy"
caddy run --config /etc/caddy/Caddyfile --adapter caddyfile &
CADDY_PID=$!

# Wait for either to die
wait -n
kill -TERM $NODE_PID $CADDY_PID 2>/dev/null || true
exit 1
```

**Step 3: Create .dockerignore**

```
node_modules
npm-debug.log
dist
dist-server
data
.git
.env
.env.local
.DS_Store
.vscode
.worktrees
docs
*.md
scripts/test-*.cjs
```

Note: we exclude `data/` because the production DB lives on a Fly volume, not in the image. Ingest scripts and test fixtures are also excluded.

**Step 4: Commit (don't build yet — Caddy config comes next)**

```bash
git add Dockerfile docker-entrypoint.sh .dockerignore
git commit -m "build: add Dockerfile with Node + Caddy runtime"
```

---

### Task 6: Create Caddyfile with Basic Auth

**Files:**
- Create: `Caddyfile`

**Step 1: Generate bcrypt hash of your chosen password**

Use the Caddy docker image to hash your password (no local Caddy install needed):

```bash
docker run --rm caddy:2-alpine caddy hash-password --plaintext '<YOUR_CHOSEN_PASSWORD>'
```

Expected output: a `$2a$14$...` bcrypt string. **Copy this string.** It's safe to commit; bcrypt hashes aren't reversible.

Alternatively if you have Caddy installed locally:
```bash
caddy hash-password --plaintext '<YOUR_CHOSEN_PASSWORD>'
```

**Step 2: Create Caddyfile**

Replace `PASTE_HASH_HERE` below with the bcrypt string from Step 1.

```
{
    admin off
    auto_https off
}

:8080 {
    basicauth {
        stack PASTE_HASH_HERE
    }

    reverse_proxy localhost:3000

    encode gzip zstd

    log {
        output stdout
        format console
        level INFO
    }
}
```

Important notes:
- `admin off` — disables Caddy's management API (not needed, reduces surface)
- `auto_https off` — Fly provides HTTPS at the edge; Caddy inside the container listens plain HTTP on :8080
- The `stack` username is fixed; the shared password is what you distribute to Josh + Andy

**Step 3: Commit**

```bash
git add Caddyfile
git commit -m "build: add Caddyfile with HTTP Basic Auth"
```

---

## Phase 4 — Fly.io deployment config

### Task 7: Create `fly.toml` + run `fly launch` (without deploying)

**Files:**
- Create: `fly.toml`

**Step 1: Create fly.toml**

```toml
app = "stack-dashboard"
primary_region = "ord"

[build]

[[mounts]]
  source = "data"
  destination = "/data"
  initial_size = "1gb"

[env]
  NODE_ENV = "production"
  DB_PATH = "/data/stack.db"
  PORT = "3000"

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = "stop"
  auto_start_machines = true
  min_machines_running = 0

[[vm]]
  size = "shared-cpu-1x"
  memory = "512mb"
```

**Step 2: Create the Fly app (this only registers the name — doesn't deploy yet)**

```bash
fly apps create stack-dashboard
```

Expected: `New app created: stack-dashboard`. If the name is taken (very unlikely), change `app = "stack-dashboard"` in fly.toml to something like `stack-dashboard-iowa` and retry.

**Step 3: Create the persistent volume**

```bash
fly volumes create data --region ord --size 1
```

Expected: volume created with ID `vol_...`. Confirm with `y` when prompted about single-region redundancy.

**Step 4: Commit**

```bash
git add fly.toml
git commit -m "build: add fly.toml for stack-dashboard deployment"
```

---

### Task 8: First deploy

**No code changes in this task** — just running the deploy.

**Step 1: Deploy**

```bash
fly deploy
```

This takes 5–10 minutes the first time (builds Docker image, pushes to Fly's registry, boots VM).

Expected final output: `checks: passed` and a URL like `https://stack-dashboard.fly.dev`.

**Step 2: Verify the deployment works WITHOUT the custom domain yet**

```bash
curl -I https://stack-dashboard.fly.dev
```

Expected: `HTTP/2 401` with `WWW-Authenticate: Basic realm="restricted"`.

```bash
curl -I -u 'stack:<YOUR_PASSWORD>' https://stack-dashboard.fly.dev
```

Expected: `HTTP/2 200` and HTML content-type.

If step 2 gets 502 or 503, something's wrong. Check `fly logs` and report back.

**Step 3: Push the current SQLite database to the production volume**

```bash
# From the marketing-dashboard directory
fly ssh sftp shell
# At the sftp> prompt:
put data/stack.db /data/stack.db
quit
```

Then restart the app so it picks up the new DB:
```bash
fly apps restart stack-dashboard
```

Expected: restart completes in ~30 seconds.

**Step 4: Verify the dashboard loads real data**

```bash
curl -s -u 'stack:<YOUR_PASSWORD>' 'https://stack-dashboard.fly.dev/api/data/health' | head -c 300
```

Expected: JSON with at least 10 tables listed and non-zero row counts (`fact_crm_customer_snapshot` should have ~29,000 rows).

**No git commit** — this is a deploy action, no files changed.

---

## Phase 5 — DNS + custom domain

### Task 9: Add CNAME at GoDaddy + tell Fly about the domain

**This task requires browser access to GoDaddy.**

**Step 1: Get the Fly-assigned IPv4 and IPv6 addresses**

```bash
fly ips list
```

Expected: a list of IP addresses for your app. You'll see one IPv4 and one IPv6 allocated.

**Step 2: Tell Fly you want the custom domain**

```bash
fly certs create data.stackwellness.com
```

Expected output: DNS verification instructions showing you need a `CNAME` (or `A + AAAA`) pointing `data.stackwellness.com` to your Fly app.

**Step 3: Add the CNAME at GoDaddy**

1. Log in to GoDaddy.
2. Go to "My Products" → find `stackwellness.com` → click "DNS"
3. Under the "Records" section, click "Add New Record"
4. Configure:
   - **Type:** `CNAME`
   - **Name:** `data`
   - **Value:** `stack-dashboard.fly.dev`
   - **TTL:** `1 Hour`
5. Save

**Step 4: Wait for DNS propagation (5–30 min usually, occasionally up to 1 hour)**

Check propagation:
```bash
dig +short data.stackwellness.com
```

Expected: eventually resolves to an IP (Fly's edge IP). If it returns empty or an old result, wait + retry.

**Step 5: Verify Fly has issued the TLS certificate**

```bash
fly certs show data.stackwellness.com
```

Expected: `Issued: Yes`. Fly auto-requests Let's Encrypt certs once DNS points correctly.

**Step 6: Verify end-to-end**

```bash
curl -I https://data.stackwellness.com
```

Expected: `HTTP/2 401` with the basic auth challenge.

```bash
curl -I -u 'stack:<YOUR_PASSWORD>' https://data.stackwellness.com
```

Expected: `HTTP/2 200`.

Open `https://data.stackwellness.com` in a browser. Expected behavior:
1. Browser prompts for username + password
2. After entering credentials, the dashboard loads
3. All pages render with real data (you should see March 2026 spend, customer counts, etc.)

**No git commit** — this is a DNS + deploy action.

---

## Phase 6 — Monthly data-sync workflow

### Task 10: Create `scripts/push-to-prod.sh`

**Files:**
- Create: `scripts/push-to-prod.sh`

**Step 1: Create the script**

```bash
#!/usr/bin/env bash
# Sync local data/stack.db to production Fly volume.
# Run this after each monthly ingest session.
set -euo pipefail

cd "$(dirname "$0")/.."
echo "→ Running local build to catch any regressions"
npm run build > /dev/null
echo "✓ Build passed"

echo "→ Uploading data/stack.db to prod volume"
fly ssh sftp shell <<EOF
put data/stack.db /data/stack.db
quit
EOF

echo "→ Restarting prod app to drop cached DB connections"
fly apps restart stack-dashboard

echo ""
echo "✅ Pushed. Verify at https://data.stackwellness.com"
echo "   Expected: current local data visible within 30 seconds"
```

**Step 2: Make it executable**

```bash
chmod +x scripts/push-to-prod.sh
```

**Step 3: Smoke-test the script**

```bash
./scripts/push-to-prod.sh
```

Expected: prints "Build passed" → "Uploading" → "Restarting" → success message. Total time ~30–60 seconds.

**Step 4: Commit**

```bash
git add scripts/push-to-prod.sh
git commit -m "ops: add push-to-prod.sh for monthly data sync"
```

---

## Phase 7 — Verification + handoff

### Task 11: Document ops runbook (`docs/OPS.md`)

**Files:**
- Create: `docs/OPS.md`

**Step 1: Create the runbook**

```markdown
# Stack Dashboard — Ops Runbook

## Production URL
https://data.stackwellness.com

## Login
- **Username:** `stack`
- **Password:** stored in 1Password / shared credential vault

## Monthly update workflow (user only)

1. Run ingest locally as usual (`npm run dev`, upload CSVs, or run `.cjs` scripts).
2. Verify locally via `http://localhost:5173` — spot-check the month's numbers.
3. Push to prod:
   ```bash
   cd ~/Desktop/Stack/marketing-dashboard
   npm run push-data
   ```
4. Verify at https://data.stackwellness.com within 30 seconds.

## Code deploy workflow (rare — only for feature/bugfix ships)

```bash
cd ~/Desktop/Stack/marketing-dashboard
fly deploy
```

## Common operations

### View prod logs
```bash
fly logs
```

### Restart the app
```bash
fly apps restart stack-dashboard
```

### SSH into the running VM
```bash
fly ssh console
```

### Rotate the shared password

1. Pick new password
2. Generate hash: `docker run --rm caddy:2-alpine caddy hash-password --plaintext '<NEW_PASSWORD>'`
3. Update `Caddyfile` with new hash
4. `git commit -am "ops: rotate prod shared password"` + `fly deploy`
5. Tell Josh + Andy the new password

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| 502 Bad Gateway | Node crashed inside container | `fly logs` to see stack trace; `fly apps restart` |
| 401 repeats after correct password | Browser cached bad auth | Clear saved credential or use incognito |
| Dashboard shows stale data | DB wasn't pushed or app didn't restart | Re-run `npm run push-data` |
| Login works but pages are blank | Frontend build broke on last deploy | `fly logs` for JS errors; `fly deploy` with previous commit |

## Cost monitoring

Fly bills monthly. Expected cost: $2–5/month.

Check usage: https://fly.io/dashboard/billing

If a month goes over $10, investigate — we have a 3-user read-only dashboard, it should never exceed that.
```

**Step 2: Commit**

```bash
git add docs/OPS.md
git commit -m "docs: add ops runbook for prod dashboard"
```

---

### Task 12: End-to-end verification checklist

**No code changes in this task.** Run through this checklist and report status.

**Step 1: Basic reachability**

- [ ] `curl -I https://data.stackwellness.com` returns `401` — auth gate working
- [ ] `curl -I -u stack:<pw> https://data.stackwellness.com` returns `200` — auth passes
- [ ] `curl -u stack:<pw> https://data.stackwellness.com/api/data/health` returns healthy JSON
- [ ] Browser opens URL, gets auth prompt, enters credentials, dashboard loads

**Step 2: Data integrity**

- [ ] Overview tab shows March 2026 spend = $33.1K
- [ ] Customer Health shows 6,813 active accounts, 27.9% churn rate
- [ ] Performance → Mar 2026 → Channel Summary shows 5 channels (Meta, Google, Yelp, AMP CTV with $1.7K spend, Lamar OOH)
- [ ] CAC & ROI shows Est ROI ~14.5x, Projected LTV $301
- [ ] CAC & ROI → Discount trend shows Jan 12.1% / Feb 11.0% / Mar 11.4%

**Step 3: Multi-browser check**

- [ ] Loads + renders in Chrome desktop
- [ ] Loads + renders in Safari desktop
- [ ] Loads + renders on mobile (Safari iOS or Chrome Android)

**Step 4: Data-push workflow**

- [ ] Make a trivial change locally (e.g., run a small DB UPDATE)
- [ ] Run `npm run push-data`
- [ ] Within 30 seconds, the change is visible in the prod dashboard
- [ ] Revert the local change if it was purely for testing

**Step 5: Hand credentials to Josh + Andy**

- [ ] Josh has the URL + username + password
- [ ] Andy has the URL + username + password
- [ ] Confirmed each can log in from their laptop

**Step 6: Commit nothing — this is the done line**

Report: "Deployment complete, all checklist items pass, shared credentials with Josh and Andy."

---

## Done criteria

- [ ] All Tasks 1–12 complete
- [ ] `https://data.stackwellness.com` reachable with valid TLS
- [ ] Basic Auth prompt working (401 without creds, 200 with creds)
- [ ] All dashboard tabs render with real March 2026 data
- [ ] `npm run push-data` roundtrip verified (local → prod in < 60s)
- [ ] `docs/OPS.md` in repo
- [ ] Monthly cost stays under $5
- [ ] Josh and Andy have logged in successfully

---

## Notes for the executing engineer

1. **The biggest risk is Task 1** (extracting `handleDataRequest` from viteDataPlugin.ts into a reusable handler). Copy the body verbatim — don't try to rewrite. If typecheck fails, the issue is almost always a missing import at the top of the new file.
2. **ESM is the default.** Once `"type": "module"` is added to package.json, all `.js` imports must include the file extension. That's why `server/production.ts` imports `./dataApiHandler.js` (not `.ts` — TS compiles to JS, then Node runs the JS).
3. **better-sqlite3 is a native module.** The Dockerfile installs `python3 make g++` for Alpine so `npm ci` can rebuild it. Don't remove those.
4. **Fly's free tier allocates 3 shared-cpu-1x VMs and 3GB persistent storage.** You'll use ~1/3 of that for this dashboard. Billing alerts are already at the platform level.
5. **The database on prod is a COPY of local; there's no merge.** If you run ingest on prod and on local independently, they diverge. Don't do that. Local is always the source of truth.
6. **Vite dev in Task 2 smoke test:** if `npm run dev` doesn't start because port 5173 is held, `kill $(lsof -ti:5173)` first.
7. **If the bcrypt hash has a `$` in it and you paste it to shell**, Bash will try to expand it. Single-quote the whole thing. The hash is safe to commit directly in the Caddyfile once it's in place.

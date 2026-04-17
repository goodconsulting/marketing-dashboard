# Production Deployment — Design

**Date:** 2026-04-17
**Trigger:** User wants to share the dashboard with Josh (CEO) and Andy (CFO) at a persistent URL `data.stackwellness.com` with password protection.
**Audience:** 3 internal users. Read-only for Josh + Andy; admin/ingest stays local.

## Goals

1. **Ship a production build** of the dashboard to a persistent URL `https://data.stackwellness.com`.
2. **Password-protect access** via HTTP Basic Auth at the edge (no app-level auth code, shared credential for v1).
3. **Preserve local ingest workflow.** User continues ingesting data on their Mac via the existing `.cjs` scripts and CSV uploads; production receives periodic SQLite file pushes.
4. **Cheap, reliable, minimal ops burden.** ≤ $5/month hosting, auto-HTTPS, one-command deploy.
5. **Reversible auth upgrade.** Shared-password today; Cloudflare Access upgrade path documented but not built.

## Non-goals

- Per-user accounts, audit logging, or SSO (deferred to later — "Cloudflare Access migration" noted as future work).
- Moving ingest to production (user explicitly chose Option A — local ingest, push artifact).
- CI/CD pipelines, preview environments, or automated tests in prod (overkill for 3-user internal dashboard).
- Real-time data sync from local to prod (monthly cadence is fine; manual push via `fly ssh sftp`).

## Chosen stack

| Layer | Tool | Reason |
|---|---|---|
| Host | **Fly.io** | Stateful SQLite-friendly, persistent volumes, free HTTPS, scales to zero, ~$0–5/mo |
| Runtime | **Node 20 + Express** | Replaces Vite dev middleware; hosts built React + API routes |
| Edge / TLS / Auth | **Caddy 2** | TLS termination + HTTP Basic Auth via a ~20-line Caddyfile |
| DB | **SQLite (local file)** | Unchanged from dev; mounted from Fly persistent volume |
| DNS | **GoDaddy** | Add CNAME `data.stackwellness.com` → `<fly-app>.fly.dev` |

**Rejected alternatives:**
- **Vercel / Netlify / Cloudflare Pages** — serverless-first, painful for persistent SQLite.
- **Railway / Render** — both work but Fly is cheaper for this workload at scale zero.
- **Custom VPS** (DigitalOcean droplet) — more ops burden for no benefit at 3 users.

## Architecture

```
Josh / Andy / user
       │
       ▼
data.stackwellness.com  (GoDaddy DNS: CNAME → stack-dashboard.fly.dev)
       │
       ▼ HTTPS (Let's Encrypt, auto-managed by Fly+Caddy)
  ┌──────────────────────────────────────────┐
  │ Fly.io VM (256MB–1GB RAM, shared-cpu-1x) │
  │                                          │
  │   Caddy :443                             │
  │     ├─ TLS termination                   │
  │     ├─ HTTP Basic Auth (username: stack) │
  │     └─ reverse_proxy :3000               │
  │                                          │
  │   Node server :3000                      │
  │     ├─ GET /* → static dist/             │
  │     ├─ GET /api/data/* → data API        │
  │     └─ (reads) data/stack.db             │
  │                                          │
  │   Persistent volume /data                │
  │     └─ stack.db (writable)               │
  └──────────────────────────────────────────┘
```

## Components

### 1. Production Node server (new file: `server/production.ts`)

Today's `/api/data/*` routes run inside Vite dev middleware. Extract the handler into a pure request-handler module, then mount it in a thin Express server for production.

Shape:
```ts
import express from 'express';
import path from 'node:path';
import { createDataApiHandler } from './dataApiHandler.ts'; // refactored from viteDataPlugin.ts

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const DIST = path.resolve('dist');
const DB_PATH = process.env.DB_PATH || path.resolve('data/stack.db');

// API
app.use('/api/data', createDataApiHandler(DB_PATH));

// Static SPA fallback
app.use(express.static(DIST));
app.get('*', (_, res) => res.sendFile(path.join(DIST, 'index.html')));

app.listen(PORT, () => console.log(`prod server on :${PORT}, db=${DB_PATH}`));
```

### 2. Extracted data API handler

The Vite plugin's request-handling logic (routing, JSON parsing, query fn calls) is already self-contained. Refactor `server/viteDataPlugin.ts` → `server/dataApiHandler.ts` + `server/viteDataPlugin.ts` (thin wrapper that calls the new handler). No behavior change.

### 3. Dockerfile

Multi-stage build:
- Stage 1: `node:20-alpine` — install deps, run `npm run build` (Vite + server TS compile)
- Stage 2: slim runtime — copy `dist/`, `dist-server/`, `node_modules` (prod-only), `package.json`
- `CMD ["node", "dist-server/production.js"]`

### 4. `fly.toml`

```toml
app = "stack-dashboard"
primary_region = "ord"   # Chicago, closest to Cedar Rapids

[build]

[[mounts]]
  source = "data"
  destination = "/data"

[env]
  DB_PATH = "/data/stack.db"
  NODE_ENV = "production"

[[services]]
  internal_port = 3000
  protocol = "tcp"
  [[services.ports]]
    port = 443
    handlers = ["tls", "http"]
  [[services.ports]]
    port = 80
    handlers = ["http"]
```

### 5. Caddyfile (sits in front of Node in the Fly VM)

```
data.stackwellness.com {
    basicauth {
        stack <BCRYPT_HASH>
    }
    reverse_proxy localhost:3000
    encode gzip
}
```

The `<BCRYPT_HASH>` is generated once locally via `caddy hash-password`, committed to the Caddyfile, and redeployed. Password rotation = regenerate + redeploy.

**Alternative considered:** run basic auth as Express middleware instead of Caddy. Rejected because Caddy handles it at the edge before any Node process runs — cleaner separation, and the auth never sees the DB. Also, if we later upgrade to Cloudflare Access, swapping Caddy → Access is one config change; Express middleware would have to be removed separately.

### 6. `scripts/push-to-prod.sh` (new) — local-to-prod data sync

```bash
#!/bin/bash
set -euo pipefail
echo "→ Verifying local build passes"
npm run build
echo "→ Pushing data/stack.db to prod volume"
fly ssh sftp shell <<< "put data/stack.db /data/stack.db"
echo "→ Restarting prod instance"
fly machine restart
echo "✅ Pushed. Dashboard at https://data.stackwellness.com"
```

Run after each local ingest session. 10-second sync.

### 7. `package.json` changes

```json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build && tsc -p tsconfig.server.json",
    "start": "node dist-server/production.js",
    "push-data": "bash scripts/push-to-prod.sh"
  }
}
```

New `tsconfig.server.json` for compiling `server/*.ts` → `dist-server/*.js` (separate from the existing `tsconfig.node.json` which is for dev-time config).

## DNS (GoDaddy)

After `fly launch` assigns an app name (e.g. `stack-dashboard.fly.dev`):

1. Log in to GoDaddy → My Products → DNS for `stackwellness.com`
2. Add record:
   - Type: `CNAME`
   - Name: `data`
   - Value: `stack-dashboard.fly.dev`
   - TTL: 1 hour (default fine)
3. In the Fly CLI: `fly certs add data.stackwellness.com` — Fly issues a Let's Encrypt cert automatically once DNS propagates (~5–30 min).
4. Verify: `curl -I https://data.stackwellness.com` should return 401 Unauthorized (auth working) with a valid TLS cert.

## Security posture

| Concern | Mitigation |
|---|---|
| PII in CRM (emails, DOB, spend) | HTTPS edge, basic auth, private hosting. Data never leaves Fly + your Mac. |
| Password leak | Single shared credential — rotate quarterly. Future: upgrade to CF Access (per-user). |
| Accidental public exposure | Caddy basic auth is enforced at port 443 before any request reaches Node. If auth is misconfigured, Caddy refuses to start — fails closed, not open. |
| Database corruption mid-push | SQLite WAL mode; `fly ssh sftp put` is atomic via temp file + rename. Worst case: restart recovers. |
| Secrets in repo | Caddyfile has a bcrypt hash, not plaintext. The hash is public-safe (can't be reversed). But we'll `.env`-gate the password anyway for good hygiene. |

## Known limitations (accepted, documented)

1. **No per-user audit log.** All three users share `stack` as their username. Access logs can't distinguish who viewed what. Upgrade: Cloudflare Access (10 min, zero code).
2. **Password rotation requires redeploy.** Not a passwords-in-env-vars setup because the Caddyfile format bakes the hash in. Future: read from Fly secrets (`--basicauth-from-env`).
3. **Data is manually pushed.** Josh and Andy see data as-of-your-last-push. No automation. Acceptable for monthly reporting cadence.
4. **No preview/staging environment.** Single prod environment. If a deploy breaks, Josh/Andy see the breakage. Mitigation: `npm run build` step in `push-to-prod.sh` catches most issues before they ship.
5. **No automatic DB backup.** Fly volume has no snapshots by default. Mitigation: the DB IS already backed up — you have the authoritative copy on your Mac. Document that "local is canonical; prod is a view."

## Cost estimate

| Item | Monthly |
|---|---|
| Fly shared-cpu-1x machine (scales to zero when idle) | ~$0–2 |
| Fly persistent volume (1 GB; using ~15 MB) | ~$0.15 |
| Fly outbound bandwidth (very low traffic) | $0 |
| **Total** | **~$2–5/month** |

Free tier credits often cover it entirely. No surprise charges — Fly has hard caps on free allocations.

## File manifest

### New files
- `server/production.ts` — Express entry point for prod
- `server/dataApiHandler.ts` — extracted data API router (shared with Vite plugin)
- `Dockerfile`
- `fly.toml`
- `Caddyfile`
- `scripts/push-to-prod.sh`
- `tsconfig.server.json`
- `.dockerignore`

### Modified files
- `server/viteDataPlugin.ts` — becomes a thin wrapper calling `dataApiHandler`
- `package.json` — new `start`, `build`, `push-data` scripts
- `.gitignore` — add `dist-server/`

### Untouched
- All React source (`src/**`)
- All DB schema and query code (`server/db/**`)
- All ingest scripts (`scripts/ingest-*`, `scripts/backfill-*`, etc.)

## Success criteria

- [ ] `https://data.stackwellness.com` returns a TLS-verified page with a valid Let's Encrypt cert.
- [ ] Visiting the URL prompts for basic-auth credentials (browser dialog).
- [ ] After auth, dashboard loads identically to local `npm run dev` view.
- [ ] `npm run push-data` ships updated `stack.db` to prod in < 30 seconds.
- [ ] Cost stays under $5/month.
- [ ] Josh and Andy can access from laptops, phones, and at minimum Chrome + Safari.

## Migration to Cloudflare Access (future work, not in this PR)

When ready to upgrade auth:
1. Put stackwellness.com DNS behind Cloudflare (requires moving nameservers from GoDaddy).
2. Create a Cloudflare Access Application for `data.stackwellness.com`.
3. Add access policy: allow email addresses matching a list.
4. Remove `basicauth` block from Caddyfile, redeploy.
5. Cloudflare now gates the dashboard at DNS level; any request that reaches Fly has a valid user.

~1 hour of work, no app changes. Safe to defer.

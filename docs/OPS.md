# Stack Dashboard — Ops Runbook

## Production URL
https://data.stackwellness.com

## Login
- **Username:** `stack`
- **Password:** stored in 1Password / shared credential vault
- All three users (Carson, Josh, Andy) use the same credentials.

## Infrastructure at a glance

| Component | Location | Notes |
|---|---|---|
| App | Fly.io app `stack-dashboard` (region `ord`) | shared-cpu-1x, 512MB, auto-stops when idle |
| DB | Fly persistent volume `data` at `/data/stack.db` | 1GB volume, daily snapshots retained 5 days |
| TLS | Let's Encrypt via Fly | Auto-renews |
| DNS | GoDaddy CNAME: `data.stackwellness.com` → `26p50m5.stack-dashboard.fly.dev` | |
| Auth | Caddy HTTP Basic Auth at edge | Single shared credential; bcrypt cost 14 |

---

## Monthly data update workflow (Carson only)

1. Run ingest locally as usual:
   ```bash
   cd ~/Desktop/Stack/marketing-dashboard
   npm run dev
   # use the Upload Data tab or run .cjs ingest scripts as needed
   ```
2. Verify locally at http://localhost:5173 — spot-check the month's numbers.
3. Push to prod:
   ```bash
   npm run push-data
   ```
4. Verify at https://data.stackwellness.com within 30 seconds (the machine restarts to drop cached DB connections).

## Code deploy workflow (rare — only for feature or bugfix ships)

```bash
cd ~/Desktop/Stack/marketing-dashboard
fly deploy
```

Fly builds the Docker image remotely, swaps machines with zero-downtime rolling deploy, auto-verifies the new machine is healthy before terminating the old one.

---

## Common operations

### View prod logs
```bash
fly logs                        # follow live
fly logs --no-tail              # last 100 lines, no follow
```

### Restart the app
```bash
fly apps restart stack-dashboard
```

### SSH into the running VM
```bash
fly ssh console
# or run a one-shot command:
fly ssh console -C 'ls /data'
```

### Check machine state
```bash
fly status
fly machine list
```

### Rotate the shared password

1. Pick a new password (16+ chars).
2. Generate a bcrypt hash locally:
   ```bash
   node -e "console.log(require('bcryptjs').hashSync(process.argv[1], 14));" 'NEW_PASSWORD_HERE'
   ```
   (bcryptjs is already in the project's devDependencies.)
3. Replace the hash in `Caddyfile` (the line under `basicauth { stack ... }`).
4. Commit + deploy:
   ```bash
   git add Caddyfile
   git commit -m "ops: rotate prod shared password"
   fly deploy
   ```
5. Distribute the new password to Josh + Andy out-of-band (1Password, Signal, etc).

### Rotate the TLS certificate
Automatic — Fly renews Let's Encrypt certs ~30 days before expiry. No action required.
Manual force-renew if ever needed:
```bash
fly certs check data.stackwellness.com
```

### Download a backup of the prod DB
```bash
echo 'get /data/stack.db data/stack-prod-$(date +%Y%m%d).db' | fly ssh sftp shell
```
Also: Fly retains 5 daily volume snapshots automatically — see https://fly.io/dashboard/stack-dashboard/volumes

### Clean shutdown (e.g., maintenance window)
```bash
fly scale count 0          # stops the machine
# later:
fly scale count 1          # starts it back up
```

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `502 Bad Gateway` at data.stackwellness.com | Node crashed inside container | `fly logs` to read the stack trace; `fly apps restart stack-dashboard` |
| `401` repeats after entering correct password | Browser cached bad auth | Clear saved credential for the site, or use incognito window |
| Dashboard loads but all numbers are 0 | DB wasn't pushed, or app didn't restart after push | Re-run `npm run push-data`. If still empty, SSH in and check `ls -la /data/stack.db` — it should be ~20MB, not 0 bytes |
| Login prompt appears twice in a row | Caddy restart mid-request; transient | Reload the page |
| "Certificate not trusted" warning | Let's Encrypt renewal failed | `fly certs show data.stackwellness.com` — check expiry. If past-due, `fly certs check data.stackwellness.com` |
| Dashboard shows stale March numbers but you ingested April | The `push-to-prod.sh` script does a full restart. If you see stale data, the restart didn't propagate. Try `fly apps restart stack-dashboard` directly |
| Build step fails on `npm run push-data` | Local TypeScript errors | `npx tsc -b` to see them. The script intentionally blocks pushing broken code |

---

## Cost monitoring

Fly bills monthly. Expected cost: **$2–5/month** for this workload.

Current-month usage: https://fly.io/dashboard/billing

If a month exceeds $10, investigate — a 3-user read-only dashboard should never hit that.

**What costs money:**
- Shared-cpu-1x machine runtime (mostly free tier; scales to zero when idle)
- Persistent volume storage (~$0.15/month for 1GB)
- Outbound bandwidth (very low traffic — effectively $0)

**What's free:**
- TLS certificates (Let's Encrypt via Fly)
- Let's Encrypt renewals
- Volume snapshots (5-day retention included)
- Deployments / builds

---

## Security upgrade path (when ready)

Current auth is a single shared password — simple but has no per-user audit trail. When ready to upgrade:

### Migrate to Cloudflare Access (free for ≤50 users)

1. Move `stackwellness.com` nameservers from GoDaddy to Cloudflare.
2. Create a Cloudflare Access application for `data.stackwellness.com`.
3. Add an access policy: `allow email in (carson@goodalecg.com, josh@..., andy@...)`.
4. Remove the `basicauth` block from `Caddyfile`, redeploy.
5. Cloudflare Access now shows a branded login page; users sign in with Google/email; access logs become per-user.

~1 hour of work. No code changes to the app itself. Reversible.

### Other hardening options (future)

- Add Fly secrets for rotating credentials without a code redeploy (`fly secrets set`).
- Enable Fly volume snapshot retention beyond 5 days (costs extra but gives you a longer recovery window).
- Set up Slack alerting on `fly logs` errors via a log drain.

---

## Related files in the repo

| File | Purpose |
|---|---|
| `server/production.ts` | Express server for prod |
| `server/dataApiHandler.ts` | Shared API routing (used by Vite dev + Express prod) |
| `server/db/connection.ts` | Honors `DB_PATH` env var |
| `Dockerfile` | Multi-stage image: builder (node:20-alpine) + runtime (caddy + node) |
| `docker-entrypoint.sh` | Launches both node + caddy concurrently |
| `Caddyfile` | TLS termination + basic auth + reverse proxy |
| `fly.toml` | App config, volume mount, region, VM size |
| `scripts/push-to-prod.sh` | `npm run push-data` → SFTP + restart |
| `tsconfig.server.json` | Compiles server TS → `dist-server/` for prod |
| `docs/plans/2026-04-17-production-deployment-*.md` | Design + plan history |

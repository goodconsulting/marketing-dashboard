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

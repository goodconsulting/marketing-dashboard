#!/usr/bin/env bash
# Sync local data/stack.db to production Fly volume.
# Run this after each monthly ingest session.
#
# Usage: npm run push-data
#        (or directly: ./scripts/push-to-prod.sh)
set -euo pipefail

cd "$(dirname "$0")/.."

echo "→ Running local build to catch regressions before shipping"
npm run build > /tmp/push-to-prod-build.log 2>&1 || {
  echo "✗ Local build failed. Log at /tmp/push-to-prod-build.log (last 20 lines):"
  tail -20 /tmp/push-to-prod-build.log
  exit 1
}
echo "  ✓ Build passed"

echo "→ Checkpointing local WAL into stack.db (upload sends only the main file)"
node -e "
const Database = require('better-sqlite3');
const db = new Database('data/stack.db');
db.pragma('wal_checkpoint(TRUNCATE)');
db.close();
"
echo "  ✓ WAL checkpointed"

# fly's sftp 'put' refuses to overwrite existing files but still exits 0 —
# a bare put silently no-ops on every push after the first (bit us 2026-06).
# So: upload under a temp name, verify the transfer actually happened, then
# atomically swap into place and clear the previous DB's stale WAL/SHM.
echo "→ Uploading data/stack.db to prod volume (as stack.db.new)"
DB_SIZE=$(ls -la data/stack.db | awk '{print $5}')
echo "  local file size: ${DB_SIZE} bytes"
fly ssh console -C "rm -f /data/stack.db.new" > /dev/null 2>&1 || true
echo 'put data/stack.db /data/stack.db.new' | fly ssh sftp shell > /tmp/push-to-prod-sftp.log 2>&1 || {
  echo "✗ SFTP upload failed. Log:"
  cat /tmp/push-to-prod-sftp.log
  exit 1
}
if ! grep -q "bytes written" /tmp/push-to-prod-sftp.log; then
  echo "✗ SFTP reported no bytes written. Log:"
  cat /tmp/push-to-prod-sftp.log
  exit 1
fi
REMOTE_SIZE=$(grep -o '[0-9]* bytes written' /tmp/push-to-prod-sftp.log | awk '{print $1}')
if [ "$REMOTE_SIZE" != "$DB_SIZE" ]; then
  echo "✗ Size mismatch: local ${DB_SIZE} vs uploaded ${REMOTE_SIZE} bytes"
  exit 1
fi
echo "  ✓ Upload complete (${REMOTE_SIZE} bytes)"

echo "→ Swapping new DB into place"
fly ssh console -C "mv /data/stack.db.new /data/stack.db" > /dev/null 2>&1 || {
  echo "✗ Remote swap failed. Check: fly ssh console -C 'ls -la /data'"
  exit 1
}
fly ssh console -C "rm -f /data/stack.db-wal /data/stack.db-shm" > /dev/null 2>&1 || true
echo "  ✓ Swap complete"

echo "→ Restarting prod app to drop cached DB connections"
fly apps restart stack-dashboard > /dev/null 2>&1 || {
  echo "✗ Restart failed. Check: fly status"
  exit 1
}
echo "  ✓ Restart complete"

echo ""
echo "✅ Data pushed. Verify at https://data.stackwellness.com"
echo "   Expected: current local data visible within 30 seconds."

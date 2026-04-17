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

echo "→ Uploading data/stack.db to prod volume"
DB_SIZE=$(ls -la data/stack.db | awk '{print $5}')
echo "  local file size: ${DB_SIZE} bytes"
echo 'put data/stack.db /data/stack.db' | fly ssh sftp shell > /tmp/push-to-prod-sftp.log 2>&1 || {
  echo "✗ SFTP upload failed. Log:"
  cat /tmp/push-to-prod-sftp.log
  exit 1
}
echo "  ✓ Upload complete"

echo "→ Restarting prod app to drop cached DB connections"
fly apps restart stack-dashboard > /dev/null 2>&1 || {
  echo "✗ Restart failed. Check: fly status"
  exit 1
}
echo "  ✓ Restart complete"

echo ""
echo "✅ Data pushed. Verify at https://data.stackwellness.com"
echo "   Expected: current local data visible within 30 seconds."

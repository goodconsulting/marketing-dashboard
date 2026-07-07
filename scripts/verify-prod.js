/**
 * Verify prod data AFTER a push — runs INSIDE the Fly machine, where the Node
 * server listens unauthenticated on localhost (Caddy basic-auth only guards
 * external traffic).
 *
 * Usage (from local machine):
 *   echo 'put scripts/verify-prod.js /tmp/verify-prod.js' | fly ssh sftp shell
 *   fly ssh console -C "node /tmp/verify-prod.js"
 *
 * NB: `fly ssh console -C` splits on spaces — a script file is the only
 * reliable way to run multi-step logic remotely.
 *
 * Prints the last 3 monthly snapshots (month, spend, revenue, ROI inputs).
 * Compare against the local values printed by scripts/verify-month.cjs.
 */
(async () => {
  const res = await fetch('http://localhost:3000/api/data/snapshots');
  if (!res.ok) {
    console.error(`✗ /api/data/snapshots → HTTP ${res.status}`);
    process.exit(1);
  }
  const snapshots = await res.json();
  const recent = snapshots.slice(-3);
  for (const s of recent) {
    const pick = {};
    for (const k of ['month', 'totalSpend', 'coOpFunding', 'netMarketingInvestment',
      'totalRevenue', 'revenue', 'newCustomers', 'cac', 'roi']) {
      if (s[k] !== undefined) pick[k] = s[k];
    }
    console.log(JSON.stringify(pick));
  }
  console.log(`✓ prod serving ${snapshots.length} snapshots, latest: ${snapshots[snapshots.length - 1]?.month}`);
})().catch((e) => {
  console.error('✗ verify failed:', e.message);
  process.exit(1);
});

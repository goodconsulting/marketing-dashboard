/**
 * Backfill fact_stage_transition from existing fact_crm_customer_snapshot data.
 *
 * Usage: node scripts/backfill-stage-transitions.cjs
 *
 * Behavior:
 *   1. Enumerate all snapshot months in order, excluding 2025-08 (all UNKNOWN).
 *   2. For each adjacent pair, derive transitions.
 *   3. Also emit first_seen transitions for customers whose earliest snapshot
 *      is NOT the first month in the series.
 *   4. Compute days_in_from_stage via sequential chaining per customer.
 *   5. DELETE-then-INSERT for idempotent re-runs.
 *
 * Safe to re-run. Idempotent.
 */
const path = require('path');
const Database = require('better-sqlite3');
const {
  deriveStageTransitions,
  computeDaysInStage,
} = require('../server/lib/stage-transitions.cjs');

const DB_PATH = path.join(__dirname, '..', 'data', 'stack.db');
const EXCLUDED_MONTHS = new Set(['2025-08']); // all-UNKNOWN; noisy baseline

const db = new Database(DB_PATH);

// Enumerate snapshot months (excluding noise)
const allMonths = db.prepare(`
  SELECT DISTINCT snapshot_month FROM fact_crm_customer_snapshot ORDER BY snapshot_month
`).all().map(r => r.snapshot_month).filter(m => !EXCLUDED_MONTHS.has(m));

console.log(`Snapshot months in scope: ${allMonths.join(', ')}`);
if (allMonths.length === 0) {
  console.error('No snapshots found. Aborting.');
  process.exit(1);
}

// Load each snapshot's customer rows + account_created_date lookup
const snapshotRows = {};
const accountCreatedByCustomer = new Map();
for (const month of allMonths) {
  snapshotRows[month] = db.prepare(`
    SELECT customer_id, journey_stage, lifetime_spend, lifetime_visits, account_created_date
    FROM fact_crm_customer_snapshot WHERE snapshot_month = ?
  `).all(month);

  for (const r of snapshotRows[month]) {
    if (r.account_created_date && r.account_created_date !== '-' && !accountCreatedByCustomer.has(r.customer_id)) {
      accountCreatedByCustomer.set(r.customer_id, r.account_created_date);
    }
  }
}

// Derive transitions for each adjacent pair, using cumulative last-known state
// (mirrors the fixture's runBackfill — if a customer is absent for a snapshot
// and reappears later, we compare against their last observed state, not treat
// as first_seen again).
const allTransitions = [];
const lastKnown = new Map();
for (let i = 0; i < allMonths.length; i++) {
  const prevMonth = i === 0 ? null : allMonths[i - 1];
  const currMonth = allMonths[i];
  const currRows = snapshotRows[currMonth];
  const prevRows = Array.from(lastKnown.values());

  const transitions = deriveStageTransitions(prevRows, currRows, prevMonth, currMonth);
  console.log(`  ${prevMonth || '(none)'} → ${currMonth}: ${transitions.length} transitions`);
  allTransitions.push(...transitions);

  // Update lastKnown with this snapshot's rows
  for (const r of currRows) lastKnown.set(r.customer_id, r);
}

// Fill days_in_from_stage
computeDaysInStage(allTransitions, accountCreatedByCustomer);

// Idempotent insert: purge and rewrite
console.log(`Purging existing fact_stage_transition (${db.prepare('SELECT COUNT(*) AS n FROM fact_stage_transition').get().n} rows)`);
db.prepare('DELETE FROM fact_stage_transition').run();

const insertStmt = db.prepare(`
  INSERT INTO fact_stage_transition
  (customer_id, from_stage, to_stage, direction, from_snapshot, to_snapshot,
   days_in_from_stage, spend_in_from_stage, visits_in_from_stage,
   from_lifetime_spend, to_lifetime_spend, from_lifetime_visits, to_lifetime_visits,
   estimated_transition_date)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const tx = db.transaction(() => {
  for (const t of allTransitions) {
    insertStmt.run(
      t.customer_id, t.from_stage, t.to_stage, t.direction,
      t.from_snapshot, t.to_snapshot,
      t.days_in_from_stage, t.spend_in_from_stage, t.visits_in_from_stage,
      t.from_lifetime_spend, t.to_lifetime_spend,
      t.from_lifetime_visits, t.to_lifetime_visits,
      t.estimated_transition_date,
    );
  }
});
tx();

console.log(`\nInserted ${allTransitions.length} total transitions.`);

// Summary
const summary = db.prepare(`
  SELECT direction, COUNT(*) AS n FROM fact_stage_transition GROUP BY direction ORDER BY n DESC
`).all();
console.log('\nBy direction:');
console.table(summary);

db.close();

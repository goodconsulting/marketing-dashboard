/**
 * Fixture test for stage-transition derivation logic.
 *
 * Runs 4 synthetic customer journeys through deriveStageTransitions()
 * and asserts expected output. Exit 0 on pass, 1 on failure.
 *
 * Usage: node scripts/test-stage-transitions-fixture.cjs
 */
const { deriveStageTransitions } = require('../server/lib/stage-transitions.cjs');

const snapshots = {
  '2025-10': [
    { customer_id: 'A', journey_stage: 'UNKNOWN', lifetime_spend: 0,  lifetime_visits: 0,  account_created_date: '2025-09-15' },
    { customer_id: 'B', journey_stage: 'ROOKIE',  lifetime_spend: 25, lifetime_visits: 2,  account_created_date: '2025-08-01' },
    { customer_id: 'C', journey_stage: 'LOYALIST',lifetime_spend: 320,lifetime_visits: 18, account_created_date: '2025-04-12' },
    { customer_id: 'D', journey_stage: 'CHURNED', lifetime_spend: 47, lifetime_visits: 3,  account_created_date: '2025-02-01' },
  ],
  '2026-01': [
    { customer_id: 'A', journey_stage: 'ROOKIE',  lifetime_spend: 18, lifetime_visits: 2,  account_created_date: '2025-09-15' },
    { customer_id: 'B', journey_stage: 'ROOKIE',  lifetime_spend: 42, lifetime_visits: 3,  account_created_date: '2025-08-01' },
    { customer_id: 'C', journey_stage: 'REGULAR', lifetime_spend: 380,lifetime_visits: 22, account_created_date: '2025-04-12' },
    { customer_id: 'D', journey_stage: 'ROOKIE',  lifetime_spend: 52, lifetime_visits: 4,  account_created_date: '2025-02-01' },
    { customer_id: 'E', journey_stage: 'ROOKIE',  lifetime_spend: 12, lifetime_visits: 1,  account_created_date: '2025-12-20' },
  ],
  '2026-02': [
    { customer_id: 'B', journey_stage: 'ROOKIE',  lifetime_spend: 42, lifetime_visits: 3,  account_created_date: '2025-08-01' },
    { customer_id: 'C', journey_stage: 'LOYALIST',lifetime_spend: 450,lifetime_visits: 28, account_created_date: '2025-04-12' },
    { customer_id: 'E', journey_stage: 'ROOKIE',  lifetime_spend: 35, lifetime_visits: 3,  account_created_date: '2025-12-20' },
  ],
  '2026-04': [
    { customer_id: 'A', journey_stage: 'LOYALIST',lifetime_spend: 280,lifetime_visits: 16, account_created_date: '2025-09-15' },
    { customer_id: 'B', journey_stage: 'CHURNED', lifetime_spend: 42, lifetime_visits: 3,  account_created_date: '2025-08-01' },
    { customer_id: 'C', journey_stage: 'LOYALIST',lifetime_spend: 512,lifetime_visits: 32, account_created_date: '2025-04-12' },
    { customer_id: 'E', journey_stage: 'REGULAR', lifetime_spend: 72, lifetime_visits: 6,  account_created_date: '2025-12-20' },
  ],
};

// Expected transitions across the full Oct→Jan→Feb→Apr backfill:
//   A: first_seen@Oct(UNKNOWN), up@Jan(UNKNOWN→ROOKIE), up@Apr(ROOKIE→LOYALIST)
//      [no Feb row for A — absent; no row generated per "silent churn" policy]
//   B: first_seen@Oct(ROOKIE), (no Jan row — stage unchanged), (no Feb row — stage unchanged), churn@Apr(ROOKIE→CHURNED)
//   C: first_seen@Oct(LOYALIST), down@Jan(LOYALIST→REGULAR), up@Feb(REGULAR→LOYALIST), (no Apr row — stage unchanged)
//   D: first_seen@Oct(CHURNED), reactivate@Jan(CHURNED→ROOKIE)
//      [no Feb or Apr rows for D — absent]
//   E: first_seen@Jan(ROOKIE) [because E first appears in Jan, not Oct], (no Feb row), up@Apr(ROOKIE→REGULAR)

const expected = [
  // Oct 2025 — all first_seen (no prior snapshot)
  { customer_id: 'A', direction: 'first_seen', to_stage: 'UNKNOWN',  to_snapshot: '2025-10' },
  { customer_id: 'B', direction: 'first_seen', to_stage: 'ROOKIE',   to_snapshot: '2025-10' },
  { customer_id: 'C', direction: 'first_seen', to_stage: 'LOYALIST', to_snapshot: '2025-10' },
  { customer_id: 'D', direction: 'first_seen', to_stage: 'CHURNED',  to_snapshot: '2025-10' },
  // Oct → Jan pair
  { customer_id: 'A', direction: 'up',         from_stage: 'UNKNOWN',  to_stage: 'ROOKIE',  to_snapshot: '2026-01' },
  { customer_id: 'C', direction: 'down',       from_stage: 'LOYALIST', to_stage: 'REGULAR', to_snapshot: '2026-01' },
  { customer_id: 'D', direction: 'reactivate', from_stage: 'CHURNED',  to_stage: 'ROOKIE',  to_snapshot: '2026-01' },
  { customer_id: 'E', direction: 'first_seen', to_stage: 'ROOKIE',     to_snapshot: '2026-01' },
  // Jan → Feb pair
  { customer_id: 'C', direction: 'up',         from_stage: 'REGULAR',  to_stage: 'LOYALIST', to_snapshot: '2026-02' },
  // Feb → Apr pair
  { customer_id: 'A', direction: 'up',         from_stage: 'ROOKIE',   to_stage: 'LOYALIST', to_snapshot: '2026-04' },
  { customer_id: 'B', direction: 'churn',      from_stage: 'ROOKIE',   to_stage: 'CHURNED',  to_snapshot: '2026-04' },
  { customer_id: 'E', direction: 'up',         from_stage: 'ROOKIE',   to_stage: 'REGULAR',  to_snapshot: '2026-04' },
];

function runBackfill(snapshotMap) {
  const ordered = Object.keys(snapshotMap).sort();
  const all = [];
  // Cumulative "last known state" per customer across all prior snapshots.
  // Semantics: if Incentivio trims a customer from the export for a month,
  // the next time they appear we compare against their last observed state,
  // not treating them as first_seen again.
  const lastKnown = new Map();
  for (let i = 0; i < ordered.length; i++) {
    const currMonth = ordered[i];
    const curr = snapshotMap[currMonth];
    const prevMonth = i === 0 ? null : ordered[i - 1];
    // prevRows = all customers ever seen, with their most recent snapshot row
    const prevRows = Array.from(lastKnown.values());
    all.push(...deriveStageTransitions(prevRows, curr, prevMonth, currMonth));
    // Update lastKnown with this snapshot's rows
    for (const r of curr) lastKnown.set(r.customer_id, r);
  }
  return all;
}

const actual = runBackfill(snapshots);

// Assertion: every expected row has a matching actual row (spot-check key fields only).
let failures = 0;
for (const exp of expected) {
  const match = actual.find(a =>
    a.customer_id === exp.customer_id &&
    a.direction === exp.direction &&
    a.to_stage === exp.to_stage &&
    a.to_snapshot === exp.to_snapshot &&
    (exp.from_stage === undefined || a.from_stage === exp.from_stage)
  );
  if (!match) {
    console.error('MISSING:', JSON.stringify(exp));
    failures++;
  }
}

// Assertion: no unexpected rows (we should have exactly `expected.length` transitions).
if (actual.length !== expected.length) {
  console.error(`ROW COUNT MISMATCH: expected ${expected.length}, got ${actual.length}`);
  console.error('Actual rows:');
  for (const a of actual) console.error('  ', JSON.stringify(a));
  failures++;
}

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log(`PASS: ${actual.length} transitions derived correctly`);

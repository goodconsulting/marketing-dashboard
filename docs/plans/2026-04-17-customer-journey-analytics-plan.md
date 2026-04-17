# Customer Journey Analytics Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ingest April 2026 CRM data and add materialized stage-transition tracking so CustomerHealth, Overview, and CAC & ROI views can show dwell time, spend-per-stage, and progression counts.

**Architecture:** New `fact_stage_transition` table populated by diffing consecutive `fact_crm_customer_snapshot` rows. Backfill derives transitions from Oct 2025 → Feb 2026 (3 intervals). Normal-path derives Feb → April on CSV ingest. All three affected views read the new table. AttributionView upgrades from hardcoded RETENTION_MONTHS to observed-or-fallback.

**Tech Stack:** better-sqlite3, Node.js (CommonJS scripts), React 19 + Tailwind + Recharts, PapaParse.

**Design reference:** [`docs/plans/2026-04-17-customer-journey-analytics-design.md`](./2026-04-17-customer-journey-analytics-design.md)

**Testing approach:** The codebase has no vitest/jest setup. Tests are written as executable `.cjs` assertion scripts (matches existing pattern in `scripts/`). Each passes = exits 0, fails = exits 1 with diff output.

---

## Phase 1 — Schema + core derivation logic

### Task 1: Add `fact_stage_transition` table to schema

**Files:**
- Modify: `server/db/schema.ts` (add `FACT_STAGE_TRANSITION` const, append to `SCHEMA_STATEMENTS` + `TABLE_NAMES`)

**Step 1: Add the CREATE TABLE block**

Add this after the `FACT_BILLBOARD_MONTHLY` const in `server/db/schema.ts` (around line 412):

```typescript
// Stage transitions: materialized from consecutive CRM snapshot pairs.
// One row per detected stage change per customer. Direction derived from
// the canonical stage ladder (UNKNOWN=0, SLIDER=1, ROOKIE=2, REGULAR=3,
// LOYALIST=4, WHALE=5; CHURNED=-1 is a terminal sink).
// INSERT OR REPLACE keyed on (customer_id, from_snapshot, to_snapshot).
const FACT_STAGE_TRANSITION = `
CREATE TABLE IF NOT EXISTS fact_stage_transition (
  id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id               TEXT NOT NULL,
  from_stage                TEXT NOT NULL,
  to_stage                  TEXT NOT NULL,
  direction                 TEXT NOT NULL,
  from_snapshot             TEXT NOT NULL,
  to_snapshot               TEXT NOT NULL,
  days_in_from_stage        INTEGER,
  spend_in_from_stage       REAL,
  visits_in_from_stage      INTEGER,
  from_lifetime_spend       REAL,
  to_lifetime_spend         REAL,
  from_lifetime_visits      INTEGER,
  to_lifetime_visits        INTEGER,
  estimated_transition_date TEXT,
  detected_at               TEXT DEFAULT (datetime('now')),
  UNIQUE(customer_id, from_snapshot, to_snapshot)
);
`;
```

**Step 2: Add to SCHEMA_STATEMENTS array (around line 497)**

Append `FACT_STAGE_TRANSITION,` before `UPLOAD_LOG,`.

**Step 3: Add to TABLE_NAMES array (around line 544)**

Append `'fact_stage_transition',` before `'upload_log',`.

**Step 4: Add indexes to the `INDEXES` const (around line 460)**

Append after the billboard index:

```sql
-- Stage transition indexes: customer lookup, stage-pair aggregation, month filtering
CREATE INDEX IF NOT EXISTS idx_transition_customer ON fact_stage_transition(customer_id);
CREATE INDEX IF NOT EXISTS idx_transition_stages ON fact_stage_transition(from_stage, to_stage);
CREATE INDEX IF NOT EXISTS idx_transition_to_snapshot ON fact_stage_transition(to_snapshot);
```

**Step 5: Verify schema applies cleanly**

Run: `cd marketing-dashboard && node -e "require('./server/db/connection.ts')"` — should fail because it's a TS file.

Run instead: `npx tsc --noEmit` — expected: clean exit.

Then trigger schema apply by starting the dev server briefly or via:
```bash
node -e "const Database = require('better-sqlite3'); const db = new Database('data/stack.db'); const cols = db.pragma('table_info(fact_stage_transition)'); console.log(cols);"
```

**Expected:** Empty array (table doesn't exist yet — schema migration doesn't run from raw Node; that happens on server startup). We verify via server startup in Task 2.

**Step 6: Commit**

```bash
git add server/db/schema.ts
git commit -m "feat(schema): add fact_stage_transition table + indexes"
```

---

### Task 2: Verify schema migration runs on server startup

**Files:** None (verification only)

**Step 1: Start dev server in background**

Use the running preview server or `npm run dev &` if not running.

**Step 2: Query the new table via the server**

```bash
node -e "const Database = require('better-sqlite3'); const db = new Database('data/stack.db'); console.log(db.pragma('table_info(fact_stage_transition)').map(c => c.name));"
```

**Expected output:** `[ 'id', 'customer_id', 'from_stage', 'to_stage', 'direction', 'from_snapshot', 'to_snapshot', 'days_in_from_stage', 'spend_in_from_stage', 'visits_in_from_stage', 'from_lifetime_spend', 'to_lifetime_spend', 'from_lifetime_visits', 'to_lifetime_visits', 'estimated_transition_date', 'detected_at' ]`

**Step 3: Verify indexes**

```bash
node -e "const Database = require('better-sqlite3'); const db = new Database('data/stack.db'); console.log(db.prepare(\"SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='fact_stage_transition'\").all());"
```

**Expected:** 3 custom indexes + 1 autoindex for UNIQUE constraint.

No commit — this is a verification step only.

---

### Task 3: Write test fixture for stage-transition derivation logic

**Files:**
- Create: `scripts/test-stage-transitions-fixture.cjs`

**Step 1: Write the fixture**

This fixture is both the test AND a reference for the derivation semantics. Write it BEFORE the derivation function so we know what behavior we're targeting.

```javascript
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
  for (let i = 0; i < ordered.length; i++) {
    const prevMonth = i === 0 ? null : ordered[i - 1];
    const currMonth = ordered[i];
    const prev = prevMonth ? snapshotMap[prevMonth] : [];
    const curr = snapshotMap[currMonth];
    all.push(...deriveStageTransitions(prev, curr, prevMonth, currMonth));
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
```

**Step 2: Run it — expect failure**

```bash
node scripts/test-stage-transitions-fixture.cjs
```

**Expected:** `Error: Cannot find module '../server/lib/stage-transitions.cjs'` — the derivation module doesn't exist yet. This is what we want.

**Step 3: Commit**

```bash
git add scripts/test-stage-transitions-fixture.cjs
git commit -m "test: add stage-transition derivation fixture (4 synthetic journeys)"
```

---

### Task 4: Implement `deriveStageTransitions()` to pass the fixture

**Files:**
- Create: `server/lib/stage-transitions.cjs`

**Step 1: Write the minimal implementation**

```javascript
/**
 * Derive stage transitions from two CRM snapshot sets.
 *
 * Input: array of customer rows from the prior snapshot (prevRows, can be empty)
 *        and the current snapshot (currRows), plus their month identifiers.
 *
 * Output: array of transition objects ready to insert into fact_stage_transition.
 *
 * The derivation rules are in docs/plans/2026-04-17-customer-journey-analytics-design.md
 * Sections 1–4. Summary:
 *   - Customer in both AND stage unchanged → no row
 *   - Customer in both AND stage changed → one transition row with direction from ladder
 *   - Customer in curr only → first_seen row (no from_stage delta available)
 *   - Customer in prev only → NO row (silent churn policy, see design Section 2)
 */

const STAGE_RANK = {
  UNKNOWN: 0,
  SLIDER: 1,
  ROOKIE: 2,
  REGULAR: 3,
  LOYALIST: 4,
  WHALE: 5,
  CHURNED: -1,
};

function classifyDirection(fromStage, toStage) {
  if (toStage === 'CHURNED') return 'churn';
  if (fromStage === 'CHURNED') return 'reactivate';
  const fr = STAGE_RANK[fromStage] ?? 0;
  const tr = STAGE_RANK[toStage] ?? 0;
  if (tr > fr) return 'up';
  if (tr < fr) return 'down';
  return 'lateral'; // same rank, different stage name (shouldn't happen with current ladder)
}

function midpointISO(fromMonth, toMonth) {
  // Month strings are YYYY-MM. Use 15th of each month as snapshot date proxy.
  if (!fromMonth || !toMonth) return null;
  const fromDate = new Date(fromMonth + '-15T00:00:00Z');
  const toDate = new Date(toMonth + '-15T00:00:00Z');
  const midMs = (fromDate.getTime() + toDate.getTime()) / 2;
  return new Date(midMs).toISOString().slice(0, 10);
}

function normalizeStage(s) {
  if (!s || s === '-' || s === '') return 'UNKNOWN';
  const upper = String(s).toUpperCase();
  return STAGE_RANK[upper] !== undefined ? upper : 'UNKNOWN';
}

/**
 * @param {Array} prevRows - customer rows from previous snapshot (or [] if none)
 * @param {Array} currRows - customer rows from current snapshot
 * @param {string|null} prevMonth - YYYY-MM of previous snapshot (null if first-ever)
 * @param {string} currMonth - YYYY-MM of current snapshot
 * @returns {Array} transition rows
 */
function deriveStageTransitions(prevRows, currRows, prevMonth, currMonth) {
  const prevByCustomer = new Map();
  for (const r of prevRows || []) prevByCustomer.set(r.customer_id, r);

  const transitions = [];

  for (const curr of currRows) {
    const prev = prevByCustomer.get(curr.customer_id);
    const currStage = normalizeStage(curr.journey_stage);

    if (!prev) {
      // first_seen
      transitions.push({
        customer_id: curr.customer_id,
        from_stage: currStage,  // placeholder; direction=first_seen means no "from"
        to_stage: currStage,
        direction: 'first_seen',
        from_snapshot: prevMonth || currMonth,  // acceptable fallback for first-ever
        to_snapshot: currMonth,
        days_in_from_stage: null,
        spend_in_from_stage: null,
        visits_in_from_stage: null,
        from_lifetime_spend: null,
        to_lifetime_spend: Number(curr.lifetime_spend) || 0,
        from_lifetime_visits: null,
        to_lifetime_visits: Number(curr.lifetime_visits) || 0,
        estimated_transition_date: null,
      });
      continue;
    }

    const prevStage = normalizeStage(prev.journey_stage);
    if (prevStage === currStage) continue; // no transition to record

    const direction = classifyDirection(prevStage, currStage);
    const spendDelta = (Number(curr.lifetime_spend) || 0) - (Number(prev.lifetime_spend) || 0);
    const visitsDelta = (Number(curr.lifetime_visits) || 0) - (Number(prev.lifetime_visits) || 0);

    transitions.push({
      customer_id: curr.customer_id,
      from_stage: prevStage,
      to_stage: currStage,
      direction,
      from_snapshot: prevMonth,
      to_snapshot: currMonth,
      days_in_from_stage: null, // populated later by sequential pass if we have full history
      spend_in_from_stage: spendDelta < 0 ? 0 : spendDelta,
      visits_in_from_stage: visitsDelta < 0 ? 0 : visitsDelta,
      from_lifetime_spend: Number(prev.lifetime_spend) || 0,
      to_lifetime_spend: Number(curr.lifetime_spend) || 0,
      from_lifetime_visits: Number(prev.lifetime_visits) || 0,
      to_lifetime_visits: Number(curr.lifetime_visits) || 0,
      estimated_transition_date: midpointISO(prevMonth, currMonth),
    });
  }

  return transitions;
}

module.exports = {
  STAGE_RANK,
  classifyDirection,
  midpointISO,
  normalizeStage,
  deriveStageTransitions,
};
```

**Step 2: Run the fixture test**

```bash
node scripts/test-stage-transitions-fixture.cjs
```

**Expected:** `PASS: 12 transitions derived correctly`

**Step 3: If fail, read the diff, fix, re-run**

Common failures:
- Missing `first_seen` rows for Oct → check `!prev` branch
- Wrong direction for CHURNED transitions → check `classifyDirection` ordering (CHURNED check must come first)
- Extra rows → check the "prevStage === currStage → continue" short-circuit

**Step 4: Commit**

```bash
git add server/lib/stage-transitions.cjs
git commit -m "feat: implement deriveStageTransitions with direction classification"
```

---

### Task 5: Add `days_in_from_stage` backfill pass

**Files:**
- Modify: `server/lib/stage-transitions.cjs` (add `computeDaysInStage()`)

**Context:** `deriveStageTransitions()` returns rows with `days_in_from_stage = null`. That's correct per-pair, but once we have the full transition history for a customer, we can compute days by chaining consecutive transitions' `estimated_transition_date`s.

**Step 1: Add the function**

Append to `server/lib/stage-transitions.cjs`:

```javascript
/**
 * Given the complete transition history for a set of customers, fill in
 * days_in_from_stage by chaining consecutive transitions per customer.
 *
 * For the first transition of each customer: use account_created_date if
 * available from the customer's first snapshot row, else leave NULL.
 *
 * Mutates the input array (sets days_in_from_stage on each row).
 *
 * @param {Array} transitions - sorted chronologically
 * @param {Map<string, string>} accountCreatedByCustomer - customer_id → YYYY-MM-DD
 */
function computeDaysInStage(transitions, accountCreatedByCustomer) {
  // Group by customer and walk in chronological order
  const byCustomer = new Map();
  for (const t of transitions) {
    if (!byCustomer.has(t.customer_id)) byCustomer.set(t.customer_id, []);
    byCustomer.get(t.customer_id).push(t);
  }

  for (const [customerId, rows] of byCustomer) {
    rows.sort((a, b) => a.to_snapshot.localeCompare(b.to_snapshot));
    const createdDate = accountCreatedByCustomer.get(customerId);

    let prevTransitionDate = createdDate || null;

    for (const t of rows) {
      if (t.direction === 'first_seen') {
        // Can't compute days_in_from_stage for first_seen (unknown prior state)
        prevTransitionDate = t.estimated_transition_date || prevTransitionDate;
        continue;
      }
      if (t.estimated_transition_date && prevTransitionDate) {
        const ms = new Date(t.estimated_transition_date + 'T00:00:00Z').getTime()
                 - new Date(prevTransitionDate + 'T00:00:00Z').getTime();
        const days = Math.round(ms / 86400000);
        t.days_in_from_stage = days >= 0 ? days : null;
      }
      prevTransitionDate = t.estimated_transition_date || prevTransitionDate;
    }
  }

  return transitions;
}

module.exports.computeDaysInStage = computeDaysInStage;
```

**Step 2: Extend the fixture to verify `days_in_from_stage`**

Append to `scripts/test-stage-transitions-fixture.cjs` before the failures check:

```javascript
// Additional assertion: days_in_from_stage computed for Customer C's Jan→Feb (REGULAR→LOYALIST)
// C's Jan transition estimated date = midpoint(Oct-15, Jan-15) ≈ Nov 30
// C's Feb transition estimated date = midpoint(Jan-15, Feb-15) ≈ Jan 30
// Days = ~61
const { computeDaysInStage } = require('../server/lib/stage-transitions.cjs');
const accountCreated = new Map();
for (const rows of Object.values(snapshots)) {
  for (const r of rows) if (r.account_created_date) accountCreated.set(r.customer_id, r.account_created_date);
}
computeDaysInStage(actual, accountCreated);

const cFebTransition = actual.find(a => a.customer_id === 'C' && a.to_snapshot === '2026-02');
if (!cFebTransition || cFebTransition.days_in_from_stage === null) {
  console.error('Customer C\'s Jan→Feb transition should have days_in_from_stage computed');
  failures++;
} else if (cFebTransition.days_in_from_stage < 45 || cFebTransition.days_in_from_stage > 75) {
  console.error(`Customer C days_in_from_stage expected 45-75, got ${cFebTransition.days_in_from_stage}`);
  failures++;
}
```

**Step 3: Run test**

```bash
node scripts/test-stage-transitions-fixture.cjs
```

**Expected:** `PASS: 12 transitions derived correctly`

**Step 4: Commit**

```bash
git add server/lib/stage-transitions.cjs scripts/test-stage-transitions-fixture.cjs
git commit -m "feat: add computeDaysInStage for sequential day-count chaining"
```

---

## Phase 2 — Query + API layer

### Task 6: Add `StageTransition` types (server + client)

**Files:**
- Modify: `server/types.ts`
- Modify: `src/types.ts`
- Modify: `src/api/dataApi.ts` (`ServerState`)
- Modify: `src/store.ts` (initial state + hydration)

**Step 1: Add server-side interface**

In `server/types.ts`, add after `OtherCampaign`:

```typescript
// ─── Stage Transitions ───────────────────────────────────────────

export interface StageTransition {
  customerId: string;
  fromStage: string;
  toStage: string;
  direction: 'up' | 'down' | 'churn' | 'reactivate' | 'first_seen' | 'lateral';
  fromSnapshot: string;
  toSnapshot: string;
  daysInFromStage: number | null;
  spendInFromStage: number | null;
  visitsInFromStage: number | null;
  fromLifetimeSpend: number | null;
  toLifetimeSpend: number | null;
  fromLifetimeVisits: number | null;
  toLifetimeVisits: number | null;
  estimatedTransitionDate: string | null;
}
```

**Step 2: Mirror in `src/types.ts`**

Same interface. Then add to `DashboardState` (after `otherCampaigns`):

```typescript
  // Stage transitions (derived from CRM snapshot history)
  stageTransitions: StageTransition[];
```

**Step 3: Add to `src/api/dataApi.ts` `ServerState`**

Add after `otherCampaigns: OtherCampaign[];`:

```typescript
  stageTransitions: StageTransition[];
```

And add import: `StageTransition`.

**Step 4: Add to `src/store.ts` initial state + both hydration paths**

Add `stageTransitions: []` to `getInitialState()`.
Add `stageTransitions: data.stageTransitions || []` to both `refresh()` and the `useEffect` mount path.

**Step 5: Typecheck**

```bash
npx tsc --noEmit
```

**Expected:** clean.

**Step 6: Commit**

```bash
git add server/types.ts src/types.ts src/api/dataApi.ts src/store.ts
git commit -m "feat(types): add StageTransition interface and wire into DashboardState"
```

---

### Task 7: Add query functions for `fact_stage_transition`

**Files:**
- Modify: `server/db/queries.ts`

**Step 1: Add import**

Add `StageTransition` to the existing type imports at the top.

**Step 2: Add query functions**

After `getOtherCampaigns`:

```typescript
// ── Stage Transitions ─────────────────────────────────────────────────────

export function insertStageTransitions(records: StageTransition[]): number {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO fact_stage_transition
    (customer_id, from_stage, to_stage, direction, from_snapshot, to_snapshot,
     days_in_from_stage, spend_in_from_stage, visits_in_from_stage,
     from_lifetime_spend, to_lifetime_spend, from_lifetime_visits, to_lifetime_visits,
     estimated_transition_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  let inserted = 0;
  db.transaction(() => {
    for (const r of records) {
      stmt.run(
        r.customerId, r.fromStage, r.toStage, r.direction,
        r.fromSnapshot, r.toSnapshot,
        r.daysInFromStage, r.spendInFromStage, r.visitsInFromStage,
        r.fromLifetimeSpend, r.toLifetimeSpend,
        r.fromLifetimeVisits, r.toLifetimeVisits,
        r.estimatedTransitionDate,
      );
      inserted++;
    }
  })();
  return inserted;
}

export function deleteStageTransitionsForSnapshot(toSnapshot: string): number {
  const db = getDb();
  const r = db.prepare('DELETE FROM fact_stage_transition WHERE to_snapshot = ?').run(toSnapshot);
  return r.changes;
}

export function getStageTransitions(limit = 5000): StageTransition[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM fact_stage_transition
    ORDER BY detected_at DESC, id DESC
    LIMIT ?
  `).all(limit) as Array<Record<string, unknown>>;
  return rows.map(rowToStageTransition);
}

function rowToStageTransition(r: Record<string, unknown>): StageTransition {
  return {
    customerId: r.customer_id as string,
    fromStage: r.from_stage as string,
    toStage: r.to_stage as string,
    direction: r.direction as StageTransition['direction'],
    fromSnapshot: r.from_snapshot as string,
    toSnapshot: r.to_snapshot as string,
    daysInFromStage: r.days_in_from_stage as number | null,
    spendInFromStage: r.spend_in_from_stage as number | null,
    visitsInFromStage: r.visits_in_from_stage as number | null,
    fromLifetimeSpend: r.from_lifetime_spend as number | null,
    toLifetimeSpend: r.to_lifetime_spend as number | null,
    fromLifetimeVisits: r.from_lifetime_visits as number | null,
    toLifetimeVisits: r.to_lifetime_visits as number | null,
    estimatedTransitionDate: r.estimated_transition_date as string | null,
  };
}

/** Count of transitions grouped by (from_stage, to_stage) for matrix rendering. */
export function getStageTransitionMatrix(): Array<{
  from_stage: string; to_stage: string; direction: string; count: number;
}> {
  const db = getDb();
  return db.prepare(`
    SELECT from_stage, to_stage, direction, COUNT(*) AS count
    FROM fact_stage_transition
    WHERE direction != 'first_seen'
    GROUP BY from_stage, to_stage, direction
    ORDER BY count DESC
  `).all() as Array<{ from_stage: string; to_stage: string; direction: string; count: number }>;
}

/** Aggregate stats per from_stage (dwell time + economics). */
export function getStageStats(): Array<{
  from_stage: string;
  n: number;
  median_days: number | null;
  avg_spend: number | null;
  avg_visits: number | null;
}> {
  const db = getDb();
  // SQLite doesn't have MEDIAN; approximate with percentile via window.
  // Use the CTE trick: row_number()/count() for 50th percentile.
  return db.prepare(`
    WITH ranked AS (
      SELECT from_stage, days_in_from_stage, spend_in_from_stage, visits_in_from_stage,
             ROW_NUMBER() OVER (PARTITION BY from_stage ORDER BY days_in_from_stage) AS rn,
             COUNT(*) OVER (PARTITION BY from_stage) AS cnt
      FROM fact_stage_transition
      WHERE direction != 'first_seen' AND days_in_from_stage IS NOT NULL
    )
    SELECT from_stage,
           cnt AS n,
           MAX(CASE WHEN rn = (cnt + 1) / 2 THEN days_in_from_stage END) AS median_days,
           AVG(spend_in_from_stage) AS avg_spend,
           AVG(visits_in_from_stage) AS avg_visits
    FROM ranked GROUP BY from_stage, cnt
  `).all() as Array<{ from_stage: string; n: number; median_days: number | null; avg_spend: number | null; avg_visits: number | null }>;
}
```

**Step 3: Typecheck**

```bash
npx tsc --noEmit
```

**Expected:** clean.

**Step 4: Commit**

```bash
git add server/db/queries.ts
git commit -m "feat(db): add stage-transition query functions (insert, get, matrix, stats)"
```

---

### Task 8: Wire `stageTransitions` into `/api/data/state` + dedicated endpoint

**Files:**
- Modify: `server/viteDataPlugin.ts`

**Step 1: Add imports**

Add to the existing import block from `./db/queries.ts`:

```typescript
  getStageTransitions,
  getStageTransitionMatrix,
  getStageStats,
```

**Step 2: Include in `/api/data/state` response**

Inside the `if (path === '/api/data/state')` block, add before `const uploads`:

```typescript
      const stageTransitions = getStageTransitions(5000);
```

Add to the returned JSON object:

```typescript
        stageTransitions,
```

**Step 3: Add dedicated endpoints**

After the `/api/data/other-campaigns` block:

```typescript
    // ── Stage Transitions ────────────────────────────────────────
    if (path === '/api/data/stage-transitions') {
      const limit = parseInt(query.get('limit') || '5000', 10);
      json(res, 200, getStageTransitions(limit));
      return;
    }

    if (path === '/api/data/stage-transition-matrix') {
      json(res, 200, getStageTransitionMatrix());
      return;
    }

    if (path === '/api/data/stage-stats') {
      json(res, 200, getStageStats());
      return;
    }
```

**Step 4: Typecheck + smoke test**

```bash
npx tsc --noEmit
```

Start/restart dev server, then:

```bash
curl -s http://localhost:5173/api/data/stage-transitions | head -c 200
```

**Expected:** `[]` (empty — backfill hasn't run yet).

**Step 5: Commit**

```bash
git add server/viteDataPlugin.ts
git commit -m "feat(api): expose stage transitions via /api/data/state + 3 endpoints"
```

---

## Phase 3 — Scripts (backfill + ingest)

### Task 9: Write backfill script

**Files:**
- Create: `scripts/backfill-stage-transitions.cjs`

**Step 1: Write the script**

```javascript
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

// Derive transitions for each adjacent pair
const allTransitions = [];
for (let i = 0; i < allMonths.length; i++) {
  const prevMonth = i === 0 ? null : allMonths[i - 1];
  const currMonth = allMonths[i];
  const prevRows = prevMonth ? snapshotRows[prevMonth] : [];
  const currRows = snapshotRows[currMonth];

  const transitions = deriveStageTransitions(prevRows, currRows, prevMonth, currMonth);
  console.log(`  ${prevMonth || '(none)'} → ${currMonth}: ${transitions.length} transitions`);
  allTransitions.push(...transitions);
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
```

**Step 2: Run it**

```bash
node scripts/backfill-stage-transitions.cjs
```

**Expected output:**
- `Snapshot months in scope: 2025-10, 2026-01, 2026-02` (April not ingested yet)
- Transition counts per pair
- Total in 4,000–7,000 range per Section 6 assertions
- Direction breakdown (first_seen dominates, then up/down)

**Step 3: Verify via SQL**

```bash
node -e "const db = require('better-sqlite3')('data/stack.db'); console.log(db.prepare('SELECT COUNT(*) AS n FROM fact_stage_transition').get());"
```

**Expected:** some number in the 4,000–7,000 range.

**Step 4: Run idempotency test**

```bash
node scripts/backfill-stage-transitions.cjs
node -e "const db = require('better-sqlite3')('data/stack.db'); console.log(db.prepare('SELECT COUNT(*) AS n FROM fact_stage_transition').get());"
```

**Expected:** identical row count after second run.

**Step 5: Commit**

```bash
git add scripts/backfill-stage-transitions.cjs
git commit -m "feat(backfill): derive stage transitions from Oct 2025 → Feb 2026 snapshots"
```

---

### Task 10: Write April 2026 CRM ingest script

**Files:**
- Create: `scripts/ingest-april-2026-crm.cjs`

**Step 1: Understand the existing CRM ingest pattern**

Read `server/parsers/crm.ts` to see how snapshot rows are parsed. The new script will reuse that parser conceptually (we can't import TS directly from .cjs, so we'll re-parse via PapaParse).

**Step 2: Write the ingest script**

```javascript
/**
 * Ingest April 2026 CRM export into fact_crm_customer_snapshot AND
 * derive new transitions for the prev-snapshot → 2026-04 pair.
 *
 * Usage: node scripts/ingest-april-2026-crm.cjs
 */
const path = require('path');
const fs = require('fs');
const Papa = require('papaparse');
const Database = require('better-sqlite3');
const {
  deriveStageTransitions,
  computeDaysInStage,
} = require('../server/lib/stage-transitions.cjs');

const CSV_PATH = '/Users/carsongoodale/Desktop/Stack/Customer_Data/stackwellnesscafe_Customer_Export_2026_04_17_UTC_03_42_05_4ba9c50f-ac40-43e6-9521-8eb4ef7263ca_.csv';
const DB_PATH = path.join(__dirname, '..', 'data', 'stack.db');
const SNAPSHOT_MONTH = '2026-04';

// Parse CSV
const csv = fs.readFileSync(CSV_PATH, 'utf8');
const parsed = Papa.parse(csv, { header: true, skipEmptyLines: true });
console.log(`Parsed ${parsed.data.length} CSV rows`);
if (parsed.errors.length > 0) {
  console.warn(`  ${parsed.errors.length} parse warnings (continuing)`);
}

function toNum(v) {
  if (v === undefined || v === null || v === '' || v === '-') return 0;
  const n = parseFloat(String(v).replace(/[$,]/g, ''));
  return isNaN(n) ? 0 : n;
}

// Transform to snapshot schema
const snapshotRows = parsed.data.map(r => ({
  customer_id: r['Customer ID'],
  snapshot_month: SNAPSHOT_MONTH,
  first_name: r['First Name'] || '',
  last_name: r['Last Name'] || '',
  email: r['Email Address'] || '',
  journey_stage: (r['Guest Journey Stage'] && r['Guest Journey Stage'] !== '-') ? r['Guest Journey Stage'] : 'UNKNOWN',
  attrition_risk: r['Attrition Risk'] || 'unknown',
  reach_location: r['Reach Location'] || '',
  lifetime_spend: toNum(r['Lifetime Spend']),
  lifetime_visits: toNum(r['Lifetime Visits']),
  avg_basket_value: toNum(r['Average Basket Value']),
  last_90_days_spend: toNum(r['Last 90 day Spend']),
  last_90_days_orders: toNum(r['Last 90 day Orders']),
  last_year_spend: toNum(r['Last year Spend']),
  last_year_orders: toNum(r['Last year Orders']),
  current_loyalty_balance: toNum(r['Current Loyalty Balance']),
  account_created_date: r['Account Created Date'] || '',
  last_visit_date: r['Last Purchase Date'] || '',
  days_since_signup: toNum(r['Days since Signup']),
  days_since_last_visit: toNum(r['Days Since Last Purchase']),
  user_affiliation: r['User Affiliation'] || '',
  signup_source: r['Signup Source'] || '',
})).filter(r => r.customer_id);

console.log(`Transformed ${snapshotRows.length} valid customer rows`);

const db = new Database(DB_PATH);

// Idempotent snapshot upsert: DELETE month, then INSERT
db.prepare('DELETE FROM fact_crm_customer_snapshot WHERE snapshot_month = ?').run(SNAPSHOT_MONTH);

const insertSnap = db.prepare(`
  INSERT INTO fact_crm_customer_snapshot
  (customer_id, snapshot_month, first_name, last_name, email, journey_stage, attrition_risk,
   reach_location, lifetime_spend, lifetime_visits, avg_basket_value, last_90_days_spend,
   last_90_days_orders, last_year_spend, last_year_orders, current_loyalty_balance,
   account_created_date, last_visit_date, days_since_signup, days_since_last_visit,
   user_affiliation, signup_source)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

db.transaction(() => {
  for (const r of snapshotRows) {
    insertSnap.run(
      r.customer_id, r.snapshot_month, r.first_name, r.last_name, r.email,
      r.journey_stage, r.attrition_risk, r.reach_location,
      r.lifetime_spend, r.lifetime_visits, r.avg_basket_value,
      r.last_90_days_spend, r.last_90_days_orders,
      r.last_year_spend, r.last_year_orders,
      r.current_loyalty_balance,
      r.account_created_date, r.last_visit_date,
      r.days_since_signup, r.days_since_last_visit,
      r.user_affiliation, r.signup_source,
    );
  }
})();

console.log(`Inserted ${snapshotRows.length} rows into fact_crm_customer_snapshot`);

// Derive new transitions for (prev, April) pair
const prevMonth = db.prepare(`
  SELECT MAX(snapshot_month) AS m FROM fact_crm_customer_snapshot
  WHERE snapshot_month < ? AND snapshot_month != '2025-08'
`).get(SNAPSHOT_MONTH).m;
console.log(`Previous snapshot: ${prevMonth}`);

const prevRows = db.prepare(`
  SELECT customer_id, journey_stage, lifetime_spend, lifetime_visits, account_created_date
  FROM fact_crm_customer_snapshot WHERE snapshot_month = ?
`).all(prevMonth);

// Idempotent transition refresh
const beforeCount = db.prepare('SELECT COUNT(*) AS n FROM fact_stage_transition WHERE to_snapshot = ?').get(SNAPSHOT_MONTH).n;
db.prepare('DELETE FROM fact_stage_transition WHERE to_snapshot = ?').run(SNAPSHOT_MONTH);

const newTransitions = deriveStageTransitions(prevRows, snapshotRows, prevMonth, SNAPSHOT_MONTH);
console.log(`Derived ${newTransitions.length} new transitions for ${prevMonth} → ${SNAPSHOT_MONTH}`);

// Re-chain days_in_from_stage for all transitions (since new April rows need to feed into existing chains)
const allTransitions = db.prepare(`
  SELECT customer_id, from_stage, to_stage, direction, from_snapshot, to_snapshot,
         days_in_from_stage, spend_in_from_stage, visits_in_from_stage,
         from_lifetime_spend, to_lifetime_spend, from_lifetime_visits, to_lifetime_visits,
         estimated_transition_date
  FROM fact_stage_transition ORDER BY customer_id, to_snapshot
`).all().concat(newTransitions);

const acctCreated = new Map();
for (const r of db.prepare('SELECT customer_id, MIN(account_created_date) AS d FROM fact_crm_customer_snapshot WHERE account_created_date NOT IN (\'\', \'-\') GROUP BY customer_id').all()) {
  acctCreated.set(r.customer_id, r.d);
}
computeDaysInStage(allTransitions, acctCreated);

// Insert only the new transitions (existing ones are untouched except for days_in_from_stage chain recomputation)
const insertTrans = db.prepare(`
  INSERT INTO fact_stage_transition
  (customer_id, from_stage, to_stage, direction, from_snapshot, to_snapshot,
   days_in_from_stage, spend_in_from_stage, visits_in_from_stage,
   from_lifetime_spend, to_lifetime_spend, from_lifetime_visits, to_lifetime_visits,
   estimated_transition_date)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

db.transaction(() => {
  for (const t of newTransitions) {
    insertTrans.run(
      t.customer_id, t.from_stage, t.to_stage, t.direction,
      t.from_snapshot, t.to_snapshot,
      t.days_in_from_stage, t.spend_in_from_stage, t.visits_in_from_stage,
      t.from_lifetime_spend, t.to_lifetime_spend,
      t.from_lifetime_visits, t.to_lifetime_visits,
      t.estimated_transition_date,
    );
  }
})();

const afterCount = db.prepare('SELECT COUNT(*) AS n FROM fact_stage_transition WHERE to_snapshot = ?').get(SNAPSHOT_MONTH).n;
console.log(`\nTransitions to ${SNAPSHOT_MONTH}: before=${beforeCount}, after=${afterCount}, delta=${afterCount - beforeCount}`);

// Verification summary
const stageSummary = db.prepare(`
  SELECT journey_stage, COUNT(*) AS n FROM fact_crm_customer_snapshot
  WHERE snapshot_month = ? GROUP BY journey_stage ORDER BY n DESC
`).all(SNAPSHOT_MONTH);
console.log(`\nApril stage distribution:`);
console.table(stageSummary);

db.close();
console.log('\nDone.');
```

**Step 2: Run it**

```bash
node scripts/ingest-april-2026-crm.cjs
```

**Expected output:**
- `Parsed 9464 CSV rows`
- `Inserted 9464 rows into fact_crm_customer_snapshot`
- `Previous snapshot: 2026-02`
- `Derived 800–1500 new transitions`
- April stage distribution matches Section 6 numbers (ROOKIE 6594, LOYALIST 2121, REGULAR 583, WHALE 29)

**Step 3: Verify via SQL**

```bash
node -e "const db = require('better-sqlite3')('data/stack.db'); console.log(db.prepare('SELECT snapshot_month, COUNT(*) AS n FROM fact_crm_customer_snapshot GROUP BY snapshot_month').all());"
```

**Expected:** 5 rows, April = 9,464.

**Step 4: Run idempotency test**

Re-run the ingest script twice. Row counts should be identical.

**Step 5: Commit**

```bash
git add scripts/ingest-april-2026-crm.cjs
git commit -m "feat(ingest): April 2026 CRM snapshot + Feb→Apr transition derivation"
```

---

### Task 11: Add migration-guard warning to server startup

**Files:**
- Modify: `server/db/queries.ts` (`initializeDatabase` function)

**Step 1: Add the guard check**

After the existing migrations block in `initializeDatabase()`:

```typescript
  // Migration guard: warn if we have snapshots but no derived transitions.
  const snapMonths = db.prepare(
    "SELECT COUNT(DISTINCT snapshot_month) AS n FROM fact_crm_customer_snapshot WHERE snapshot_month != '2025-08'"
  ).get() as { n: number };
  const transitionCount = db.prepare(
    'SELECT COUNT(*) AS n FROM fact_stage_transition'
  ).get() as { n: number };

  if (snapMonths.n >= 2 && transitionCount.n === 0) {
    console.warn('⚠️  fact_stage_transition is empty but ' + snapMonths.n + ' CRM snapshots exist.');
    console.warn('    Run: node scripts/backfill-stage-transitions.cjs');
    console.warn('    Until backfill runs, Journey Analytics panels will show empty.');
  }
```

**Step 2: Typecheck**

```bash
npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add server/db/queries.ts
git commit -m "feat(db): warn on startup when transitions table is empty but snapshots exist"
```

---

## Phase 4 — UI updates

### Task 12: Add Journey Analytics 4-panel stack to CustomerHealthView

**Files:**
- Modify: `src/components/CustomerHealthView.tsx`
- Modify: `src/App.tsx` (pass `stageTransitions` prop)

**Step 1: Pass new props through App.tsx**

In `src/App.tsx`, find the CustomerHealthView render and add:

```typescript
<CustomerHealthView
  customers={store.state.crmCustomers}
  snapshots={snapshots}
  stageTransitions={store.state.stageTransitions}
/>
```

**Step 2: Update prop interface in CustomerHealthView.tsx**

```typescript
interface CustomerHealthViewProps {
  customers: CRMCustomerRecord[];
  snapshots: MonthlySnapshot[];
  stageTransitions: StageTransition[];
}
```

Add `StageTransition` import from `../types`.

Update the function signature to destructure `stageTransitions`.

**Step 3: Add a new `JourneyAnalytics` sub-component**

Insert inside the CustomerHealthView's render tree, below the existing LTV-by-stage cards and above the high-risk customer list. Reference full code in the design doc's Section 5. Minimum viable:

```typescript
function JourneyAnalytics({ transitions }: { transitions: StageTransition[] }) {
  const dwellByStage = useMemo(() => {
    const map = new Map<string, number[]>();
    for (const t of transitions) {
      if (t.direction === 'first_seen' || t.daysInFromStage === null) continue;
      if (!map.has(t.fromStage)) map.set(t.fromStage, []);
      map.get(t.fromStage)!.push(t.daysInFromStage);
    }
    return Array.from(map.entries()).map(([stage, days]) => {
      const sorted = [...days].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
      return { stage, median, n: days.length };
    }).sort((a, b) => STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage));
  }, [transitions]);

  const economicsByStage = useMemo(() => {
    const map = new Map<string, { spendSum: number; visitsSum: number; n: number }>();
    for (const t of transitions) {
      if (t.direction === 'first_seen' || t.spendInFromStage === null) continue;
      const agg = map.get(t.fromStage) ?? { spendSum: 0, visitsSum: 0, n: 0 };
      agg.spendSum += t.spendInFromStage;
      agg.visitsSum += t.visitsInFromStage || 0;
      agg.n++;
      map.set(t.fromStage, agg);
    }
    return Array.from(map.entries()).map(([stage, a]) => ({
      stage, avgSpend: a.n > 0 ? a.spendSum / a.n : 0, avgVisits: a.n > 0 ? a.visitsSum / a.n : 0, n: a.n,
    })).sort((a, b) => STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage));
  }, [transitions]);

  const matrix = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of transitions) {
      if (t.direction === 'first_seen') continue;
      const k = `${t.fromStage}→${t.toStage}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [transitions]);

  const recent = useMemo(() =>
    transitions.filter(t => t.direction !== 'first_seen').slice(0, 20),
  [transitions]);

  if (transitions.length === 0) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 text-sm text-amber-900">
        <div className="font-semibold mb-1">Journey Analytics: no data yet</div>
        Run <code className="bg-amber-100 px-1 rounded">node scripts/backfill-stage-transitions.cjs</code> to populate.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700">Journey Analytics</h3>
        <span className="text-xs text-gray-400">
          Based on {new Set(transitions.map(t => t.toSnapshot)).size} snapshots · confidence improves over time
        </span>
      </div>

      {/* Dwell time + economics side-by-side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Stage Dwell Time (median days)</div>
          {dwellByStage.map(d => (
            <div key={d.stage} className="flex items-center gap-3 py-1.5">
              <div className="w-20 text-sm text-gray-700">{d.stage}</div>
              <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
                <div className="bg-[#2D5A3D] h-full" style={{ width: `${Math.min(d.median, 180) / 180 * 100}%` }} />
              </div>
              <div className="w-20 text-sm text-gray-700 text-right">
                {d.median}d <span className="text-gray-400">(n={d.n})</span>
              </div>
            </div>
          ))}
        </div>

        <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Stage Economics (avg per customer)</div>
          <table className="w-full text-sm">
            <thead><tr className="text-xs text-gray-500 uppercase">
              <th className="text-left">Stage</th><th className="text-right">Avg Spend</th><th className="text-right">Avg Visits</th><th className="text-right">n</th>
            </tr></thead>
            <tbody>
              {economicsByStage.map(e => (
                <tr key={e.stage} className="border-t border-gray-50">
                  <td className="py-1.5 text-gray-700">{e.stage}</td>
                  <td className="py-1.5 text-right">${e.avgSpend.toFixed(2)}</td>
                  <td className="py-1.5 text-right">{e.avgVisits.toFixed(1)}</td>
                  <td className="py-1.5 text-right text-gray-400">{e.n}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Transition matrix + recent feed side-by-side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Transition Matrix (top flows)</div>
          <table className="w-full text-sm">
            <tbody>
              {matrix.slice(0, 10).map(([k, n]) => (
                <tr key={k} className="border-t border-gray-50">
                  <td className="py-1.5 text-gray-700">{k}</td>
                  <td className="py-1.5 text-right font-mono text-gray-900">{n}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm overflow-x-auto">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Recent Transitions</div>
          <table className="w-full text-xs">
            <thead><tr className="text-gray-500">
              <th className="text-left">Customer</th><th className="text-left">Change</th><th className="text-right">Spend</th><th className="text-right">Est. Date</th>
            </tr></thead>
            <tbody>
              {recent.map((t, i) => (
                <tr key={i} className="border-t border-gray-50">
                  <td className="py-1 font-mono text-gray-500">{t.customerId.slice(0, 8)}</td>
                  <td className="py-1 text-gray-700">{t.fromStage} → {t.toStage}</td>
                  <td className="py-1 text-right">${(t.spendInFromStage ?? 0).toFixed(0)}</td>
                  <td className="py-1 text-right text-gray-500">{t.estimatedTransitionDate}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const STAGE_ORDER = ['UNKNOWN', 'SLIDER', 'ROOKIE', 'REGULAR', 'LOYALIST', 'WHALE', 'CHURNED'];
```

**Step 4: Insert `<JourneyAnalytics transitions={stageTransitions} />` in the main CustomerHealthView render tree**

Place below existing LTV-by-stage cards.

**Step 5: Typecheck + visual verify**

```bash
npx tsc --noEmit
```

Reload preview, navigate to Customer Health tab, scroll down — verify all 4 panels render with real data.

**Step 6: Commit**

```bash
git add src/components/CustomerHealthView.tsx src/App.tsx
git commit -m "feat(ui): add Journey Analytics 4-panel stack to CustomerHealthView"
```

---

### Task 13: Upgrade AttributionView retention-months math

**Files:**
- Modify: `src/components/AttributionView.tsx`

**Step 1: Compute observed median tenure per stage from transitions**

Add a `useMemo` that computes observed median for each stage + sample size, with threshold logic.

```typescript
const THRESHOLDS: Record<string, number> = { ROOKIE: 200, REGULAR: 100, LOYALIST: 50, WHALE: 20 };
const HARDCODED_RETENTION_MONTHS: Record<string, number> = { ROOKIE: 6, REGULAR: 12, LOYALIST: 24, WHALE: 36 };

const observedRetention = useMemo(() => {
  const out: Record<string, { months: number; n: number; source: 'observed' | 'fallback' }> = {};
  for (const stage of ['ROOKIE', 'REGULAR', 'LOYALIST', 'WHALE']) {
    const samples = stageTransitions
      .filter(t => t.fromStage === stage && t.daysInFromStage !== null && t.direction !== 'first_seen')
      .map(t => t.daysInFromStage!);
    const n = samples.length;
    if (n >= THRESHOLDS[stage]) {
      samples.sort((a, b) => a - b);
      const medianDays = samples[Math.floor(n / 2)];
      out[stage] = { months: medianDays / 30, n, source: 'observed' };
    } else {
      out[stage] = { months: HARDCODED_RETENTION_MONTHS[stage], n, source: 'fallback' };
    }
  }
  return out;
}, [stageTransitions]);
```

**Step 2: Replace the hardcoded `RETENTION_MONTHS_ATTR` usage with `observedRetention[stage].months`**

Find the existing LTV calculation (around line 216). Swap in:

```typescript
const retention = observedRetention[c.journeyStage]?.months ?? 6;
```

**Step 3: Surface observed-vs-fallback in the UI**

Find the existing LTV tooltip / subtitle (around line 826) and add a small data-transparency note showing which stages are observed vs fallback:

```tsx
<div className="text-xs text-gray-400 mt-1">
  Retention: {Object.entries(observedRetention).map(([s, r]) =>
    `${s}: ${r.months.toFixed(1)}mo ${r.source === 'observed' ? `(n=${r.n})` : '(fallback)'}`
  ).join(' · ')}
</div>
```

**Step 4: Pass `stageTransitions` prop through App.tsx**

Same pattern as Task 12.

**Step 5: Typecheck + verify**

```bash
npx tsc --noEmit
```

Reload preview, navigate to CAC & ROI, verify LTV number doesn't blow up and the transparency note appears.

**Step 6: Commit**

```bash
git add src/components/AttributionView.tsx src/App.tsx
git commit -m "feat(ui): AttributionView uses observed retention when sample size clears threshold"
```

---

### Task 14: Update OverviewView funnel with journey-stage-based loyal count

**Files:**
- Modify: `src/components/OverviewView.tsx`

**Step 1: Tighten the "loyal" definition**

Find the existing funnel calc (around line 179):

```typescript
const loyal = customers.filter(c =>
  c.lifetimeVisits >= 3 || loyalStages.has(c.journeyStage)
).length;
```

Replace the ambiguous fallback with pure journey-stage:

```typescript
const loyal = customers.filter(c =>
  c.journeyStage === 'LOYALIST' || c.journeyStage === 'WHALE'
).length;
```

**Step 2: Typecheck + verify**

Reload Overview. Funnel's "loyal" count should match the post-April LOYALIST+WHALE total (≈2,150).

**Step 3: Commit**

```bash
git add src/components/OverviewView.tsx
git commit -m "feat(ui): Overview funnel loyal count = LOYALIST + WHALE (stage-based)"
```

---

## Phase 5 — Verification

### Task 15: Run Section 6 regression assertions

**Files:** None (verification only)

**Step 1: Run the full assertion script**

```bash
node -e '
const Database = require("better-sqlite3");
const db = new Database("data/stack.db", { readonly: true });

const checks = [
  { name: "CRM snapshot total rows",        get: () => db.prepare("SELECT COUNT(*) AS n FROM fact_crm_customer_snapshot").get().n, expected: 29205, tolerance: 0 },
  { name: "April 2026 snapshot rows",       get: () => db.prepare("SELECT COUNT(*) AS n FROM fact_crm_customer_snapshot WHERE snapshot_month=?").get("2026-04").n, expected: 9464, tolerance: 0 },
  { name: "April ROOKIE count",             get: () => db.prepare("SELECT COUNT(*) AS n FROM fact_crm_customer_snapshot WHERE snapshot_month=? AND journey_stage=?").get("2026-04", "ROOKIE").n, expected: 6594, tolerance: 0 },
  { name: "April REGULAR count",            get: () => db.prepare("SELECT COUNT(*) AS n FROM fact_crm_customer_snapshot WHERE snapshot_month=? AND journey_stage=?").get("2026-04", "REGULAR").n, expected: 583, tolerance: 0 },
  { name: "April LOYALIST count",           get: () => db.prepare("SELECT COUNT(*) AS n FROM fact_crm_customer_snapshot WHERE snapshot_month=? AND journey_stage=?").get("2026-04", "LOYALIST").n, expected: 2121, tolerance: 0 },
  { name: "April WHALE count",              get: () => db.prepare("SELECT COUNT(*) AS n FROM fact_crm_customer_snapshot WHERE snapshot_month=? AND journey_stage=?").get("2026-04", "WHALE").n, expected: 29, tolerance: 0 },
  { name: "Transitions in range (4k-7k)",   get: () => db.prepare("SELECT COUNT(*) AS n FROM fact_stage_transition").get().n, expected: [4000, 7000], range: true },
  { name: "Feb-Apr transitions (800-1500)", get: () => db.prepare("SELECT COUNT(*) AS n FROM fact_stage_transition WHERE to_snapshot=?").get("2026-04").n, expected: [800, 1500], range: true },
];

let failures = 0;
for (const c of checks) {
  const actual = c.get();
  let pass;
  if (c.range) pass = actual >= c.expected[0] && actual <= c.expected[1];
  else pass = Math.abs(actual - c.expected) <= c.tolerance;
  const status = pass ? "PASS" : "FAIL";
  console.log(`${status}: ${c.name} = ${actual} (expected ${JSON.stringify(c.expected)})`);
  if (!pass) failures++;
}

process.exit(failures > 0 ? 1 : 0);
'
```

**Expected:** all PASS; exit code 0.

**Step 2: If any FAIL, investigate**

- Off by a few rows → CSV parse edge case (trailing newline, quotes)
- Counts wildly off → likely a snapshot_month mismatch or snapshot DELETE didn't run

**Step 3: No commit — verification only**

---

### Task 16: UI regression sweep

**Files:** None (verification only)

**Step 1: Typecheck**

```bash
npx tsc --noEmit
```

**Expected:** clean.

**Step 2: Reload dashboard + visit every view**

For each: Overview, Performance, CAC & ROI, Customer Health, Menu Intel, Locations, Report, Upload Data, Settings:
- Page loads without error
- No console errors (check `preview_console_logs`)
- Charts render, no NaN or blank

**Step 3: Screenshot Customer Health → Journey Analytics section**

Confirm: 4 panels visible (Stage Dwell Time, Stage Economics, Transition Matrix, Recent Transitions), all populated with non-empty data.

**Step 4: Screenshot CAC & ROI**

Confirm: LTV transparency line renders with ROOKIE observed (n≈5000+) and WHALE fallback.

**Step 5: Commit verification artifacts (if any screenshots saved to repo)**

```bash
git status  # confirm no stray changes
```

---

## Done criteria

- [ ] All Task 1–16 commits landed
- [ ] Fixture test passes: `node scripts/test-stage-transitions-fixture.cjs` → PASS
- [ ] Backfill idempotent: two consecutive runs produce identical row counts
- [ ] April ingest idempotent: two consecutive runs produce identical row counts
- [ ] Section 6 assertions all PASS
- [ ] `npx tsc --noEmit` clean
- [ ] Dashboard renders all 9 views with zero console errors

---

## Notes for the executing engineer

1. **No vitest/jest in this codebase.** "Tests" are executable `.cjs` scripts that exit 1 on failure. Don't try to add a test framework; the pattern is established.
2. **Schema migrations apply on server startup**, not on raw Node queries. If you change `schema.ts`, restart the dev server for the new table/index to appear.
3. **Two `categorize.ts` files** exist (server + client). This project deliberately keeps them in sync by hand. Same pattern applies if you need to mirror types.
4. **The `data/stack.db-wal` file** may show large; that's normal WAL mode behavior. Don't commit it.
5. If backfill produces transition counts *outside* the 4,000–7,000 range, first check whether 2025-08 got included by accident (it should be excluded).

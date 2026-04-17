# Customer Journey Analytics — Design

**Date:** 2026-04-17
**Trigger:** April 2026 CRM export (`stackwellnesscafe_Customer_Export_2026_04_17_UTC_03_42_05_4ba9c50f-ac40-43e6-9521-8eb4ef7263ca_.csv`, 9,464 customers) + explicit user ask to track time-spent-between-segments and spend-per-stage.
**Scope:** Customer Health, Overview, and CAC & ROI views. New "Journey Analytics" surface inside CustomerHealthView.

## Goals

1. **Ingest April 2026 snapshot** into `fact_crm_customer_snapshot` (existing pipeline; same schema).
2. **Introduce lifecycle transition tracking** via a new materialized `fact_stage_transition` table populated from the existing snapshots plus every future snapshot.
3. **Answer three analytical questions at once** (user selected "all of the above"):
   - **Cohort progression:** "Of customers who signed up in Oct 2025, what % reached LOYALIST by April, and how long did it take?"
   - **Per-stage economics:** "What's the average spend/visits a ROOKIE accrues before leveling up or churning?"
   - **Bottleneck diagnosis:** "Which transitions are slowest? Where are customers getting stuck?"
4. **Upgrade AttributionView's LTV math** from hardcoded retention months to observed-where-available.
5. **Regress-check** all three affected views against concrete numerical predictions (Section 6).

## Non-goals

- Changing snapshot cadence from monthly to weekly. Future consideration.
- Building inferred-churn detection for customers who vanish from exports. Flagged as known limitation; needs ≥6 snapshots.
- Sankey diagram of transitions at v1. Matrix table now, Sankey later when data matures.
- Changing the existing `fact_crm_customer_snapshot` schema.

## Approach

**Approach 2: materialized `fact_stage_transition` table.** Chosen over pure-SQL-on-snapshots (slow, logic-scattered) and hybrid-columns-on-snapshot (halfway to #2, tech debt). Justification: user's D-tier ambition across 3 analytical dimensions + 3 view updates makes the one-time schema cost pay for itself.

## Section 1 — Schema

```sql
CREATE TABLE fact_stage_transition (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id              TEXT NOT NULL,
  from_stage               TEXT NOT NULL,     -- UNKNOWN|SLIDER|ROOKIE|REGULAR|LOYALIST|WHALE|CHURNED
  to_stage                 TEXT NOT NULL,
  direction                TEXT NOT NULL,     -- up|down|churn|reactivate|first_seen
  from_snapshot            TEXT NOT NULL,     -- YYYY-MM (prior)
  to_snapshot              TEXT NOT NULL,     -- YYYY-MM (current)
  days_in_from_stage       INTEGER,           -- NULL for first_seen
  spend_in_from_stage      REAL,              -- lifetime_spend delta (NULL for first_seen)
  visits_in_from_stage     INTEGER,
  from_lifetime_spend      REAL,
  to_lifetime_spend        REAL,
  from_lifetime_visits     INTEGER,
  to_lifetime_visits       INTEGER,
  estimated_transition_date TEXT,             -- YYYY-MM-DD, midpoint of interval
  detected_at              TEXT DEFAULT (datetime('now')),
  UNIQUE(customer_id, from_snapshot, to_snapshot)
);
CREATE INDEX idx_transition_customer ON fact_stage_transition(customer_id);
CREATE INDEX idx_transition_stages ON fact_stage_transition(from_stage, to_stage);
CREATE INDEX idx_transition_to_snapshot ON fact_stage_transition(to_snapshot);
```

**Canonical stage ladder** (used for direction computation):

| Stage | Rank | Notes |
|---|---|---|
| UNKNOWN | 0 | No classification yet |
| SLIDER | 1 | Active but declining |
| ROOKIE | 2 | First active stage |
| REGULAR | 3 | |
| LOYALIST | 4 | |
| WHALE | 5 | Top of ladder |
| CHURNED | -1 | Terminal sink — not on ladder |

**Direction rules:**
- Rank increased → `up`
- Rank decreased but not to CHURNED → `down`
- → CHURNED → `churn`
- CHURNED → any active stage → `reactivate`
- New customer's first observation → `first_seen`
- Same stage in consecutive snapshots → NOT recorded as a transition (no row)

## Section 2 — Ingest pipeline

### "Previous snapshot" defined precisely

For any snapshot `M`, **previous snapshot `P` = `MAX(snapshot_month)` from `fact_crm_customer_snapshot` WHERE `snapshot_month < M`**. The inter-snapshot interval is **variable** (backfill gaps: Oct→Jan ≈ 92 days, Jan→Feb ≈ 31 days, Feb→Apr ≈ 60 days). All downstream math (midpoint date, `days_in_from_stage`, error bars) uses the **actual day count** between `P` and `M`, never a hardcoded month value.

### Normal path (ingesting a new CSV)

1. Parse CSV → insert into `fact_crm_customer_snapshot` (existing pipeline unchanged — DELETE `snapshot_month` then INSERT all rows).
2. **New step (transition derivation):**
   - Compute `P = MAX(snapshot_month) WHERE snapshot_month < M`. If `P` is NULL (first snapshot ever), every customer row gets a `first_seen` transition; stop.
   - `DELETE FROM fact_stage_transition WHERE to_snapshot = M` (idempotent re-ingest).
   - For each customer present in both `P` and `M`:
     - If `stage_P == stage_M` → no row.
     - Else → insert one transition row (from_stage, to_stage, deltas, midpoint date).
   - For customers present ONLY in `M` (not in `P`): insert `first_seen` transitions.
   - For customers present in `P` but NOT in `M`: no action (see "inferred churn" limitation below).

### Backfill path (one-time on first migration)

Iterate existing snapshots in order: Oct 2025 → Jan 2026 → Feb 2026. Apply the normal-path step 2 to each adjacent pair. August 2025 is excluded — its all-UNKNOWN data would generate false `first_seen` transitions for 1,459 customers.

After backfill completes, ingest April 2026 CSV via the normal path, which adds Feb→Apr transitions to the already-populated table.

### Known limitation: silent churn via export trimming

**Incentivio's export is not guaranteed to include every customer on every pull** — dormant accounts can drop from the export without being labeled CHURNED. Our `fact_stage_transition` table therefore **under-reports attrition** whenever Incentivio trims rather than labels.

**Day-1 behavior:** do NOT auto-churn missing customers (too false-positive-prone with only 4 snapshots).

**Day-N future work** (not in this PR): add inferred-churn detection — "customer present in snapshot N-2 but absent from N-1 AND N" → synthesize a `CHURNED` transition with `direction='churn_inferred'`. Requires ≥3 consecutive snapshots to avoid false positives. Flag for revisit once we have ≥6 snapshots (roughly October 2026 at monthly cadence).

## Section 3 — Time-in-stage estimation

We only know state at snapshot boundaries. Given Feb = ROOKIE and April = REGULAR, the real transition could have happened any day in the ≈60-day window between those snapshots.

**Rule:** `estimated_transition_date = midpoint(previous_snapshot_date, current_snapshot_date)`.

**Error bars:** `± ½ × (inter_snapshot_interval_days)`. Concrete numbers for the current backfill:
- Oct → Jan: ≈92 days gap → **±46 days error**
- Jan → Feb: ≈31 days gap → **±15 days error**
- Feb → Apr: ≈60 days gap → **±30 days error**

Going forward, error scales with whatever snapshot cadence is used. At a steady monthly cadence error stabilizes at ±15d.

**`days_in_from_stage` computation:**

| Case | Formula |
|---|---|
| First-ever observed stage of a customer | `days = estimated_transition_date − account_created_date` (falls back to `from_snapshot` month start if `account_created_date` unavailable) |
| Subsequent stages | `days = this.estimated_transition_date − previous_transition.estimated_transition_date` |
| Customer's *current* stage (no exit yet) | NOT stored; computed on demand in UI as "days since last transition (or signup)" |

**UI tooltip display:** show the actual uncertainty bracket per row, e.g. `"Transition occurred between 2026-01-20 and 2026-02-18 (±15 days)"`, NOT a fixed-width ±15 window. Aggregate stats average out the error; per-customer displays acknowledge uncertainty honestly.

## Section 4 — Spend & visits allocation rule

```
spend_in_from_stage  = lifetime_spend_at_to_snapshot  − lifetime_spend_at_from_snapshot
visits_in_from_stage = lifetime_visits_at_to_snapshot − lifetime_visits_at_from_snapshot
```

**Rationale:** `lifetime_spend` and `lifetime_visits` are monotonically non-decreasing in Incentivio's data model, so the delta captures what accrued while the customer held `from_stage`.

**Edge cases:**
- `first_seen`: set `spend_in_from_stage = from_lifetime_spend` (full accrual since signup — represents what they spent as a ROOKIE before we first observed them).
- ROOKIE who never purchased before upgrading: delta = 0. Correct and expected.
- CHURN transition: delta = spend accrued in their last active stage before going dormant.
- Data anomaly (delta < 0): should never happen; add assertion in ingest script to log a warning and clamp to 0.

## Section 5 — UI surfaces

### Primary: new "Journey Analytics" card stack in CustomerHealthView

Positioned below existing LTV-by-stage cards, above the high-risk customer list. Four panels:

| Panel | Visualization | SQL |
|---|---|---|
| **Stage Dwell Time** | Horizontal bar: median days per stage | `SELECT from_stage, MEDIAN(days_in_from_stage) FROM fact_stage_transition WHERE days_in_from_stage IS NOT NULL GROUP BY from_stage ORDER BY stage_rank` |
| **Stage Economics** | Grouped bars: avg spend + avg visits per stage | `SELECT from_stage, AVG(spend_in_from_stage), AVG(visits_in_from_stage) GROUP BY from_stage` |
| **Transition Matrix** | Table: from-stage rows × to-stage columns, counts + % | `SELECT from_stage, to_stage, COUNT(*) GROUP BY from_stage, to_stage` |
| **Recent Transitions Feed** | Table: last 20 detected transitions | `SELECT * FROM fact_stage_transition ORDER BY detected_at DESC LIMIT 20` |

**v1 uses a transition matrix, NOT a Sankey.** With only 4 intervals of data at launch and most customers having 0–1 transitions, a Sankey would look half-empty and misleading. Matrix table shows exact counts and is honest about sparsity. **Sankey promotes to v2 when ≥6 snapshots exist (≈August 2026).**

**Data maturity label (displayed on the panel):**
> "Journey progression from October 2025. Based on 4 snapshots. Confidence improves with each monthly export — fuller picture expected by August 2026."

### Secondary: AttributionView retention-months upgrade

Today: hardcoded `RETENTION_MONTHS_ATTR = { WHALE: 36, LOYALIST: 24, REGULAR: 12, ROOKIE: 6 }`.

**New behavior:** observed median tenure from `fact_stage_transition`, with stage-specific fallback thresholds:

| Stage | Sample threshold | Rationale |
|---|---|---|
| ROOKIE | 200 observed transitions out of ROOKIE | Cheap to observe; tightens quickly |
| REGULAR | 100 | Moderate cohort |
| LOYALIST | 50 | Smaller cohort, harder to observe |
| WHALE | 20 | Only 29 WHALEs total in April; stricter = never |

- **Below threshold:** fall back to hardcoded `RETENTION_MONTHS_ATTR` value.
- **At or above threshold:** use observed **median** tenure (median, not mean — robust to outliers like the ROOKIE who was dormant for 400 days).
- **UI transparency:** display "Observed: 14.2 mo (n=127)" when measured, "Fallback: 12 mo (n=11, below threshold)" when hardcoded. Users should see which mode is in effect.

**No Bayesian blended weighting.** Overkill for v1; sharp cutoff is auditable.

### Secondary: OverviewView funnel tweak

Replace the existing hardcoded "loyal" customer definition in the funnel with `LOYALIST + WHALE` count using the latest snapshot. Small change, more accurate with April data.

## Section 6 — Regression assertions (numerical, testable)

Every number below is derived from data already in hand (Feb snapshot + April CSV raw counts). Any deviation >5% relative means the pipeline is broken.

### Database-level

| Check | Before | Expected |
|---|---|---|
| `fact_crm_customer_snapshot` total rows | 19,741 | **29,205** (+9,464 April rows) |
| Rows WHERE `snapshot_month='2026-04'` | 0 | **9,464 exactly** |
| Distinct customer_ids | 8,139 | **~11,500** (+≈3,400 never-seen-before) |
| `fact_stage_transition` total rows | 0 | **4,000–7,000** |
| Transitions WHERE `to_snapshot='2026-04'` | 0 | **800–1,500** |
| Transitions WHERE `direction='first_seen'` | 0 | **~11,500** |

### CustomerHealthView @ month filter = April 2026

| Stage | Feb (known) | Apr expected | Δ % |
|---|---|---|---|
| ROOKIE | 5,742 (70.6%) | **6,594 (69.7%)** | +14.8% |
| REGULAR | 373 (4.6%) | **583 (6.2%)** | **+56.3%** ← fastest |
| LOYALIST | 1,724 (21.2%) | **2,121 (22.4%)** | +23.0% |
| WHALE | 19 (0.2%) | **29 (0.3%)** | +52.6% |
| UNKNOWN/"-" | ~275 | 137 | — |

**Business validation:** REGULAR and WHALE growing ~50% MoM² is the "moving customers UP the ladder" story, not just top-of-funnel acquisition.

### OverviewView (2026 YTD)

- **CAC YTD:** was $27. Expected **$28–$34** range. <$22 or >$40 = attribution math bug.
- **New customers YTD:** was 2,074. Expected **~3,400** (all 2026 signups through April).
- **Est ROI (YTD):** was 10.2x. Expected **9.5x–11.5x**.

### AttributionView

- **Observed retention threshold gates:** at launch only ROOKIE (~5,500 observations) clears. REGULAR (~300) below 100 threshold → fallback. LOYALIST (~400) at 50 threshold → borderline. WHALE (~10) far below 20 → fallback.

### Journey Analytics (new panels)

- **Stage Dwell Time (median):** ROOKIE 60–120 days; REGULAR 45–90 days; LOYALIST/WHALE not predictable (insufficient exits).
- **Transition Matrix dominant cells:** ROOKIE→REGULAR, REGULAR→LOYALIST, LOYALIST→LOYALIST (stable). CHURNED row sparse (known limitation).
- **Recent Transitions feed:** first 20 dominated by Feb→Apr pair, mostly `direction='up'`.

### No regressions

- Console: **0 errors, 0 warnings** during dashboard load
- All existing charts: render with April data, no NaN, no missing labels
- `npx tsc --noEmit`: clean
- Store hydration: <2s

## Rollback / re-ingest contract

Every ingest is idempotent and reversible at `to_snapshot` granularity.

1. On ingest of snapshot `M`: `DELETE FROM fact_crm_customer_snapshot WHERE snapshot_month = M` then re-insert (unchanged from current behavior).
2. **New:** also `DELETE FROM fact_stage_transition WHERE to_snapshot = M`, then re-derive transitions for the (P, M) pair.
3. Transitions for pairs NOT involving `M` (e.g., Oct→Jan when re-ingesting April) are untouched.
4. **Emergency nuclear option:** `DELETE FROM fact_stage_transition;` then re-run backfill. Deterministic and safe.
5. **Diff log on every re-ingest:** "Re-ingested snapshot 2026-04. Before: 847 transitions to this snapshot. After: 851. Delta: +4 new, 2 changed stages, 0 removed."

## Test coverage

**Direction-computation fixture (required).** Hand-authored test data:
- Customer A: UNKNOWN (Oct) → ROOKIE (Jan) → REGULAR (Feb) → LOYALIST (Apr). Expected directions: `first_seen`, `up`, `up`, `up`.
- Customer B: ROOKIE (Jan) → ROOKIE (Feb) → CHURNED (Apr). Expected: `first_seen`, (no row), `churn`.
- Customer C: LOYALIST (Jan) → REGULAR (Feb) → LOYALIST (Apr). Expected: `first_seen`, `down`, `up`.
- Customer D: CHURNED (Oct) → ROOKIE (Jan). Expected: `first_seen`, `reactivate`.

Stage-rank ordering and CHURNED=-1 are fiddly; regressions here are silent without this fixture.

## Migration guard

The DB currently has 4 existing CRM snapshots. When someone pulls this branch and runs `npm run dev`, the schema migration creates `fact_stage_transition` empty. The backfill is a separate script (`scripts/backfill-stage-transitions.cjs`, not auto-run on startup).

**Decision:** Ingest script checks on first load: if `fact_stage_transition` has 0 rows but `fact_crm_customer_snapshot` has multiple snapshots, log a prominent warning to the server console:

```
⚠️ fact_stage_transition is empty but 4 CRM snapshots exist.
   Run: node scripts/backfill-stage-transitions.cjs
   (until backfill runs, Journey Analytics panels will show empty)
```

UI-side: Journey Analytics panels render an empty-state card with the same instruction, rather than NaN or blank charts.

## File manifest

### New files
- `scripts/backfill-stage-transitions.cjs` — one-time derive all transitions from existing snapshots
- `scripts/ingest-april-2026-crm.cjs` — wraps existing CRM ingest + calls transition-derive for Feb→Apr pair
- `scripts/test-stage-transitions-fixture.cjs` — runs the direction-computation fixture, exits 1 on mismatch

### Modified files
- `server/db/schema.ts` — add `FACT_STAGE_TRANSITION` + `TABLE_NAMES` entry
- `server/types.ts` + `src/types.ts` — add `StageTransition` interface; add `stageTransitions` to `DashboardState`
- `server/db/queries.ts` — `insertStageTransitions`, `getStageTransitions`, `getStageTransitionStats`
- `server/viteDataPlugin.ts` — wire `stageTransitions` into `/api/data/state`; add `/api/data/stage-transitions` endpoint
- `src/api/dataApi.ts` — add to `ServerState` interface
- `src/store.ts` — include in initial state + hydration paths
- `src/components/CustomerHealthView.tsx` — add 4-panel Journey Analytics card stack
- `src/components/AttributionView.tsx` — replace hardcoded RETENTION_MONTHS_ATTR with observed-or-fallback lookup
- `src/components/OverviewView.tsx` — update loyal-customer count to use journey stages

## Success criteria

- [ ] April 2026 CSV ingested; row counts match Section 6 assertions exactly
- [ ] `fact_stage_transition` populated via backfill; row counts fall within Section 6 predicted ranges
- [ ] Test fixture passes — all 4 hand-authored customer journeys produce expected transition rows
- [ ] Journey Analytics panels render in CustomerHealthView with non-empty data
- [ ] AttributionView retention-months display shows "Observed: X mo (n=...)" for ROOKIE and "Fallback: X mo" for WHALE
- [ ] OverviewView, AttributionView, CustomerHealthView render with 0 console errors, 0 NaN, 0 TypeScript errors
- [ ] Re-ingesting April CSV twice produces identical transition counts (idempotency)

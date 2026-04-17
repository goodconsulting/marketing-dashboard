# March 2026 Paid Media Consolidation — Design

**Date:** 2026-04-16
**Context:** Extend the dashboard to capture Yelp, AMP CTV, and Lamar OOH as first-class paid media channels for March 2026 reporting, using a consolidated JSON report as the source of truth.

## Goals

1. Persist Yelp, AMP CTV, and Lamar OOH March 2026 performance data in SQLite.
2. Render a unified "Channel Summary" table in the Performance view showing all paid channels side-by-side (Meta, Google, Yelp, AMP CTV, Lamar OOH).
3. Establish a durable pattern for small/long-tail paid channels so adding TikTok, LinkedIn, etc. in the future is a one-row insert, not a schema change.

## Non-goals

- Reworking Meta/Google tables. They stay as-is (dedicated tables each).
- Ingesting platform/daypart/publisher mix for AMP CTV (rich per-campaign breakdowns from the JSON). Future work.
- Filling in missing AMP CTV spend. JSON flags it as pending invoice; we record `NULL` and surface the gap.

## Schema

### New: `fact_other_campaign`

Generic long-tail paid media table. One row per (month, source, campaign_name).

```sql
CREATE TABLE fact_other_campaign (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  month         TEXT NOT NULL,
  source        TEXT NOT NULL,       -- 'yelp', 'tiktok', 'linkedin', etc.
  campaign_name TEXT NOT NULL,       -- store name for local channels
  spend         REAL DEFAULT 0,
  impressions   INTEGER DEFAULT 0,
  clicks        INTEGER DEFAULT 0,   -- page_visits for Yelp
  conversions   INTEGER DEFAULT 0,   -- leads for Yelp
  ctr           REAL DEFAULT 0,
  cpc           REAL DEFAULT 0,
  cost_per_conv REAL DEFAULT 0,
  window_start  TEXT,                -- for non-calendar-month windows
  window_end    TEXT,
  extra         TEXT,                -- JSON for channel-specific fields
  UNIQUE(month, source, campaign_name)
);
```

### Reused: `fact_amp_campaign`

Existing table (8 rows, Jan-Feb 2026 CTV + email precedent). March 2026 row:
- `campaign_type = 'streaming'`
- `campaign_name = 'AMP CTV — Des Moines Metro'`
- `location = 'Des Moines / Ames DMA'`
- Metrics: 81,995 imps · 8,601 reach · 9.53 freq · 80,658 completed views · 98.37 VCR · 672.15 viewing hours
- Spend: NULL (pending AMP invoice)

### Reused: `fact_billboard_monthly`

Existing table (3 rows, Dec 2025 – Feb 2026 Lamar precedent). March 2026 row:
- `panel_id = '232-070050'`
- `plays_guaranteed = 38688`, `plays_delivered = 43495`
- `impressions_guaranteed = 1312664`, `impressions_delivered = 1475763`
- `variance_pct = 12.43` (delivered 112.4% of guarantee)
- `num_creatives = 4` (Cucumber Cooler, Southwest Crunch, Caramel Apple, Golden Grain)
- `contracted_days = 31`

## Ingestion

One script: `scripts/ingest-mar-2026-paid-media-consolidated.cjs`

1. Save JSON payload to `data/mar_2026_paid_media_consolidated.json` for reproducibility.
2. Parse JSON → upsert into three tables (new Yelp + AMP extension + Lamar extension).
3. Verify totals against JSON `channel_summary` block.
4. Flag spend gaps (AMP CTV) for human follow-up.

## Dashboard integration (Option β — Performance view Channel Summary table)

Files to change:
- `server/db/schema.ts` — add `FACT_OTHER_CAMPAIGN` CREATE TABLE block + include in `SCHEMA_STATEMENTS` and `TABLE_NAMES`.
- `server/db/queries.ts` — add `insertOtherCampaigns()` + `getOtherCampaigns(month)` + include in `/api/data/state` response.
- `server/types.ts` + `src/types.ts` — add `OtherCampaign` interface.
- `src/store.ts` — include `otherCampaigns` in `DashboardState`.
- `src/components/PerformanceView.tsx` — add a "Channel Summary" table at top: one row per channel (Meta, Google, Yelp, AMP CTV, Lamar OOH) with spend, impressions, clicks/visits, conversions, CTR, cost-per-conv.

## Trade-offs / open questions

1. **AMP CTV spend is NULL** in the JSON — the Channel Summary table will show a dash or "(pending invoice)". Acceptable short-term.
2. **Yelp window mismatch** — Yelp's data is a rolling 30-day window (~3/17 – 4/16), not a clean March. We store the `window_start`/`window_end` fields and note in UI.
3. **Lamar has no click/conversion data** (OOH by nature). The Channel Summary table will show dashes for those columns on the Lamar row.

## Success criteria

- [ ] `fact_other_campaign` exists, has Yelp March 2026 row with `spend=403.20`.
- [ ] `fact_amp_campaign` has 9 rows (8 existing + 1 March CTV row).
- [ ] `fact_billboard_monthly` has 4 rows (3 existing + 1 March Lamar row).
- [ ] Performance view renders a Channel Summary table with all 5 paid channels visible for March 2026.
- [ ] Totals in dashboard match JSON `channel_summary` block (modulo NULL spend for AMP CTV).

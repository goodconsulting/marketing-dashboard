# CLAUDE.md — Stack Marketing Dashboard

## Quick Reference

```bash
npm run dev          # Start dev server (localhost:5173) — SQLite + Vite middleware
npm run build        # Type-check + production build
npm run lint         # ESLint
npx tsc --noEmit     # Type-check only (fast)
npm run preview      # Preview production build
```

## Tech Stack

| Layer | Library | Version |
|-------|---------|---------|
| Framework | React | 19.2 |
| Language | TypeScript | 5.9 |
| Bundler | Vite | 7.3 |
| Styling | Tailwind CSS | 4.2 |
| Charts | Recharts | 3.7 |
| Database | better-sqlite3 | 12.6 |
| CSV Parsing | PapaParse | 5.5 |
| Excel Parsing | SheetJS (xlsx) | 0.18 |
| Icons | Lucide React | 0.577 |
| Dates | date-fns | 4.1 |

## TypeScript Constraints

- `verbatimModuleSyntax: true` — use `import type` for type-only imports
- `noUnusedLocals: true` / `noUnusedParameters: true` — no dead code
- `erasableSyntaxOnly: true` — no `const enum` or `namespace`
- `strict: true` — full strict mode
- Target: ES2022, Module: ESNext, JSX: react-jsx
- Separate configs: `tsconfig.node.json` for `server/**/*.ts`, `tsconfig.app.json` for `src/**/*.ts`

## Architecture

### Data Flow

All data lives in a local SQLite database (`data/stack.db`). The React frontend communicates with a server-side API via Vite dev middleware — zero external infrastructure.

```
CSV/XLSX Files
  ↓ (drag & drop)
POST /api/data/upload  ← raw file body
  ↓
Server Parser (server/parsers/*)
  ├── detectSourceType(filename)       → filename pattern matching
  ├── detectSourceFromHeaders(file)    → header-based fallback
  ├── Parse into typed records
  ↓
In-Memory Staging (30 min TTL)
  ├── Dedup analysis against existing DB data
  ├── Returns UploadPreview { source, month, recordCount, dedup, sampleRows }
  ↓
User Confirms in UI
  ↓
POST /api/data/upload/confirm
  ├── BEGIN TRANSACTION
  ├── Write to SQLite (dedup strategy per source)
  ├── COMMIT + log to upload_log
  ↓
GET /api/data/state  ← client refreshes
  ├── Server-computed MonthlySnapshot[] (SQL aggregation)
  ├── All data slices returned in one payload
  ↓
React State → View Components
```

### Server-Side SQLite

- **Connection**: `server/db/connection.ts` — singleton `better-sqlite3` instance, WAL journal mode
- **Schema**: `server/db/schema.ts` — 12 tables with dedup indexes, auto-migration on startup
- **Queries**: `server/db/queries.ts` — prepared statement wrappers, snapshot aggregation SQL
- **DB file**: `data/stack.db` (gitignored)

### API Layer

Vite dev middleware at `/api/data/*` (`server/viteDataPlugin.ts`). Raw Node.js request handlers, no Express.

### State Management

Single `useState<DashboardState>` hook in `src/store.ts`. Hydrates from `GET /api/data/state` on mount. Store exposes `refresh()` to re-fetch after uploads.

Snapshots are computed server-side via SQL aggregation (no client-side `useMemo`).

### Code Splitting

All 9 view components are lazy-loaded via `React.lazy()` in `App.tsx`. Named exports use the `.then(m => ({ default: m.Name }))` pattern. Views are wrapped in `<Suspense>` with a spinner fallback.

### Notifications

Context-based toast system in `src/components/Toast.tsx`. Uses React 19 `<Context value={}>` pattern. Types: success, error, warning, info. Auto-dismiss (5s default, 8s for errors).

## File Structure

```
src/
├── api/
│   ├── dataApi.ts               # Fetch wrappers for /api/data/* endpoints
│   └── toastApi.ts              # Toast POS API client
├── components/
│   ├── Header.tsx               # Tab navigation (10 tabs)
│   ├── FileUpload.tsx           # Upload with preview/confirm/cancel flow
│   ├── KPICard.tsx              # Reusable metric card
│   ├── ExportButton.tsx         # CSV/JSON download dropdown
│   ├── Toast.tsx                # Notification system (context + provider)
│   ├── ToastConnectionCard.tsx  # Toast POS connection UI
│   ├── SettingsView.tsx         # App configuration
│   ├── OverviewView.tsx         # Dashboard summary KPIs + charts
│   ├── SpendView.tsx            # Budget vs actual spend
│   ├── PerformanceView.tsx      # Meta + Google campaign metrics
│   ├── AttributionView.tsx      # CAC, ROI, new customer attribution
│   ├── CustomerHealthView.tsx   # CRM segments, attrition, LTV
│   ├── MenuIntelligenceView.tsx # BCG quadrant menu analysis
│   ├── LocationComparatorView.tsx # Multi-location revenue comparison
│   └── ReportView.tsx           # Period-over-period reports (MoM/QoQ/YoY)
├── hooks/
│   └── useToastSync.ts          # Toast POS data sync hook
├── utils/
│   ├── categorize.ts            # Expense vendor → category mapping
│   ├── export.ts                # CSV/JSON export utility
│   ├── periodComparison.ts      # MoM, QoQ, YoY comparison logic
│   └── theme.ts                 # Centralized brand/chart colors
├── App.tsx                      # Root: lazy views, tab routing
├── store.ts                     # Server-backed state (fetch + refresh)
├── types.ts                     # All TypeScript interfaces
├── main.tsx                     # Entry: StrictMode + ToastProvider
└── index.css                    # Tailwind import + CSS custom properties

server/
├── db/
│   ├── connection.ts            # better-sqlite3 singleton (WAL mode)
│   ├── schema.ts                # CREATE TABLE + indexes + migrations
│   └── queries.ts               # Prepared statements + snapshot SQL
├── parsers/
│   ├── detect.ts                # Source detection (filename + headers)
│   ├── crm.ts                   # Incentivio CRM (~44 fields)
│   ├── menuIntelligence.ts      # Menu intelligence (~35 fields)
│   ├── expenses.ts              # QuickBooks CSV/XLSX
│   ├── meta.ts                  # Meta Ads campaigns
│   ├── google.ts                # Google Ads campaigns + daily
│   ├── toast.ts                 # Toast POS CSV
│   ├── budget.ts                # Operating budget XLSX
│   ├── categorize.ts            # Expense category mapping
│   └── index.ts                 # Barrel export
├── api/
│   └── uploadPipeline.ts        # Stage/confirm/cancel with dedup
├── viteDataPlugin.ts            # Vite middleware: /api/data/* routes
├── toastProxy.ts                # Toast API proxy handler
├── viteToastPlugin.ts           # Vite middleware: /api/toast/*
└── types.ts                     # Server-side type definitions
```

## API Routes

### Upload Pipeline
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/data/upload?filename=&month=` | Stage file for preview (raw body) |
| `POST` | `/api/data/upload/confirm` | Confirm staged upload `{ uploadId }` |
| `POST` | `/api/data/upload/cancel` | Cancel staged upload `{ uploadId }` |

### Data Retrieval
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/data/state` | Full dashboard state (initial hydration) |
| `GET` | `/api/data/snapshots` | Computed MonthlySnapshot[] |
| `GET` | `/api/data/expenses?month=` | Expenses |
| `GET` | `/api/data/meta-campaigns?month=` | Meta campaigns |
| `GET` | `/api/data/google-campaigns?month=` | Google campaigns |
| `GET` | `/api/data/google-daily?from=&to=` | Google daily metrics |
| `GET` | `/api/data/toast-sales?month=` | Toast POS sales |
| `GET` | `/api/data/crm-customers?month=&stage=` | CRM customer records |
| `GET` | `/api/data/menu-intelligence?month=` | Menu intelligence items |
| `GET` | `/api/data/incentivio-metrics` | Incentivio aggregate metrics |
| `GET` | `/api/data/budgets` | Monthly budgets |
| `GET` | `/api/data/uploads` | Upload history log |
| `GET` | `/api/data/health` | Database health info |

### Management
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/data/toast-sales` | Direct Toast insert `{ sales: [...] }` |
| `PUT` | `/api/data/settings/:key` | Update setting `{ value }` |
| `DELETE` | `/api/data/all` | Clear all database data |

## SQLite Schema

Database: `data/stack.db` (WAL mode, auto-created on first `npm run dev`)

### Fact Tables

| Table | Dedup Key (UNIQUE) | Strategy |
|-------|-------------------|----------|
| `fact_expense` | `(date, vendor, amount)` | `INSERT OR IGNORE` |
| `fact_meta_campaign` | `(month, campaign_name)` | `INSERT OR IGNORE` |
| `fact_google_campaign` | `(month, campaign_name)` | `INSERT OR IGNORE` |
| `fact_google_daily` | `date` (PK) | `INSERT OR REPLACE` |
| `fact_toast_sales` | `(month, location)` | `INSERT OR REPLACE` |
| `fact_crm_customer_snapshot` | `(customer_id, snapshot_month)` | DELETE month then INSERT |
| `fact_menu_item_snapshot` | `(item_name, snapshot_month)` | DELETE month then INSERT |
| `fact_incentivio_metrics` | `month` (PK) | `INSERT OR REPLACE` |
| `fact_budget` | `month` (PK) | `INSERT OR REPLACE` |

### Meta Tables
- `upload_log` — file upload history with status and dedup summary
- `settings` — key-value app configuration

## CSV Format Reference

### QuickBooks Expenses

| Column | Required | Notes |
|--------|----------|-------|
| `Transaction date` or `Date` | Yes | Any date format (auto-detected) |
| `Name` or `Vendor` | Yes | Vendor name |
| `Memo/Description` or `Description` | No | Used for auto-categorization |
| `Amount` | Yes | Can include `$` and commas |

Also supports XLSX/XLS format with same columns.

### Meta (Facebook/Instagram) Campaigns

Filename must contain `campaign` + one of: `meta`, `facebook`, `wellness-campaigns`, `brightn`

| Column | Required | Notes |
|--------|----------|-------|
| `Reporting starts` | Yes | Date → YYYY-MM |
| `Campaign name` | Yes | |
| `Amount spent (USD)` | Yes | |
| `Impressions` | Yes | |
| `Reach` | No | |
| `Results` | No | Fallback for clicks |
| `Link clicks` | No | Preferred click metric |
| `Cost per results` | No | |
| `Result indicator` | No | e.g., "Link Clicks" |

### Google Ads — Campaign Summary

Filename contains `google` or `gads` (but not `time_series`/`timeseries`)

| Column | Required | Notes |
|--------|----------|-------|
| `Campaign Name` or `Campaign` | Yes | |
| `Cost` | Yes | Can include `$` |
| `Clicks` | Yes | |
| `Impressions` | Yes | |
| `CTR` | No | Percentage string |

### Google Ads — Daily Time Series

Filename contains `time_series` or `timeseries`

| Column | Required | Notes |
|--------|----------|-------|
| `Date` | Yes | → YYYY-MM-DD |
| `Clicks` | Yes | |
| `Impressions` | Yes | |
| `Avg. CPC` | Yes | Can include `$` |
| `Cost` | Yes | Can include `$` |

### Toast POS Sales

Filename contains `toast` or `productmix`

| Column | Required | Notes |
|--------|----------|-------|
| `Location` / `Restaurant` / `Store` | Yes | One of these |
| `Date` / `Business Date` / `Report Date` | Yes | One of these |
| `Gross Sales` / `Total Sales` | Yes | |
| `Net Sales` | No | |
| `Orders` / `Order Count` / `Checks` | Yes | |
| `Discounts` / `Discount Total` | No | |

Rows with same month+location in a single file are aggregated.

### Incentivio Customer Export (CRM — ~44 fields)

Filename contains `customer_export`, `incentivio`, `loyalty`, `giftpool`, or `kpi`

Parses ~44 fields per customer including: identity, journey stage, core spend/frequency, extended spend metrics (avg basket/month, purchases/week), percentiles, referrals (lifetime referrals, referral orders, referral spend), engagement flags (SMS opt, valid email), and demographics (when available).

Produces both `IncentivioMetrics` (aggregated) and `CRMCustomerRecord[]` (per-customer).

### Menu Intelligence (~35 fields)

Filename contains `menu_intelligence`

Parses ~35 fields per menu item including: score, price, parent group, item type, over/under state, volume metrics (sold last year/month by frequent/infrequent), avg orders/month, avg sold/month, penetration %, daypart breakdowns (breakfast/lunch/dinner by customer type), and computed ratios.

Items are classified into BCG quadrants (star/plow_horse/puzzle/dog) based on median volume and revenue.

### Operating Budget (XLSX)

Filename contains `budget` or `operating budget`

Looks for a sheet named `STACK` (falls back to first sheet). Expects a row with date columns (B onwards) and a row containing "Advertising" or "Marketing". Budget amounts are split into 6 categories using default allocation percentages.

## Brand Colors

Defined in `src/utils/theme.ts` and `src/index.css`:

| Token | Hex | Usage |
|-------|-----|-------|
| `--stack-green` | `#2D5A3D` | Primary brand |
| `--stack-green-light` | `#4A7C5C` | Hover states |
| `--stack-meadow` | `#7CB342` | Accent/secondary |
| `--stack-linen` | `#F5F0E8` | Background |
| `--stack-dark` | `#1A1A2E` | Dark text |

## Toast POS API Integration

Dev-only proxy at `/api/toast/*` via Vite middleware (`server/viteToastPlugin.ts`). Credentials loaded from `.env` (non-VITE_ prefixed, server-side only). API data pushed directly to SQLite via `POST /api/data/toast-sales`.

# CLAUDE.md — Stack Marketing Dashboard

## Quick Reference

```bash
npm run dev          # Start dev server (localhost:5173)
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
| Persistence | idb (IndexedDB) | 8.0 |
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

## Architecture

### State Management

Single `useState<DashboardState>` hook in `src/store.ts`. All 13 data slices live in one object. State updates use `setState(prev => ({ ...prev, slice: newValue }))`.

Derived data: `snapshots` computed via `useMemo` with 9 granular dependency array entries (individual state slices, not the full state object). This ensures snapshots only recompute when actual data changes, not when unrelated slices (uploadedFiles, etc.) update.

### Code Splitting

All 9 view components are lazy-loaded via `React.lazy()` in `App.tsx`. Named exports use the `.then(m => ({ default: m.Name }))` pattern. Views are wrapped in `<Suspense>` with a spinner fallback.

### Persistence

IndexedDB via `idb` library in `src/db.ts`. All writes use `withRetry(fn, { retries: 2, delayMs: 500 })` with exponential backoff. Failed writes surface toast notifications. Data hydrates from IndexedDB on mount, with one-time localStorage migration for upgrades.

### Notifications

Context-based toast system in `src/components/Toast.tsx`. Uses React 19 `<Context value={}>` pattern. Types: success, error, warning, info. Auto-dismiss (5s default, 8s for errors).

## File Structure

```
src/
├── api/
│   └── toastApi.ts              # Toast POS API client
├── components/
│   ├── Header.tsx               # Tab navigation (10 tabs)
│   ├── FileUpload.tsx           # CSV/XLSX upload + source detection
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
│   ├── parsers.ts               # CSV/XLSX parsers for all data sources
│   ├── categorize.ts            # Expense vendor → category mapping
│   ├── export.ts                # CSV/JSON export utility
│   ├── periodComparison.ts      # MoM, QoQ, YoY comparison logic
│   └── theme.ts                 # Centralized brand/chart colors
├── App.tsx                      # Root: lazy views, tab routing, snapshot passing
├── store.ts                     # useState store + useMemo snapshots
├── db.ts                        # IndexedDB schema, reads, writes, migrations
├── types.ts                     # All TypeScript interfaces
├── main.tsx                     # Entry: StrictMode + ToastProvider
└── index.css                    # Tailwind import + CSS custom properties

server/
├── toastProxy.ts                # Toast API proxy handler
└── viteToastPlugin.ts           # Vite dev middleware for /api/toast/*
```

## Data Pipeline

```
CSV/XLSX Files
  ↓
FileUpload.processFile()
  ├── detectSourceType(filename)       → filename pattern matching
  ├── detectSourceFromHeaders(file)    → header-based fallback
  ↓
Parser (src/utils/parsers.ts)
  ├── parseExpensesCSV / parseExpensesXLSX
  ├── parseMetaCampaigns
  ├── parseGoogleCampaigns / parseGoogleDaily
  ├── parseToastCSV
  ├── parseIncentivioCustomers  →  CRMCustomerRecord[] + IncentivioMetrics
  ├── parseMenuIntelligence
  └── parseBudgetXLSX
  ↓
Store Action (src/store.ts)
  ├── Deduplicates against existing state
  ├── Persists to IndexedDB (async, with retry)
  ├── Updates state slice → triggers re-render
  ↓
useMemo Snapshot Computation
  ├── Aggregates all data by month
  ├── Computes derived metrics: CAC, ROI, LTV, segment counts
  ├── Returns MonthlySnapshot[]
  ↓
View Components
  ├── Each view receives snapshots and derives local display data
  └── ExportButton → CSV/JSON download of current filtered data
```

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

### Incentivio Customer Export

Filename contains `customer_export`, `incentivio`, `loyalty`, `giftpool`, or `kpi`

| Column | Required | Notes |
|--------|----------|-------|
| `Customer ID` | Yes | Filters empty rows |
| `First Name`, `Last Name` | No | |
| `Email`, `Phone` | No | |
| `Guest Journey Stage` | No | Normalized to: WHALE, LOYALIST, REGULAR, ROOKIE, CHURNED, SLIDER, UNKNOWN |
| `Reach Location` / `Location` | No | |
| `Account Created Date` | No | ISO date |
| `Last Visit Date` / `Last Order Date` | No | ISO date |
| `Lifetime Spend` | No | |
| `Lifetime Visits` | No | |
| `Average Basket Value` | No | |
| `Last 90 day Spend` | No | |
| `Last 90 Days Orders` | No | |
| `Loyalty Balance` | No | |
| `Email Opt In` | No | "true"/"yes" → boolean |
| `SMS Opt In` | No | "true"/"yes" → boolean |

Produces both `IncentivioMetrics` (aggregated) and `CRMCustomerRecord[]` (per-customer).

### Menu Intelligence

Filename contains `menu_intelligence`

| Column | Required | Notes |
|--------|----------|-------|
| `Item Name` | Yes | Leading apostrophes stripped |
| `Item Score` | Yes | |
| `Item Price ($)` | Yes | |
| `Parent group` | No | Brackets removed |
| `Total Sold in Last Year - All customers` | Yes | |
| `Revenue Generated in Last Year - All Customers` | Yes | |
| `Total Sold in Last Month - All Customers` | No | |
| `Total Sold in Last Year - Frequent customers` | No | |
| `Total Sold in Last Year - Infrequent customers` | No | |

Items are classified into BCG quadrants (star/plow_horse/puzzle/dog) based on median volume and revenue.

### Operating Budget (XLSX)

Filename contains `budget` or `operating budget`

Looks for a sheet named `STACK` (falls back to first sheet). Expects a row with date columns (B onwards) and a row containing "Advertising" or "Marketing". Budget amounts are split into 6 categories using default allocation percentages.

## Store Actions & Deduplication

| Action | Dedup Key | Strategy |
|--------|-----------|----------|
| `addExpenses` | `date\|vendor\|amount` | Skip duplicates |
| `addMetaCampaigns` | `month\|campaignName` | Skip duplicates |
| `addGoogleCampaigns` | — | Append all |
| `addGoogleDaily` | `date` | Skip duplicates |
| `addToastSales` | `month\|location` | API wins; same-source replaces |
| `addIncentivio` | `month` | Replace by month |
| `addCRMCustomers` | `snapshotMonth` | Replace all records for that month |
| `addMenuIntelligence` | — | Full replace |
| `addBudgets` | `month` | Replace by month |

## IndexedDB Schema

Database name: `stack-dashboard` (version 3)

| Store | Key Path | Indexes |
|-------|----------|---------|
| `expenses` | `id` | `month` |
| `budgets` | `month` | — |
| `metaCampaigns` | auto-increment | `month` |
| `googleCampaigns` | auto-increment | `month` |
| `googleDaily` | auto-increment | — |
| `toastSales` | auto-increment | `month`, `location` |
| `toastDiscrepancies` | auto-increment | `month` |
| `incentivio` | `month` | — |
| `crmCustomers` | auto-increment | `snapshotMonth`, `journeyStage` |
| `menuIntelligence` | auto-increment | — |
| `uploadedFiles` | `id` | — |
| `settings` | `key` | — |

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

Dev-only proxy at `/api/toast/*` via Vite middleware (`server/viteToastPlugin.ts`). Credentials loaded from `.env` (non-VITE_ prefixed, server-side only). API responses tagged with `source: 'api'` to distinguish from CSV uploads. Discrepancies between API and CSV data are tracked and surfaced in the UI.

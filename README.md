# Stack Wellness Cafe — Marketing Dashboard

A full-stack analytics dashboard for Stack Wellness Cafe (5 locations across Iowa), built with React, TypeScript, Vite, and SQLite. Consolidates marketing spend, POS sales, CRM health, and campaign performance into a single view.

## Features

- **8 analytics views** — Overview, Spend & Budget, Performance, CAC & ROI, Customer Health, Menu Intelligence, Location Comparison, Period Reports
- **Smart file import** — Drag-and-drop CSV/XLSX with auto-detection, preview with dedup warnings, confirm before commit
- **CSV/JSON export** — Download filtered data from any view
- **Period comparisons** — Month-over-month, quarter-over-quarter, year-over-year with delta indicators
- **CRM segmentation** — Journey stage analysis (Whale → Churned), attrition risk scoring, LTV tracking (~44 fields per customer)
- **Menu intelligence** — BCG quadrant classification, daypart breakdowns, penetration analysis (~35 fields per item)
- **Multi-location comparison** — Revenue and order volume across all 5 Stack locations
- **Server-side persistence** — Local SQLite database with WAL mode, zero external infrastructure
- **Print-ready reports** — Optimized print stylesheets for period comparison reports

## Quick Start

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) and upload your CSV files via the **Upload Data** tab.

Data is stored in `data/stack.db` (created automatically on first run).

## Supported Data Sources

| Source | File Type | Detection |
|--------|-----------|-----------|
| **Meta Ads** | CSV | Filename contains `campaign` + `meta`/`facebook` |
| **Google Ads** (campaigns) | CSV | Filename contains `google`/`gads` |
| **Google Ads** (daily) | CSV | Filename contains `time_series`/`timeseries` |
| **Toast POS** | CSV | Filename contains `toast`/`productmix` |
| **Incentivio** (customers) | CSV | Filename contains `customer_export`/`incentivio`/`loyalty` |
| **Incentivio** (menu) | CSV | Filename contains `menu_intelligence` |
| **QuickBooks** (expenses) | CSV/XLSX | Filename contains `quickbooks` or has `Transaction date` + `Amount` columns |
| **Operating Budget** | XLSX | Filename contains `budget` |

Ambiguous filenames fall back to header-based detection.

See [CLAUDE.md](./CLAUDE.md) for detailed column specifications and data flow documentation.

## Tech Stack

- [React 19](https://react.dev) + [TypeScript 5.9](https://www.typescriptlang.org)
- [Vite 7](https://vite.dev) with code splitting (lazy-loaded view chunks)
- [Tailwind CSS 4](https://tailwindcss.com)
- [Recharts 3](https://recharts.org) for data visualization
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) for local persistence
- [PapaParse](https://www.papaparse.com) + [SheetJS](https://sheetjs.com) for CSV/XLSX parsing

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server with HMR + SQLite |
| `npm run build` | Type-check + production build |
| `npm run lint` | Run ESLint |
| `npm run preview` | Serve production build locally |

## Project Structure

```
src/
├── api/           # Fetch wrappers for server API + Toast POS client
├── components/    # 15 React components (views, shared UI)
├── hooks/         # Toast POS sync hook
├── utils/         # Export, categorization, theme, period comparison
├── store.ts       # Server-backed state management
└── types.ts       # TypeScript interfaces (~44 CRM fields, ~35 menu fields)

server/
├── db/            # SQLite connection, schema, queries
├── parsers/       # 8 data source parsers (server-side)
├── api/           # Upload pipeline (stage → preview → confirm)
└── viteDataPlugin.ts  # Vite middleware for /api/data/* routes
```

See [CLAUDE.md](./CLAUDE.md) for architecture details, API routes, CSV format specifications, and developer documentation.

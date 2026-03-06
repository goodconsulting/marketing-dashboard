# Stack Wellness Cafe — Marketing Dashboard

A client-side analytics dashboard for Stack Wellness Cafe (5 locations across Iowa), built with React, TypeScript, and Vite. Consolidates marketing spend, POS sales, CRM health, and campaign performance into a single view.

## Features

- **8 analytics views** — Overview, Spend & Budget, Performance, CAC & ROI, Customer Health, Menu Intelligence, Location Comparison, Period Reports
- **CSV/XLSX import** — Drag-and-drop upload with automatic source detection (Meta Ads, Google Ads, Toast POS, Incentivio, QuickBooks, operating budgets)
- **CSV/JSON export** — Download filtered data from any view
- **Period comparisons** — Month-over-month, quarter-over-quarter, year-over-year with delta indicators
- **CRM segmentation** — Journey stage analysis (Whale → Churned), attrition risk scoring, LTV tracking
- **Menu intelligence** — BCG quadrant classification (Star/Plow Horse/Puzzle/Dog)
- **Multi-location comparison** — Revenue and order volume across all 5 Stack locations
- **Offline-capable** — All data persisted in IndexedDB; no backend required
- **Print-ready reports** — Optimized print stylesheets for period comparison reports

## Quick Start

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) and upload your CSV files via the **Upload Data** tab.

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
- [Vite 7](https://vite.dev) with code splitting (21 lazy-loaded chunks)
- [Tailwind CSS 4](https://tailwindcss.com)
- [Recharts 3](https://recharts.org) for data visualization
- [idb](https://github.com/jakearchibald/idb) for IndexedDB persistence
- [PapaParse](https://www.papaparse.com) + [SheetJS](https://sheetjs.com) for CSV/XLSX parsing

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server with HMR |
| `npm run build` | Type-check + production build |
| `npm run lint` | Run ESLint |
| `npm run preview` | Serve production build locally |

## Project Structure

```
src/
├── components/    # 15 React components (views, shared UI)
├── utils/         # Parsers, export, categorization, theme
├── hooks/         # Toast POS sync hook
├── api/           # Toast POS API client
├── store.ts       # State management + snapshot computation
├── db.ts          # IndexedDB persistence layer
└── types.ts       # TypeScript interfaces
```

See [CLAUDE.md](./CLAUDE.md) for architecture details, CSV format specifications, and developer documentation.

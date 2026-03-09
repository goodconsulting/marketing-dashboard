/**
 * SQLite schema definitions for the Stack marketing dashboard.
 *
 * Architecture: dimensional model with fact + dimension tables.
 * - Dimension tables: dim_month, dim_location (slowly changing)
 * - Fact tables: one per data source, keyed by month + entity
 * - Meta tables: upload_log for ingestion tracking, settings for config
 *
 * Dedup strategy varies by table — see inline comments.
 */

// ---------------------------------------------------------------------------
// Dimension tables
// ---------------------------------------------------------------------------

const DIM_MONTH = `
CREATE TABLE IF NOT EXISTS dim_month (
  month        TEXT PRIMARY KEY,  -- YYYY-MM
  year         INTEGER GENERATED ALWAYS AS (CAST(substr(month, 1, 4) AS INTEGER)) STORED,
  quarter      INTEGER GENERATED ALWAYS AS (
    CASE substr(month, 6, 2)
      WHEN '01' THEN 1 WHEN '02' THEN 1 WHEN '03' THEN 1
      WHEN '04' THEN 2 WHEN '05' THEN 2 WHEN '06' THEN 2
      WHEN '07' THEN 3 WHEN '08' THEN 3 WHEN '09' THEN 3
      ELSE 4
    END
  ) STORED
);
`;

const DIM_LOCATION = `
CREATE TABLE IF NOT EXISTS dim_location (
  location_id  INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL UNIQUE,
  toast_guid   TEXT
);
`;

// ---------------------------------------------------------------------------
// Fact tables
// ---------------------------------------------------------------------------

// CRM: Snapshot replace — DELETE all rows for that month, then INSERT.
// Unique on (customer_id, snapshot_month) prevents within-file duplicates.
const FACT_CRM = `
CREATE TABLE IF NOT EXISTS fact_crm_customer_snapshot (
  id                          INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id                 TEXT NOT NULL,
  snapshot_month              TEXT NOT NULL,

  -- Identity
  first_name                  TEXT,
  last_name                   TEXT,
  email                       TEXT,
  phone                       TEXT,

  -- Journey & segmentation
  journey_stage               TEXT,
  attrition_risk              TEXT,
  reach_location              TEXT,

  -- Core spend & frequency
  lifetime_spend              REAL DEFAULT 0,
  lifetime_visits             INTEGER DEFAULT 0,
  avg_basket_value            REAL DEFAULT 0,
  last_90_days_spend          REAL DEFAULT 0,
  last_90_days_orders         INTEGER DEFAULT 0,
  last_year_spend             REAL DEFAULT 0,
  last_year_orders            INTEGER DEFAULT 0,
  current_loyalty_balance     REAL DEFAULT 0,

  -- Extended spend metrics (new)
  avg_basket_value_per_month  REAL DEFAULT 0,
  purchases_per_month         REAL DEFAULT 0,
  avg_purchases_per_week      REAL DEFAULT 0,
  last_90_day_monthly_spend   REAL DEFAULT 0,
  last_90_day_avg_weekly_spend REAL DEFAULT 0,
  avg_weekly_spend            REAL DEFAULT 0,

  -- Percentiles (new)
  days_since_last_visit_pct   REAL,
  lifetime_aov_percentile     REAL,
  purchases_per_month_pct     REAL,

  -- Referrals (new)
  lifetime_referrals          INTEGER DEFAULT 0,
  referrals_who_ordered       INTEGER DEFAULT 0,
  orders_from_referrals       INTEGER DEFAULT 0,
  total_spend_from_referrals  REAL DEFAULT 0,
  unique_referral_code        TEXT,

  -- Engagement (new)
  sms_order_notification_opt  INTEGER DEFAULT 0,
  valid_email                 INTEGER DEFAULT 0,
  user_affiliation            TEXT,

  -- Dates
  account_created_date        TEXT,
  last_visit_date             TEXT,
  days_since_last_visit       INTEGER DEFAULT 0,
  days_since_signup           INTEGER DEFAULT 0,
  class_month                 TEXT,

  -- Signup & opt-in
  signup_source               TEXT,
  email_opt_in                INTEGER DEFAULT 0,
  sms_opt_in                  INTEGER DEFAULT 0,

  -- Demographics (columns ready, populated later)
  date_of_birth               TEXT,
  age                         INTEGER,
  gender                      TEXT,

  UNIQUE(customer_id, snapshot_month)
);
`;

// Menu Intelligence: Snapshot replace — DELETE all for that month, then INSERT.
const FACT_MENU = `
CREATE TABLE IF NOT EXISTS fact_menu_item_snapshot (
  id                              INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_month                  TEXT NOT NULL,
  item_name                       TEXT NOT NULL,
  score                           REAL DEFAULT 0,
  price                           REAL DEFAULT 0,
  parent_group                    TEXT,
  item_type                       TEXT,
  over_under_state                TEXT,

  -- Volume metrics
  total_sold_last_year            INTEGER DEFAULT 0,
  revenue_last_year               REAL DEFAULT 0,
  total_sold_last_month           INTEGER DEFAULT 0,

  -- Frequency breakdowns
  sold_last_year_frequent         INTEGER DEFAULT 0,
  sold_last_year_infrequent       INTEGER DEFAULT 0,
  revenue_frequent                REAL DEFAULT 0,
  revenue_infrequent              REAL DEFAULT 0,

  -- Sold last month breakdown (new)
  sold_last_month_frequent        INTEGER DEFAULT 0,
  sold_last_month_infrequent      INTEGER DEFAULT 0,

  -- Average orders per month (new)
  avg_orders_per_month_all        REAL DEFAULT 0,
  avg_orders_per_month_frequent   REAL DEFAULT 0,
  avg_orders_per_month_infrequent REAL DEFAULT 0,

  -- Average sold per month (new)
  avg_sold_per_month_all          REAL DEFAULT 0,
  avg_sold_per_month_frequent     REAL DEFAULT 0,
  avg_sold_per_month_infrequent   REAL DEFAULT 0,

  -- Penetration % (new)
  penetration_pct_all             REAL DEFAULT 0,
  penetration_pct_frequent        REAL DEFAULT 0,
  penetration_pct_infrequent      REAL DEFAULT 0,

  -- Daypart: breakfast (new)
  daypart_breakfast_all           INTEGER DEFAULT 0,
  daypart_breakfast_frequent      INTEGER DEFAULT 0,
  daypart_breakfast_infrequent    INTEGER DEFAULT 0,

  -- Daypart: lunch (new)
  daypart_lunch_all               INTEGER DEFAULT 0,
  daypart_lunch_frequent          INTEGER DEFAULT 0,
  daypart_lunch_infrequent        INTEGER DEFAULT 0,

  -- Daypart: dinner (new)
  daypart_dinner_all              INTEGER DEFAULT 0,
  daypart_dinner_frequent         INTEGER DEFAULT 0,
  daypart_dinner_infrequent       INTEGER DEFAULT 0,

  -- Computed ratios (stored at parse time)
  freq_revenue_ratio              REAL DEFAULT 0,
  infreq_revenue_ratio            REAL DEFAULT 0,
  repeat_purchase_proxy           REAL DEFAULT 0,
  revenue_per_unit                REAL DEFAULT 0,
  menu_quadrant                   TEXT,

  UNIQUE(item_name, snapshot_month)
);
`;

// Expenses: INSERT OR IGNORE on (date, vendor, amount) — skip exact dupes.
const FACT_EXPENSE = `
CREATE TABLE IF NOT EXISTS fact_expense (
  id          TEXT PRIMARY KEY,
  date        TEXT NOT NULL,
  month       TEXT NOT NULL,
  vendor      TEXT NOT NULL,
  description TEXT,
  amount      REAL NOT NULL,
  category    TEXT NOT NULL,
  source      TEXT,
  UNIQUE(date, vendor, amount)
);
`;

// Meta campaigns: INSERT OR IGNORE on (month, campaign_name).
const FACT_META = `
CREATE TABLE IF NOT EXISTS fact_meta_campaign (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  month           TEXT NOT NULL,
  campaign_name   TEXT NOT NULL,
  impressions     INTEGER DEFAULT 0,
  reach           INTEGER DEFAULT 0,
  clicks          INTEGER DEFAULT 0,
  spend           REAL DEFAULT 0,
  results         INTEGER DEFAULT 0,
  result_type     TEXT,
  cost_per_result REAL DEFAULT 0,
  UNIQUE(month, campaign_name)
);
`;

// Google campaigns: INSERT OR IGNORE on (month, campaign_name).
const FACT_GOOGLE = `
CREATE TABLE IF NOT EXISTS fact_google_campaign (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  month         TEXT NOT NULL,
  campaign_name TEXT NOT NULL,
  clicks        INTEGER DEFAULT 0,
  impressions   INTEGER DEFAULT 0,
  ctr           REAL DEFAULT 0,
  avg_cpc       REAL DEFAULT 0,
  cost          REAL DEFAULT 0,
  UNIQUE(month, campaign_name)
);
`;

// Google daily: INSERT OR REPLACE on date PK.
const FACT_GOOGLE_DAILY = `
CREATE TABLE IF NOT EXISTS fact_google_daily (
  date        TEXT PRIMARY KEY,
  clicks      INTEGER DEFAULT 0,
  impressions INTEGER DEFAULT 0,
  avg_cpc     REAL DEFAULT 0,
  cost        REAL DEFAULT 0
);
`;

// Toast sales: INSERT OR REPLACE — API source always wins over CSV.
const FACT_TOAST = `
CREATE TABLE IF NOT EXISTS fact_toast_sales (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  month          TEXT NOT NULL,
  location       TEXT NOT NULL,
  gross_sales    REAL DEFAULT 0,
  net_sales      REAL DEFAULT 0,
  orders         INTEGER DEFAULT 0,
  discount_total REAL DEFAULT 0,
  source         TEXT,
  synced_at      TEXT,
  UNIQUE(month, location)
);
`;

// Toast discrepancies: append-only log comparing API vs CSV values.
const FACT_TOAST_DISCREPANCY = `
CREATE TABLE IF NOT EXISTS fact_toast_discrepancy (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  month        TEXT NOT NULL,
  location     TEXT NOT NULL,
  field        TEXT NOT NULL,
  api_value    REAL DEFAULT 0,
  csv_value    REAL DEFAULT 0,
  percent_diff REAL DEFAULT 0,
  created_at   TEXT DEFAULT (datetime('now'))
);
`;

// Incentivio aggregate metrics: one row per month.
const FACT_INCENTIVIO = `
CREATE TABLE IF NOT EXISTS fact_incentivio_metrics (
  month                   TEXT PRIMARY KEY,
  total_loyalty_accounts  INTEGER DEFAULT 0,
  new_accounts            INTEGER DEFAULT 0,
  avg_order_value         REAL DEFAULT 0,
  lifetime_visits         INTEGER DEFAULT 0,
  last_90_days_spend      REAL DEFAULT 0,
  ltv                     REAL DEFAULT 0
);
`;

// Monthly budgets: one row per month with category breakdown.
const FACT_BUDGET = `
CREATE TABLE IF NOT EXISTS fact_budget (
  month            TEXT PRIMARY KEY,
  total_budget     REAL DEFAULT 0,
  paid_media       REAL DEFAULT 0,
  direct_mail_print REAL DEFAULT 0,
  ooh              REAL DEFAULT 0,
  software_fees    REAL DEFAULT 0,
  labor            REAL DEFAULT 0,
  other            REAL DEFAULT 0
);
`;

// ---------------------------------------------------------------------------
// Meta tables
// ---------------------------------------------------------------------------

// Upload log tracks every ingestion attempt for audit + dedup UX.
const UPLOAD_LOG = `
CREATE TABLE IF NOT EXISTS upload_log (
  id             TEXT PRIMARY KEY,
  filename       TEXT NOT NULL,
  source_type    TEXT NOT NULL,
  record_count   INTEGER DEFAULT 0,
  month_covered  TEXT,
  status         TEXT DEFAULT 'pending',
  dedup_summary  TEXT,
  created_at     TEXT DEFAULT (datetime('now')),
  confirmed_at   TEXT
);
`;

// Key-value settings store for dashboard configuration.
const SETTINGS = `
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);
`;

// ---------------------------------------------------------------------------
// Indexes for query performance
// ---------------------------------------------------------------------------

const INDEXES = `
-- CRM indexes: snapshot browsing, journey segmentation, location, attrition
CREATE INDEX IF NOT EXISTS idx_crm_snapshot_month ON fact_crm_customer_snapshot(snapshot_month);
CREATE INDEX IF NOT EXISTS idx_crm_journey_stage ON fact_crm_customer_snapshot(journey_stage);
CREATE INDEX IF NOT EXISTS idx_crm_reach_location ON fact_crm_customer_snapshot(reach_location);
CREATE INDEX IF NOT EXISTS idx_crm_class_month ON fact_crm_customer_snapshot(class_month);
CREATE INDEX IF NOT EXISTS idx_crm_attrition_risk ON fact_crm_customer_snapshot(attrition_risk);

-- Menu indexes: snapshot browsing, quadrant analysis
CREATE INDEX IF NOT EXISTS idx_menu_snapshot_month ON fact_menu_item_snapshot(snapshot_month);
CREATE INDEX IF NOT EXISTS idx_menu_quadrant ON fact_menu_item_snapshot(menu_quadrant);

-- Expense index: month-based filtering
CREATE INDEX IF NOT EXISTS idx_expense_month ON fact_expense(month);

-- Campaign indexes: month-based aggregation
CREATE INDEX IF NOT EXISTS idx_meta_month ON fact_meta_campaign(month);
CREATE INDEX IF NOT EXISTS idx_google_month ON fact_google_campaign(month);

-- Toast index: month-based revenue roll-ups
CREATE INDEX IF NOT EXISTS idx_toast_month ON fact_toast_sales(month);

-- Upload log: status-based queries (show pending uploads)
CREATE INDEX IF NOT EXISTS idx_upload_status ON upload_log(status);
`;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** All DDL statements in creation order (dimensions first, then facts, meta, indexes). */
export const SCHEMA_STATEMENTS: string[] = [
  DIM_MONTH,
  DIM_LOCATION,
  FACT_CRM,
  FACT_MENU,
  FACT_EXPENSE,
  FACT_META,
  FACT_GOOGLE,
  FACT_GOOGLE_DAILY,
  FACT_TOAST,
  FACT_TOAST_DISCREPANCY,
  FACT_INCENTIVIO,
  FACT_BUDGET,
  UPLOAD_LOG,
  SETTINGS,
  INDEXES,
];

/** All table names for health checks and diagnostics. */
export const TABLE_NAMES = [
  'dim_month',
  'dim_location',
  'fact_crm_customer_snapshot',
  'fact_menu_item_snapshot',
  'fact_expense',
  'fact_meta_campaign',
  'fact_google_campaign',
  'fact_google_daily',
  'fact_toast_sales',
  'fact_toast_discrepancy',
  'fact_incentivio_metrics',
  'fact_budget',
  'upload_log',
  'settings',
] as const;

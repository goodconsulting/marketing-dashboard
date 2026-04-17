/**
 * Database query layer — full CRUD + snapshot aggregation.
 *
 * Organization:
 *   1. Initialization + health
 *   2. Settings
 *   3. Upload log
 *   4. Write operations (one per fact table)
 *   5. Read operations (one per fact table)
 *   6. Snapshot aggregation (replaces client-side useMemo)
 *   7. Dedup analysis
 *   8. Management (clear all)
 */

import { getDb } from './connection.ts';
import { SCHEMA_STATEMENTS, TABLE_NAMES } from './schema.ts';
import type {
  MonthlyExpense, MetaCampaign, MetaAdSet, GoogleCampaign, GoogleDaily,
  StoreSales, IncentivioMetrics, MonthlyBudget, SpendCategory,
  CRMCustomerRecord, MenuIntelligenceItem, OneLinkDaily,
  DiscountSummary, JourneyStage, AmpCampaign, BillboardMonthly, OtherCampaign,
  StageTransition,
} from '../types.ts';

// ═══════════════════════════════════════════════════════════════════════════
// 1. INITIALIZATION
// ═══════════════════════════════════════════════════════════════════════════

export function initializeDatabase(): void {
  const db = getDb();
  db.transaction(() => {
    for (const sql of SCHEMA_STATEMENTS) {
      db.exec(sql);
    }
  })();

  // ── Migrations ────────────────────────────────────────────────────
  // Add sponsorship column to fact_budget if missing (added Dec 2025)
  const budgetCols = db.pragma('table_info(fact_budget)') as Array<{ name: string }>;
  if (!budgetCols.some(c => c.name === 'sponsorship')) {
    db.exec('ALTER TABLE fact_budget ADD COLUMN sponsorship REAL DEFAULT 0');
  }

  // Add conversions column to fact_google_campaign if missing (added Mar 2026)
  const googleCols = db.pragma('table_info(fact_google_campaign)') as Array<{ name: string }>;
  if (!googleCols.some(c => c.name === 'conversions')) {
    db.exec('ALTER TABLE fact_google_campaign ADD COLUMN conversions REAL DEFAULT 0');
  }

  const settingsCount = db.prepare(
    'SELECT COUNT(*) as count FROM settings'
  ).get() as { count: number };

  if (settingsCount.count === 0) {
    db.prepare(
      'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)'
    ).run('annualBudget', '533000');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HEALTH
// ═══════════════════════════════════════════════════════════════════════════

interface TableInfo { name: string; rowCount: number; }
interface HealthInfo { status: string; tables: TableInfo[]; dbSizeBytes: number; }

export function getHealthInfo(): HealthInfo {
  const db = getDb();
  const tables: TableInfo[] = TABLE_NAMES.map(name => {
    const row = db.prepare(`SELECT COUNT(*) as count FROM ${name}`).get() as { count: number };
    return { name, rowCount: row.count };
  });
  const pageCount = db.pragma('page_count', { simple: true }) as number;
  const pageSize = db.pragma('page_size', { simple: true }) as number;
  return { status: 'ok', tables, dbSizeBytes: pageCount * pageSize };
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. SETTINGS
// ═══════════════════════════════════════════════════════════════════════════

export function getSetting(key: string): string | undefined {
  const db = getDb();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value;
}

export function setSetting(key: string, value: string): void {
  const db = getDb();
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. UPLOAD LOG
// ═══════════════════════════════════════════════════════════════════════════

interface UploadLogRow {
  id: string;
  filename: string;
  source_type: string;
  record_count: number;
  month_covered: string | null;
  status: string;
  dedup_summary: string | null;
  created_at: string;
  confirmed_at: string | null;
}

export function getUploadLog(): UploadLogRow[] {
  const db = getDb();
  return db.prepare('SELECT * FROM upload_log ORDER BY created_at DESC').all() as UploadLogRow[];
}

export function createUploadEntry(
  id: string, filename: string, sourceType: string,
  recordCount: number, monthCovered: string | null, dedupSummary?: string,
): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO upload_log (id, filename, source_type, record_count, month_covered, status, dedup_summary)
    VALUES (?, ?, ?, ?, ?, 'confirmed', ?)
  `).run(id, filename, sourceType, recordCount, monthCovered, dedupSummary || null);
}

export function confirmUploadEntry(id: string): void {
  const db = getDb();
  db.prepare(
    "UPDATE upload_log SET status = 'confirmed', confirmed_at = datetime('now') WHERE id = ?"
  ).run(id);
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. WRITE OPERATIONS
// ═══════════════════════════════════════════════════════════════════════════

// ── Expenses ─────────────────────────────────────────────────────────────

export function insertExpenses(expenses: MonthlyExpense[]): number {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO fact_expense (id, date, month, vendor, description, amount, category, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let inserted = 0;
  db.transaction(() => {
    // Ensure dim_month entries exist
    const dimStmt = db.prepare('INSERT OR IGNORE INTO dim_month (month) VALUES (?)');
    for (const e of expenses) {
      dimStmt.run(e.month);
      const result = stmt.run(e.id, e.date, e.month, e.vendor, e.description, e.amount, e.category, e.source);
      if (result.changes > 0) inserted++;
    }
  })();
  return inserted;
}

// ── Meta Campaigns ───────────────────────────────────────────────────────

export function insertMetaCampaigns(campaigns: MetaCampaign[]): number {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO fact_meta_campaign
    (month, campaign_name, impressions, reach, clicks, spend, results, result_type, cost_per_result)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let inserted = 0;
  db.transaction(() => {
    const dimStmt = db.prepare('INSERT OR IGNORE INTO dim_month (month) VALUES (?)');
    for (const c of campaigns) {
      dimStmt.run(c.month);
      const result = stmt.run(
        c.month, c.campaignName, c.impressions, c.reach, c.clicks,
        c.spend, c.results, c.resultType, c.costPerResult,
      );
      if (result.changes > 0) inserted++;
    }
  })();
  return inserted;
}

// ── Google Campaigns ─────────────────────────────────────────────────────

export function insertGoogleCampaigns(campaigns: GoogleCampaign[], month?: string): number {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO fact_google_campaign
    (month, campaign_name, clicks, impressions, ctr, avg_cpc, cost, conversions)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let inserted = 0;
  db.transaction(() => {
    const dimStmt = db.prepare('INSERT OR IGNORE INTO dim_month (month) VALUES (?)');
    for (const c of campaigns) {
      const m = c.month || month || '';
      if (!m) continue;
      dimStmt.run(m);
      const result = stmt.run(m, c.campaignName, c.clicks, c.impressions, c.ctr, c.avgCpc, c.cost, c.conversions);
      if (result.changes > 0) inserted++;
    }
  })();
  return inserted;
}

// ── Google Daily ─────────────────────────────────────────────────────────

export function insertGoogleDaily(daily: GoogleDaily[]): number {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO fact_google_daily (date, clicks, impressions, avg_cpc, cost)
    VALUES (?, ?, ?, ?, ?)
  `);

  let inserted = 0;
  db.transaction(() => {
    for (const d of daily) {
      stmt.run(d.date, d.clicks, d.impressions, d.avgCpc, d.cost);
      inserted++;
    }
  })();
  return inserted;
}

// ── Store Sales (Clover + Toast) ─────────────────────────────────────────

export function insertStoreSales(sales: StoreSales[]): number {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO fact_store_sales
    (month, location, gross_sales, net_sales, orders, discount_total,
     guests, tips, tax_amount, refunds,
     doordash_sales, uber_eats_sales, food_sales, smoothie_sales, retail_sales,
     source, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `);

  let inserted = 0;
  db.transaction(() => {
    const dimStmt = db.prepare('INSERT OR IGNORE INTO dim_month (month) VALUES (?)');
    const locStmt = db.prepare('INSERT OR IGNORE INTO dim_location (name) VALUES (?)');
    for (const s of sales) {
      dimStmt.run(s.month);
      locStmt.run(s.location);
      stmt.run(
        s.month, s.location, s.grossSales, s.netSales, s.orders, s.discountTotal,
        s.guests ?? 0, s.tips ?? 0, s.taxAmount ?? 0, s.refunds ?? 0,
        s.doordashSales ?? 0, s.uberEatsSales ?? 0,
        s.foodSales ?? 0, s.smoothieSales ?? 0, s.retailSales ?? 0,
        s.source || 'csv'
      );
      inserted++;
    }
  })();
  return inserted;
}

/** @deprecated Use insertStoreSales instead */
export const insertToastSales = insertStoreSales;

// ── CRM Customer Snapshot ────────────────────────────────────────────────
// Strategy: DELETE all rows for the snapshot month, then INSERT fresh.

export function insertCRMSnapshot(customers: CRMCustomerRecord[], snapshotMonth: string): number {
  const db = getDb();

  db.transaction(() => {
    // Clear existing snapshot for this month
    db.prepare('DELETE FROM fact_crm_customer_snapshot WHERE snapshot_month = ?').run(snapshotMonth);
    db.prepare('INSERT OR IGNORE INTO dim_month (month) VALUES (?)').run(snapshotMonth);

    const stmt = db.prepare(`
      INSERT INTO fact_crm_customer_snapshot (
        customer_id, snapshot_month, first_name, last_name, email, phone,
        journey_stage, attrition_risk, reach_location,
        lifetime_spend, lifetime_visits, avg_basket_value,
        last_90_days_spend, last_90_days_orders, last_year_spend, last_year_orders,
        current_loyalty_balance,
        avg_basket_value_per_month, purchases_per_month, avg_purchases_per_week,
        last_90_day_monthly_spend, last_90_day_avg_weekly_spend, avg_weekly_spend,
        days_since_last_visit_pct, lifetime_aov_percentile, purchases_per_month_pct,
        lifetime_referrals, referrals_who_ordered, orders_from_referrals,
        total_spend_from_referrals, unique_referral_code,
        sms_order_notification_opt, valid_email, user_affiliation,
        account_created_date, last_visit_date, days_since_last_visit, days_since_signup,
        class_month, signup_source, email_opt_in, sms_opt_in,
        date_of_birth, age, gender
      ) VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?,
        ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?
      )
    `);

    for (const c of customers) {
      stmt.run(
        c.customerId, snapshotMonth, c.firstName, c.lastName, c.email, c.phone,
        c.journeyStage, c.attritionRisk, c.reachLocation,
        c.lifetimeSpend, c.lifetimeVisits, c.avgBasketValue,
        c.last90DaysSpend, c.last90DaysOrders, c.lastYearSpend, c.lastYearOrders,
        c.currentLoyaltyBalance,
        c.avgBasketValuePerMonth, c.purchasesPerMonth, c.avgPurchasesPerWeek,
        c.last90DayMonthlySpend, c.last90DayAvgWeeklySpend, c.avgWeeklySpend,
        c.daysSinceLastVisitPct, c.lifetimeAovPercentile, c.purchasesPerMonthPct,
        c.lifetimeReferrals, c.referralsWhoOrdered, c.ordersFromReferrals,
        c.totalSpendFromReferrals, c.uniqueReferralCode,
        c.smsOrderNotificationOpt ? 1 : 0, c.validEmail ? 1 : 0, c.userAffiliation,
        c.accountCreatedDate, c.lastVisitDate, c.daysSinceLastVisit, c.daysSinceSignup,
        c.classMonth, c.signupSource, c.emailOptIn ? 1 : 0, c.smsOptIn ? 1 : 0,
        c.dateOfBirth, c.age, c.gender,
      );
    }
  })();

  return customers.length;
}

// ── Menu Intelligence Snapshot ───────────────────────────────────────────
// Strategy: DELETE all rows for the snapshot month, then INSERT fresh.

export function insertMenuSnapshot(items: MenuIntelligenceItem[], snapshotMonth: string): number {
  const db = getDb();

  db.transaction(() => {
    db.prepare('DELETE FROM fact_menu_item_snapshot WHERE snapshot_month = ?').run(snapshotMonth);
    db.prepare('INSERT OR IGNORE INTO dim_month (month) VALUES (?)').run(snapshotMonth);

    const stmt = db.prepare(`
      INSERT INTO fact_menu_item_snapshot (
        snapshot_month, item_name, score, price, parent_group, item_type, over_under_state,
        total_sold_last_year, revenue_last_year, total_sold_last_month,
        sold_last_year_frequent, sold_last_year_infrequent,
        revenue_frequent, revenue_infrequent,
        sold_last_month_frequent, sold_last_month_infrequent,
        avg_orders_per_month_all, avg_orders_per_month_frequent, avg_orders_per_month_infrequent,
        avg_sold_per_month_all, avg_sold_per_month_frequent, avg_sold_per_month_infrequent,
        penetration_pct_all, penetration_pct_frequent, penetration_pct_infrequent,
        daypart_breakfast_all, daypart_breakfast_frequent, daypart_breakfast_infrequent,
        daypart_lunch_all, daypart_lunch_frequent, daypart_lunch_infrequent,
        daypart_dinner_all, daypart_dinner_frequent, daypart_dinner_infrequent,
        freq_revenue_ratio, infreq_revenue_ratio, repeat_purchase_proxy, revenue_per_unit,
        menu_quadrant
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?,
        ?, ?,
        ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?,
        ?
      )
    `);

    for (const item of items) {
      stmt.run(
        snapshotMonth, item.name, item.score, item.price, item.parentGroup,
        item.itemType, item.overUnderState,
        item.totalSoldLastYear, item.revenueLastYear, item.totalSoldLastMonth,
        item.soldLastYearFrequent, item.soldLastYearInfrequent,
        item.revenueFrequent, item.revenueInfrequent,
        item.soldLastMonthFrequent, item.soldLastMonthInfrequent,
        item.avgOrdersPerMonthAll, item.avgOrdersPerMonthFrequent, item.avgOrdersPerMonthInfrequent,
        item.avgSoldPerMonthAll, item.avgSoldPerMonthFrequent, item.avgSoldPerMonthInfrequent,
        item.penetrationPctAll, item.penetrationPctFrequent, item.penetrationPctInfrequent,
        item.daypartBreakfastAll, item.daypartBreakfastFrequent, item.daypartBreakfastInfrequent,
        item.daypartLunchAll, item.daypartLunchFrequent, item.daypartLunchInfrequent,
        item.daypartDinnerAll, item.daypartDinnerFrequent, item.daypartDinnerInfrequent,
        item.freqRevenueRatio, item.infreqRevenueRatio, item.repeatPurchaseProxy, item.revenuePerUnit,
        item.menuQuadrant,
      );
    }
  })();

  return items.length;
}

// ── Incentivio Aggregate Metrics ─────────────────────────────────────────

export function insertIncentivioMetrics(metrics: IncentivioMetrics): void {
  const db = getDb();
  db.prepare('INSERT OR IGNORE INTO dim_month (month) VALUES (?)').run(metrics.month);
  db.prepare(`
    INSERT OR REPLACE INTO fact_incentivio_metrics
    (month, total_loyalty_accounts, new_accounts, avg_order_value, lifetime_visits, last_90_days_spend, ltv)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    metrics.month, metrics.totalLoyaltyAccounts, metrics.newAccounts,
    metrics.avgOrderValue, metrics.lifetimeVisits, metrics.last90DaysSpend, metrics.ltv,
  );
}

// ── OneLink QR Tracking ──────────────────────────────────────────────────

export function insertOneLinkDaily(records: OneLinkDaily[]): number {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO fact_onelink_daily
    (date, month, tracking_code, campaign_source, campaign_label, total, iphone, ipad, android, other)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let inserted = 0;
  db.transaction(() => {
    const dimStmt = db.prepare('INSERT OR IGNORE INTO dim_month (month) VALUES (?)');
    for (const r of records) {
      dimStmt.run(r.month);
      stmt.run(
        r.date, r.month, r.trackingCode, r.campaignSource, r.campaignLabel,
        r.total, r.iphone, r.ipad, r.android, r.other,
      );
      inserted++;
    }
  })();
  return inserted;
}

// ── Budgets ──────────────────────────────────────────────────────────────

export function insertBudgets(budgets: MonthlyBudget[]): number {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO fact_budget
    (month, total_budget, paid_media, direct_mail_print, ooh, software_fees, labor, sponsorship, other)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let inserted = 0;
  db.transaction(() => {
    const dimStmt = db.prepare('INSERT OR IGNORE INTO dim_month (month) VALUES (?)');
    for (const b of budgets) {
      dimStmt.run(b.month);
      stmt.run(
        b.month, b.totalBudget,
        b.byCategory.paid_media, b.byCategory.direct_mail_print, b.byCategory.ooh,
        b.byCategory.software_fees, b.byCategory.labor, b.byCategory.sponsorship, b.byCategory.other,
      );
      inserted++;
    }
  })();
  return inserted;
}

// ── Discount Summary ─────────────────────────────────────────────────────

export function insertDiscountSummary(records: DiscountSummary[]): number {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO fact_discount_summary
    (period, period_type, discount_name, discount_category, usage_count, discount_amount, profitability, pct_of_total_sales)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let inserted = 0;
  db.transaction(() => {
    for (const r of records) {
      stmt.run(
        r.period, r.periodType, r.discountName, r.discountCategory,
        r.usageCount, r.discountAmount, r.profitability, r.pctOfTotalSales,
      );
      inserted++;
    }
  })();
  return inserted;
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. READ OPERATIONS
// ═══════════════════════════════════════════════════════════════════════════

export function getExpenses(month?: string): MonthlyExpense[] {
  const db = getDb();
  const query = month
    ? 'SELECT * FROM fact_expense WHERE month = ? ORDER BY date'
    : 'SELECT * FROM fact_expense ORDER BY date';
  const rows = (month ? db.prepare(query).all(month) : db.prepare(query).all()) as Array<{
    id: string; date: string; month: string; vendor: string;
    description: string; amount: number; category: SpendCategory; source: string;
  }>;
  return rows;
}

export function getMetaCampaigns(month?: string): MetaCampaign[] {
  const db = getDb();
  const query = month
    ? 'SELECT * FROM fact_meta_campaign WHERE month = ?'
    : 'SELECT * FROM fact_meta_campaign';
  const rows = (month ? db.prepare(query).all(month) : db.prepare(query).all()) as Array<{
    month: string; campaign_name: string; impressions: number; reach: number;
    clicks: number; spend: number; results: number; result_type: string; cost_per_result: number;
  }>;
  return rows.map(r => ({
    month: r.month, campaignName: r.campaign_name, impressions: r.impressions,
    reach: r.reach, clicks: r.clicks, spend: r.spend, results: r.results,
    resultType: r.result_type, costPerResult: r.cost_per_result,
  }));
}

// ── Meta Ad Sets ──────────────────────────────────────────────────────────

export function insertMetaAdSets(adSets: MetaAdSet[]): number {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO fact_meta_ad_set
    (month, campaign_name, ad_set_name, delivery, impressions, reach, clicks,
     spend, results, result_type, cost_per_result, landing_page_views, cpm, cpc, ctr)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let inserted = 0;
  db.transaction(() => {
    for (const a of adSets) {
      const result = stmt.run(
        a.month, a.campaignName, a.adSetName, a.delivery, a.impressions, a.reach,
        a.clicks, a.spend, a.results, a.resultType, a.costPerResult,
        a.landingPageViews, a.cpm, a.cpc, a.ctr,
      );
      if (result.changes > 0) inserted++;
    }
  })();
  return inserted;
}

export function getMetaAdSets(month?: string, campaignName?: string): MetaAdSet[] {
  const db = getDb();
  const conditions: string[] = [];
  const params: string[] = [];
  if (month) { conditions.push('month = ?'); params.push(month); }
  if (campaignName) { conditions.push('campaign_name = ?'); params.push(campaignName); }
  const where = conditions.length > 0 ? ' WHERE ' + conditions.join(' AND ') : '';
  const rows = db.prepare(`SELECT * FROM fact_meta_ad_set${where}`).all(...params) as Array<Record<string, unknown>>;
  return rows.map(r => ({
    month: r.month as string,
    campaignName: r.campaign_name as string,
    adSetName: r.ad_set_name as string,
    delivery: (r.delivery as string) || '',
    impressions: (r.impressions as number) || 0,
    reach: (r.reach as number) || 0,
    clicks: (r.clicks as number) || 0,
    spend: (r.spend as number) || 0,
    results: (r.results as number) || 0,
    resultType: (r.result_type as string) || '',
    costPerResult: (r.cost_per_result as number) || 0,
    landingPageViews: (r.landing_page_views as number) || 0,
    cpm: (r.cpm as number) || 0,
    cpc: (r.cpc as number) || 0,
    ctr: (r.ctr as number) || 0,
  }));
}

export function getGoogleCampaigns(month?: string): GoogleCampaign[] {
  const db = getDb();
  const query = month
    ? 'SELECT * FROM fact_google_campaign WHERE month = ?'
    : 'SELECT * FROM fact_google_campaign';
  const rows = (month ? db.prepare(query).all(month) : db.prepare(query).all()) as Array<{
    month: string; campaign_name: string; clicks: number; impressions: number;
    ctr: number; avg_cpc: number; cost: number; conversions: number;
  }>;
  return rows.map(r => ({
    month: r.month, campaignName: r.campaign_name, clicks: r.clicks,
    impressions: r.impressions, ctr: r.ctr, avgCpc: r.avg_cpc, cost: r.cost,
    conversions: r.conversions ?? 0,
  }));
}

export function getGoogleDaily(from?: string, to?: string): GoogleDaily[] {
  const db = getDb();
  let query = 'SELECT * FROM fact_google_daily';
  const params: string[] = [];
  if (from || to) {
    const conditions: string[] = [];
    if (from) { conditions.push('date >= ?'); params.push(from); }
    if (to) { conditions.push('date <= ?'); params.push(to); }
    query += ' WHERE ' + conditions.join(' AND ');
  }
  query += ' ORDER BY date';
  const rows = db.prepare(query).all(...params) as Array<{
    date: string; clicks: number; impressions: number; avg_cpc: number; cost: number;
  }>;
  return rows.map(r => ({
    date: r.date, clicks: r.clicks, impressions: r.impressions,
    avgCpc: r.avg_cpc, cost: r.cost,
  }));
}

export function getStoreSales(month?: string): StoreSales[] {
  const db = getDb();
  const query = month
    ? 'SELECT * FROM fact_store_sales WHERE month = ?'
    : 'SELECT * FROM fact_store_sales';
  const rows = (month ? db.prepare(query).all(month) : db.prepare(query).all()) as Array<{
    month: string; location: string; gross_sales: number; net_sales: number;
    orders: number; discount_total: number; guests: number; tips: number;
    tax_amount: number; refunds: number; doordash_sales: number; uber_eats_sales: number;
    food_sales: number; smoothie_sales: number; retail_sales: number;
    source: string; synced_at: string;
  }>;
  return rows.map(r => ({
    month: r.month, location: r.location, grossSales: r.gross_sales,
    netSales: r.net_sales, orders: r.orders, discountTotal: r.discount_total,
    guests: r.guests, tips: r.tips, taxAmount: r.tax_amount, refunds: r.refunds,
    doordashSales: r.doordash_sales, uberEatsSales: r.uber_eats_sales,
    foodSales: r.food_sales, smoothieSales: r.smoothie_sales, retailSales: r.retail_sales,
    source: r.source as 'clover' | 'toast' | 'clover+toast', syncedAt: r.synced_at,
  }));
}

/** @deprecated Use getStoreSales instead */
export const getToastSales = getStoreSales;

export function getIncentivioMetrics(): IncentivioMetrics[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM fact_incentivio_metrics ORDER BY month').all() as Array<{
    month: string; total_loyalty_accounts: number; new_accounts: number;
    avg_order_value: number; lifetime_visits: number; last_90_days_spend: number; ltv: number;
  }>;
  return rows.map(r => ({
    month: r.month, totalLoyaltyAccounts: r.total_loyalty_accounts,
    newAccounts: r.new_accounts, avgOrderValue: r.avg_order_value,
    lifetimeVisits: r.lifetime_visits, last90DaysSpend: r.last_90_days_spend, ltv: r.ltv,
  }));
}

export function getOneLinkDaily(month?: string): OneLinkDaily[] {
  const db = getDb();
  const query = month
    ? 'SELECT * FROM fact_onelink_daily WHERE month = ? ORDER BY date'
    : 'SELECT * FROM fact_onelink_daily ORDER BY date';
  const rows = (month ? db.prepare(query).all(month) : db.prepare(query).all()) as Array<{
    date: string; month: string; tracking_code: string; campaign_source: string;
    campaign_label: string; total: number; iphone: number; ipad: number;
    android: number; other: number;
  }>;
  return rows.map(r => ({
    date: r.date, month: r.month, trackingCode: r.tracking_code,
    campaignSource: r.campaign_source, campaignLabel: r.campaign_label,
    total: r.total, iphone: r.iphone, ipad: r.ipad, android: r.android, other: r.other,
  }));
}

/**
 * Sum total_budget from fact_budget for a given year (e.g. '2026').
 * Falls back to the annualBudget setting if no budget rows exist for that year.
 */
export function getAnnualBudgetForYear(year: string): number {
  const db = getDb();
  const row = db.prepare(
    `SELECT COALESCE(SUM(total_budget), 0) AS total
     FROM fact_budget
     WHERE month >= ? AND month <= ?`
  ).get(`${year}-01`, `${year}-12`) as { total: number };

  if (row.total > 0) return Math.round(row.total * 100) / 100;
  // Fall back to legacy setting
  return parseFloat(getSetting('annualBudget') || '533000');
}

export function getBudgets(): MonthlyBudget[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM fact_budget ORDER BY month').all() as Array<{
    month: string; total_budget: number; paid_media: number; direct_mail_print: number;
    ooh: number; software_fees: number; labor: number; sponsorship: number; other: number;
  }>;
  return rows.map(r => ({
    month: r.month, totalBudget: r.total_budget,
    byCategory: {
      paid_media: r.paid_media, direct_mail_print: r.direct_mail_print,
      ooh: r.ooh, software_fees: r.software_fees, labor: r.labor,
      sponsorship: r.sponsorship || 0, other: r.other,
    },
  }));
}

export function getDiscountSummary(period?: string): DiscountSummary[] {
  const db = getDb();
  const query = period
    ? 'SELECT * FROM fact_discount_summary WHERE period = ? ORDER BY discount_amount DESC'
    : 'SELECT * FROM fact_discount_summary ORDER BY period, discount_amount DESC';
  const rows = (period ? db.prepare(query).all(period) : db.prepare(query).all()) as Array<{
    period: string; period_type: string; discount_name: string; discount_category: string;
    usage_count: number; discount_amount: number; profitability: number; pct_of_total_sales: number;
  }>;
  return rows.map(r => ({
    period: r.period,
    periodType: r.period_type,
    discountName: r.discount_name,
    discountCategory: r.discount_category,
    usageCount: r.usage_count,
    discountAmount: r.discount_amount,
    profitability: r.profitability,
    pctOfTotalSales: r.pct_of_total_sales,
  }));
}

// ── AMP Campaigns ─────────────────────────────────────────────────────────

export function insertAmpCampaigns(records: AmpCampaign[]): number {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO fact_amp_campaign
    (month, campaign_type, campaign_name, location, impressions, reach, frequency,
     sent, views, clicks, view_rate, click_rate, vcr, viewing_hours)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let inserted = 0;
  db.transaction(() => {
    const dimStmt = db.prepare('INSERT OR IGNORE INTO dim_month (month) VALUES (?)');
    for (const r of records) {
      dimStmt.run(r.month);
      stmt.run(
        r.month, r.campaignType, r.campaignName, r.location,
        r.impressions, r.reach, r.frequency, r.sent, r.views, r.clicks,
        r.viewRate, r.clickRate, r.vcr, r.viewingHours,
      );
      inserted++;
    }
  })();
  return inserted;
}

export function getAmpCampaigns(month?: string): AmpCampaign[] {
  const db = getDb();
  const query = month
    ? 'SELECT * FROM fact_amp_campaign WHERE month = ? ORDER BY month, campaign_type'
    : 'SELECT * FROM fact_amp_campaign ORDER BY month, campaign_type';
  const rows = (month ? db.prepare(query).all(month) : db.prepare(query).all()) as Array<{
    month: string; campaign_type: string; campaign_name: string; location: string;
    impressions: number; reach: number; frequency: number; sent: number;
    views: number; clicks: number; view_rate: number; click_rate: number;
    vcr: number; viewing_hours: number;
  }>;
  return rows.map(r => ({
    month: r.month, campaignType: r.campaign_type, campaignName: r.campaign_name,
    location: r.location || '', impressions: r.impressions, reach: r.reach,
    frequency: r.frequency, sent: r.sent, views: r.views, clicks: r.clicks,
    viewRate: r.view_rate, clickRate: r.click_rate, vcr: r.vcr,
    viewingHours: r.viewing_hours,
  }));
}

// ── Billboard Monthly ─────────────────────────────────────────────────────

export function insertBillboardMonthly(records: BillboardMonthly[]): number {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO fact_billboard_monthly
    (month, location, panel_id, plays_guaranteed, plays_delivered,
     impressions_guaranteed, impressions_delivered, variance_pct,
     num_creatives, contracted_days)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let inserted = 0;
  db.transaction(() => {
    const dimStmt = db.prepare('INSERT OR IGNORE INTO dim_month (month) VALUES (?)');
    for (const r of records) {
      dimStmt.run(r.month);
      stmt.run(
        r.month, r.location, r.panelId, r.playsGuaranteed, r.playsDelivered,
        r.impressionsGuaranteed, r.impressionsDelivered, r.variancePct,
        r.numCreatives, r.contractedDays,
      );
      inserted++;
    }
  })();
  return inserted;
}

export function getBillboardMonthly(month?: string): BillboardMonthly[] {
  const db = getDb();
  const query = month
    ? 'SELECT * FROM fact_billboard_monthly WHERE month = ? ORDER BY month'
    : 'SELECT * FROM fact_billboard_monthly ORDER BY month';
  const rows = (month ? db.prepare(query).all(month) : db.prepare(query).all()) as Array<{
    month: string; location: string; panel_id: string; plays_guaranteed: number;
    plays_delivered: number; impressions_guaranteed: number; impressions_delivered: number;
    variance_pct: number; num_creatives: number; contracted_days: number;
  }>;
  return rows.map(r => ({
    month: r.month, location: r.location, panelId: r.panel_id || '',
    playsGuaranteed: r.plays_guaranteed, playsDelivered: r.plays_delivered,
    impressionsGuaranteed: r.impressions_guaranteed, impressionsDelivered: r.impressions_delivered,
    variancePct: r.variance_pct, numCreatives: r.num_creatives,
    contractedDays: r.contracted_days,
  }));
}

// ── Other Campaigns (long-tail paid media) ────────────────────────────────

export function insertOtherCampaigns(records: OtherCampaign[]): number {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO fact_other_campaign
    (month, source, campaign_name, spend, impressions, clicks, conversions,
     ctr, cpc, cost_per_conv, window_start, window_end, extra)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  let inserted = 0;
  db.transaction(() => {
    const dimStmt = db.prepare('INSERT OR IGNORE INTO dim_month (month) VALUES (?)');
    for (const r of records) {
      dimStmt.run(r.month);
      stmt.run(
        r.month, r.source, r.campaignName, r.spend, r.impressions,
        r.clicks, r.conversions, r.ctr, r.cpc, r.costPerConv,
        r.windowStart, r.windowEnd,
        r.extra ? JSON.stringify(r.extra) : null,
      );
      inserted++;
    }
  })();
  return inserted;
}

export function getOtherCampaigns(month?: string): OtherCampaign[] {
  const db = getDb();
  const query = month
    ? 'SELECT * FROM fact_other_campaign WHERE month = ? ORDER BY source, campaign_name'
    : 'SELECT * FROM fact_other_campaign ORDER BY month, source, campaign_name';
  const rows = (month ? db.prepare(query).all(month) : db.prepare(query).all()) as Array<{
    month: string; source: string; campaign_name: string; spend: number;
    impressions: number; clicks: number; conversions: number;
    ctr: number; cpc: number; cost_per_conv: number;
    window_start: string | null; window_end: string | null; extra: string | null;
  }>;
  return rows.map(r => ({
    month: r.month, source: r.source, campaignName: r.campaign_name,
    spend: r.spend, impressions: r.impressions, clicks: r.clicks,
    conversions: r.conversions, ctr: r.ctr, cpc: r.cpc, costPerConv: r.cost_per_conv,
    windowStart: r.window_start, windowEnd: r.window_end,
    extra: r.extra ? safeJsonParse(r.extra) : null,
  }));
}

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

function safeJsonParse(s: string): Record<string, unknown> | null {
  try { return JSON.parse(s) as Record<string, unknown>; } catch { return null; }
}

/**
 * Return only the most recent snapshot per customer.
 * Uses a subquery to find the max snapshot_month per customer_id,
 * then joins back to get the full row. This ensures Customer Health
 * never shows duplicate customer IDs across snapshot months.
 */
export function getLatestCRMCustomers(stage?: string, activeOnly = true): CRMCustomerRecord[] {
  const db = getDb();
  let query = `
    SELECT c.* FROM fact_crm_customer_snapshot c
    INNER JOIN (
      SELECT customer_id, MAX(snapshot_month) as max_month
      FROM fact_crm_customer_snapshot
      GROUP BY customer_id
    ) latest ON c.customer_id = latest.customer_id AND c.snapshot_month = latest.max_month
  `;
  const conditions: string[] = [];
  const params: string[] = [];
  if (activeOnly) { conditions.push('(c.lifetime_visits > 0 OR c.lifetime_spend > 0)'); }
  if (stage) { conditions.push('c.journey_stage = ?'); params.push(stage); }
  if (conditions.length > 0) query += ' WHERE ' + conditions.join(' AND ');

  const rows = db.prepare(query).all(...params) as Array<Record<string, unknown>>;
  return mapCRMRows(rows);
}

export function getCRMCustomers(month?: string, stage?: string): CRMCustomerRecord[] {
  const db = getDb();
  let query = 'SELECT * FROM fact_crm_customer_snapshot';
  const conditions: string[] = [];
  const params: string[] = [];

  if (month) { conditions.push('snapshot_month = ?'); params.push(month); }
  if (stage) { conditions.push('journey_stage = ?'); params.push(stage); }
  if (conditions.length > 0) query += ' WHERE ' + conditions.join(' AND ');

  const rows = db.prepare(query).all(...params) as Array<Record<string, unknown>>;
  return mapCRMRows(rows);
}

function mapCRMRows(rows: Array<Record<string, unknown>>): CRMCustomerRecord[] {
  return rows.map(r => ({
    customerId: r.customer_id as string,
    firstName: r.first_name as string || '',
    lastName: r.last_name as string || '',
    email: r.email as string || '',
    phone: r.phone as string || '',
    journeyStage: r.journey_stage as JourneyStage,
    attritionRisk: r.attrition_risk as 'high' | 'medium' | 'low',
    reachLocation: r.reach_location as string || '',
    lifetimeSpend: r.lifetime_spend as number || 0,
    lifetimeVisits: r.lifetime_visits as number || 0,
    avgBasketValue: r.avg_basket_value as number || 0,
    last90DaysSpend: r.last_90_days_spend as number || 0,
    last90DaysOrders: r.last_90_days_orders as number || 0,
    lastYearSpend: r.last_year_spend as number || 0,
    lastYearOrders: r.last_year_orders as number || 0,
    currentLoyaltyBalance: r.current_loyalty_balance as number || 0,
    avgBasketValuePerMonth: r.avg_basket_value_per_month as number || 0,
    purchasesPerMonth: r.purchases_per_month as number || 0,
    avgPurchasesPerWeek: r.avg_purchases_per_week as number || 0,
    last90DayMonthlySpend: r.last_90_day_monthly_spend as number || 0,
    last90DayAvgWeeklySpend: r.last_90_day_avg_weekly_spend as number || 0,
    avgWeeklySpend: r.avg_weekly_spend as number || 0,
    daysSinceLastVisitPct: r.days_since_last_visit_pct as number | null,
    lifetimeAovPercentile: r.lifetime_aov_percentile as number | null,
    purchasesPerMonthPct: r.purchases_per_month_pct as number | null,
    lifetimeReferrals: r.lifetime_referrals as number || 0,
    referralsWhoOrdered: r.referrals_who_ordered as number || 0,
    ordersFromReferrals: r.orders_from_referrals as number || 0,
    totalSpendFromReferrals: r.total_spend_from_referrals as number || 0,
    uniqueReferralCode: r.unique_referral_code as string || '',
    smsOrderNotificationOpt: (r.sms_order_notification_opt as number) === 1,
    validEmail: (r.valid_email as number) === 1,
    userAffiliation: r.user_affiliation as string || '',
    accountCreatedDate: r.account_created_date as string || '',
    lastVisitDate: r.last_visit_date as string || '',
    daysSinceLastVisit: r.days_since_last_visit as number || 0,
    daysSinceSignup: r.days_since_signup as number || 0,
    classMonth: r.class_month as string || '',
    signupSource: r.signup_source as string || '',
    emailOptIn: (r.email_opt_in as number) === 1,
    smsOptIn: (r.sms_opt_in as number) === 1,
    dateOfBirth: r.date_of_birth as string || '',
    age: r.age as number | null,
    gender: r.gender as string || '',
    snapshotMonth: r.snapshot_month as string,
  }));
}

export function getMenuIntelligence(month?: string): MenuIntelligenceItem[] {
  const db = getDb();
  const query = month
    ? 'SELECT * FROM fact_menu_item_snapshot WHERE snapshot_month = ? ORDER BY total_sold_last_year DESC'
    : 'SELECT * FROM fact_menu_item_snapshot ORDER BY total_sold_last_year DESC';
  const rows = (month ? db.prepare(query).all(month) : db.prepare(query).all()) as Array<Record<string, unknown>>;
  return rows.map(r => ({
    name: r.item_name as string,
    score: r.score as number || 0,
    price: r.price as number || 0,
    parentGroup: r.parent_group as string || '',
    itemType: r.item_type as string || '',
    overUnderState: r.over_under_state as string || '',
    totalSoldLastYear: r.total_sold_last_year as number || 0,
    revenueLastYear: r.revenue_last_year as number || 0,
    totalSoldLastMonth: r.total_sold_last_month as number || 0,
    soldLastYearFrequent: r.sold_last_year_frequent as number || 0,
    soldLastYearInfrequent: r.sold_last_year_infrequent as number || 0,
    revenueFrequent: r.revenue_frequent as number || 0,
    revenueInfrequent: r.revenue_infrequent as number || 0,
    soldLastMonthFrequent: r.sold_last_month_frequent as number || 0,
    soldLastMonthInfrequent: r.sold_last_month_infrequent as number || 0,
    avgOrdersPerMonthAll: r.avg_orders_per_month_all as number || 0,
    avgOrdersPerMonthFrequent: r.avg_orders_per_month_frequent as number || 0,
    avgOrdersPerMonthInfrequent: r.avg_orders_per_month_infrequent as number || 0,
    avgSoldPerMonthAll: r.avg_sold_per_month_all as number || 0,
    avgSoldPerMonthFrequent: r.avg_sold_per_month_frequent as number || 0,
    avgSoldPerMonthInfrequent: r.avg_sold_per_month_infrequent as number || 0,
    penetrationPctAll: r.penetration_pct_all as number || 0,
    penetrationPctFrequent: r.penetration_pct_frequent as number || 0,
    penetrationPctInfrequent: r.penetration_pct_infrequent as number || 0,
    daypartBreakfastAll: r.daypart_breakfast_all as number || 0,
    daypartBreakfastFrequent: r.daypart_breakfast_frequent as number || 0,
    daypartBreakfastInfrequent: r.daypart_breakfast_infrequent as number || 0,
    daypartLunchAll: r.daypart_lunch_all as number || 0,
    daypartLunchFrequent: r.daypart_lunch_frequent as number || 0,
    daypartLunchInfrequent: r.daypart_lunch_infrequent as number || 0,
    daypartDinnerAll: r.daypart_dinner_all as number || 0,
    daypartDinnerFrequent: r.daypart_dinner_frequent as number || 0,
    daypartDinnerInfrequent: r.daypart_dinner_infrequent as number || 0,
    freqRevenueRatio: r.freq_revenue_ratio as number || 0,
    infreqRevenueRatio: r.infreq_revenue_ratio as number || 0,
    repeatPurchaseProxy: r.repeat_purchase_proxy as number || 0,
    revenuePerUnit: r.revenue_per_unit as number || 0,
    menuQuadrant: r.menu_quadrant as 'star' | 'plow_horse' | 'puzzle' | 'dog',
    snapshotMonth: r.snapshot_month as string,
  }));
}

// ═══════════════════════════════════════════════════════════════════════════
// 6. SNAPSHOT AGGREGATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Compute MonthlySnapshot[] from all fact tables.
 * Replaces the ~100 line useMemo in store.ts.
 *
 * Strategy: Run 7 focused queries, merge by month in JavaScript.
 * This is more maintainable than one massive JOIN.
 */

interface MonthlySnapshot {
  month: string;
  totalSpend: number;
  spendByCategory: Record<SpendCategory, number>;
  budgetedSpend: number;
  budgetVariance: number;
  totalRevenue: number;
  revenueByLocation: Record<string, number>;
  totalOrders: number;
  metaImpressions: number;
  metaClicks: number;
  metaSpend: number;
  googleImpressions: number;
  googleClicks: number;
  googleSpend: number;
  newCustomers: number;
  estimatedCAC: number;
  estimatedROI: number;
  loyaltyAccounts: number;
  newLoyaltyAccounts: number;
  avgOrderValue: number;
  segmentCounts: Record<JourneyStage, number>;
  attritionHighCount: number;
  avgLTV: number;
}

function emptySnapshot(month: string): MonthlySnapshot {
  return {
    month,
    totalSpend: 0,
    spendByCategory: { paid_media: 0, direct_mail_print: 0, ooh: 0, software_fees: 0, labor: 0, sponsorship: 0, other: 0 },
    budgetedSpend: 0, budgetVariance: 0,
    totalRevenue: 0, revenueByLocation: {}, totalOrders: 0,
    metaImpressions: 0, metaClicks: 0, metaSpend: 0,
    googleImpressions: 0, googleClicks: 0, googleSpend: 0,
    newCustomers: 0, estimatedCAC: 0, estimatedROI: 0,
    loyaltyAccounts: 0, newLoyaltyAccounts: 0, avgOrderValue: 0,
    segmentCounts: { WHALE: 0, LOYALIST: 0, REGULAR: 0, ROOKIE: 0, CHURNED: 0, SLIDER: 0, UNKNOWN: 0 },
    attritionHighCount: 0, avgLTV: 0,
  };
}

export function computeSnapshots(): MonthlySnapshot[] {
  const db = getDb();
  const snapMap = new Map<string, MonthlySnapshot>();

  const getSnap = (month: string): MonthlySnapshot => {
    if (!snapMap.has(month)) snapMap.set(month, emptySnapshot(month));
    return snapMap.get(month)!;
  };

  // 1. Expenses by month + category
  const expenseRows = db.prepare(
    'SELECT month, category, SUM(amount) as total FROM fact_expense GROUP BY month, category'
  ).all() as Array<{ month: string; category: SpendCategory; total: number }>;

  for (const r of expenseRows) {
    const s = getSnap(r.month);
    s.spendByCategory[r.category] = (s.spendByCategory[r.category] || 0) + r.total;
    s.totalSpend += r.total;
  }

  // 2. Budgets
  const budgetRows = db.prepare('SELECT month, total_budget FROM fact_budget').all() as Array<{
    month: string; total_budget: number;
  }>;
  for (const r of budgetRows) {
    const s = getSnap(r.month);
    s.budgetedSpend = r.total_budget;
  }

  // 3. Store sales revenue by month + location (Clover + Toast combined)
  const storeRows = db.prepare(
    'SELECT month, location, gross_sales, net_sales, orders FROM fact_store_sales'
  ).all() as Array<{ month: string; location: string; gross_sales: number; net_sales: number; orders: number }>;

  for (const r of storeRows) {
    const s = getSnap(r.month);
    s.totalRevenue += r.gross_sales;
    s.totalOrders += r.orders;
    s.revenueByLocation[r.location] = (s.revenueByLocation[r.location] || 0) + r.gross_sales;
  }

  // 4. Meta campaign totals by month
  const metaRows = db.prepare(
    'SELECT month, SUM(impressions) as imp, SUM(clicks) as clk, SUM(spend) as spd FROM fact_meta_campaign GROUP BY month'
  ).all() as Array<{ month: string; imp: number; clk: number; spd: number }>;

  for (const r of metaRows) {
    const s = getSnap(r.month);
    s.metaImpressions = r.imp;
    s.metaClicks = r.clk;
    s.metaSpend = r.spd;
  }

  // 5. Google campaign totals by month
  const googleRows = db.prepare(
    'SELECT month, SUM(impressions) as imp, SUM(clicks) as clk, SUM(cost) as cst FROM fact_google_campaign GROUP BY month'
  ).all() as Array<{ month: string; imp: number; clk: number; cst: number }>;

  for (const r of googleRows) {
    const s = getSnap(r.month);
    s.googleImpressions = r.imp;
    s.googleClicks = r.clk;
    s.googleSpend = r.cst;
  }

  // 6. Incentivio metrics
  const incentivioRows = db.prepare(
    'SELECT month, total_loyalty_accounts, new_accounts, avg_order_value, ltv FROM fact_incentivio_metrics'
  ).all() as Array<{
    month: string; total_loyalty_accounts: number; new_accounts: number;
    avg_order_value: number; ltv: number;
  }>;

  for (const r of incentivioRows) {
    const s = getSnap(r.month);
    s.loyaltyAccounts = r.total_loyalty_accounts;
    s.newLoyaltyAccounts = r.new_accounts;
    s.avgOrderValue = r.avg_order_value;
    s.avgLTV = r.ltv;
    s.newCustomers = r.new_accounts; // best proxy for new customer count
  }

  // 7. CRM segment counts by month
  const crmRows = db.prepare(`
    SELECT snapshot_month, journey_stage, COUNT(*) as cnt,
      SUM(CASE WHEN attrition_risk = 'high' THEN 1 ELSE 0 END) as high_risk,
      AVG(lifetime_spend) as avg_ltv
    FROM fact_crm_customer_snapshot
    GROUP BY snapshot_month, journey_stage
  `).all() as Array<{
    snapshot_month: string; journey_stage: JourneyStage;
    cnt: number; high_risk: number; avg_ltv: number;
  }>;

  for (const r of crmRows) {
    const s = getSnap(r.snapshot_month);
    s.segmentCounts[r.journey_stage] = r.cnt;
    s.attritionHighCount += r.high_risk;
    // avgLTV from CRM overrides Incentivio LTV if available
    if (r.avg_ltv > 0) s.avgLTV = Math.round(r.avg_ltv * 100) / 100;
  }

  // ── Compute derived metrics ──
  const annualBudget = parseFloat(getSetting('annualBudget') || '533000');

  for (const s of snapMap.values()) {
    // Budget variance
    s.budgetVariance = s.budgetedSpend > 0
      ? ((s.totalSpend - s.budgetedSpend) / s.budgetedSpend) * 100
      : 0;

    // If no explicit budget, estimate from annual
    if (s.budgetedSpend === 0 && annualBudget > 0) {
      s.budgetedSpend = Math.round((annualBudget / 12) * 100) / 100;
      s.budgetVariance = ((s.totalSpend - s.budgetedSpend) / s.budgetedSpend) * 100;
    }

    // Estimated CAC
    s.estimatedCAC = s.newCustomers > 0
      ? Math.round((s.totalSpend / s.newCustomers) * 100) / 100
      : 0;

    // Estimated ROI: (revenue - spend) / spend × 100
    s.estimatedROI = s.totalSpend > 0
      ? Math.round(((s.totalRevenue - s.totalSpend) / s.totalSpend) * 100 * 100) / 100
      : 0;

    // Round values
    s.totalSpend = Math.round(s.totalSpend * 100) / 100;
    s.budgetVariance = Math.round(s.budgetVariance * 100) / 100;
  }

  // Sort by month ascending
  return [...snapMap.values()].sort((a, b) => a.month.localeCompare(b.month));
}

// ═══════════════════════════════════════════════════════════════════════════
// 7. DEDUP ANALYSIS
// ═══════════════════════════════════════════════════════════════════════════

export interface DedupAnalysis {
  existingRecords: number;
  newRecords: number;
  duplicates: number;
  strategy: 'insert_or_ignore' | 'snapshot_replace' | 'insert_or_replace';
  message: string;
}

export function analyzeExpenseDedup(expenses: MonthlyExpense[]): DedupAnalysis {
  const db = getDb();
  let duplicates = 0;
  const stmt = db.prepare(
    'SELECT COUNT(*) as cnt FROM fact_expense WHERE date = ? AND vendor = ? AND amount = ?'
  );
  for (const e of expenses) {
    const row = stmt.get(e.date, e.vendor, e.amount) as { cnt: number };
    if (row.cnt > 0) duplicates++;
  }
  return {
    existingRecords: duplicates,
    newRecords: expenses.length - duplicates,
    duplicates,
    strategy: 'insert_or_ignore',
    message: duplicates > 0
      ? `${duplicates} duplicate expenses will be skipped (same date + vendor + amount)`
      : 'No duplicates detected',
  };
}

export function analyzeCRMDedup(snapshotMonth: string, recordCount: number): DedupAnalysis {
  const db = getDb();
  const row = db.prepare(
    'SELECT COUNT(*) as cnt FROM fact_crm_customer_snapshot WHERE snapshot_month = ?'
  ).get(snapshotMonth) as { cnt: number };
  return {
    existingRecords: row.cnt,
    newRecords: recordCount,
    duplicates: row.cnt,
    strategy: 'snapshot_replace',
    message: row.cnt > 0
      ? `${row.cnt} existing CRM records for ${snapshotMonth} will be replaced`
      : `No existing data for ${snapshotMonth}`,
  };
}

export function analyzeMenuDedup(snapshotMonth: string, recordCount: number): DedupAnalysis {
  const db = getDb();
  const row = db.prepare(
    'SELECT COUNT(*) as cnt FROM fact_menu_item_snapshot WHERE snapshot_month = ?'
  ).get(snapshotMonth) as { cnt: number };
  return {
    existingRecords: row.cnt,
    newRecords: recordCount,
    duplicates: row.cnt,
    strategy: 'snapshot_replace',
    message: row.cnt > 0
      ? `${row.cnt} existing menu items for ${snapshotMonth} will be replaced`
      : `No existing data for ${snapshotMonth}`,
  };
}

export function analyzeMetaDedup(campaigns: MetaCampaign[]): DedupAnalysis {
  const db = getDb();
  let duplicates = 0;
  const stmt = db.prepare(
    'SELECT COUNT(*) as cnt FROM fact_meta_campaign WHERE month = ? AND campaign_name = ?'
  );
  for (const c of campaigns) {
    const row = stmt.get(c.month, c.campaignName) as { cnt: number };
    if (row.cnt > 0) duplicates++;
  }
  return {
    existingRecords: duplicates,
    newRecords: campaigns.length - duplicates,
    duplicates,
    strategy: 'insert_or_ignore',
    message: duplicates > 0
      ? `${duplicates} duplicate campaigns will be skipped`
      : 'No duplicates detected',
  };
}

export function analyzeGoogleDedup(campaigns: GoogleCampaign[], month: string): DedupAnalysis {
  const db = getDb();
  let duplicates = 0;
  const stmt = db.prepare(
    'SELECT COUNT(*) as cnt FROM fact_google_campaign WHERE month = ? AND campaign_name = ?'
  );
  for (const c of campaigns) {
    const row = stmt.get(month, c.campaignName) as { cnt: number };
    if (row.cnt > 0) duplicates++;
  }
  return {
    existingRecords: duplicates,
    newRecords: campaigns.length - duplicates,
    duplicates,
    strategy: 'insert_or_ignore',
    message: duplicates > 0
      ? `${duplicates} duplicate Google campaigns will be skipped`
      : 'No duplicates detected',
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 8. MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

/** Clear all data from all fact tables. Dimensions and settings are preserved. */
export function clearAllData(): void {
  const db = getDb();
  db.transaction(() => {
    db.exec('DELETE FROM fact_crm_customer_snapshot');
    db.exec('DELETE FROM fact_menu_item_snapshot');
    db.exec('DELETE FROM fact_expense');
    db.exec('DELETE FROM fact_meta_campaign');
    db.exec('DELETE FROM fact_google_campaign');
    db.exec('DELETE FROM fact_google_daily');
    db.exec('DELETE FROM fact_store_sales');
    db.exec('DELETE FROM fact_toast_discrepancy');
    db.exec('DELETE FROM fact_incentivio_metrics');
    db.exec('DELETE FROM fact_budget');
    db.exec('DELETE FROM upload_log');
  })();
}

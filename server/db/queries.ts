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
  MonthlyExpense, MetaCampaign, GoogleCampaign, GoogleDaily,
  ToastSales, IncentivioMetrics, MonthlyBudget, SpendCategory,
  CRMCustomerRecord, MenuIntelligenceItem,
  JourneyStage,
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
    (month, campaign_name, clicks, impressions, ctr, avg_cpc, cost)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  let inserted = 0;
  db.transaction(() => {
    const dimStmt = db.prepare('INSERT OR IGNORE INTO dim_month (month) VALUES (?)');
    for (const c of campaigns) {
      const m = c.month || month || '';
      if (!m) continue;
      dimStmt.run(m);
      const result = stmt.run(m, c.campaignName, c.clicks, c.impressions, c.ctr, c.avgCpc, c.cost);
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

// ── Toast Sales ──────────────────────────────────────────────────────────

export function insertToastSales(sales: ToastSales[]): number {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO fact_toast_sales
    (month, location, gross_sales, net_sales, orders, discount_total, source, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `);

  let inserted = 0;
  db.transaction(() => {
    const dimStmt = db.prepare('INSERT OR IGNORE INTO dim_month (month) VALUES (?)');
    const locStmt = db.prepare('INSERT OR IGNORE INTO dim_location (name) VALUES (?)');
    for (const s of sales) {
      dimStmt.run(s.month);
      locStmt.run(s.location);
      stmt.run(s.month, s.location, s.grossSales, s.netSales, s.orders, s.discountTotal, s.source || 'csv');
      inserted++;
    }
  })();
  return inserted;
}

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

// ── Budgets ──────────────────────────────────────────────────────────────

export function insertBudgets(budgets: MonthlyBudget[]): number {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO fact_budget
    (month, total_budget, paid_media, direct_mail_print, ooh, software_fees, labor, other)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let inserted = 0;
  db.transaction(() => {
    const dimStmt = db.prepare('INSERT OR IGNORE INTO dim_month (month) VALUES (?)');
    for (const b of budgets) {
      dimStmt.run(b.month);
      stmt.run(
        b.month, b.totalBudget,
        b.byCategory.paid_media, b.byCategory.direct_mail_print, b.byCategory.ooh,
        b.byCategory.software_fees, b.byCategory.labor, b.byCategory.other,
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

export function getGoogleCampaigns(month?: string): GoogleCampaign[] {
  const db = getDb();
  const query = month
    ? 'SELECT * FROM fact_google_campaign WHERE month = ?'
    : 'SELECT * FROM fact_google_campaign';
  const rows = (month ? db.prepare(query).all(month) : db.prepare(query).all()) as Array<{
    month: string; campaign_name: string; clicks: number; impressions: number;
    ctr: number; avg_cpc: number; cost: number;
  }>;
  return rows.map(r => ({
    month: r.month, campaignName: r.campaign_name, clicks: r.clicks,
    impressions: r.impressions, ctr: r.ctr, avgCpc: r.avg_cpc, cost: r.cost,
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

export function getToastSales(month?: string): ToastSales[] {
  const db = getDb();
  const query = month
    ? 'SELECT * FROM fact_toast_sales WHERE month = ?'
    : 'SELECT * FROM fact_toast_sales';
  const rows = (month ? db.prepare(query).all(month) : db.prepare(query).all()) as Array<{
    month: string; location: string; gross_sales: number; net_sales: number;
    orders: number; discount_total: number; source: string; synced_at: string;
  }>;
  return rows.map(r => ({
    month: r.month, location: r.location, grossSales: r.gross_sales,
    netSales: r.net_sales, orders: r.orders, discountTotal: r.discount_total,
    source: r.source as 'api' | 'csv', syncedAt: r.synced_at,
  }));
}

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

export function getBudgets(): MonthlyBudget[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM fact_budget ORDER BY month').all() as Array<{
    month: string; total_budget: number; paid_media: number; direct_mail_print: number;
    ooh: number; software_fees: number; labor: number; other: number;
  }>;
  return rows.map(r => ({
    month: r.month, totalBudget: r.total_budget,
    byCategory: {
      paid_media: r.paid_media, direct_mail_print: r.direct_mail_print,
      ooh: r.ooh, software_fees: r.software_fees, labor: r.labor, other: r.other,
    },
  }));
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
    spendByCategory: { paid_media: 0, direct_mail_print: 0, ooh: 0, software_fees: 0, labor: 0, other: 0 },
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

  // 3. Toast revenue by month + location
  const toastRows = db.prepare(
    'SELECT month, location, gross_sales, orders FROM fact_toast_sales'
  ).all() as Array<{ month: string; location: string; gross_sales: number; orders: number }>;

  for (const r of toastRows) {
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
    db.exec('DELETE FROM fact_toast_sales');
    db.exec('DELETE FROM fact_toast_discrepancy');
    db.exec('DELETE FROM fact_incentivio_metrics');
    db.exec('DELETE FROM fact_budget');
    db.exec('DELETE FROM upload_log');
  })();
}

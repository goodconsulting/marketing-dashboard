/**
 * Server-side type definitions for the Stack marketing dashboard.
 *
 * These mirror and EXPAND the client-side types in src/types.ts.
 * The server types are authoritative — they include all ~44 CRM fields
 * and ~35 Menu Intelligence fields from Incentivio's exports.
 *
 * Phase 4 will sync src/types.ts with these expanded definitions.
 */

// ─── Shared primitives ──────────────────────────────────────────

export type SpendCategory = 'paid_media' | 'direct_mail_print' | 'ooh' | 'software_fees' | 'labor' | 'other';

export type DataSourceType =
  | 'meta'
  | 'google'
  | 'toast'
  | 'incentivio'
  | 'incentivio_crm'
  | 'incentivio_menu'
  | 'organic'
  | '3po'
  | 'expenses'
  | 'budget';

export type JourneyStage = 'WHALE' | 'LOYALIST' | 'REGULAR' | 'ROOKIE' | 'CHURNED' | 'SLIDER' | 'UNKNOWN';

// ─── Expense ────────────────────────────────────────────────────

export interface MonthlyExpense {
  id: string;
  date: string;
  month: string;
  vendor: string;
  description: string;
  amount: number;
  category: SpendCategory;
  source: string;
}

// ─── Budget ─────────────────────────────────────────────────────

export interface MonthlyBudget {
  month: string;
  totalBudget: number;
  byCategory: Record<SpendCategory, number>;
}

// ─── Meta Campaigns ─────────────────────────────────────────────

export interface MetaCampaign {
  month: string;
  campaignName: string;
  impressions: number;
  reach: number;
  clicks: number;
  spend: number;
  results: number;
  resultType: string;
  costPerResult: number;
}

// ─── Google Ads ─────────────────────────────────────────────────

export interface GoogleCampaign {
  month: string;
  campaignName: string;
  clicks: number;
  impressions: number;
  ctr: number;
  avgCpc: number;
  cost: number;
}

export interface GoogleDaily {
  date: string;
  clicks: number;
  impressions: number;
  avgCpc: number;
  cost: number;
}

// ─── Toast POS ──────────────────────────────────────────────────

export interface ToastSales {
  month: string;
  location: string;
  grossSales: number;
  netSales: number;
  orders: number;
  discountTotal: number;
  source?: 'api' | 'csv';
  syncedAt?: string;
}

// ─── Incentivio Aggregate Metrics ───────────────────────────────

export interface IncentivioMetrics {
  month: string;
  totalLoyaltyAccounts: number;
  newAccounts: number;
  avgOrderValue: number;
  lifetimeVisits: number;
  last90DaysSpend: number;
  ltv: number;
}

// ─── CRM: Expanded Per-Customer Record (~44 fields) ─────────────

export interface CRMCustomerRecord {
  customerId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;

  // Journey & segmentation
  journeyStage: JourneyStage;
  attritionRisk: 'high' | 'medium' | 'low';
  reachLocation: string;

  // Core spend & frequency
  lifetimeSpend: number;
  lifetimeVisits: number;
  avgBasketValue: number;
  last90DaysSpend: number;
  last90DaysOrders: number;
  lastYearSpend: number;
  lastYearOrders: number;
  currentLoyaltyBalance: number;

  // Extended spend metrics (NEW)
  avgBasketValuePerMonth: number;
  purchasesPerMonth: number;
  avgPurchasesPerWeek: number;
  last90DayMonthlySpend: number;
  last90DayAvgWeeklySpend: number;
  avgWeeklySpend: number;

  // Percentiles (NEW)
  daysSinceLastVisitPct: number | null;
  lifetimeAovPercentile: number | null;
  purchasesPerMonthPct: number | null;

  // Referrals (NEW)
  lifetimeReferrals: number;
  referralsWhoOrdered: number;
  ordersFromReferrals: number;
  totalSpendFromReferrals: number;
  uniqueReferralCode: string;

  // Engagement (NEW)
  smsOrderNotificationOpt: boolean;
  validEmail: boolean;
  userAffiliation: string;

  // Dates
  accountCreatedDate: string;
  lastVisitDate: string;
  daysSinceLastVisit: number;
  daysSinceSignup: number;
  classMonth: string;

  // Signup & opt-in
  signupSource: string;
  emailOptIn: boolean;
  smsOptIn: boolean;

  // Demographics (columns ready, populated when available)
  dateOfBirth: string;
  age: number | null;
  gender: string;

  // Snapshot metadata
  snapshotMonth: string;
}

// ─── Menu Intelligence: Expanded (~35 fields) ────────────────────

export interface MenuIntelligenceItem {
  name: string;
  score: number;
  price: number;
  parentGroup: string;
  itemType: string;
  overUnderState: string;

  // Volume metrics
  totalSoldLastYear: number;
  revenueLastYear: number;
  totalSoldLastMonth: number;

  // Frequency breakdowns
  soldLastYearFrequent: number;
  soldLastYearInfrequent: number;
  revenueFrequent: number;
  revenueInfrequent: number;

  // Sold last month breakdown (NEW)
  soldLastMonthFrequent: number;
  soldLastMonthInfrequent: number;

  // Average orders per month (NEW)
  avgOrdersPerMonthAll: number;
  avgOrdersPerMonthFrequent: number;
  avgOrdersPerMonthInfrequent: number;

  // Average sold per month (NEW)
  avgSoldPerMonthAll: number;
  avgSoldPerMonthFrequent: number;
  avgSoldPerMonthInfrequent: number;

  // Penetration % (NEW)
  penetrationPctAll: number;
  penetrationPctFrequent: number;
  penetrationPctInfrequent: number;

  // Daypart breakdown (NEW) — total sold in each daypart
  daypartBreakfastAll: number;
  daypartBreakfastFrequent: number;
  daypartBreakfastInfrequent: number;
  daypartLunchAll: number;
  daypartLunchFrequent: number;
  daypartLunchInfrequent: number;
  daypartDinnerAll: number;
  daypartDinnerFrequent: number;
  daypartDinnerInfrequent: number;

  // Computed ratios
  freqRevenueRatio: number;
  infreqRevenueRatio: number;
  repeatPurchaseProxy: number;
  revenuePerUnit: number;
  menuQuadrant: 'star' | 'plow_horse' | 'puzzle' | 'dog';

  // Snapshot metadata
  snapshotMonth: string;
}

// ─── Parser result types ─────────────────────────────────────────

export interface IncentivioParseResult {
  metrics: IncentivioMetrics;
  customers: CRMCustomerRecord[];
  totalRecords: number;
  activeCustomers: number;
}

export interface ParseResult<T> {
  records: T[];
  detectedMonth: string;
  recordCount: number;
}

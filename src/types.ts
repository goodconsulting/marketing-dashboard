export type SpendCategory = 'paid_media' | 'direct_mail_print' | 'ooh' | 'software_fees' | 'labor' | 'sponsorship' | 'other';

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
  | 'budget'
  | 'onelink'
  | 'discount_summary';

export interface MonthlyExpense {
  id: string;
  date: string;        // YYYY-MM-DD
  month: string;       // YYYY-MM
  vendor: string;
  description: string;
  amount: number;
  category: SpendCategory;
  source: string;      // 'manual' | filename
}

export interface MonthlyBudget {
  month: string;       // YYYY-MM
  totalBudget: number;
  byCategory: Record<SpendCategory, number>;
}

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

export interface MetaAdSet {
  month: string;
  campaignName: string;
  adSetName: string;
  delivery: string;
  impressions: number;
  reach: number;
  clicks: number;
  spend: number;
  results: number;
  resultType: string;
  costPerResult: number;
  landingPageViews: number;
  cpm: number;
  cpc: number;
  ctr: number;
}

export interface GoogleCampaign {
  month: string;
  campaignName: string;
  clicks: number;
  impressions: number;
  ctr: number;
  avgCpc: number;
  cost: number;
  conversions: number;
}

export interface GoogleDaily {
  date: string;
  clicks: number;
  impressions: number;
  avgCpc: number;
  cost: number;
}

export interface StoreSales {
  month: string;
  location: string;
  grossSales: number;
  netSales: number;
  orders: number;
  discountTotal: number;
  guests?: number;
  tips?: number;
  taxAmount?: number;
  refunds?: number;
  doordashSales?: number;
  uberEatsSales?: number;
  foodSales?: number;
  smoothieSales?: number;
  retailSales?: number;
  source?: 'clover' | 'toast' | 'clover+toast';
  syncedAt?: string;
}

/** @deprecated Use StoreSales instead */
export type ToastSales = StoreSales;

export interface ToastDiscrepancy {
  month: string;
  location: string;
  field: 'grossSales' | 'netSales' | 'orders' | 'discountTotal';
  apiValue: number;
  csvValue: number;
  percentDiff: number;
}

export interface IncentivioMetrics {
  month: string;
  totalLoyaltyAccounts: number;
  newAccounts: number;
  avgOrderValue: number;
  lifetimeVisits: number;
  last90DaysSpend: number;
  ltv: number;
}

// ─── CRM: Per-Customer Records (~44 fields) ──────────────────────
// Journey stages from Incentivio's Guest Journey Stage field
export type JourneyStage = 'WHALE' | 'LOYALIST' | 'REGULAR' | 'ROOKIE' | 'CHURNED' | 'SLIDER' | 'UNKNOWN';

export interface CRMCustomerRecord {
  customerId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;

  // Journey & segmentation
  journeyStage: JourneyStage;
  attritionRisk: 'high' | 'medium' | 'low';  // computed from recency + frequency
  reachLocation: string;                       // primary location affinity

  // Core spend & frequency
  lifetimeSpend: number;
  lifetimeVisits: number;
  avgBasketValue: number;
  last90DaysSpend: number;
  last90DaysOrders: number;
  lastYearSpend: number;
  lastYearOrders: number;
  currentLoyaltyBalance: number;

  // Extended spend metrics
  avgBasketValuePerMonth: number;
  purchasesPerMonth: number;
  avgPurchasesPerWeek: number;
  last90DayMonthlySpend: number;
  last90DayAvgWeeklySpend: number;
  avgWeeklySpend: number;

  // Percentiles
  daysSinceLastVisitPct: number | null;
  lifetimeAovPercentile: number | null;
  purchasesPerMonthPct: number | null;

  // Referrals
  lifetimeReferrals: number;
  referralsWhoOrdered: number;
  ordersFromReferrals: number;
  totalSpendFromReferrals: number;
  uniqueReferralCode: string;

  // Engagement
  smsOrderNotificationOpt: boolean;
  validEmail: boolean;
  userAffiliation: string;

  // Dates
  accountCreatedDate: string;      // ISO date
  lastVisitDate: string;           // ISO date
  daysSinceLastVisit: number;      // computed
  daysSinceSignup: number;         // computed

  // Computed cohort field
  classMonth: string;              // YYYY-MM of first order (signup proxy)

  // Signup & opt-in
  signupSource: string;
  emailOptIn: boolean;
  smsOptIn: boolean;

  // Demographics (columns ready, populated when available)
  dateOfBirth: string;
  age: number | null;
  gender: string;

  // Snapshot metadata
  snapshotMonth: string;           // YYYY-MM when this record was captured
}

// Segment summary for dashboard display
export interface SegmentSummary {
  stage: JourneyStage;
  count: number;
  pctOfTotal: number;
  avgLTV: number;
  avgBasketValue: number;
  avgVisits: number;
  attritionHighCount: number;
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

  // Frequency breakdowns (from Incentivio CSV columns)
  soldLastYearFrequent: number;     // frequent customers
  soldLastYearInfrequent: number;   // infrequent customers
  revenueFrequent: number;
  revenueInfrequent: number;

  // Sold last month breakdown
  soldLastMonthFrequent: number;
  soldLastMonthInfrequent: number;

  // Average orders per month
  avgOrdersPerMonthAll: number;
  avgOrdersPerMonthFrequent: number;
  avgOrdersPerMonthInfrequent: number;

  // Average sold per month
  avgSoldPerMonthAll: number;
  avgSoldPerMonthFrequent: number;
  avgSoldPerMonthInfrequent: number;

  // Penetration %
  penetrationPctAll: number;
  penetrationPctFrequent: number;
  penetrationPctInfrequent: number;

  // Daypart breakdown — total sold in each daypart
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
  freqRevenueRatio: number;         // revenueFrequent / revenueLastYear
  infreqRevenueRatio: number;       // revenueInfrequent / revenueLastYear
  repeatPurchaseProxy: number;      // totalSoldLastYear / totalSoldLastMonth (annualized)
  revenuePerUnit: number;           // revenueLastYear / totalSoldLastYear

  // Classification
  menuQuadrant: 'star' | 'plow_horse' | 'puzzle' | 'dog';  // BCG-style

  // Snapshot metadata
  snapshotMonth: string;
}

export interface OneLinkDaily {
  date: string;
  month: string;
  trackingCode: string;
  campaignSource: string;
  campaignLabel: string;
  total: number;
  iphone: number;
  ipad: number;
  android: number;
  other: number;
}

// ─── AMP Campaigns (Email + Streaming) ───────────────────────────

export interface AmpCampaign {
  month: string;
  campaignType: string;
  campaignName: string;
  location: string;
  impressions: number;
  reach: number;
  frequency: number;
  sent: number;
  views: number;
  clicks: number;
  viewRate: number;
  clickRate: number;
  vcr: number;
  viewingHours: number;
}

// ─── Billboard Monthly (Lamar) ───────────────────────────────────

export interface BillboardMonthly {
  month: string;
  location: string;
  panelId: string;
  playsGuaranteed: number;
  playsDelivered: number;
  impressionsGuaranteed: number;
  impressionsDelivered: number;
  variancePct: number;
  numCreatives: number;
  contractedDays: number;
}

// ─── Other Campaigns (Yelp, TikTok, LinkedIn, long-tail) ─────────

export interface OtherCampaign {
  month: string;
  source: string;            // 'yelp', 'tiktok', etc.
  campaignName: string;      // e.g., store name for local channels
  spend: number;
  impressions: number;
  clicks: number;            // page_visits for Yelp
  conversions: number;       // leads for Yelp
  ctr: number;
  cpc: number;
  costPerConv: number;
  windowStart: string | null;
  windowEnd: string | null;
  extra: Record<string, unknown> | null;
}

// ─── Stage Transitions ───────────────────────────────────────────

export interface StageTransition {
  customerId: string;
  fromStage: string;
  toStage: string;
  direction: 'up' | 'down' | 'churn' | 'reactivate' | 'first_seen' | 'lateral';
  fromSnapshot: string;
  toSnapshot: string;
  daysInFromStage: number | null;
  spendInFromStage: number | null;
  visitsInFromStage: number | null;
  fromLifetimeSpend: number | null;
  toLifetimeSpend: number | null;
  fromLifetimeVisits: number | null;
  toLifetimeVisits: number | null;
  estimatedTransitionDate: string | null;
}

export interface OrganicMetrics {
  month: string;
  platform: string;
  followers: number;
  newFollows: number;
  views: number;
  interactions: number;
  linkClicks: number;
}

export interface ThirdPartyMetrics {
  month: string;
  platform: string;   // ubereats | doordash | grubhub
  orders: number;
  revenue: number;
}

export interface MonthlySnapshot {
  month: string;       // YYYY-MM
  // Spend
  totalSpend: number;
  spendByCategory: Record<SpendCategory, number>;
  budgetedSpend: number;
  budgetVariance: number;
  // Revenue
  totalRevenue: number;
  revenueByLocation: Record<string, number>;
  totalOrders: number;
  // Performance
  metaImpressions: number;
  metaClicks: number;
  metaSpend: number;
  googleImpressions: number;
  googleClicks: number;
  googleSpend: number;
  // Attribution
  newCustomers: number;
  estimatedCAC: number;
  estimatedROI: number;
  // Loyalty
  loyaltyAccounts: number;
  newLoyaltyAccounts: number;
  avgOrderValue: number;

  // CRM Segment Counts
  segmentCounts: Record<JourneyStage, number>;
  attritionHighCount: number;
  avgLTV: number;
}

export interface UploadedFile {
  id: string;
  filename: string;
  uploadedAt: string;
  sourceType: DataSourceType;
  recordCount: number;
  monthCovered: string;
}

// ─── Upload Pipeline Types ───────────────────────────────────────

export interface DedupAnalysis {
  totalIncoming: number;
  existingCount: number;
  newCount: number;
  duplicateCount: number;
  action: 'insert_new' | 'replace_all' | 'skip_duplicates' | 'snapshot_replace';
  details: string;
}

export interface UploadPreview {
  uploadId: string;
  detectedSource: DataSourceType;
  detectedMonth: string;
  recordCount: number;
  sampleRows: unknown[];
  dedup: DedupAnalysis | null;
  filename: string;
}

export interface ConfirmResult {
  success: boolean;
  recordCount: number;
  insertedCount: number;
  source: DataSourceType;
  month: string;
}

// ─── Discount Summary ────────────────────────────────────────────

export interface DiscountSummary {
  period: string;
  periodType: string;
  discountName: string;
  discountCategory: string;
  usageCount: number;
  discountAmount: number;
  profitability: number;
  pctOfTotalSales: number;
}

// ─── Dashboard State ─────────────────────────────────────────────

export interface DashboardState {
  expenses: MonthlyExpense[];
  budgets: MonthlyBudget[];
  metaCampaigns: MetaCampaign[];
  googleCampaigns: GoogleCampaign[];
  googleDaily: GoogleDaily[];
  toastSales: ToastSales[];
  incentivio: IncentivioMetrics[];
  organic: OrganicMetrics[];
  thirdParty: ThirdPartyMetrics[];
  snapshots: MonthlySnapshot[];
  uploadedFiles: UploadedFile[];
  annualBudget: number;
  toastDiscrepancies: ToastDiscrepancy[];

  // Per-customer CRM records + menu intelligence
  crmCustomers: CRMCustomerRecord[];           // active only (lifetime_spend > 0 or lifetime_visits > 0)
  allCrmCustomers: CRMCustomerRecord[];         // all customers including ghost accounts
  menuIntelligence: MenuIntelligenceItem[];

  // OneLink QR tracking
  onelinkData: OneLinkDaily[];

  // Discount summary
  discountSummary: DiscountSummary[];

  // AMP campaigns (email + streaming)
  ampCampaigns: AmpCampaign[];

  // Billboard (Lamar)
  billboardData: BillboardMonthly[];

  // Long-tail paid channels (Yelp, TikTok, LinkedIn, etc.)
  otherCampaigns: OtherCampaign[];

  // Stage transitions (derived from CRM snapshot history)
  stageTransitions: StageTransition[];
}

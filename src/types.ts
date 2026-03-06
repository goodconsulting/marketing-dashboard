export type SpendCategory = 'paid_media' | 'direct_mail_print' | 'ooh' | 'software_fees' | 'labor' | 'other';

export type DataSourceType =
  | 'meta'
  | 'google'
  | 'toast'
  | 'incentivio'
  | 'organic'
  | '3po'
  | 'expenses'
  | 'budget';

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

export interface ToastSales {
  month: string;
  location: string;
  grossSales: number;
  netSales: number;
  orders: number;
  discountTotal: number;
  source?: 'api' | 'csv';   // Track data origin — API is source of truth
  syncedAt?: string;         // ISO timestamp of when data was fetched
}

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

// ─── CRM: Per-Customer Records ─────────────────────────────────
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

  // Spend & frequency
  lifetimeSpend: number;
  lifetimeVisits: number;
  avgBasketValue: number;
  last90DaysSpend: number;
  last90DaysOrders: number;
  lastYearSpend: number;
  lastYearOrders: number;
  currentLoyaltyBalance: number;

  // Dates
  accountCreatedDate: string;      // ISO date
  lastVisitDate: string;           // ISO date
  daysSinceLastVisit: number;      // computed
  daysSinceSignup: number;         // computed

  // Computed cohort field
  classMonth: string;              // YYYY-MM of first order (signup proxy)

  // Engagement flags (enrichable from Incentivio tags/custom fields)
  signupSource: string;
  emailOptIn: boolean;
  smsOptIn: boolean;

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

// ─── Menu Intelligence: Expanded ─────────────────────────────────
export interface MenuIntelligenceItem {
  name: string;
  score: number;
  price: number;
  parentGroup: string;

  // Volume metrics
  totalSoldLastYear: number;
  revenueLastYear: number;
  totalSoldLastMonth: number;

  // Frequency breakdowns (from Incentivio CSV columns)
  soldLastYearFrequent: number;     // frequent customers
  soldLastYearInfrequent: number;   // infrequent customers
  revenueFrequent: number;
  revenueInfrequent: number;

  // Computed ratios
  freqRevenueRatio: number;         // revenueFrequent / revenueLastYear
  infreqRevenueRatio: number;       // revenueInfrequent / revenueLastYear
  repeatPurchaseProxy: number;      // totalSoldLastYear / totalSoldLastMonth (annualized)
  revenuePerUnit: number;           // revenueLastYear / totalSoldLastYear

  // Classification
  menuQuadrant: 'star' | 'plow_horse' | 'puzzle' | 'dog';  // BCG-style
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

  // CRM Segment Counts (Phase A)
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

  // Phase A: Per-customer CRM records + menu intelligence
  crmCustomers: CRMCustomerRecord[];
  menuIntelligence: MenuIntelligenceItem[];
}

/**
 * CRM Customer parser — expanded to ~44 fields from Incentivio export.
 *
 * Input: CSV string from Incentivio's customer_export.
 * Output: Per-customer records + aggregated IncentivioMetrics.
 *
 * New fields vs client-side parser:
 * - Extended spend: avg basket/month, purchases/month, weekly spend
 * - Percentiles: days since visit, AOV, purchases/month
 * - Referrals: lifetime referrals, who ordered, orders/spend from referrals
 * - Engagement: SMS order opt-in, valid email, user affiliation
 * - Demographics: DOB, age, gender (columns ready)
 */

import Papa from 'papaparse';
import type { CRMCustomerRecord, IncentivioParseResult, IncentivioMetrics, JourneyStage } from '../types.ts';
import { parseMonth, parseNum, parseInt_, parseBool } from './utils.ts';

// ─── Journey Stage Normalization ───────────────────────
function normalizeJourneyStage(raw: string): JourneyStage {
  const upper = raw.toUpperCase().trim();
  if (upper === 'WHALE') return 'WHALE';
  if (upper === 'LOYALIST') return 'LOYALIST';
  if (upper === 'REGULAR') return 'REGULAR';
  if (upper === 'ROOKIE') return 'ROOKIE';
  if (upper === 'CHURNED') return 'CHURNED';
  if (upper === 'SLIDER') return 'SLIDER';
  return 'UNKNOWN';
}

// ─── Attrition Risk Scoring ────────────────────────────
function computeAttritionRisk(
  daysSinceLastVisit: number,
  lifetimeVisits: number,
  last90DaysOrders: number,
): 'high' | 'medium' | 'low' {
  if (daysSinceLastVisit > 60 && lifetimeVisits < 4) return 'high';
  if (daysSinceLastVisit > 60) return 'medium';
  if (daysSinceLastVisit > 30 && last90DaysOrders < 2) return 'medium';
  return 'low';
}

/**
 * Parse Incentivio CRM customer export CSV.
 * Returns both per-customer records and aggregated metrics.
 */
export function parseCRM(csvContent: string, snapshotMonthOverride?: string): IncentivioParseResult {
  const result = Papa.parse(csvContent, { header: true, skipEmptyLines: true });

  if (result.errors.length > 0) {
    console.warn(`[CRM Parser] ${result.errors.length} row-level warnings`);
  }

  const rows = result.data as Record<string, string>[];
  const validRows = rows.filter(r => r['Customer ID'] && r['Customer ID'] !== '');

  const totalAccounts = validRows.length;
  const today = new Date();
  const todayMs = today.getTime();

  // Aggregation accumulators
  let newestMonth = '';
  const accountsByMonth: Record<string, number> = {};
  let sumAOV = 0, aovCount = 0;
  let sumLifetimeVisits = 0, lifetimeCount = 0;
  let sumLast90Spend = 0, last90Count = 0;
  let sumLifetimeSpend = 0, lifetimeSpendCount = 0;
  let activeCustomers = 0;

  const customers: CRMCustomerRecord[] = [];

  for (const row of validRows) {
    // ─── Identity fields ───
    const customerId = row['Customer ID'] || '';
    const firstName = row['First Name'] || '';
    const lastName = row['Last Name'] || '';
    const email = row['Email'] || '';
    const phone = row['Phone'] || row['Phone Number'] || '';
    const journeyStageRaw = row['Guest Journey Stage'] || '';
    const reachLocation = row['Reach Location'] || row['Location'] || '';
    const signupSource = row['Signup Source'] || row['Source'] || '';

    const createdDate = row['Account Created Date'] || '';
    const lastVisitDate = row['Last Purchase Date'] || row['Last Visit Date'] || row['Last Order Date'] || '';

    // ─── Core spend & frequency (existing 25 fields) ───
    const lifetimeSpend = parseNum(row['Lifetime Spend']);
    const lifetimeVisits = parseInt_(row['Lifetime Visits']);
    const avgBasketValue = parseNum(row['Average Basket Value']);
    const last90DaysSpend = parseNum(row['Last 90 day Spend'] || row['Last 90 Days Spend']);
    const last90DaysOrders = parseInt_(row['Last 90 Days Orders'] || row['Last 90 day Orders']);
    const lastYearSpend = parseNum(row['Last Year Spend'] || row['Last 365 Days Spend']);
    const lastYearOrders = parseInt_(row['Last Year Orders'] || row['Last 365 Days Orders']);
    const loyaltyBalance = parseNum(row['Loyalty Balance'] || row['Current Loyalty Balance']);

    // ─── Extended spend metrics (NEW) ───
    const avgBasketValuePerMonth = parseNum(row['Average Basket Value Per Month']);
    const purchasesPerMonth = parseNum(row['Purchases per Month'] || row['Purchases Per Month']);
    const avgPurchasesPerWeek = parseNum(row['Average Purchases Per Week'] || row['Avg Purchases Per Week']);
    const last90DayMonthlySpend = parseNum(row['Last 90 day monthly Spend'] || row['Last 90 Day Monthly Spend']);
    const last90DayAvgWeeklySpend = parseNum(row['Last 90 day average weekly Spend'] || row['Last 90 Day Avg Weekly Spend']);
    const avgWeeklySpend = parseNum(row['Average Weekly Spend'] || row['Avg Weekly Spend']);

    // ─── Percentiles (NEW) ───
    const daysSinceLastVisitPctRaw = row['Days Since Last Purchase Percentile'] || row['Days Since Last Visit Percentile'];
    const daysSinceLastVisitPct = daysSinceLastVisitPctRaw ? parseNum(daysSinceLastVisitPctRaw) : null;

    const lifetimeAovPercentileRaw = row['Lifetime Average Order Value Percentile'] || row['Lifetime AOV Percentile'];
    const lifetimeAovPercentile = lifetimeAovPercentileRaw ? parseNum(lifetimeAovPercentileRaw) : null;

    const purchasesPerMonthPctRaw = row['Purchases Per Month Percentile'] || row['Purchases per Month Percentile'];
    const purchasesPerMonthPct = purchasesPerMonthPctRaw ? parseNum(purchasesPerMonthPctRaw) : null;

    // ─── Referrals (NEW) ───
    const lifetimeReferrals = parseInt_(row['Lifetime Referrals']);
    const referralsWhoOrdered = parseInt_(row['No of Referrals who Ordered'] || row['Referrals Who Ordered']);
    const ordersFromReferrals = parseInt_(row['No of Orders from Referrals'] || row['Orders From Referrals']);
    const totalSpendFromReferrals = parseNum(row['Total Spend from Referrals'] || row['Total Spend From Referrals']);
    const uniqueReferralCode = row['Unique Referral Code'] || '';

    // ─── Engagement (NEW) ───
    const smsOrderNotificationOpt = parseBool(row['SMS Order Notification Opt in'] || row['SMS Order Notification Opt In']);
    const validEmail = parseBool(row['Valid Email?'] || row['Valid Email']);
    const userAffiliation = row['User Affiliation'] || '';

    // ─── Opt-in flags ───
    const emailOptIn = parseBool(row['Email Opt In'] || row['Email Opted In']);
    const smsOptIn = parseBool(row['SMS Opt In'] || row['SMS Opted In']);

    // ─── Demographics (NEW — columns ready) ───
    const dateOfBirth = row['Date of Birth'] || row['Birthday'] || '';
    const ageRaw = row['Age'];
    const age = ageRaw ? parseInt_(ageRaw) : null;
    const gender = row['Gender'] || '';

    // ─── Compute derived fields ───
    // Prefer the pre-computed "Days Since Last Purchase" from the CSV;
    // fall back to date arithmetic from Last Purchase/Visit Date.
    const daysSinceLastPurchaseRaw = row['Days Since Last Purchase'];
    let daysSinceLastVisit = 999;
    if (daysSinceLastPurchaseRaw && daysSinceLastPurchaseRaw !== '-' && daysSinceLastPurchaseRaw !== '') {
      daysSinceLastVisit = parseInt_(daysSinceLastPurchaseRaw);
    } else if (lastVisitDate && lastVisitDate !== '-') {
      const lvDate = new Date(lastVisitDate);
      if (!isNaN(lvDate.getTime())) {
        daysSinceLastVisit = Math.floor((todayMs - lvDate.getTime()) / (1000 * 60 * 60 * 24));
      }
    }

    let daysSinceSignup = 0;
    if (createdDate && createdDate !== '-') {
      const cdDate = new Date(createdDate);
      if (!isNaN(cdDate.getTime())) {
        daysSinceSignup = Math.floor((todayMs - cdDate.getTime()) / (1000 * 60 * 60 * 24));
      }
    }

    const classMonth = createdDate && createdDate !== '-'
      ? parseMonth(createdDate)
      : '';

    const journeyStage = normalizeJourneyStage(journeyStageRaw);

    // Prefer Incentivio's own Attrition Risk classification (CHURNED/SLIDER/NO_RISK);
    // fall back to computed heuristic when the column is empty/dash.
    const incentivioAttritionRaw = (row['Attrition Risk'] || '').toUpperCase().trim();
    let attritionRisk: 'high' | 'medium' | 'low';
    if (incentivioAttritionRaw === 'CHURNED') {
      attritionRisk = 'high';
    } else if (incentivioAttritionRaw === 'SLIDER') {
      attritionRisk = 'medium';
    } else if (incentivioAttritionRaw === 'NO_RISK') {
      attritionRisk = 'low';
    } else {
      attritionRisk = computeAttritionRisk(daysSinceLastVisit, lifetimeVisits, last90DaysOrders);
    }

    // ─── Aggregation ───
    if (createdDate && createdDate !== '-') {
      const month = parseMonth(createdDate);
      if (month.match(/^\d{4}-\d{2}$/)) {
        accountsByMonth[month] = (accountsByMonth[month] || 0) + 1;
        if (month > newestMonth) newestMonth = month;
      }
    }

    if (avgBasketValue > 0) { sumAOV += avgBasketValue; aovCount++; }
    if (lifetimeVisits > 0) { sumLifetimeVisits += lifetimeVisits; lifetimeCount++; activeCustomers++; }
    if (last90DaysSpend > 0) { sumLast90Spend += last90DaysSpend; last90Count++; }
    if (lifetimeSpend > 0) { sumLifetimeSpend += lifetimeSpend; lifetimeSpendCount++; }

    // ─── Build expanded record ───
    customers.push({
      customerId,
      firstName,
      lastName,
      email,
      phone,
      journeyStage,
      attritionRisk,
      reachLocation,
      lifetimeSpend,
      lifetimeVisits,
      avgBasketValue,
      last90DaysSpend,
      last90DaysOrders,
      lastYearSpend,
      lastYearOrders,
      currentLoyaltyBalance: loyaltyBalance,
      avgBasketValuePerMonth,
      purchasesPerMonth,
      avgPurchasesPerWeek,
      last90DayMonthlySpend,
      last90DayAvgWeeklySpend,
      avgWeeklySpend,
      daysSinceLastVisitPct,
      lifetimeAovPercentile,
      purchasesPerMonthPct,
      lifetimeReferrals,
      referralsWhoOrdered,
      ordersFromReferrals,
      totalSpendFromReferrals,
      uniqueReferralCode,
      smsOrderNotificationOpt,
      validEmail,
      userAffiliation,
      accountCreatedDate: createdDate,
      lastVisitDate,
      daysSinceLastVisit,
      daysSinceSignup,
      classMonth,
      signupSource,
      emailOptIn,
      smsOptIn,
      dateOfBirth,
      age,
      gender,
      snapshotMonth: '', // set below after determining newest month
    });
  }

  // Determine snapshot month
  const snapshotMonth = snapshotMonthOverride || newestMonth || today.toISOString().substring(0, 7);
  for (const c of customers) { c.snapshotMonth = snapshotMonth; }

  // Aggregate metrics
  const avgOrderValue = aovCount > 0 ? sumAOV / aovCount : 0;
  const avgLifetimeVisits = lifetimeCount > 0 ? sumLifetimeVisits / lifetimeCount : 0;
  const avgLast90DaysSpend = last90Count > 0 ? sumLast90Spend / last90Count : 0;
  const ltv = lifetimeSpendCount > 0 ? sumLifetimeSpend / lifetimeSpendCount : avgOrderValue * 2.5;
  const newAccountsThisMonth = accountsByMonth[snapshotMonth] || 0;

  const metrics: IncentivioMetrics = {
    month: snapshotMonth,
    totalLoyaltyAccounts: totalAccounts,
    newAccounts: newAccountsThisMonth,
    avgOrderValue: Math.round(avgOrderValue * 100) / 100,
    lifetimeVisits: Math.round(avgLifetimeVisits * 10) / 10,
    last90DaysSpend: Math.round(avgLast90DaysSpend * 100) / 100,
    ltv: Math.round(ltv * 100) / 100,
  };

  return { metrics, customers, totalRecords: totalAccounts, activeCustomers };
}

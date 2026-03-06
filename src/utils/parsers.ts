import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { categorizeExpense } from './categorize';
import type {
  MonthlyExpense,
  MetaCampaign,
  GoogleCampaign,
  GoogleDaily,
  IncentivioMetrics,
  MonthlyBudget,
  DataSourceType,
  SpendCategory,
  CRMCustomerRecord,
  JourneyStage,
  MenuIntelligenceItem,
} from '../types';

function generateId(): string {
  return Math.random().toString(36).substring(2, 15);
}

export function parseMonth(dateStr: string): string {
  const cleaned = dateStr.replace(/"/g, '').trim();

  // YYYY-MM-DD (most common ISO format)
  const isoMatch = cleaned.match(/^(\d{4})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}`;

  // MM/DD/YYYY
  const slashMatch = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) return `${slashMatch[3]}-${slashMatch[1].padStart(2, '0')}`;

  // "Mon, Dec 1, 2025" or "Dec 1, 2025" style
  const longMatch = cleaned.match(/(\w{3})\w*[,\s]+(\d+),?\s+(\d{4})/);
  if (longMatch) {
    const months: Record<string, string> = {
      Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
      Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
    };
    const m = months[longMatch[1]];
    if (m) return `${longMatch[3]}-${m}`;
  }

  // "Sun, Feb 1, 2026" — Google Ads daily format (Day, Mon DD, YYYY)
  const dayMonMatch = cleaned.match(/\w+,\s*(\w{3})\s+(\d+),?\s+(\d{4})/);
  if (dayMonMatch) {
    const months: Record<string, string> = {
      Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
      Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
    };
    const m = months[dayMonMatch[1]];
    if (m) return `${dayMonMatch[3]}-${m}`;
  }

  return cleaned.substring(0, 7);
}

// ═══════════════════════════════════════════════
// SOURCE DETECTION — filename-first, then header-based fallback
// ═══════════════════════════════════════════════

export function detectSourceType(filename: string): DataSourceType {
  const lower = filename.toLowerCase();

  // PDF files — can't parse client-side
  if (lower.endsWith('.pdf')) return 'expenses'; // will be caught in FileUpload

  // Meta / Facebook campaigns — including agency exports like "Brightn-Campaigns"
  if (lower.includes('campaign') && (
    lower.includes('meta') || lower.includes('facebook') ||
    lower.includes('wellness-campaigns') || lower.includes('brightn')
  )) return 'meta';

  // Google Ads
  if (lower.includes('overview_cards') || lower.includes('time_series') || lower.includes('search_keywords')) return 'google';
  if (lower.includes('google') && !lower.includes('analytics')) return 'google';

  // Toast POS
  if (lower.includes('toast') || lower.includes('productmix')) return 'toast';

  // Incentivio / loyalty
  if (lower.includes('customer_export') || lower.includes('incentivio') ||
      lower.includes('loyalty') || lower.includes('giftpool') ||
      lower.includes('kpi') || lower.includes('menu_intelligence')) return 'incentivio';

  // Organic social
  if (lower.includes('onelink') || lower.includes('organic') || lower.includes('review_analytics')) return 'organic';

  // 3rd party delivery
  if (lower.includes('uber') || lower.includes('doordash') || lower.includes('grubhub')) return '3po';

  // Budget
  if (lower.includes('budget') || lower.includes('operating budget')) return 'budget';

  // QuickBooks expenses
  if (lower.includes('marketing') && (lower.includes('exp') || lower.includes('expense'))) return 'expenses';

  return 'unknown' as DataSourceType; // will trigger header-based detection
}

/**
 * Header-based detection — reads CSV headers and matches known column patterns.
 * Called when filename detection returns 'unknown'.
 */
export async function detectSourceFromHeaders(file: File): Promise<DataSourceType> {
  return new Promise((resolve) => {
    Papa.parse(file, {
      header: true,
      preview: 1, // only read first row to get headers
      complete: (results) => {
        const headers = results.meta.fields || [];
        const headerSet = new Set(headers.map(h => h.toLowerCase()));

        // Meta Ads: "Campaign name" + "Amount spent (USD)"
        if (headerSet.has('campaign name') && (headerSet.has('amount spent (usd)') || headerSet.has('impressions'))) {
          resolve('meta');
          return;
        }
        // Google Ads daily: "Date" + "Clicks" + "Avg. CPC"
        if (headerSet.has('date') && headerSet.has('clicks') && headerSet.has('avg. cpc')) {
          resolve('google');
          return;
        }
        // Google Ads campaigns: "Campaign Name" + "Cost"
        if (headerSet.has('campaign name') && headerSet.has('cost')) {
          resolve('google');
          return;
        }
        // Incentivio customer export: "Customer ID" + "Lifetime Visits"
        if (headerSet.has('customer id') && headerSet.has('lifetime visits')) {
          resolve('incentivio');
          return;
        }
        // Incentivio menu intelligence: "Item Name" + "Item Score"
        if (headerSet.has('item name') && headerSet.has('item score')) {
          resolve('incentivio');
          return;
        }
        // QuickBooks: "Transaction date" + "Amount"
        if (headerSet.has('transaction date') && headerSet.has('amount')) {
          resolve('expenses');
          return;
        }

        resolve('expenses'); // final fallback
      },
      error: () => resolve('expenses'),
    });
  });
}

// ═══════════════════════════════════════════════
// EXPENSES — QuickBooks XLSX + CSV
// ═══════════════════════════════════════════════

export async function parseExpensesXLSX(file: File): Promise<MonthlyExpense[]> {
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { header: 1 }) as unknown[][];

  const expenses: MonthlyExpense[] = [];

  for (const row of rows) {
    if (!Array.isArray(row)) continue;

    const dateVal = row[1];
    const vendor = row[4];
    const desc = row[5];
    const amount = row[8];

    if (!dateVal || !amount || typeof amount !== 'number' || amount <= 0) continue;

    let dateStr = '';
    if (typeof dateVal === 'string') {
      dateStr = dateVal;
    } else if (typeof dateVal === 'number') {
      const d = XLSX.SSF.parse_date_code(dateVal);
      dateStr = `${d.m.toString().padStart(2, '0')}/${d.d.toString().padStart(2, '0')}/${d.y}`;
    }

    if (!dateStr || !dateStr.match(/\d/)) continue;

    const vendorStr = String(vendor || '');
    const descStr = String(desc || '');

    expenses.push({
      id: generateId(),
      date: dateStr,
      month: parseMonth(dateStr),
      vendor: vendorStr,
      description: descStr,
      amount,
      category: categorizeExpense(vendorStr, descStr),
      source: file.name,
    });
  }

  return expenses;
}

export async function parseExpensesCSV(file: File): Promise<MonthlyExpense[]> {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      complete: (results) => {
        if (results.errors.length > 0) {
          console.warn(`[parseExpensesCSV] ${file.name}: ${results.errors.length} row-level warnings`, results.errors);
        }
        const expenses: MonthlyExpense[] = [];
        for (const row of results.data as Record<string, string>[]) {
          const date = row['Transaction date'] || row['Date'] || '';
          const vendor = row['Name'] || row['Vendor'] || '';
          const desc = row['Memo/Description'] || row['Description'] || '';
          const amountStr = row['Amount'] || '0';
          const amount = Math.abs(parseFloat(amountStr.replace(/[$,]/g, '')) || 0);

          if (!date || amount === 0) continue;

          expenses.push({
            id: generateId(),
            date,
            month: parseMonth(date),
            vendor,
            description: desc,
            amount,
            category: categorizeExpense(vendor, desc),
            source: file.name,
          });
        }
        resolve(expenses);
      },
      error: (err: Error) => reject(new Error(`Failed to parse expenses CSV "${file.name}": ${err.message}`)),
    });
  });
}

// ═══════════════════════════════════════════════
// META / FACEBOOK CAMPAIGNS
// ═══════════════════════════════════════════════

export function parseMetaCampaigns(file: File): Promise<MetaCampaign[]> {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      complete: (results) => {
        if (results.errors.length > 0) {
          console.warn(`[parseMetaCampaigns] ${file.name}: ${results.errors.length} row-level warnings`, results.errors);
        }
        const campaigns: MetaCampaign[] = [];
        for (const row of results.data as Record<string, string>[]) {
          const start = row['Reporting starts'] || '';
          const name = row['Campaign name'] || '';
          const spend = parseFloat((row['Amount spent (USD)'] || '0').replace(/[$,]/g, ''));
          const impressions = parseInt((row['Impressions'] || '0').replace(/,/g, ''));
          const reach = parseInt((row['Reach'] || '0').replace(/,/g, ''));
          const results_val = parseInt((row['Results'] || '0').replace(/,/g, ''));
          const cpr = parseFloat((row['Cost per results'] || '0').replace(/[$,]/g, ''));
          // Use Link clicks when available (more accurate than Results for traffic)
          const linkClicks = parseInt((row['Link clicks'] || '0').replace(/,/g, ''));

          if (!name || (spend === 0 && impressions === 0)) continue;

          campaigns.push({
            month: parseMonth(start),
            campaignName: name,
            impressions,
            reach,
            clicks: linkClicks || results_val, // prefer link clicks
            spend,
            results: results_val,
            resultType: row['Result indicator'] || '',
            costPerResult: cpr,
          });
        }
        resolve(campaigns);
      },
      error: (err: Error) => reject(new Error(`Failed to parse Meta campaigns CSV "${file.name}": ${err.message}`)),
    });
  });
}

// ═══════════════════════════════════════════════
// GOOGLE ADS — Campaigns + Daily time series
// ═══════════════════════════════════════════════

export function parseGoogleCampaigns(file: File): Promise<GoogleCampaign[]> {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      complete: (results) => {
        if (results.errors.length > 0) {
          console.warn(`[parseGoogleCampaigns] ${file.name}: ${results.errors.length} row-level warnings`, results.errors);
        }
        const campaigns: GoogleCampaign[] = [];
        for (const row of results.data as Record<string, string>[]) {
          const name = row['Campaign Name'] || row['Campaign'] || '';
          const cost = parseFloat((row['Cost'] || '0').replace(/[$,]/g, ''));
          const clicks = parseInt((row['Clicks'] || '0').replace(/,/g, ''));
          const impressions = parseInt((row['Impressions'] || '0').replace(/,/g, ''));
          const ctrStr = (row['CTR'] || '0').replace(/%/g, '');
          const ctr = parseFloat(ctrStr) || 0;

          if (!name) continue;

          campaigns.push({
            month: '',
            campaignName: name,
            clicks,
            impressions: impressions || (ctr > 0 ? Math.round(clicks / (ctr / 100)) : 0),
            ctr,
            avgCpc: clicks > 0 ? cost / clicks : 0,
            cost,
          });
        }
        resolve(campaigns);
      },
      error: (err: Error) => reject(new Error(`Failed to parse Google campaigns CSV "${file.name}": ${err.message}`)),
    });
  });
}

export function parseGoogleDaily(file: File): Promise<GoogleDaily[]> {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      complete: (results) => {
        if (results.errors.length > 0) {
          console.warn(`[parseGoogleDaily] ${file.name}: ${results.errors.length} row-level warnings`, results.errors);
        }
        const daily: GoogleDaily[] = [];
        for (const row of results.data as Record<string, string>[]) {
          const date = row['Date'] || '';
          const clicks = parseInt((row['Clicks'] || '0').replace(/,/g, ''));
          const impressions = parseInt((row['Impressions'] || '0').replace(/,/g, ''));
          const cpc = parseFloat((row['Avg. CPC'] || '0').replace(/[$,]/g, ''));
          const cost = parseFloat((row['Cost'] || '0').replace(/[$,]/g, ''));

          if (!date) continue;

          daily.push({ date, clicks, impressions, avgCpc: cpc, cost });
        }
        resolve(daily);
      },
      error: (err: Error) => reject(new Error(`Failed to parse Google daily CSV "${file.name}": ${err.message}`)),
    });
  });
}

// ═══════════════════════════════════════════════
// INCENTIVIO — Customer export (snapshot → aggregated metrics)
// ═══════════════════════════════════════════════

export interface IncentivioParseResult {
  metrics: IncentivioMetrics;
  customers: CRMCustomerRecord[];  // Phase A: full per-customer records
  totalRecords: number;
  activeCustomers: number;
}

// ─── Attrition Risk Scoring ────────────────────────────
// High: no visit in 60+ days AND <4 lifetime visits
// Medium: no visit in 30-60 days OR declining frequency
// Low: visited in last 30 days with decent frequency
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

export function parseIncentivioCustomers(file: File): Promise<IncentivioParseResult> {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      complete: (results) => {
        if (results.errors.length > 0) {
          console.warn(`[parseIncentivioCustomers] ${file.name}: ${results.errors.length} row-level warnings`, results.errors);
        }
        const rows = results.data as Record<string, string>[];
        const validRows = rows.filter(r => r['Customer ID'] && r['Customer ID'] !== '');

        const totalAccounts = validRows.length;
        const today = new Date();
        const todayMs = today.getTime();

        // Aggregation accumulators (backward-compatible)
        let newestMonth = '';
        const accountsByMonth: Record<string, number> = {};
        let sumAOV = 0, aovCount = 0;
        let sumLifetimeVisits = 0, lifetimeCount = 0;
        let sumLast90Spend = 0, last90Count = 0;
        let sumLifetimeSpend = 0, lifetimeSpendCount = 0;
        let activeCustomers = 0;

        // Per-customer records
        const customers: CRMCustomerRecord[] = [];

        for (const row of validRows) {
          // ─── Parse raw fields ───
          const customerId = row['Customer ID'] || '';
          const firstName = row['First Name'] || '';
          const lastName = row['Last Name'] || '';
          const email = row['Email'] || '';
          const phone = row['Phone'] || row['Phone Number'] || '';
          const journeyStageRaw = row['Guest Journey Stage'] || '';
          const reachLocation = row['Reach Location'] || row['Location'] || '';
          const signupSource = row['Signup Source'] || row['Source'] || '';

          const createdDate = row['Account Created Date'] || '';
          const lastVisitDate = row['Last Visit Date'] || row['Last Order Date'] || '';

          const lifetimeSpend = parseFloat((row['Lifetime Spend'] || '0').replace(/[$,]/g, ''));
          const lifetimeVisits = parseInt((row['Lifetime Visits'] || '0').replace(/,/g, ''));
          const avgBasketValue = parseFloat((row['Average Basket Value'] || '0').replace(/[$,]/g, ''));
          const last90DaysSpend = parseFloat((row['Last 90 day Spend'] || row['Last 90 Days Spend'] || '0').replace(/[$,]/g, ''));
          const last90DaysOrders = parseInt((row['Last 90 Days Orders'] || row['Last 90 day Orders'] || '0').replace(/,/g, ''));
          const lastYearSpend = parseFloat((row['Last Year Spend'] || row['Last 365 Days Spend'] || '0').replace(/[$,]/g, ''));
          const lastYearOrders = parseInt((row['Last Year Orders'] || row['Last 365 Days Orders'] || '0').replace(/,/g, ''));
          const loyaltyBalance = parseFloat((row['Loyalty Balance'] || row['Current Loyalty Balance'] || '0').replace(/[$,]/g, ''));

          const emailOptIn = (row['Email Opt In'] || row['Email Opted In'] || '').toLowerCase() === 'true' ||
                             (row['Email Opt In'] || '').toLowerCase() === 'yes';
          const smsOptIn = (row['SMS Opt In'] || row['SMS Opted In'] || '').toLowerCase() === 'true' ||
                           (row['SMS Opt In'] || '').toLowerCase() === 'yes';

          // ─── Compute derived fields ───
          let daysSinceLastVisit = 999;
          if (lastVisitDate && lastVisitDate !== '-') {
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
          const attritionRisk = computeAttritionRisk(daysSinceLastVisit, lifetimeVisits, last90DaysOrders);

          // ─── Backward-compatible aggregation ───
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

          // ─── Build per-customer record ───
          const snapshotMonth = newestMonth || today.toISOString().substring(0, 7);

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
            accountCreatedDate: createdDate,
            lastVisitDate,
            daysSinceLastVisit,
            daysSinceSignup,
            classMonth,
            signupSource,
            emailOptIn,
            smsOptIn,
            snapshotMonth,
          });
        }

        // ─── Aggregate metrics (backward-compatible output) ───
        const avgOrderValue = aovCount > 0 ? sumAOV / aovCount : 0;
        const avgLifetimeVisits = lifetimeCount > 0 ? sumLifetimeVisits / lifetimeCount : 0;
        const avgLast90DaysSpend = last90Count > 0 ? sumLast90Spend / last90Count : 0;
        const ltv = lifetimeSpendCount > 0 ? sumLifetimeSpend / lifetimeSpendCount : avgOrderValue * 2.5;

        const snapshotMonth = newestMonth || today.toISOString().substring(0, 7);
        const newAccountsThisMonth = accountsByMonth[snapshotMonth] || 0;

        // Set snapshotMonth on all customers now that we know it
        for (const c of customers) { c.snapshotMonth = snapshotMonth; }

        resolve({
          metrics: {
            month: snapshotMonth,
            totalLoyaltyAccounts: totalAccounts,
            newAccounts: newAccountsThisMonth,
            avgOrderValue: Math.round(avgOrderValue * 100) / 100,
            lifetimeVisits: Math.round(avgLifetimeVisits * 10) / 10,
            last90DaysSpend: Math.round(avgLast90DaysSpend * 100) / 100,
            ltv: Math.round(ltv * 100) / 100,
          },
          customers,
          totalRecords: totalAccounts,
          activeCustomers,
        });
      },
      error: (err: Error) => reject(new Error(`Failed to parse Incentivio customer CSV "${file.name}": ${err.message}`)),
    });
  });
}

// ═══════════════════════════════════════════════
// MENU INTELLIGENCE — Incentivio menu analytics (expanded Phase A)
// ═══════════════════════════════════════════════

function classifyMenuQuadrant(
  totalSold: number, revenue: number,
  medianSold: number, medianRevenue: number,
): MenuIntelligenceItem['menuQuadrant'] {
  const highVolume = totalSold >= medianSold;
  const highRevenue = revenue >= medianRevenue;
  if (highVolume && highRevenue) return 'star';
  if (highVolume && !highRevenue) return 'plow_horse';
  if (!highVolume && highRevenue) return 'puzzle';
  return 'dog';
}

export function parseMenuIntelligence(file: File): Promise<MenuIntelligenceItem[]> {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      complete: (results) => {
        if (results.errors.length > 0) {
          console.warn(`[parseMenuIntelligence] ${file.name}: ${results.errors.length} row-level warnings`, results.errors);
        }
        const rawItems: MenuIntelligenceItem[] = [];

        for (const row of results.data as Record<string, string>[]) {
          const name = (row['Item Name'] || '').replace(/^'/, '');
          if (!name) continue;

          const totalSoldLastYear = parseInt(row['Total Sold in Last Year - All customers'] || row['Total Sold in Last Year - All Customers'] || '0');
          const revenueLastYear = parseFloat(row['Revenue Generated in Last Year - All Customers'] || '0');
          const totalSoldLastMonth = parseInt(row['Total Sold in Last Month - All Customers'] || '0');

          // Frequency breakdown columns (Incentivio exports these)
          const soldLastYearFrequent = parseInt(
            row['Total Sold in Last Year - Frequent customers'] ||
            row['Total Sold in Last Year - Frequent Customers'] || '0'
          );
          const soldLastYearInfrequent = parseInt(
            row['Total Sold in Last Year - Infrequent customers'] ||
            row['Total Sold in Last Year - Infrequent Customers'] || '0'
          );
          const revenueFrequent = parseFloat(
            row['Revenue Generated in Last Year - Frequent Customers'] ||
            row['Revenue Generated in Last Year - Frequent customers'] || '0'
          );
          const revenueInfrequent = parseFloat(
            row['Revenue Generated in Last Year - Infrequent Customers'] ||
            row['Revenue Generated in Last Year - Infrequent customers'] || '0'
          );

          // Computed ratios
          const freqRevenueRatio = revenueLastYear > 0 ? revenueFrequent / revenueLastYear : 0;
          const infreqRevenueRatio = revenueLastYear > 0 ? revenueInfrequent / revenueLastYear : 0;
          // Repeat purchase proxy: annualized monthly rate. >1 = growing, <1 = declining
          const repeatPurchaseProxy = totalSoldLastMonth > 0
            ? totalSoldLastYear / (totalSoldLastMonth * 12)
            : 0;
          const revenuePerUnit = totalSoldLastYear > 0
            ? revenueLastYear / totalSoldLastYear
            : 0;

          rawItems.push({
            name,
            score: parseFloat(row['Item Score'] || '0'),
            price: parseFloat(row['Item Price ($)'] || '0'),
            parentGroup: (row['Parent group'] || '').replace(/[\[\]]/g, ''),
            totalSoldLastYear,
            revenueLastYear,
            totalSoldLastMonth,
            soldLastYearFrequent,
            soldLastYearInfrequent,
            revenueFrequent,
            revenueInfrequent,
            freqRevenueRatio: Math.round(freqRevenueRatio * 1000) / 1000,
            infreqRevenueRatio: Math.round(infreqRevenueRatio * 1000) / 1000,
            repeatPurchaseProxy: Math.round(repeatPurchaseProxy * 100) / 100,
            revenuePerUnit: Math.round(revenuePerUnit * 100) / 100,
            menuQuadrant: 'star', // placeholder — classified below after medians
          });
        }

        // Classify quadrants using median volume + revenue
        if (rawItems.length > 0) {
          const sortedBySold = [...rawItems].sort((a, b) => a.totalSoldLastYear - b.totalSoldLastYear);
          const sortedByRev = [...rawItems].sort((a, b) => a.revenueLastYear - b.revenueLastYear);
          const medianSold = sortedBySold[Math.floor(sortedBySold.length / 2)].totalSoldLastYear;
          const medianRevenue = sortedByRev[Math.floor(sortedByRev.length / 2)].revenueLastYear;

          for (const item of rawItems) {
            item.menuQuadrant = classifyMenuQuadrant(
              item.totalSoldLastYear, item.revenueLastYear,
              medianSold, medianRevenue,
            );
          }
        }

        resolve(rawItems);
      },
      error: (err: Error) => reject(new Error(`Failed to parse menu intelligence CSV "${file.name}": ${err.message}`)),
    });
  });
}

// ═══════════════════════════════════════════════
// TOAST POS — Sales Summary CSV (fallback when API unavailable)
// ═══════════════════════════════════════════════

export function parseToastCSV(file: File): Promise<import('../types').ToastSales[]> {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      complete: (results) => {
        if (results.errors.length > 0) {
          console.warn(`[parseToastCSV] ${file.name}: ${results.errors.length} row-level warnings`, results.errors);
        }
        const sales: import('../types').ToastSales[] = [];
        for (const row of results.data as Record<string, string>[]) {
          // Flexible header matching — Toast reports vary slightly
          const location = row['Location'] || row['Restaurant'] || row['Store'] || '';
          const date = row['Date'] || row['Business Date'] || row['Report Date'] || '';
          const grossSales = parseFloat((row['Gross Sales'] || row['Total Sales'] || '0').replace(/[$,]/g, ''));
          const netSales = parseFloat((row['Net Sales'] || '0').replace(/[$,]/g, ''));
          const orders = parseInt((row['Orders'] || row['Order Count'] || row['Checks'] || '0').replace(/,/g, ''));
          const discounts = Math.abs(parseFloat((row['Discounts'] || row['Discount Total'] || '0').replace(/[$,]/g, '')));

          if (!location || grossSales === 0) continue;

          const month = date ? parseMonth(date) : '';
          if (!month || !month.match(/^\d{4}-\d{2}$/)) continue;

          // Check if we already have this month+location — aggregate if so
          const existing = sales.find(s => s.month === month && s.location === location);
          if (existing) {
            existing.grossSales += grossSales;
            existing.netSales += netSales;
            existing.orders += orders;
            existing.discountTotal += discounts;
          } else {
            sales.push({
              month,
              location,
              grossSales,
              netSales,
              orders,
              discountTotal: discounts,
              source: 'csv',
            });
          }
        }
        resolve(sales);
      },
      error: (err: Error) => reject(new Error(`Failed to parse Toast sales CSV "${file.name}": ${err.message}`)),
    });
  });
}

// ═══════════════════════════════════════════════
// BUDGET XLSX — Operating Budget (15-month)
// ═══════════════════════════════════════════════

export async function parseBudgetXLSX(file: File): Promise<MonthlyBudget[]> {
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true });

  // Look for the main "STACK" sheet (consolidated view)
  const sheetName = wb.SheetNames.find(n => n.toUpperCase() === 'STACK') || wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { header: 1 }) as unknown[][];

  const budgets: MonthlyBudget[] = [];

  // Row 4 (index 3) has month columns starting from column B
  // Find the date header row
  let dateRowIdx = -1;
  let marketingRowIdx = -1;

  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const row = rows[i];
    if (!row) continue;

    // Check if this row has dates in columns
    for (let j = 1; j < row.length; j++) {
      const val = row[j];
      if (val instanceof Date || (typeof val === 'string' && val.match(/^\d{4}-\d{2}/))) {
        dateRowIdx = i;
        break;
      }
    }

    // Find the "Advertising & Marketing" row
    const label = String(row[0] || '').toLowerCase().trim();
    if (label.includes('advertising') || label.includes('marketing')) {
      marketingRowIdx = i;
    }
  }

  if (dateRowIdx === -1 || marketingRowIdx === -1) return budgets;

  const dateRow = rows[dateRowIdx];
  const marketingRow = rows[marketingRowIdx];

  for (let col = 1; col < dateRow.length; col++) {
    const dateVal = dateRow[col];
    let monthStr = '';

    if (dateVal instanceof Date) {
      const y = dateVal.getFullYear();
      const m = (dateVal.getMonth() + 1).toString().padStart(2, '0');
      monthStr = `${y}-${m}`;
    } else if (typeof dateVal === 'string') {
      monthStr = parseMonth(dateVal);
    } else if (typeof dateVal === 'number') {
      // Excel serial date
      const d = XLSX.SSF.parse_date_code(dateVal);
      monthStr = `${d.y}-${d.m.toString().padStart(2, '0')}`;
    }

    if (!monthStr || !monthStr.match(/^\d{4}-\d{2}$/)) continue;

    const rawAmount = marketingRow[col];
    const amount = Math.abs(typeof rawAmount === 'number' ? rawAmount : parseFloat(String(rawAmount || '0')));

    if (amount === 0) continue;

    // Default category split based on the $533K annual allocation percentages
    const byCategory: Record<SpendCategory, number> = {
      paid_media: amount * 0.25,        // 25% Paid Social
      direct_mail_print: amount * 0.15,  // 15% Print
      ooh: amount * 0.10,               // 10% Billboards
      software_fees: amount * 0.05,      // 5% Email/CRM
      labor: amount * 0.20,             // 20% Community & Events labor
      other: amount * 0.25,             // 25% NIL + SEO + other
    };

    budgets.push({
      month: monthStr,
      totalBudget: Math.round(amount * 100) / 100,
      byCategory,
    });
  }

  return budgets;
}

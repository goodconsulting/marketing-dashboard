/**
 * Menu Intelligence parser — expanded to ~35 fields from Incentivio export.
 *
 * New fields vs client-side parser:
 * - Item type & over/under state classification
 * - Average orders/sold per month (all/frequent/infrequent)
 * - Penetration % (all/frequent/infrequent)
 * - Sold last month by frequency segment
 * - Daypart breakdowns: breakfast/lunch/dinner × all/frequent/infrequent
 */

import Papa from 'papaparse';
import type { MenuIntelligenceItem } from '../types.ts';
import { parseNum, parseInt_ } from './utils.ts';

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

/**
 * Parse Incentivio Menu Intelligence CSV.
 * Returns expanded menu items with daypart breakdowns and penetration metrics.
 */
export function parseMenuIntelligence(csvContent: string, snapshotMonthOverride?: string): MenuIntelligenceItem[] {
  const result = Papa.parse(csvContent, { header: true, skipEmptyLines: true });

  if (result.errors.length > 0) {
    console.warn(`[Menu Parser] ${result.errors.length} row-level warnings`);
  }

  const snapshotMonth = snapshotMonthOverride || new Date().toISOString().substring(0, 7);
  const rawItems: MenuIntelligenceItem[] = [];

  for (const row of result.data as Record<string, string>[]) {
    const name = (row['Item Name'] || '').replace(/^'/, '');
    if (!name) continue;

    // ─── Existing volume metrics ───
    const totalSoldLastYear = parseInt_(row['Total Sold in Last Year - All customers'] || row['Total Sold in Last Year - All Customers']);
    const revenueLastYear = parseNum(row['Revenue Generated in Last Year - All Customers']);
    const totalSoldLastMonth = parseInt_(row['Total Sold in Last Month - All Customers']);

    // ─── Existing frequency breakdowns ───
    const soldLastYearFrequent = parseInt_(
      row['Total Sold in Last Year - Frequent customers'] || row['Total Sold in Last Year - Frequent Customers']
    );
    const soldLastYearInfrequent = parseInt_(
      row['Total Sold in Last Year - Infrequent customers'] || row['Total Sold in Last Year - Infrequent Customers']
    );
    const revenueFrequent = parseNum(
      row['Revenue Generated in Last Year - Frequent Customers'] || row['Revenue Generated in Last Year - Frequent customers']
    );
    const revenueInfrequent = parseNum(
      row['Revenue Generated in Last Year - Infrequent Customers'] || row['Revenue Generated in Last Year - Infrequent customers']
    );

    // ─── NEW: Classification ───
    const itemType = row['Item Type'] || '';
    const overUnderState = row['Over-under state'] || row['Over Under State'] || '';

    // ─── NEW: Sold last month by frequency ───
    const soldLastMonthFrequent = parseInt_(
      row['Total Sold in Last Month - Frequent Customers'] || row['Total Sold in Last Month - Frequent customers']
    );
    const soldLastMonthInfrequent = parseInt_(
      row['Total Sold in Last Month - Infrequent Customers'] || row['Total Sold in Last Month - Infrequent customers']
    );

    // ─── NEW: Average orders per month ───
    const avgOrdersPerMonthAll = parseNum(
      row['Average Orders Per Month - All Customers'] || row['Average Orders Per Month - All customers']
    );
    const avgOrdersPerMonthFrequent = parseNum(
      row['Average Orders Per Month - Frequent Customers'] || row['Average Orders Per Month - Frequent customers']
    );
    const avgOrdersPerMonthInfrequent = parseNum(
      row['Average Orders Per Month - Infrequent Customers'] || row['Average Orders Per Month - Infrequent customers']
    );

    // ─── NEW: Average sold per month ───
    const avgSoldPerMonthAll = parseNum(
      row['Average Sold Per Month - All Customers'] || row['Average Sold Per Month - All customers']
    );
    const avgSoldPerMonthFrequent = parseNum(
      row['Average Sold Per Month - Frequent Customers'] || row['Average Sold Per Month - Frequent customers']
    );
    const avgSoldPerMonthInfrequent = parseNum(
      row['Average Sold Per Month - Infrequent Customers'] || row['Average Sold Per Month - Infrequent customers']
    );

    // ─── NEW: Penetration % ───
    const penetrationPctAll = parseNum(
      row['Percentage Ordered - All Customers'] || row['Percentage Ordered - All customers']
    );
    const penetrationPctFrequent = parseNum(
      row['Percentage Ordered - Frequent Customers'] || row['Percentage Ordered - Frequent customers']
    );
    const penetrationPctInfrequent = parseNum(
      row['Percentage Ordered - Infrequent Customers'] || row['Percentage Ordered - Infrequent customers']
    );

    // ─── NEW: Daypart breakdowns ───
    const daypartBreakfastAll = parseInt_(
      row['Total Sold in Breakfast in Last Year - All Customers'] || row['Total Sold in Breakfast in Last Year - All customers']
    );
    const daypartBreakfastFrequent = parseInt_(
      row['Total Sold in Breakfast in Last Year - Frequent Customers'] || row['Total Sold in Breakfast in Last Year - Frequent customers']
    );
    const daypartBreakfastInfrequent = parseInt_(
      row['Total Sold in Breakfast in Last Year - Infrequent Customers'] || row['Total Sold in Breakfast in Last Year - Infrequent customers']
    );

    const daypartLunchAll = parseInt_(
      row['Total Sold in Lunch in Last Year - All Customers'] || row['Total Sold in Lunch in Last Year - All customers']
    );
    const daypartLunchFrequent = parseInt_(
      row['Total Sold in Lunch in Last Year - Frequent Customers'] || row['Total Sold in Lunch in Last Year - Frequent customers']
    );
    const daypartLunchInfrequent = parseInt_(
      row['Total Sold in Lunch in Last Year - Infrequent Customers'] || row['Total Sold in Lunch in Last Year - Infrequent customers']
    );

    const daypartDinnerAll = parseInt_(
      row['Total Sold in Dinner in Last Year - All Customers'] || row['Total Sold in Dinner in Last Year - All customers']
    );
    const daypartDinnerFrequent = parseInt_(
      row['Total Sold in Dinner in Last Year - Frequent Customers'] || row['Total Sold in Dinner in Last Year - Frequent customers']
    );
    const daypartDinnerInfrequent = parseInt_(
      row['Total Sold in Dinner in Last Year - Infrequent Customers'] || row['Total Sold in Dinner in Last Year - Infrequent customers']
    );

    // ─── Computed ratios ───
    const freqRevenueRatio = revenueLastYear > 0 ? revenueFrequent / revenueLastYear : 0;
    const infreqRevenueRatio = revenueLastYear > 0 ? revenueInfrequent / revenueLastYear : 0;
    const repeatPurchaseProxy = totalSoldLastMonth > 0
      ? totalSoldLastYear / (totalSoldLastMonth * 12)
      : 0;
    const revenuePerUnit = totalSoldLastYear > 0
      ? revenueLastYear / totalSoldLastYear
      : 0;

    rawItems.push({
      name,
      score: parseNum(row['Item Score']),
      price: parseNum(row['Item Price ($)'] || row['Item Price']),
      parentGroup: (row['Parent group'] || row['Parent Group'] || '').replace(/[\[\]]/g, ''),
      itemType,
      overUnderState,
      totalSoldLastYear,
      revenueLastYear,
      totalSoldLastMonth,
      soldLastYearFrequent,
      soldLastYearInfrequent,
      revenueFrequent,
      revenueInfrequent,
      soldLastMonthFrequent,
      soldLastMonthInfrequent,
      avgOrdersPerMonthAll,
      avgOrdersPerMonthFrequent,
      avgOrdersPerMonthInfrequent,
      avgSoldPerMonthAll,
      avgSoldPerMonthFrequent,
      avgSoldPerMonthInfrequent,
      penetrationPctAll,
      penetrationPctFrequent,
      penetrationPctInfrequent,
      daypartBreakfastAll,
      daypartBreakfastFrequent,
      daypartBreakfastInfrequent,
      daypartLunchAll,
      daypartLunchFrequent,
      daypartLunchInfrequent,
      daypartDinnerAll,
      daypartDinnerFrequent,
      daypartDinnerInfrequent,
      freqRevenueRatio: Math.round(freqRevenueRatio * 1000) / 1000,
      infreqRevenueRatio: Math.round(infreqRevenueRatio * 1000) / 1000,
      repeatPurchaseProxy: Math.round(repeatPurchaseProxy * 100) / 100,
      revenuePerUnit: Math.round(revenuePerUnit * 100) / 100,
      menuQuadrant: 'star', // placeholder — classified below
      snapshotMonth,
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

  return rawItems;
}

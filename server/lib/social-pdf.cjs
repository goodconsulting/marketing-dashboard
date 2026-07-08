/**
 * Hello Digital Marketing monthly social PDF — text-layer parser core.
 *
 * Shared between the CLI (scripts/ingest-social.cjs) and the TS upload
 * pipeline (server/parsers/socialPdf.ts), same pattern as stage-transitions.cjs.
 *
 * Report format ("Monthly Reporting: Stack Wellness - Facebook|Instagram"):
 * a Jan–Dec year grid, one row per KPI. Cells are "X" for months before
 * engagement started, numbers for reported months, absent for future months.
 * Each monthly report RESTATES the whole year — the vendor has revised prior
 * months (April 2026 engagement/impressions/reach were cut ~65% in the May
 * report), so the LATEST report is authoritative and ingestion replaces every
 * month it contains.
 *
 * The PDF contains month names but NO year — callers must supply it.
 *
 * Input text is the pdf-parse v2 (PDFParse#getText) output: tab-delimited
 * cells, one line per table row.
 */

const KPI_COLUMNS = {
  'total followers': 'followers',
  'engagement': 'engagement',
  'impressions': 'impressions',
  'reach': 'reach',
  'profile visits': 'profile_visits',
  'website clicks': 'website_clicks',
};

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december'];

/**
 * @param {string} text  pdf-parse text of one report
 * @param {number|string} year  calendar year the report covers (not in the PDF)
 * @returns {{ platform: string, records: Array<object> }}
 *   records: one per reported month — { month: 'YYYY-MM', platform, followers, ... }
 */
function parseSocialReportText(text, year) {
  const yr = String(year);
  if (!/^\d{4}$/.test(yr)) throw new Error(`Invalid year: ${year}`);

  const titleMatch = text.match(/Monthly Reporting:\s*Stack Wellness\s*-\s*(Facebook|Instagram)/i);
  if (!titleMatch) throw new Error('Not a Hello Digital social report (title line not found)');
  const platform = titleMatch[1].toLowerCase();

  // Header row gives the month column order (defensive: don't assume Jan-first).
  const lines = text.split('\n').map((l) => l.split('\t').map((c) => c.trim()).filter(Boolean));
  const headerCells = lines.find((cells) => cells.some((c) => c.toLowerCase() === 'january'));
  const monthOrder = headerCells
    ? headerCells.map((c) => c.toLowerCase()).filter((c) => MONTHS.includes(c))
    : MONTHS;

  // byMonth: 'YYYY-MM' → partial record
  const byMonth = new Map();
  const cellCounts = new Set();

  for (const cells of lines) {
    const kpiIdx = cells.findIndex((c) => KPI_COLUMNS[c.toLowerCase()]);
    if (kpiIdx < 0) continue;
    const column = KPI_COLUMNS[cells[kpiIdx].toLowerCase()];
    const values = cells.slice(kpiIdx + 1);
    if (values.length > monthOrder.length) {
      throw new Error(`Row "${cells[kpiIdx]}" has ${values.length} value cells for ${monthOrder.length} months`);
    }
    cellCounts.add(values.length);

    values.forEach((v, i) => {
      if (v.toUpperCase() === 'X') return; // month not tracked
      const n = parseFloat(v.replace(/[,$\s]/g, ''));
      if (!Number.isFinite(n)) throw new Error(`Unparseable cell "${v}" in row "${cells[kpiIdx]}"`);
      const monthNum = MONTHS.indexOf(monthOrder[i]) + 1;
      const month = `${yr}-${String(monthNum).padStart(2, '0')}`;
      if (!byMonth.has(month)) byMonth.set(month, { month, platform });
      byMonth.get(month)[column] = Math.round(n);
    });
  }

  if (byMonth.size === 0) throw new Error('No reported months found in the grid');
  // All KPI rows must cover the same months — a shorter row would mean cells
  // silently shifted onto wrong months.
  if (cellCounts.size > 1) {
    throw new Error(`KPI rows disagree on month coverage (${[...cellCounts].join(' vs ')} cells) — format changed, aborting`);
  }

  const records = [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
  // Every record should have all 6 KPIs; missing ones default to 0 with a note.
  for (const r of records) {
    for (const col of Object.values(KPI_COLUMNS)) {
      if (r[col] === undefined) r[col] = 0;
    }
  }
  return { platform, records };
}

module.exports = { parseSocialReportText, KPI_COLUMNS };

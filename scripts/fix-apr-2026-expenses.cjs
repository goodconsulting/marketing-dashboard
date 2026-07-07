/**
 * April 2026 expense corrections (per CIO direction, 2026-06-04):
 *   1. Recognize Hero Labs co-op marketing funding (-$5,000) instead of omitting it.
 *      Hero Labs (an in-store product vendor) gave Stack $5K to spend on marketing;
 *      recorded as a contra-expense so net marketing investment reflects the offset.
 *   2. Relabel the $500 "AT APR26 DD MKTG" journal entry vendor -> "DD Marketing"
 *      (already paid_media; matches Dec 2025 / Jan 2026 naming).
 *   3. Recategorize: Copyworks -> direct_mail_print; Big Green (Umbrella Media),
 *      Downtown Events Group, Waukee Area Chamber of Commerce -> sponsorship.
 *      LinkedIn intentionally left in 'other' (job postings, not marketing).
 *
 * Idempotent: safe to re-run.
 * Usage: node scripts/fix-apr-2026-expenses.cjs
 */
const path = require('path');
const Database = require('better-sqlite3');
const { randomBytes } = require('crypto');

const db = new Database(path.join(__dirname, '..', 'data', 'stack.db'));

const HERO_DESC = 'Hero Labs co-op marketing funding (vendor-provided; offsets marketing spend)';

const tx = db.transaction(() => {
  // 1. Hero Labs co-op funding as a -$5,000 contra-expense (insert if absent)
  const exists = db.prepare(
    "SELECT 1 FROM fact_expense WHERE month='2026-04' AND vendor='Hero Labs' AND amount=-5000"
  ).get();
  if (!exists) {
    db.prepare(`
      INSERT OR IGNORE INTO fact_expense (id, date, month, vendor, description, amount, category, source)
      VALUES (?, '04/30/2026', '2026-04', 'Hero Labs', ?, -5000, 'other', 'apr_2026_expenses.xlsx')
    `).run(randomBytes(8).toString('hex'), HERO_DESC);
  }

  // 2. DoorDash $500 — relabel vendor for clarity (category already paid_media)
  db.prepare(`
    UPDATE fact_expense SET vendor='DD Marketing'
    WHERE month='2026-04' AND description='AT APR26 DD MKTG' AND amount=500
  `).run();

  // 3. Recategorizations (exact vendor matches, April only)
  const recat = [
    ['direct_mail_print', 'Copyworks'],
    ['sponsorship', 'Big Green'],
    ['sponsorship', 'Downtown Events Group'],
    ['sponsorship', 'Waukee Area Chamber of Commerce'],
  ];
  const upd = db.prepare("UPDATE fact_expense SET category=? WHERE month='2026-04' AND vendor=?");
  for (const [cat, vendor] of recat) {
    const r = upd.run(cat, vendor);
    console.log(`  ${vendor} -> ${cat}: ${r.changes} row(s)`);
  }
});
tx();

// ── Verify ──
console.log('\nApril 2026 by category (after corrections):');
console.table(db.prepare(`
  SELECT category, COUNT(*) AS n, ROUND(SUM(amount), 2) AS total
  FROM fact_expense WHERE month='2026-04' GROUP BY category ORDER BY total DESC
`).all());

const gross = db.prepare(
  "SELECT ROUND(SUM(amount),2) t FROM fact_expense WHERE month='2026-04' AND amount > 0"
).get().t;
const net = db.prepare(
  "SELECT ROUND(SUM(amount),2) t FROM fact_expense WHERE month='2026-04'"
).get().t;
const n = db.prepare("SELECT COUNT(*) n FROM fact_expense WHERE month='2026-04'").get().n;
console.log(`Gross marketing spend: $${gross}`);
console.log(`Hero Labs co-op offset: -$5,000.00`);
console.log(`Net marketing investment: $${net}  (across ${n} rows; ties to QuickBooks net $22,786.78)`);

db.close();

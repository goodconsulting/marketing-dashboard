/**
 * Option B (per CIO, 2026-06-04): represent the Hero Labs $5,000 co-op as a
 * SEPARATE funding line rather than a contra-expense.
 *
 *   - Remove the -$5,000 Hero Labs row from fact_expense  -> category spend
 *     returns to GROSS (April total $27,786.78, 'other' back to positive).
 *   - Record the $5,000 in fact_marketing_funding (type 'co_op').
 *
 * The dashboard now shows: gross spend by category, co-op funding, and
 * net marketing investment (gross - funding). ROI continues to use gross
 * spend (the marketing activity that drove results).
 *
 * Idempotent. Usage: node scripts/apply-option-b-coop.cjs
 */
const path = require('path');
const Database = require('better-sqlite3');

const db = new Database(path.join(__dirname, '..', 'data', 'stack.db'));

// Ensure funding table exists (mirrors schema.ts FACT_MARKETING_FUNDING)
db.prepare(`
CREATE TABLE IF NOT EXISTS fact_marketing_funding (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  month        TEXT NOT NULL,
  source       TEXT NOT NULL,
  funding_type TEXT NOT NULL DEFAULT 'co_op',
  amount       REAL NOT NULL DEFAULT 0,
  note         TEXT,
  UNIQUE(month, source)
)
`).run();

const tx = db.transaction(() => {
  // 1. Remove the contra-expense so categories are gross again
  const del = db.prepare(
    "DELETE FROM fact_expense WHERE month='2026-04' AND vendor='Hero Labs' AND amount=-5000"
  ).run();
  console.log(`Removed ${del.changes} contra-expense row from fact_expense`);

  // 2. Record co-op funding separately
  db.prepare(`
    INSERT OR REPLACE INTO fact_marketing_funding (month, source, funding_type, amount, note)
    VALUES ('2026-04', 'Hero Labs', 'co_op', 5000,
      'In-store product vendor co-op marketing funding (Bill.com Inv 0001). Offsets April marketing spend.')
  `).run();
  db.prepare('INSERT OR IGNORE INTO dim_month (month) VALUES (?)').run('2026-04');
});
tx();

// ── Verify ──
console.log('\nApril 2026 spend by category (now GROSS):');
console.table(db.prepare(`
  SELECT category, COUNT(*) n, ROUND(SUM(amount),2) total
  FROM fact_expense WHERE month='2026-04' GROUP BY category ORDER BY total DESC
`).all());

const gross = db.prepare("SELECT ROUND(SUM(amount),2) t, COUNT(*) n FROM fact_expense WHERE month='2026-04'").get();
const funding = db.prepare("SELECT ROUND(SUM(amount),2) t FROM fact_marketing_funding WHERE month='2026-04'").get().t;
console.log('\nfact_marketing_funding:');
console.table(db.prepare("SELECT month, source, funding_type, amount FROM fact_marketing_funding").all());
console.log(`Gross marketing spend (April): $${gross.t} across ${gross.n} rows`);
console.log(`Co-op funding (Hero Labs):     -$${funding}`);
console.log(`Net marketing investment:      $${(Math.round((gross.t - funding) * 100) / 100)}`);
db.close();

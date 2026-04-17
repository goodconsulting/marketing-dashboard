/**
 * Migration: widen fact_expense UNIQUE key from
 *   (date, vendor, amount)  ->  (date, vendor, amount, description)
 *
 * Reason: a single vendor can legitimately issue multiple invoices on the
 * same day with the same amount but distinct line-item descriptions
 * (e.g. Sinclair Broadcast Group, March 2026).
 *
 * Strategy: SQLite cannot ALTER a UNIQUE constraint in place. Standard
 * pattern is rebuild-and-rename inside a transaction. Idempotent: if the
 * new constraint is already in place, the script exits without changes.
 *
 * Usage: node scripts/migrate-expense-unique-key.cjs
 */
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, '..', 'data', 'stack.db');
const db = new Database(DB_PATH);

// Local alias for SQLite DDL (NOT child_process). All DDL strings below are
// hardcoded — no user input is interpolated into any statement.
const runDDL = (sql) => db.prepare(sql).run();
const runScript = (sql) => {
  for (const stmt of sql.split(';').map(s => s.trim()).filter(Boolean)) {
    db.prepare(stmt).run();
  }
};

// Detect current state by inspecting the auto-index for the UNIQUE constraint.
const indexes = db.prepare(
  `SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='fact_expense' AND name LIKE 'sqlite_autoindex%'`
).all();

let alreadyMigrated = false;
for (const { name } of indexes) {
  const cols = db.prepare(`PRAGMA index_info('${name}')`).all().map(c => c.name);
  if (cols.includes('description') && cols.includes('amount')) {
    alreadyMigrated = true;
    break;
  }
}

if (alreadyMigrated) {
  console.log('fact_expense already migrated - nothing to do.');
  db.close();
  process.exit(0);
}

const beforeCount = db.prepare('SELECT COUNT(*) AS n FROM fact_expense').get().n;
console.log(`Pre-migration row count: ${beforeCount}`);

db.transaction(() => {
  runDDL(`
    CREATE TABLE fact_expense_new (
      id          TEXT PRIMARY KEY,
      date        TEXT NOT NULL,
      month       TEXT NOT NULL,
      vendor      TEXT NOT NULL,
      description TEXT,
      amount      REAL NOT NULL,
      category    TEXT NOT NULL,
      source      TEXT,
      UNIQUE(date, vendor, amount, description)
    )
  `);

  runDDL(`
    INSERT INTO fact_expense_new (id, date, month, vendor, description, amount, category, source)
    SELECT id, date, month, vendor, description, amount, category, source FROM fact_expense
  `);

  runDDL(`DROP TABLE fact_expense`);
  runDDL(`ALTER TABLE fact_expense_new RENAME TO fact_expense`);
  runDDL(`CREATE INDEX IF NOT EXISTS idx_expense_month ON fact_expense(month)`);
})();

const afterCount = db.prepare('SELECT COUNT(*) AS n FROM fact_expense').get().n;
console.log(`Post-migration row count: ${afterCount}`);

if (afterCount !== beforeCount) {
  console.error(`ROW COUNT MISMATCH: before=${beforeCount}, after=${afterCount}`);
  process.exit(1);
}

const newIdx = db.prepare(
  `SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='fact_expense' AND name LIKE 'sqlite_autoindex%'`
).all();
for (const { name } of newIdx) {
  const cols = db.prepare(`PRAGMA index_info('${name}')`).all().map(c => c.name);
  console.log(`  index ${name}: [${cols.join(', ')}]`);
}

console.log('Migration complete.');
db.close();
// runScript intentionally unused above — kept for future multi-statement DDL needs.
void runScript;

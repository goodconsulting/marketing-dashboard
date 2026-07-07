/**
 * Verify the three copies of the expense categorizer keyword map agree:
 *   server/parsers/categorize.ts   (live upload pipeline)
 *   src/utils/categorize.ts        (client)
 *   scripts/ingest-expenses.cjs    (CLI ingest mirror)
 *
 * Compares keyword→category PAIRS (the semantic invariant — matching is
 * first-substring-wins, so ordering only matters for overlapping keywords
 * like gsuite/workspace-before-google, which is also asserted here).
 *
 * Usage: node scripts/check-categorizer-sync.cjs   (exit 1 on drift)
 */
const fs = require('fs');
const path = require('path');

const FILES = [
  'server/parsers/categorize.ts',
  'src/utils/categorize.ts',
  'scripts/ingest-expenses.cjs',
];

function extractMap(file) {
  const text = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const start = text.indexOf('VENDOR_CATEGORIES');
  if (start < 0) throw new Error(`No VENDOR_CATEGORIES in ${file}`);
  const block = text.slice(start, text.indexOf('};', start));
  const map = new Map();
  const order = [];
  for (const m of block.matchAll(/'([^']+)':\s*'([^']+)'/g)) {
    map.set(m[1], m[2]);
    order.push(m[1]);
  }
  return { map, order };
}

const parsed = FILES.map((f) => ({ file: f, ...extractMap(f) }));
const [ref, ...rest] = parsed;
let drifted = false;

for (const other of rest) {
  const missing = [...ref.map.keys()].filter((k) => !other.map.has(k));
  const extra = [...other.map.keys()].filter((k) => !ref.map.has(k));
  const changed = [...ref.map.keys()].filter((k) => other.map.has(k) && other.map.get(k) !== ref.map.get(k));
  if (missing.length || extra.length || changed.length) {
    drifted = true;
    console.log(`✗ ${other.file} vs ${ref.file}:`);
    if (missing.length) console.log(`    missing: ${missing.join(', ')}`);
    if (extra.length) console.log(`    extra: ${extra.join(', ')}`);
    for (const k of changed) console.log(`    '${k}': ${ref.map.get(k)} → ${other.map.get(k)}`);
  }
}

// Ordering invariant: specific overrides must precede their generic substrings.
const OVERRIDES = [['gsuite', 'google'], ['workspace', 'google']];
for (const p of parsed) {
  for (const [specific, generic] of OVERRIDES) {
    if (p.order.indexOf(specific) > p.order.indexOf(generic)) {
      drifted = true;
      console.log(`✗ ${p.file}: '${specific}' must come BEFORE '${generic}' (first-match-wins)`);
    }
  }
}

if (drifted) {
  console.log('\n❌ Categorizer copies have drifted — sync them before the next expense ingest.');
  process.exit(1);
}
console.log(`✅ Categorizer maps in sync across ${FILES.length} files (${ref.map.size} keywords).`);

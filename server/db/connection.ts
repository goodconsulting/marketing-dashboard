/**
 * SQLite database connection singleton.
 *
 * Uses better-sqlite3 with WAL journal mode for concurrent read/write
 * performance. The database file lives at `data/stack.db` relative to
 * the project root.
 *
 * WAL mode lets the React frontend read data while an upload transaction
 * is still writing — critical when ingesting 8,000+ CRM records.
 */

import Database from 'better-sqlite3';
import { dirname, join } from 'path';
import { mkdirSync } from 'fs';

// DB_PATH env var wins (production — prod container sets it to /data/stack.db
// pointing at a Fly persistent volume). Falls back to ./data/stack.db relative
// to process.cwd() for local dev.
const DB_PATH = process.env.DB_PATH || join(process.cwd(), 'data', 'stack.db');
const DB_DIR = dirname(DB_PATH);

let instance: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!instance) {
    // Ensure data directory exists on first connection
    mkdirSync(DB_DIR, { recursive: true });

    instance = new Database(DB_PATH);

    // WAL = concurrent reads during writes, ~2x write throughput
    instance.pragma('journal_mode = WAL');
    // Enforce FK constraints (SQLite disables them by default)
    instance.pragma('foreign_keys = ON');
    // Wait up to 5s if another connection holds a lock
    instance.pragma('busy_timeout = 5000');
  }
  return instance;
}

export function closeDb(): void {
  if (instance) {
    instance.close();
    instance = null;
  }
}

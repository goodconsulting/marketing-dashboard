/**
 * Type declarations for month-checks.cjs (shared CLI/server month-close checklist).
 */

/** Minimal structural view of a better-sqlite3 connection — keeps this
 *  declaration dependency-free while remaining assignable from getDb(). */
interface SqliteLike {
  prepare(sql: string): { get(...params: unknown[]): unknown };
}

export interface MonthCheckDef {
  key: string;
  label: string;
  required: boolean;
  sql: string;
}

export interface MonthCheckRow {
  key: string;
  label: string;
  required: boolean;
  rows: number;
  total: number | null;
  present: boolean;
}

export declare const CHECKS: MonthCheckDef[];

export declare function runMonthChecks(
  db: SqliteLike,
  month: string,
): { month: string; checks: MonthCheckRow[]; gaps: number };

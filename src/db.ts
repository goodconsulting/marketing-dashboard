/**
 * IndexedDB persistence layer for Stack Marketing Dashboard.
 *
 * Replaces the single-blob localStorage approach with structured object stores,
 * each indexed by month for efficient time-range queries. On first load, any
 * existing localStorage data is migrated and then removed.
 *
 * Uses the `idb` library for a clean async/await API over raw IndexedDB.
 */
import { openDB, type IDBPDatabase, type DBSchema } from 'idb';
import type {
  MonthlyExpense, MonthlyBudget, MetaCampaign, GoogleCampaign,
  GoogleDaily, ToastSales, ToastDiscrepancy, IncentivioMetrics,
  CRMCustomerRecord, MenuIntelligenceItem, UploadedFile,
  DashboardState,
} from './types';

// ─── Schema Definition ────────────────────────────────────────────
interface StackDB extends DBSchema {
  expenses: {
    key: string;          // id
    value: MonthlyExpense;
    indexes: { 'by-month': string };
  };
  budgets: {
    key: string;          // month
    value: MonthlyBudget;
  };
  metaCampaigns: {
    key: number;          // auto-increment
    value: MetaCampaign;
    indexes: { 'by-month': string };
  };
  googleCampaigns: {
    key: number;
    value: GoogleCampaign;
    indexes: { 'by-month': string };
  };
  googleDaily: {
    key: string;          // date
    value: GoogleDaily;
  };
  toastSales: {
    key: string;          // month|location
    value: ToastSales;
    indexes: { 'by-month': string };
  };
  toastDiscrepancies: {
    key: number;
    value: ToastDiscrepancy;
    indexes: { 'by-month': string };
  };
  incentivio: {
    key: string;          // month
    value: IncentivioMetrics;
  };
  crmCustomers: {
    key: string;          // customerId|snapshotMonth
    value: CRMCustomerRecord;
    indexes: { 'by-month': string; 'by-stage': string; 'by-location': string };
  };
  menuIntelligence: {
    key: string;          // name
    value: MenuIntelligenceItem;
  };
  uploadedFiles: {
    key: string;          // id
    value: UploadedFile;
  };
  settings: {
    key: string;
    value: { key: string; value: number | string | boolean };
  };
}

const DB_NAME = 'stack_dashboard';
const DB_VERSION = 1;
const LEGACY_KEY = 'stack_marketing_dashboard';

// ─── Retry wrapper for transient IDB failures ──────────────────────
async function withRetry<T>(
  fn: () => Promise<T>,
  { retries = 2, delayMs = 500 } = {},
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, delayMs * Math.pow(2, attempt)));
      }
    }
  }
  throw lastError;
}

// Singleton promise — only one DB connection per page lifecycle
let dbPromise: Promise<IDBPDatabase<StackDB>> | null = null;

export function getDB(): Promise<IDBPDatabase<StackDB>> {
  if (!dbPromise) {
    dbPromise = openDB<StackDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        // Expenses
        const expenseStore = db.createObjectStore('expenses', { keyPath: 'id' });
        expenseStore.createIndex('by-month', 'month');

        // Budgets
        db.createObjectStore('budgets', { keyPath: 'month' });

        // Meta Campaigns
        const metaStore = db.createObjectStore('metaCampaigns', { autoIncrement: true });
        metaStore.createIndex('by-month', 'month');

        // Google Campaigns
        const googleStore = db.createObjectStore('googleCampaigns', { autoIncrement: true });
        googleStore.createIndex('by-month', 'month');

        // Google Daily
        db.createObjectStore('googleDaily', { keyPath: 'date' });

        // Toast Sales — composite key
        const toastStore = db.createObjectStore('toastSales', { keyPath: ['month', 'location'] as unknown as string });
        toastStore.createIndex('by-month', 'month');

        // Toast Discrepancies
        const discStore = db.createObjectStore('toastDiscrepancies', { autoIncrement: true });
        discStore.createIndex('by-month', 'month');

        // Incentivio
        db.createObjectStore('incentivio', { keyPath: 'month' });

        // CRM Customers
        const crmStore = db.createObjectStore('crmCustomers', { keyPath: ['customerId', 'snapshotMonth'] as unknown as string });
        crmStore.createIndex('by-month', 'snapshotMonth');
        crmStore.createIndex('by-stage', 'journeyStage');
        crmStore.createIndex('by-location', 'reachLocation');

        // Menu Intelligence
        db.createObjectStore('menuIntelligence', { keyPath: 'name' });

        // Uploaded Files
        db.createObjectStore('uploadedFiles', { keyPath: 'id' });

        // Settings (key-value pairs)
        db.createObjectStore('settings', { keyPath: 'key' });
      },
    });
  }
  return dbPromise;
}

// ─── Full State Load (hydration on app start) ─────────────────────
export async function loadAllData(): Promise<DashboardState> {
  const db = await getDB();

  // Parallel read of all object stores
  const [
    expenses, budgets, metaCampaigns, googleCampaigns,
    googleDaily, toastSales, toastDiscrepancies, incentivio,
    crmCustomers, menuIntelligence, uploadedFiles, settingsArr,
  ] = await Promise.all([
    db.getAll('expenses'),
    db.getAll('budgets'),
    db.getAll('metaCampaigns'),
    db.getAll('googleCampaigns'),
    db.getAll('googleDaily'),
    db.getAll('toastSales'),
    db.getAll('toastDiscrepancies'),
    db.getAll('incentivio'),
    db.getAll('crmCustomers'),
    db.getAll('menuIntelligence'),
    db.getAll('uploadedFiles'),
    db.getAll('settings'),
  ]);

  // Reconstruct settings
  const settingsMap = new Map(settingsArr.map(s => [s.key, s.value]));
  const annualBudget = (settingsMap.get('annualBudget') as number) || 533000;

  return {
    expenses,
    budgets,
    metaCampaigns,
    googleCampaigns,
    googleDaily,
    toastSales,
    toastDiscrepancies,
    incentivio,
    organic: [],
    thirdParty: [],
    snapshots: [],
    uploadedFiles,
    annualBudget,
    crmCustomers,
    menuIntelligence,
  };
}

// ─── Per-Store Write Helpers ──────────────────────────────────────
// Each returns a promise but callers can fire-and-forget

export function putExpenses(items: MonthlyExpense[]): Promise<void> {
  return withRetry(async () => {
    const db = await getDB();
    const tx = db.transaction('expenses', 'readwrite');
    await Promise.all([...items.map(item => tx.store.put(item)), tx.done]);
  });
}

export function putBudgets(items: MonthlyBudget[]): Promise<void> {
  return withRetry(async () => {
    const db = await getDB();
    const tx = db.transaction('budgets', 'readwrite');
    await Promise.all([...items.map(item => tx.store.put(item)), tx.done]);
  });
}

export function putMetaCampaigns(items: MetaCampaign[]): Promise<void> {
  return withRetry(async () => {
    const db = await getDB();
    const tx = db.transaction('metaCampaigns', 'readwrite');
    await Promise.all([...items.map(item => tx.store.add(item)), tx.done]);
  });
}

export function putGoogleCampaigns(items: GoogleCampaign[]): Promise<void> {
  return withRetry(async () => {
    const db = await getDB();
    const tx = db.transaction('googleCampaigns', 'readwrite');
    await Promise.all([...items.map(item => tx.store.add(item)), tx.done]);
  });
}

export function putGoogleDaily(items: GoogleDaily[]): Promise<void> {
  return withRetry(async () => {
    const db = await getDB();
    const tx = db.transaction('googleDaily', 'readwrite');
    await Promise.all([...items.map(item => tx.store.put(item)), tx.done]);
  });
}

export function putToastSales(items: ToastSales[]): Promise<void> {
  return withRetry(async () => {
    const db = await getDB();
    const tx = db.transaction('toastSales', 'readwrite');
    await Promise.all([...items.map(item => tx.store.put(item)), tx.done]);
  });
}

export function putToastDiscrepancies(
  items: ToastDiscrepancy[],
  replaceForMonthLocations?: Array<{ month: string; location: string }>
): Promise<void> {
  return withRetry(async () => {
    const db = await getDB();
    const tx = db.transaction('toastDiscrepancies', 'readwrite');

    // Remove old discrepancies for month/locations being updated
    if (replaceForMonthLocations?.length) {
      const removeSet = new Set(replaceForMonthLocations.map(ml => `${ml.month}|${ml.location}`));
      let cursor = await tx.store.openCursor();
      while (cursor) {
        const d = cursor.value;
        if (removeSet.has(`${d.month}|${d.location}`)) {
          await cursor.delete();
        }
        cursor = await cursor.continue();
      }
    }

    await Promise.all([...items.map(item => tx.store.add(item)), tx.done]);
  });
}

export function putIncentivio(item: IncentivioMetrics): Promise<void> {
  return withRetry(async () => {
    const db = await getDB();
    await db.put('incentivio', item);
  });
}

export function putCRMCustomers(customers: CRMCustomerRecord[], replaceMonths?: Set<string>): Promise<void> {
  return withRetry(async () => {
    const db = await getDB();
    const tx = db.transaction('crmCustomers', 'readwrite');

    // Clear customers from months being replaced
    if (replaceMonths?.size) {
      const idx = tx.store.index('by-month');
      for (const month of replaceMonths) {
        let cursor = await idx.openCursor(month);
        while (cursor) {
          await cursor.delete();
          cursor = await cursor.continue();
        }
      }
    }

    await Promise.all([...customers.map(c => tx.store.put(c)), tx.done]);
  });
}

export function putMenuIntelligence(items: MenuIntelligenceItem[]): Promise<void> {
  return withRetry(async () => {
    const db = await getDB();
    const tx = db.transaction('menuIntelligence', 'readwrite');
    await tx.store.clear();
    await Promise.all([...items.map(item => tx.store.put(item)), tx.done]);
  });
}

export function putUploadedFile(file: UploadedFile): Promise<void> {
  return withRetry(async () => {
    const db = await getDB();
    await db.put('uploadedFiles', file);
  });
}

export function putSetting(key: string, value: number | string | boolean): Promise<void> {
  return withRetry(async () => {
    const db = await getDB();
    await db.put('settings', { key, value });
  });
}

// ─── Clear Everything ─────────────────────────────────────────────
export async function clearAllStores(): Promise<void> {
  const db = await getDB();
  const storeNames: Array<keyof StackDB> = [
    'expenses', 'budgets', 'metaCampaigns', 'googleCampaigns',
    'googleDaily', 'toastSales', 'toastDiscrepancies', 'incentivio',
    'crmCustomers', 'menuIntelligence', 'uploadedFiles', 'settings',
  ];
  // Each clear needs its own transaction (IDB rule: one readwrite per store at a time)
  await Promise.all(
    storeNames.map(name => {
      const tx = db.transaction(name, 'readwrite');
      tx.store.clear();
      return tx.done;
    })
  );
}

// ─── Month-Range Query Helpers (for MoM/QoQ/YoY) ─────────────────
export async function getExpensesByMonth(month: string): Promise<MonthlyExpense[]> {
  const db = await getDB();
  return db.getAllFromIndex('expenses', 'by-month', month);
}

export async function getToastSalesByMonth(month: string): Promise<ToastSales[]> {
  const db = await getDB();
  return db.getAllFromIndex('toastSales', 'by-month', month);
}

export async function getCRMCustomersByMonth(month: string): Promise<CRMCustomerRecord[]> {
  const db = await getDB();
  return db.getAllFromIndex('crmCustomers', 'by-month', month);
}

// ─── localStorage Migration ───────────────────────────────────────
export async function migrateFromLocalStorage(): Promise<DashboardState | null> {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return null;

    const legacy: DashboardState = JSON.parse(raw);

    // Write each collection to IndexedDB
    const db = await getDB();

    // Use individual transactions per store for safety
    if (legacy.expenses.length > 0) await putExpenses(legacy.expenses);
    if (legacy.budgets.length > 0) await putBudgets(legacy.budgets);
    if (legacy.metaCampaigns.length > 0) await putMetaCampaigns(legacy.metaCampaigns);
    if (legacy.googleCampaigns.length > 0) await putGoogleCampaigns(legacy.googleCampaigns);
    if (legacy.googleDaily.length > 0) await putGoogleDaily(legacy.googleDaily);
    if (legacy.toastSales.length > 0) await putToastSales(legacy.toastSales);
    if (legacy.incentivio.length > 0) {
      for (const i of legacy.incentivio) await putIncentivio(i);
    }
    if (legacy.crmCustomers?.length > 0) {
      await putCRMCustomers(legacy.crmCustomers);
    }
    if (legacy.menuIntelligence?.length > 0) {
      await putMenuIntelligence(legacy.menuIntelligence);
    }
    if (legacy.uploadedFiles.length > 0) {
      for (const f of legacy.uploadedFiles) await putUploadedFile(f);
    }
    if (legacy.toastDiscrepancies?.length > 0) {
      await putToastDiscrepancies(legacy.toastDiscrepancies);
    }

    // Settings
    await putSetting('annualBudget', legacy.annualBudget);

    // Remove localStorage data after successful migration
    localStorage.removeItem(LEGACY_KEY);

    // Suppress unused variable warning - db was used for its side effect of ensuring connection
    void db;

    return legacy;
  } catch {
    // Migration failed — will start fresh from IndexedDB
    return null;
  }
}

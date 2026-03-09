/**
 * Toast POS API Proxy — runs server-side in Vite's Node.js process.
 *
 * Handles authentication, location discovery, order fetching, and
 * aggregation so the browser only sees clean ToastSales objects.
 *
 * Credentials come from .env (never exposed to the client bundle).
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

// ── Types ────────────────────────────────────────────────────────────

interface ToastToken {
  accessToken: string;
  expiresAt: number;
}

interface ToastLocation {
  guid: string;
  name: string;
  rawName: string; // Original name from API
}

export interface AggregatedSales {
  month: string;
  location: string;
  grossSales: number;
  netSales: number;
  orders: number;
  discountTotal: number;
  source: 'api';
  syncedAt: string;
}

interface SyncRequest {
  months: string[];
}

// ── In-Memory Caches ─────────────────────────────────────────────────

let tokenCache: (ToastToken & { scope: string }) | null = null;
let locationCache: { locations: ToastLocation[]; expiresAt: number } | null = null;
let lastRequestTime = 0;

// ── Constants ────────────────────────────────────────────────────────

const RATE_LIMIT_MS = 210; // ~5 req/sec with safety margin

/** Scopes required for full Toast integration (orders + restaurant discovery) */
const REQUIRED_SCOPES = ['orders:read', 'restaurants:read'];

/** Decode JWT payload without verification (we trust Toast's endpoint) */
function decodeJwtPayload(jwt: string): Record<string, unknown> {
  try {
    const payload = jwt.split('.')[1];
    return JSON.parse(Buffer.from(payload, 'base64url').toString());
  } catch {
    return {};
  }
}

/**
 * Map common Toast restaurant name fragments to canonical Stack location names.
 * This is populated after the first /connectedRestaurants call — we do fuzzy
 * matching on the Toast-provided restaurant name to find the right canonical name.
 */
const CANONICAL_LOCATIONS = [
  'Coralville',
  'Edgewood',
  'Downtown Cedar Rapids',
  'Fountains',
  'Waukee',
  'Urbandale',
];

function matchLocationName(rawName: string): string {
  const lower = rawName.toLowerCase();
  for (const canonical of CANONICAL_LOCATIONS) {
    if (lower.includes(canonical.toLowerCase())) return canonical;
  }
  // Check shorthand matches
  if (lower.includes('downtown') || lower.includes('cr downtown') || lower.includes('cedar rapids')) return 'Downtown Cedar Rapids';
  if (lower.includes('coral')) return 'Coralville';
  if (lower.includes('edge')) return 'Edgewood';
  if (lower.includes('fountain')) return 'Fountains';
  if (lower.includes('waukee')) return 'Waukee';
  if (lower.includes('urbandale') || lower.includes('hickman')) return 'Urbandale';
  // If no match, return the raw name trimmed
  return rawName.trim();
}

// ── Helpers ──────────────────────────────────────────────────────────

function getEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing environment variable: ${key}`);
  return val;
}

async function rateLimitedFetch(url: string, opts: RequestInit): Promise<Response> {
  const now = Date.now();
  const wait = Math.max(0, RATE_LIMIT_MS - (now - lastRequestTime));
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastRequestTime = Date.now();
  return fetch(url, opts);
}

function sendJSON(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

/** Get days in a month as YYYY-MM-DD strings */
function getDaysInMonth(month: string): string[] {
  const [year, mon] = month.split('-').map(Number);
  const days: string[] = [];
  const daysInMonth = new Date(year, mon, 0).getDate();
  for (let d = 1; d <= daysInMonth; d++) {
    days.push(`${year}-${String(mon).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  }
  return days;
}

// ── Authentication ───────────────────────────────────────────────────

async function getToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt) {
    return tokenCache.accessToken;
  }

  const apiUrl = getEnv('TOAST_API_URL');
  const res = await fetch(`${apiUrl}/authentication/v1/authentication/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientId: getEnv('TOAST_CLIENT_ID'),
      clientSecret: getEnv('TOAST_CLIENT_SECRET'),
      userAccessType: 'TOAST_MACHINE_CLIENT',
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Toast auth failed (${res.status}): ${text}`);
  }

  const data = await res.json() as Record<string, unknown>;
  // Toast returns { token: { ... }, status: "SUCCESS" } or { accessToken, tokenType }
  const tokenObj = data.token as Record<string, unknown> | undefined;
  const accessToken = (tokenObj?.accessToken || data.accessToken) as string | undefined;
  if (!accessToken) {
    throw new Error(`Toast auth response missing token: ${JSON.stringify(data).substring(0, 200)}`);
  }

  // Decode token to check scopes
  const jwtPayload = decodeJwtPayload(accessToken);
  const scope = (jwtPayload.scope as string) || '';

  tokenCache = {
    accessToken,
    expiresAt: Date.now() + 23 * 60 * 60 * 1000, // Cache for 23 hours
    scope,
  };

  const missingScopes = REQUIRED_SCOPES.filter(s => !scope.includes(s));
  if (missingScopes.length > 0) {
    console.warn(`[Toast] ⚠ Authenticated but token is missing required scopes: ${missingScopes.join(', ')}`);
    console.warn(`[Toast]   Current scope: "${scope}"`);
    console.warn(`[Toast]   Fix: In Toast Developer Portal → Credentials → edit scopes → add: ${missingScopes.join(', ')}`);
  } else {
    console.log(`[Toast] Authenticated successfully (scope: ${scope})`);
  }

  return accessToken;
}

// ── Location Discovery ───────────────────────────────────────────────

async function getLocations(): Promise<ToastLocation[]> {
  if (locationCache && Date.now() < locationCache.expiresAt) {
    return locationCache.locations;
  }

  const token = await getToken();
  const apiUrl = getEnv('TOAST_API_URL');
  const locations: ToastLocation[] = [];
  let pageToken: string | null = null;

  do {
    const url = new URL(`${apiUrl}/partners/v1/connectedRestaurants`);
    url.searchParams.set('pageSize', '200');
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const res = await rateLimitedFetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to fetch locations (${res.status}): ${text}`);
    }

    const data = await res.json() as Record<string, unknown>;
    const restaurants = Array.isArray(data)
      ? data
      : (data.results as Record<string, unknown>[] || data.restaurants as Record<string, unknown>[] || []);

    for (const r of restaurants as Record<string, unknown>[]) {
      const guid = (r.restaurantGuid || r.guid || r.restaurantExternalId) as string | undefined;
      // Toast returns locationName (e.g. "Edgewood") and restaurantName (e.g. "Stack Wellness")
      // Prefer locationName for matching since it's the most specific
      const locationName = r.locationName as string | undefined;
      const restaurantName = (r.restaurantName || r.name || guid) as string;
      const rawName = locationName || restaurantName;
      if (guid) {
        locations.push({
          guid,
          name: matchLocationName(rawName),
          rawName,
        });
      }
    }

    pageToken = (data.nextPageToken as string) || null;
  } while (pageToken);

  locationCache = {
    locations,
    expiresAt: Date.now() + 24 * 60 * 60 * 1000,
  };

  console.log(`[Toast] Discovered ${locations.length} location(s):`, locations.map(l => `${l.name} (${l.guid.substring(0, 8)}...)`));
  return locations;
}

// ── Order Fetching & Aggregation ─────────────────────────────────────

interface OrderAggregate {
  grossSales: number;
  netSales: number;
  orders: number;
  discountTotal: number;
}

/**
 * Fetch orders for one location for one business date.
 * Paginates through all results (pageSize=100).
 */
async function fetchOrdersForDate(
  locationGuid: string,
  businessDate: string,
  token: string,
): Promise<OrderAggregate> {
  const apiUrl = getEnv('TOAST_API_URL');
  const agg: OrderAggregate = { grossSales: 0, netSales: 0, orders: 0, discountTotal: 0 };
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const url = new URL(`${apiUrl}/orders/v2/orders`);
    url.searchParams.set('businessDate', businessDate);
    url.searchParams.set('pageSize', '100');
    url.searchParams.set('page', String(page));

    const res = await rateLimitedFetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
        'Toast-Restaurant-External-ID': locationGuid,
      },
    });

    if (!res.ok) {
      // 404 or empty is normal for days with no orders
      if (res.status === 404 || res.status === 204) break;
      const text = await res.text();
      console.warn(`[Toast] Order fetch error for ${businessDate} (${res.status}): ${text.substring(0, 200)}`);
      break;
    }

    const orders = await res.json() as Record<string, unknown>;
    const orderList = (Array.isArray(orders) ? orders : (orders.orders as Record<string, unknown>[]) || []) as Record<string, unknown>[];

    if (orderList.length === 0) {
      hasMore = false;
      break;
    }

    for (const order of orderList) {
      agg.orders += 1;

      // Gross sales: total amount on the order
      const amount = order.amount || order.totalAmount || 0;
      agg.grossSales += typeof amount === 'number' ? amount : parseFloat(String(amount)) || 0;

      // Discount total
      const discount = order.discountAmount || order.totalDiscountAmount || 0;
      agg.discountTotal += typeof discount === 'number' ? discount : parseFloat(String(discount)) || 0;

      // Net sales: try explicit field, otherwise gross - discount
      if (order.netAmount !== undefined) {
        const net = order.netAmount;
        agg.netSales += typeof net === 'number' ? net : parseFloat(String(net)) || 0;
      } else {
        agg.netSales += (typeof amount === 'number' ? amount : parseFloat(String(amount)) || 0)
                      - (typeof discount === 'number' ? discount : parseFloat(String(discount)) || 0);
      }
    }

    // Check if there are more pages
    hasMore = orderList.length >= 100;
    page += 1;
  }

  return agg;
}

/**
 * Aggregate a full month of orders for one location.
 * Iterates through each business day in the month.
 */
async function aggregateMonthForLocation(
  location: ToastLocation,
  month: string,
): Promise<AggregatedSales> {
  const token = await getToken();
  const days = getDaysInMonth(month);
  const totals: OrderAggregate = { grossSales: 0, netSales: 0, orders: 0, discountTotal: 0 };

  console.log(`[Toast] Fetching ${days.length} days for ${location.name} (${month})...`);

  for (const day of days) {
    const dayAgg = await fetchOrdersForDate(location.guid, day, token);
    totals.grossSales += dayAgg.grossSales;
    totals.netSales += dayAgg.netSales;
    totals.orders += dayAgg.orders;
    totals.discountTotal += dayAgg.discountTotal;
  }

  console.log(`[Toast] ${location.name} ${month}: $${totals.grossSales.toFixed(2)} gross, ${totals.orders} orders`);

  return {
    month,
    location: location.name,
    grossSales: Math.round(totals.grossSales * 100) / 100,
    netSales: Math.round(totals.netSales * 100) / 100,
    orders: totals.orders,
    discountTotal: Math.round(totals.discountTotal * 100) / 100,
    source: 'api',
    syncedAt: new Date().toISOString(),
  };
}

// ── Request Handler ──────────────────────────────────────────────────

export async function handleToastRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const path = url.pathname.replace('/api/toast', '');

  try {
    // ─── GET /api/toast/status ───
    if (path === '/status' && req.method === 'GET') {
      try {
        await getToken();

        // Check if token has required scopes before trying to fetch locations
        const scope = tokenCache?.scope || '';
        const missingScopes = REQUIRED_SCOPES.filter(s => !scope.includes(s));

        if (missingScopes.length > 0) {
          sendJSON(res, 200, {
            connected: false,
            locations: [],
            authenticated: true,
            scope,
            missingScopes,
            error: `Authentication succeeded, but your API credentials are missing required scopes: ${missingScopes.join(', ')}. `
              + `Current scope: "${scope}". `
              + `Fix: Go to Toast Developer Portal → API Credentials → edit your credential set → add scopes: ${missingScopes.join(', ')}. `
              + `Then regenerate your client secret and update .env.`,
          });
          return;
        }

        const locations = await getLocations();
        sendJSON(res, 200, {
          connected: true,
          locations: locations.map(l => l.name),
          locationCount: locations.length,
          scope,
        });
      } catch (err) {
        sendJSON(res, 200, {
          connected: false,
          locations: [],
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
      return;
    }

    // ─── GET /api/toast/locations ───
    if (path === '/locations' && req.method === 'GET') {
      const locations = await getLocations();
      sendJSON(res, 200, locations.map(l => ({
        guid: l.guid,
        name: l.name,
        rawName: l.rawName,
      })));
      return;
    }

    // ─── GET /api/toast/sales?month=YYYY-MM[&location=Name] ───
    if (path === '/sales' && req.method === 'GET') {
      const month = url.searchParams.get('month');
      if (!month || !/^\d{4}-\d{2}$/.test(month)) {
        sendJSON(res, 400, { error: 'month parameter required (YYYY-MM format)' });
        return;
      }

      const locationFilter = url.searchParams.get('location');
      const allLocations = await getLocations();
      const targets = locationFilter
        ? allLocations.filter(l => l.name.toLowerCase() === locationFilter.toLowerCase())
        : allLocations;

      if (targets.length === 0) {
        sendJSON(res, 404, { error: `No locations matched "${locationFilter}"` });
        return;
      }

      const results: AggregatedSales[] = [];
      for (const loc of targets) {
        const sales = await aggregateMonthForLocation(loc, month);
        results.push(sales);
      }

      sendJSON(res, 200, results);
      return;
    }

    // ─── POST /api/toast/sync ───
    if (path === '/sync' && req.method === 'POST') {
      const body = await readBody(req);
      const { months } = JSON.parse(body) as SyncRequest;

      if (!months || !Array.isArray(months) || months.length === 0) {
        sendJSON(res, 400, { error: 'months array required in body' });
        return;
      }

      const locations = await getLocations();
      const sales: AggregatedSales[] = [];
      const errors: Array<{ location: string; month: string; error: string }> = [];

      for (const month of months) {
        for (const loc of locations) {
          try {
            const result = await aggregateMonthForLocation(loc, month);
            sales.push(result);
          } catch (err) {
            const msg = err instanceof Error ? err.message : 'Unknown error';
            console.error(`[Toast] Error syncing ${loc.name} ${month}: ${msg}`);
            errors.push({ location: loc.name, month, error: msg });
          }
        }
      }

      sendJSON(res, 200, {
        sales,
        errors,
        syncedAt: new Date().toISOString(),
      });
      return;
    }

    // ─── Fallback: unknown route ───
    sendJSON(res, 404, { error: `Unknown toast endpoint: ${path}` });

  } catch (err) {
    console.error('[Toast] Proxy error:', err);
    sendJSON(res, 500, {
      error: err instanceof Error ? err.message : 'Internal proxy error',
    });
  }
}

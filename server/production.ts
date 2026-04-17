/**
 * Production Node + Express server.
 *
 * Serves the built React frontend from `dist/` and mounts the shared data
 * API handler at /api/data/*. Used in the Fly.io Docker image.
 *
 * Environment:
 *   PORT    (default: 3000)
 *   DB_PATH (default: ./data/stack.db; prod uses /data/stack.db)
 */
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleDataRequest } from './dataApiHandler.js';
import { initializeDatabase } from './db/queries.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Resolve dist/ relative to this file's compiled location in dist-server/
const DIST_DIR = path.resolve(__dirname, '..', 'dist');
const PORT = Number(process.env.PORT) || 3000;

// Ensure DB schema is initialized (creates tables if missing — idempotent).
initializeDatabase();

const app = express();

// Mount the data API handler. It returns true on match (handled), false
// otherwise — fall through to static/SPA when false.
app.use(async (req, res, next) => {
  try {
    const handled = await handleDataRequest(req, res);
    if (!handled) next();
  } catch (err) {
    console.error('[Data API]', err);
    res.status(500).json({ error: String(err) });
  }
});

// Static React bundle (cached aggressively; index.html has hashes in asset refs)
app.use(express.static(DIST_DIR, { maxAge: '1h' }));

// SPA fallback: anything not matched above serves index.html so client-side
// routing works.
app.get('*', (_req, res) => {
  res.sendFile(path.join(DIST_DIR, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`[prod] Stack dashboard listening on :${PORT}`);
  console.log(`[prod] Serving static files from ${DIST_DIR}`);
  console.log(`[prod] DB_PATH = ${process.env.DB_PATH ?? 'default'}`);
});

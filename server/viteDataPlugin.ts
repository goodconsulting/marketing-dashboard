/**
 * Vite dev-mode wrapper around the shared data API handler.
 * Used only during `npm run dev`; production uses server/production.ts.
 */
import type { Plugin } from 'vite';
import { handleDataRequest } from './dataApiHandler.ts';
import { initializeDatabase } from './db/queries.ts';

export function dataApiPlugin(): Plugin {
  return {
    name: 'stack-data-api',
    configureServer(server) {
      initializeDatabase();
      console.log('[Data API] SQLite initialized \u2014 database ready');
      server.middlewares.use(async (req, res, next) => {
        try {
          const handled = await handleDataRequest(req, res);
          if (!handled) next();
        } catch (err) {
          console.error('[Data API]', err);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: String(err) }));
        }
      });
      console.log('[Data API] Routes mounted at /api/data/*');
    },
  };
}

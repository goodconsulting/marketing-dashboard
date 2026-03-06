/**
 * Vite plugin that mounts the Toast API proxy as dev-server middleware.
 * Intercepts all /api/toast/* requests and routes them to the proxy handler.
 * Credentials are loaded from .env via Vite's loadEnv — never exposed to the browser.
 */

import type { Plugin } from 'vite';
import { handleToastRequest } from './toastProxy.ts';

export function toastApiPlugin(): Plugin {
  return {
    name: 'toast-api-proxy',

    configureServer(server) {
      // Mount middleware before Vite's internal middleware
      server.middlewares.use(async (req, res, next) => {
        if (req.url?.startsWith('/api/toast')) {
          try {
            await handleToastRequest(req, res);
          } catch (err) {
            console.error('[Toast Plugin] Unhandled error:', err);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Internal server error' }));
          }
        } else {
          next();
        }
      });

      console.log('[Toast Plugin] API proxy mounted at /api/toast/*');
    },
  };
}

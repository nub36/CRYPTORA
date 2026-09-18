/**
 * CRYPTORA — Backend Entry Point
 *
 * Production: listens on 127.0.0.1:3000 (behind Nginx).
 * Development: same, but with relaxed cookie settings.
 *
 * Does NOT serve static files — Nginx handles that in production.
 * For development, run `npm run dev` (Vite) alongside `npm run server`.
 */

import { createApp } from './app.js';
import { config } from './config.js';
import { checkDatabase } from './db/pool.js';

const app = createApp();

async function start() {
  // Verify DB connectivity before accepting traffic
  const dbOk = await checkDatabase();
  if (!dbOk) {
    console.error('[CRYPTORA] WARNING: Database not reachable. Server will start but /api/health will report degraded.');
  } else {
    console.log('[CRYPTORA] Database connected.');
  }

  app.listen(config.PORT, config.HOST, () => {
    console.log('=======================================================');
    console.log('  CRYPTORA Backend Server');
    console.log(`  Listening on: http://${config.HOST}:${config.PORT}`);
    console.log(`  Environment:  ${config.NODE_ENV}`);
    console.log(`  Registration: ${config.REGISTRATION_ENABLED ? 'enabled' : 'disabled'}`);
    console.log('=======================================================');
  });
}

// Graceful shutdown
const shutdown = (signal) => {
  console.log(`\nReceived ${signal}. Shutting down...`);
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

start().catch((err) => {
  console.error('[CRYPTORA] Fatal startup error:', err);
  process.exit(1);
});
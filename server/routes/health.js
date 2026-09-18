/**
 * CRYPTORA — Health Endpoint
 *
 * GET /api/health — Returns backend health, version, uptime.
 * No authentication required. Used by Nginx health checks and monitoring.
 */

import { Router } from 'express';
import { checkDatabase } from '../db/pool.js';
import { config } from '../config.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Read version from package.json once at startup
const APP_VERSION = (() => {
  try {
    return JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8')
    ).version ?? 'unknown';
  } catch {
    return 'unknown';
  }
})();

const router = Router();

router.get('/', async (req, res) => {
  const dbHealthy = await checkDatabase();

  res.status(dbHealthy ? 200 : 503).json({
    status: dbHealthy ? 'ok' : 'degraded',
    app: 'CRYPTORA Market Intelligence Terminal',
    version: APP_VERSION,
    node: process.version,
    environment: config.NODE_ENV,
    uptimeSeconds: Math.floor(process.uptime()),
    database: dbHealthy ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString(),
  });
});

export default router;
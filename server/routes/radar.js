/** Server-authoritative Radar history and detector telemetry. */

import { Router } from 'express';
import { listRadarEvents, RADAR_HISTORY_MAX_LIMIT } from '../services/radar/radarEventRepository.js';
import { radarMonitorStatus } from '../services/radar/radarMonitor.js';

const router = Router();

function boundedLimit(raw) {
  if (raw === undefined) return RADAR_HISTORY_MAX_LIMIT;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > RADAR_HISTORY_MAX_LIMIT) return null;
  return value;
}

router.get('/status', (_req, res) => {
  res.json(radarMonitorStatus());
});

router.get('/events', async (req, res, next) => {
  try {
    const limit = boundedLimit(req.query.limit);
    if (limit === null) {
      return res.status(400).json({ error: 'INVALID_LIMIT', message: `limit must be 1..${RADAR_HISTORY_MAX_LIMIT}` });
    }
    const before = typeof req.query.before === 'string' ? req.query.before : null;
    if (before && Number.isNaN(Date.parse(before))) {
      return res.status(400).json({ error: 'INVALID_BEFORE', message: 'before must be an ISO timestamp' });
    }
    const symbol = typeof req.query.symbol === 'string' ? req.query.symbol : null;
    const events = await listRadarEvents({ limit, symbol, before });
    res.json({ events, count: events.length, source: 'server' });
  } catch (error) {
    next(error);
  }
});

export default router;

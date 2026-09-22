/**
 * CRYPTORA — Публичное чтение сигналов.
 *
 * GET /api/signals?strategy=&status=&symbol=&limit=
 *
 * Данные берутся из PostgreSQL (миграция 007), а не из localStorage браузера.
 * Чтение публичное и только на чтение: торговля не выполняется, ордеров нет.
 */

import { Router } from 'express';
import { listSignals } from '../services/signalRepository.js';

const router = Router();

const ALLOWED_STATUS = new Set(['ACTIVE', 'INVALIDATED', 'TARGET_REACHED', 'EXPIRED']);

router.get('/', async (req, res, next) => {
  try {
    const { strategy, status, symbol, limit } = req.query;

    if (status !== undefined && !ALLOWED_STATUS.has(String(status))) {
      return res.status(400).json({
        error: 'INVALID_STATUS',
        message: `status must be one of: ${[...ALLOWED_STATUS].join(', ')}`,
      });
    }

    const signals = await listSignals({
      strategyId: typeof strategy === 'string' && strategy ? strategy : undefined,
      status: typeof status === 'string' && status ? status : undefined,
      symbol: typeof symbol === 'string' && symbol ? symbol : undefined,
      limit: typeof limit === 'string' ? Number(limit) : 50,
    });

    res.json({ signals, count: signals.length, source: 'server' });
  } catch (e) {
    next(e);
  }
});

export default router;

/**
 * CRYPTORA — Публичное чтение состояния стратегий.
 *
 * GET /api/strategies — ВКЛ/ВЫКЛ, статус, интервал, последний скан/сигнал,
 * число активных сигналов. Чтение публичное: здесь нет ни параметров
 * алгоритма, ни внутренних исследовательских данных.
 *
 * Запись — только через /api/admin/strategies/:id (requireAdmin).
 */

import { Router } from 'express';
import { listStrategyStates } from '../services/strategySettings.js';
import { getScanUniverseState } from '../services/scanUniverse.js';

const router = Router();

router.get('/', async (_req, res, next) => {
  try {
    const strategies = await listStrategyStates();
    res.json({
      strategies,
      // Серверный движок — единственный источник сигналов. Фронт это
      // показывает, чтобы не возникало двух источников истины.
      source: 'server',
    });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/strategies/scan-universe — публичное чтение эффективной вселенной
 * скана (сохранённая ∩ активные на бирже). Нужна браузерному движку, чтобы
 * все пользователи сканировали один и тот же server-side список.
 */
router.get('/scan-universe', async (_req, res, next) => {
  try {
    const { effective, activeKnown } = await getScanUniverseState();
    res.json({ symbols: effective, activeKnown });
  } catch (e) {
    next(e);
  }
});

export default router;

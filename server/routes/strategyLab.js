/**
 * CRYPTORA — Strategy Lab · маршруты (RESEARCH ONLY, ADMIN ONLY)
 * ---------------------------------------------------------------------------
 * GET  /api/strategy-lab/strategies — список исследовательских стратегий + поля
 * POST /api/strategy-lab/replay      — исторический backtest (read-only)
 *
 * ЗАЩИТА: весь router закрыт `requireAuth, requireAdmin` (переиспользуем
 * существующий middleware, auth.js НЕ меняется). Скрытие кнопки в UI — не защита;
 * не-admin не получит ни список стратегий, ни replay, ни события, ни метрики.
 *
 * НИКАКИХ production-записей: сервис только читает публичные свечи и считает
 * результат в памяти. strategy_settings / signals / strategy_test_runs /
 * scheduler / БД не затрагиваются.
 */

import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { parseReplayRequest } from '../validators/strategyLab.js';
import { listStrategies, runReplay, LabRequestError } from '../services/strategyLab/labService.js';
import { LabHistoricalError } from '../services/strategyLab/historicalCandles.js';
import {
  getLocalDatasetCoverage,
  LocalHistoricalError,
} from '../services/strategyLab/localHistoricalCandles.js';
import {
  listSavedStrategies,
  createSavedStrategy,
  updateSavedStrategy,
  validateSavedDraft,
  SavedStrategyValidationError,
} from '../services/strategyLab/savedStrategies.js';

const router = Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Весь исследовательский контур — только для администраторов.
router.use(requireAuth, requireAdmin);

/* GET /api/strategy-lab/saved-strategies — current admin's own research drafts. */
router.get('/saved-strategies', async (req, res, next) => {
  try {
    const strategies = await listSavedStrategies(req.user.id);
    res.set('Cache-Control', 'no-store');
    res.json({ strategies });
  } catch (e) {
    next(e);
  }
});

/* POST /api/strategy-lab/saved-strategies */
router.post('/saved-strategies', async (req, res, next) => {
  try {
    const draft = await validateSavedDraft(req.body ?? {});
    const strategy = await createSavedStrategy(req.user.id, draft);
    res.status(201).set('Cache-Control', 'no-store').json({ strategy });
  } catch (e) {
    if (e instanceof SavedStrategyValidationError) {
      return res.status(400).json({ error: e.message, code: 'INVALID_SAVED_STRATEGY' });
    }
    next(e);
  }
});

/* PUT /api/strategy-lab/saved-strategies/:id */
router.put('/saved-strategies/:id', async (req, res, next) => {
  if (!UUID_RE.test(req.params.id)) {
    return res.status(404).json({ error: 'Стратегия не найдена', code: 'SAVED_STRATEGY_NOT_FOUND' });
  }
  try {
    const draft = await validateSavedDraft(req.body ?? {});
    const strategy = await updateSavedStrategy(req.user.id, req.params.id, draft);
    if (!strategy) return res.status(404).json({ error: 'Стратегия не найдена', code: 'SAVED_STRATEGY_NOT_FOUND' });
    res.set('Cache-Control', 'no-store').json({ strategy });
  } catch (e) {
    if (e instanceof SavedStrategyValidationError) {
      return res.status(400).json({ error: e.message, code: 'INVALID_SAVED_STRATEGY' });
    }
    next(e);
  }
});

/* GET /api/strategy-lab/strategies */
router.get('/strategies', async (_req, res, next) => {
  try {
    const strategies = await listStrategies();
    res.set('Cache-Control', 'no-store');
    res.json({ strategies, researchOnly: true });
  } catch (e) {
    next(e);
  }
});

/* GET /api/strategy-lab/data-coverage — metadata only, never candle arrays. */
router.get('/data-coverage', async (_req, res, next) => {
  try {
    const coverage = await getLocalDatasetCoverage();
    res.set('Cache-Control', 'no-store');
    res.json(coverage);
  } catch (e) {
    next(e);
  }
});

/* POST /api/strategy-lab/replay */
router.post('/replay', async (req, res, next) => {
  let parsed;
  try {
    parsed = parseReplayRequest(req.body ?? {});
  } catch (e) {
    // ZodError → 400 глобальным errorHandler.
    return next(e);
  }

  try {
    const result = await runReplay(parsed);
    res.set('Cache-Control', 'no-store');
    res.json(result);
  } catch (e) {
    if (e instanceof LabRequestError) {
      return res.status(e.status).json({ error: e.message, code: e.code });
    }
    if (e instanceof LabHistoricalError) {
      const clientCodes = new Set(['RANGE_TOO_LARGE', 'BAD_RANGE', 'BAD_TIMEFRAME', 'BAD_MARKET']);
      if (clientCodes.has(e.code)) {
        return res.status(400).json({ error: e.message, code: e.code });
      }
      if (e.code === 'UPSTREAM_TIMEOUT' || e.code === 'UPSTREAM_ERROR') {
        return res.status(502).json({ error: 'Источник свечей недоступен', code: e.code });
      }
    }
    if (e instanceof LocalHistoricalError) {
      return res.status(503).json({ error: 'Локальный архив повреждён или недоступен', code: e.code });
    }
    return next(e);
  }
});

export default router;

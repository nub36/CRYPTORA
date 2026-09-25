/**
 * CRYPTORA — Публичное чтение сигналов.
 *
 * GET /api/signals?symbol=&strategy=&status=&open=&direction=&limit=&offset=
 * GET /api/signals/:id — один сигнал по `signals.id` (deep-link колокольчика)
 *
 * Данные берутся из PostgreSQL (миграции 007 + 009), а не из localStorage
 * браузера. Чтение публичное и только на чтение: торговля не выполняется,
 * ордеров нет.
 *
 * Контракт для будущего Signals UI (источник истины — этот эндпоинт):
 *  • лента ограничена: `limit` ≤ 200 (по умолчанию 50) + `offset` ≤ 5000,
 *    бесконечная история одним ответом не отдаётся;
 *  • порядок детерминирован: новые сверху (`created_at DESC, id DESC`);
 *  • `total` — сколько всего строк под фильтром (для честной пагинации);
 *  • `appliedFilters` — что реально применено (нормализация символа видна);
 *  • домен статуса отдаётся в ответе (`statuses`, `openStatuses`), чтобы UI не
 *    хардкодил состояния и не выдумывал свои;
 *  • уровни сигнала — только посчитанные стратегией: `entryMin`/`entryMax`,
 *    `stopLoss`, `targets` (вся лестница TP1..TPn), а после исполнения —
 *    `fillPrice`/`fillStop`/`fillTargets`. Никаких «приблизительных» уровней
 *    эндпоинт не возвращает и не досчитывает.
 */

import { Router } from 'express';
import {
  listSignals,
  countSignals,
  getSignalById,
  isSignalIdShape,
  SIGNAL_STATUSES,
  OPEN_SIGNAL_STATUSES,
  CLOSED_SIGNAL_STATUSES,
  MAX_SIGNALS_LIMIT,
  DEFAULT_SIGNALS_LIMIT,
  MAX_SIGNALS_OFFSET,
} from '../services/signalRepository.js';
import { isKnownStrategyId, KNOWN_STRATEGY_IDS } from '../services/strategyCatalog.js';
import { getSignalStatistics, STATISTICS_PERIODS } from '../services/signalStatistics.js';
import { signalMonitorStatus } from '../services/signalMonitor/signalMonitor.js';

const router = Router();

const DIRECTIONS = new Set(['LONG', 'SHORT']);

/** Цитата канонической вселенной — спот USDT (см. docs/MARKET_DATA.md). */
const QUOTE = 'USDT';

/**
 * Приводит параметр символа к форме, в которой сигналы хранятся ('BTC/USDT').
 *
 * Принимаются три формы, потому что в продукте сосуществуют биржевой символ
 * (scan universe: 'BTCUSDT') и пара (реестр/журнал: 'BTC/USDT'). Неизвестная
 * форма отклоняется: молча вернуть пустой список означало бы «нет сигналов»
 * вместо «неверный запрос».
 *
 * @param {string} raw
 * @returns {{ok: true, value: string} | {ok: false, reason: string}}
 */
export function normalizeSymbolParam(raw) {
  const value = String(raw).trim().toUpperCase();
  if (value.length === 0 || value.length > 32) return { ok: false, reason: 'length' };
  if (!/^[A-Z0-9/]+$/.test(value)) return { ok: false, reason: 'charset' };

  if (value.includes('/')) {
    return /^[A-Z0-9]{2,20}\/[A-Z0-9]{2,10}$/.test(value)
      ? { ok: true, value }
      : { ok: false, reason: 'pair shape' };
  }
  if (value.endsWith(QUOTE) && value.length > QUOTE.length) {
    return { ok: true, value: `${value.slice(0, -QUOTE.length)}/${QUOTE}` };
  }
  return /^[A-Z0-9]{2,20}$/.test(value)
    ? { ok: true, value: `${value}/${QUOTE}` }
    : { ok: false, reason: 'symbol shape' };
}

/** Целое число из query-параметра в заданных границах. */
function parseBoundedInt(raw, { min, max, fallback }) {
  if (raw === undefined || raw === null || raw === '') return { ok: true, value: fallback };
  if (!/^\d+$/.test(String(raw).trim())) return { ok: false, reason: 'not an integer' };
  const n = Number(String(raw).trim());
  if (!Number.isFinite(n) || n < min || n > max) return { ok: false, reason: `out of range ${min}..${max}` };
  return { ok: true, value: n };
}

router.get('/', async (req, res, next) => {
  try {
    const { strategy, status, symbol, direction, limit, offset, open } = req.query;

    if (status !== undefined && !SIGNAL_STATUSES.includes(String(status))) {
      return res.status(400).json({
        error: 'INVALID_STATUS',
        message: `status must be one of: ${SIGNAL_STATUSES.join(', ')}`,
      });
    }

    if (strategy !== undefined && strategy !== '' && !isKnownStrategyId(String(strategy))) {
      // Раньше неизвестная стратегия молча давала пустой список: «нет сигналов»
      // вместо «нет такой стратегии».
      return res.status(400).json({
        error: 'INVALID_STRATEGY',
        message: `strategy must be one of: ${[...KNOWN_STRATEGY_IDS].join(', ')}`,
      });
    }

    if (direction !== undefined && direction !== '' && !DIRECTIONS.has(String(direction).toUpperCase())) {
      return res.status(400).json({
        error: 'INVALID_DIRECTION',
        message: 'direction must be LONG or SHORT',
      });
    }

    if (open !== undefined && open !== '' && !['true', 'false'].includes(String(open))) {
      return res.status(400).json({
        error: 'INVALID_OPEN',
        message: 'open must be true (ACTIVE + FILLED) or false (terminal states)',
      });
    }

    let normalizedSymbol;
    if (symbol !== undefined && symbol !== '') {
      const parsed = normalizeSymbolParam(symbol);
      if (!parsed.ok) {
        return res.status(400).json({
          error: 'INVALID_SYMBOL',
          message: `symbol must look like 'BTC/USDT' or 'BTCUSDT' (${parsed.reason})`,
        });
      }
      normalizedSymbol = parsed.value;
    }

    const parsedLimit = parseBoundedInt(limit, {
      min: 1, max: MAX_SIGNALS_LIMIT, fallback: DEFAULT_SIGNALS_LIMIT,
    });
    if (!parsedLimit.ok) {
      return res.status(400).json({
        error: 'INVALID_LIMIT',
        message: `limit ${parsedLimit.reason} (max ${MAX_SIGNALS_LIMIT})`,
      });
    }
    const parsedOffset = parseBoundedInt(offset, { min: 0, max: MAX_SIGNALS_OFFSET, fallback: 0 });
    if (!parsedOffset.ok) {
      return res.status(400).json({
        error: 'INVALID_OFFSET',
        message: `offset ${parsedOffset.reason} (max ${MAX_SIGNALS_OFFSET})`,
      });
    }

    const filters = {
      strategyId: typeof strategy === 'string' && strategy ? strategy : undefined,
      status: typeof status === 'string' && status ? status : undefined,
      // «Открытые» = ACTIVE + FILLED (тот же смысл, что у ledger.getActiveSetups()),
      // «закрытые» = терминальные состояния.
      statuses:
        open === 'true' ? [...OPEN_SIGNAL_STATUSES] : open === 'false' ? [...CLOSED_SIGNAL_STATUSES] : undefined,
      symbol: normalizedSymbol,
      direction:
        typeof direction === 'string' && direction ? String(direction).toUpperCase() : undefined,
    };

    const [signals, total] = await Promise.all([
      listSignals({ ...filters, limit: parsedLimit.value, offset: parsedOffset.value }),
      countSignals(filters),
    ]);

    res.json({
      signals,
      count: signals.length,
      total,
      limit: parsedLimit.value,
      offset: parsedOffset.value,
      maxLimit: MAX_SIGNALS_LIMIT,
      ordering: 'created_at_desc',
      appliedFilters: {
        strategyId: filters.strategyId ?? null,
        status: filters.status ?? null,
        open: open === 'true' ? true : open === 'false' ? false : null,
        symbol: filters.symbol ?? null,
        direction: filters.direction ?? null,
      },
      // Домен состояний — из репозитория (единый источник), а не из UI.
      statuses: [...SIGNAL_STATUSES],
      openStatuses: [...OPEN_SIGNAL_STATUSES],
      source: 'server',
    });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/signals/statistics — агрегаты по СОХРАНЁННОМУ жизненному циклу.
 *
 * Источник — таблица `signals` (PostgreSQL), не журнал браузера. Поэтому
 * статистика одинакова для всех пользователей и переживает рестарты.
 * «Опубликовано» и «совершилась сделка» считаются раздельно: сигнал без входа
 * не попадает в знаменатель win rate (подробнее в `definitions` ответа).
 *
 * Query: `strategyId`, `symbol`, `period` (all|24h|7d|30d|90d).
 */
router.get('/statistics', async (req, res, next) => {
  try {
    if (typeof req.query.strategyId === 'string' && req.query.strategyId) {
      if (!isKnownStrategyId(req.query.strategyId)) {
        return res.status(400).json({
          error: 'Unknown strategyId',
          knownStrategyIds: [...KNOWN_STRATEGY_IDS],
        });
      }
    }
    const period = req.query.period === undefined ? 'all' : String(req.query.period);
    if (!STATISTICS_PERIODS.includes(period)) {
      return res.status(400).json({ error: 'Unknown period', allowedPeriods: [...STATISTICS_PERIODS] });
    }
    const symbol =
      typeof req.query.symbol === 'string' && req.query.symbol
        ? normalizeSymbolParam(req.query.symbol)
        : { ok: true, value: undefined };
    if (!symbol.ok) {
      return res.status(400).json({ error: 'Invalid symbol', reason: symbol.reason });
    }

    const stats = await getSignalStatistics({
      strategyId: typeof req.query.strategyId === 'string' ? req.query.strategyId : undefined,
      symbol: symbol.value,
      period,
    });
    res.json(stats);
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/signals/monitor — состояние серверного монитора открытых сигналов.
 *
 * Нужен UI, чтобы отличить «сигналы отслеживаются» от «монитор не работает».
 * Эндпоинт только читает: сменить состояние монитора через него нельзя.
 */
router.get('/monitor', async (req, res, next) => {
  try {
    res.json(signalMonitorStatus());
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/signals/:id — один серверный сигнал по `signals.id`.
 *
 * Нужен deep-link'у: уведомление колокольчика открывает
 * `/signals?symbol=RUNE&signal=<id>`, а сигнал может быть за пределами первой
 * страницы ленты. Догрузка страниц «пока не найдётся» — неограниченное число
 * запросов; точечное чтение — один SELECT по первичному ключу.
 *
 * Отличия от ленты сознательные:
 *  • карантинные строки тоже возвращаются (`provenanceStatus` — как в БД):
 *    если пользователь открыл уведомление/ссылку, он обязан увидеть честный
 *    статус происхождения, а не «сигнал не найден»;
 *  • форма id проверяется до БД: 400 `INVALID_ID` (а не 500 от постгреса и не
 *    пустой ответ), 404 `SIGNAL_NOT_FOUND` — если строки нет;
 *  • ничего не вычисляется и не подставляется: тот же `SignalDto`, что в ленте.
 */
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!isSignalIdShape(id)) {
      return res.status(400).json({
        error: 'INVALID_ID',
        message: "id must be a signal UUID (as returned in the 'signals' feed)",
      });
    }
    const signal = await getSignalById(id);
    if (!signal) {
      return res.status(404).json({ error: 'SIGNAL_NOT_FOUND', message: 'Signal not found' });
    }
    res.json({ signal, source: 'server' });
  } catch (e) {
    next(e);
  }
});

export default router;

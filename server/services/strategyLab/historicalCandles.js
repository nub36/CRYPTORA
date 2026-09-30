/**
 * CRYPTORA — Strategy Lab · исторические свечи (RESEARCH ONLY, изолированно)
 * ---------------------------------------------------------------------------
 * ОТДЕЛЬНЫЙ Lab-сервис загрузки исторических свечей. НЕ импортирует и НЕ меняет
 * production `server/services/strategyEngine/marketDataFetcher.js`.
 *
 * Источник: публичный Binance REST (spot: api.binance.com, futures: fapi).
 * Только ПУБЛИЧНЫЕ эндпоинты, без ключей и приватных методов.
 *
 * Жёсткие границы (§13):
 *   • одна пара symbol × timeframe × market за запрос;
 *   • чанки по ≤ 1000 баров, пагинация по startTime/endTime;
 *   • hard max = LAB_MAX_CANDLES (5000) ЗАКРЫТЫХ свечей;
 *   • формирующаяся (незакрытая) свеча ОТБРАСЫВАЕТСЯ (closeTime должен быть < now).
 *
 * Возвращает LabCandle[] с временем в СЕКУНДАХ (time = openTime/1000,
 * closeTime = closeTime/1000), отсортированные по возрастанию, без дублей.
 */

const BINANCE_SPOT = 'https://api.binance.com/api/v3/klines';
const BINANCE_FUTURES = 'https://fapi.binance.com/fapi/v1/klines';
const BINANCE_MAX_KLINES = 1000;
const REQUEST_TIMEOUT_MS = 12_000;

/** Lab timeframe → Binance interval. `1d` строчными (у Binance `1M` — месяц!). */
const INTERVAL_BY_TIMEFRAME = Object.freeze({
  '1m': '1m',
  '5m': '5m',
  '15m': '15m',
  '1h': '1h',
  '4h': '4h',
  '1d': '1d',
});

const TF_MS = Object.freeze({
  '1m': 60_000,
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '1h': 60 * 60_000,
  '4h': 4 * 60 * 60_000,
  '1d': 24 * 60 * 60_000,
});

export const LAB_MAX_CANDLES = 5000;

export class LabHistoricalError extends Error {
  constructor(message, code = 'LAB_HISTORICAL_ERROR') {
    super(message);
    this.name = 'LabHistoricalError';
    this.code = code;
  }
}

function endpointFor(market) {
  return market === 'futures' ? BINANCE_FUTURES : BINANCE_SPOT;
}

/**
 * @param {{
 *   market: 'spot'|'futures', symbol: string, timeframe: keyof typeof TF_MS,
 *   fromMs: number, toMs: number,
 * }} params
 * @param {{ fetchFn?: typeof fetch, nowMs?: number, maxCandles?: number, timeoutMs?: number }} [options]
 * @returns {Promise<Array<{time:number,open:number,high:number,low:number,close:number,volume:number,closeTime:number}>>}
 */
export async function fetchLabCandles(params, options = {}) {
  const { market, symbol, timeframe, fromMs, toMs } = params;
  const fetchFn = options.fetchFn ?? globalThis.fetch;
  const nowMs = options.nowMs ?? Date.now();
  const maxCandles = options.maxCandles ?? LAB_MAX_CANDLES;
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;

  const interval = INTERVAL_BY_TIMEFRAME[timeframe];
  const spanMs = TF_MS[timeframe];
  if (!interval || !spanMs) {
    throw new LabHistoricalError(`Unsupported timeframe: ${timeframe}`, 'BAD_TIMEFRAME');
  }
  if (!(fromMs < toMs)) {
    throw new LabHistoricalError('`from` must be strictly before `to`', 'BAD_RANGE');
  }

  // Верхняя граница запроса — не в будущем (у нас нет будущих закрытых свечей).
  const effectiveTo = Math.min(toMs, nowMs);
  if (!(fromMs < effectiveTo)) {
    return [];
  }

  // Оценка числа баров ДО запросов: жёсткий отказ, если диапазон превышает потолок.
  const estimatedBars = Math.ceil((effectiveTo - fromMs) / spanMs);
  if (estimatedBars > maxCandles) {
    throw new LabHistoricalError(
      `Диапазон требует ~${estimatedBars} свечей, максимум ${maxCandles}. Сузьте период или увеличьте таймфрейм.`,
      'RANGE_TOO_LARGE'
    );
  }

  const url = endpointFor(market);
  const bySeconds = new Map(); // openTimeSec → candle (дедуп)
  let cursor = fromMs;

  // Пагинация чанками по BINANCE_MAX_KLINES. Ограничение числа чанков —
  // страховка (потолок баров уже проверен выше).
  const maxChunks = Math.ceil(maxCandles / BINANCE_MAX_KLINES) + 2;
  for (let chunk = 0; chunk < maxChunks; chunk++) {
    if (cursor >= effectiveTo) break;

    const qs = new URLSearchParams({
      symbol,
      interval,
      startTime: String(cursor),
      endTime: String(effectiveTo),
      limit: String(BINANCE_MAX_KLINES),
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let rows;
    try {
      const res = await fetchFn(`${url}?${qs.toString()}`, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) {
        throw new LabHistoricalError(
          `Binance ответил ${res.status} для ${symbol} ${interval}`,
          'UPSTREAM_ERROR'
        );
      }
      rows = await res.json();
    } catch (err) {
      if (err instanceof LabHistoricalError) throw err;
      if (err && err.name === 'AbortError') {
        throw new LabHistoricalError('Таймаут запроса свечей у биржи', 'UPSTREAM_TIMEOUT');
      }
      throw new LabHistoricalError(
        `Ошибка запроса свечей: ${err instanceof Error ? err.message : String(err)}`,
        'UPSTREAM_ERROR'
      );
    } finally {
      clearTimeout(timer);
    }

    if (!Array.isArray(rows) || rows.length === 0) break;

    let lastOpen = cursor;
    for (const k of rows) {
      // Binance kline: [openTime, open, high, low, close, volume, closeTime, ...]
      const openTime = Number(k[0]);
      const closeTime = Number(k[6]);
      lastOpen = openTime;
      // ОТБРОС формирующейся свечи: включаем только закрытые (closeTime < now).
      if (!(closeTime < nowMs)) continue;
      if (closeTime > effectiveTo) continue;
      const openSec = Math.floor(openTime / 1000);
      if (bySeconds.has(openSec)) continue;
      bySeconds.set(openSec, {
        time: openSec,
        open: Number(k[1]),
        high: Number(k[2]),
        low: Number(k[3]),
        close: Number(k[4]),
        volume: Number(k[5]),
        closeTime: Math.floor(closeTime / 1000),
      });
      if (bySeconds.size >= maxCandles) break;
    }

    if (bySeconds.size >= maxCandles) break;
    if (rows.length < BINANCE_MAX_KLINES) break; // страница неполная → данные закончились

    // Следующий чанк начинается сразу после последнего полученного openTime.
    const next = lastOpen + spanMs;
    if (next <= cursor) break; // защита от зацикливания
    cursor = next;
  }

  const candles = [...bySeconds.values()].sort((a, b) => a.time - b.time);
  return candles.slice(0, maxCandles);
}

import { spotUniversePayload, futuresUniversePayload } from './exchangeUniverse.js';
import { assetMetadataPayload } from './assetMetadata.js';
import { futuresMarketSnapshotPayload } from './futuresMarketData.js';
import { getHealthTelemetry } from './health/telemetry.js';

const BINANCE_SPOT = 'https://api.binance.com';
const BINANCE_FUTURES = 'https://fapi.binance.com';
const KUCOIN_SPOT = 'https://api.kucoin.com';

const SYMBOL_RE = /^[A-Z0-9]{2,25}$/;
const BINANCE_INTERVALS = new Set(['1s', '1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w', '1M']);
const KUCOIN_CANDLE_TYPES = new Set(['1min', '3min', '5min', '15min', '30min', '1hour', '2hour', '4hour', '6hour', '8hour', '12hour', '1day', '1week']);
const FUTURES_PERIODS = new Set(['5m', '15m', '30m', '1h', '2h', '4h', '6h', '12h', '1d']);
/** Разрешённая сетка глубины стакана USD-M (`GET /fapi/v1/depth`, вес 2…20). */
const FUTURES_DEPTH_LIMITS = new Set(['5', '10', '20', '50', '100', '500', '1000']);
const MAX_LIMIT = 1000;

/**
 * Какой наблюдаемый поток свежести соответствует проксируемому маршруту.
 * Пустое значение = маршрут в контракт свежести не входит (справочники,
 * exchangeInfo и т.п.: у них своя TTL-логика и они не используются как
 * «актуальная цена»).
 */
const FRESHNESS_FEED_BY_ROUTE = Object.freeze({
  '/binance/spot/api/v3/klines': 'binance-spot-candles',
  '/binance/spot/api/v3/ticker/24hr': 'binance-spot-ticker',
  '/binance/futures/fapi/v1/klines': 'binance-futures-snapshot',
  '/binance/futures/fapi/v1/ticker/24hr': 'binance-futures-snapshot',
  '/binance/futures/fapi/v1/premiumIndex': 'binance-futures-funding',
  '/binance/futures/fapi/v1/openInterest': 'binance-futures-open-interest',
  '/binance/futures/futures/data/openInterestHist': 'binance-futures-open-interest',
  '/kucoin/spot/api/v1/market/candles': 'kucoin-spot-candles',
  '/kucoin/spot/api/v1/market/stats': 'kucoin-spot-candles',
  '/kucoin/spot/api/v1/market/allTickers': 'kucoin-spot-candles',
});

/**
 * Время ИСТОЧНИКА из ответа биржи.
 *
 * Разные эндпоинты сообщают его по-разному, и «когда пришёл HTTP-ответ» в
 * качестве источника не годится: именно подмена источника временем приёма
 * превращает трёхчасовую свечу в «свежие данные». Если источник прочитать
 * не удалось — возвращается null, и health опирается только на возраст
 * приёма (это честнее выдуманного timestamp).
 */
export function extractSourceTimestampMs(routePath, body) {
  try {
    if (routePath.endsWith('/klines') && Array.isArray(body) && body.length > 0) {
      const last = body[body.length - 1];
      const closeTime = Number(Array.isArray(last) ? last[6] : NaN);
      return Number.isFinite(closeTime) ? closeTime : null;
    }
    if (routePath === '/kucoin/spot/api/v1/market/candles') {
      const rows = Array.isArray(body?.data) ? body.data : null;
      const openSeconds = rows && rows.length > 0 ? Number(rows[0][0]) : NaN;
      return Number.isFinite(openSeconds) ? openSeconds * 1000 : null;
    }
    if (routePath.startsWith('/kucoin/')) {
      const time = Number(body?.data?.time);
      return Number.isFinite(time) ? time : null;
    }
    if (routePath === '/binance/futures/fapi/v1/openInterest') {
      const time = Number(body?.time);
      return Number.isFinite(time) ? time : null;
    }
    if (routePath === '/binance/futures/fapi/v1/premiumIndex') {
      const first = Array.isArray(body) ? body[0] : body;
      const time = Number(first?.time);
      return Number.isFinite(time) ? time : null;
    }
    if (routePath.endsWith('/ticker/24hr')) {
      const first = Array.isArray(body) ? body[0] : body;
      const time = Number(first?.closeTime);
      return Number.isFinite(time) ? time : null;
    }
  } catch {
    return null;
  }
  return null;
}
const REQUEST_TIMEOUT_MS = 8_000;

function parseBoundedInteger(value, { min = 1, max = MAX_LIMIT } = {}) {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

function buildQuery(params, allowed, validators) {
  const result = new URLSearchParams();
  for (const key of params.keys()) {
    if (!allowed.includes(key) || params.getAll(key).length !== 1) return null;
  }
  for (const key of allowed) {
    const value = params.get(key);
    if (value === null) continue;
    const normalized = validators[key]?.(value);
    if (normalized === null || normalized === undefined) return null;
    result.set(key, String(normalized));
  }
  return result;
}

const symbol = (value) => SYMBOL_RE.test(value) ? value : null;
const kucoinSymbol = (value) => /^[A-Z0-9]{2,20}-[A-Z0-9]{2,20}$/.test(value) ? value : null;
const integer = (min, max) => (value) => parseBoundedInteger(value, { min, max });
const oneOf = (values) => (value) => values.has(value) ? value : null;

/**
 * Explicit public market-data allowlist. The browser cannot choose an upstream
 * host, HTTP method, or arbitrary path; each route maps to one fixed exchange host.
 */
const ROUTES = new Map([
  ['/binance/spot/api/v3/ticker/24hr', {
    origin: BINANCE_SPOT, path: '/api/v3/ticker/24hr', optional: ['symbol'], validators: { symbol },
  }],
  ['/binance/spot/api/v3/klines', {
    origin: BINANCE_SPOT, path: '/api/v3/klines', required: ['symbol', 'interval', 'limit'],
    validators: { symbol, interval: oneOf(BINANCE_INTERVALS), limit: integer(1, MAX_LIMIT) },
  }],
  ['/kucoin/spot/api/v1/market/stats', {
    origin: KUCOIN_SPOT, path: '/api/v1/market/stats', required: ['symbol'], validators: { symbol: kucoinSymbol },
  }],
  ['/kucoin/spot/api/v1/market/allTickers', {
    origin: KUCOIN_SPOT, path: '/api/v1/market/allTickers',
  }],
  ['/kucoin/spot/api/v1/market/candles', {
    origin: KUCOIN_SPOT, path: '/api/v1/market/candles', required: ['symbol', 'type'],
    optional: ['startAt', 'endAt'], validators: {
      symbol: kucoinSymbol, type: oneOf(KUCOIN_CANDLE_TYPES), startAt: integer(1, 4_102_444_800), endAt: integer(1, 4_102_444_800),
    },
  }],
  ['/binance/futures/fapi/v1/exchangeInfo', {
    origin: BINANCE_FUTURES, path: '/fapi/v1/exchangeInfo',
  }],
  ['/binance/futures/fapi/v1/premiumIndex', {
    origin: BINANCE_FUTURES, path: '/fapi/v1/premiumIndex', optional: ['symbol'], validators: { symbol },
  }],
  ['/binance/futures/fapi/v1/openInterest', {
    origin: BINANCE_FUTURES, path: '/fapi/v1/openInterest', required: ['symbol'], validators: { symbol },
  }],
  ['/binance/futures/fapi/v1/ticker/24hr', {
    origin: BINANCE_FUTURES, path: '/fapi/v1/ticker/24hr', optional: ['symbol'], validators: { symbol },
  }],
  /**
   * USD-M klines. Separate fixed upstream path from the Spot kline route:
   * a Futures chart must never be served Spot candles (task §5 / RC-6).
   */
  ['/binance/futures/fapi/v1/klines', {
    origin: BINANCE_FUTURES, path: '/fapi/v1/klines', required: ['symbol', 'interval', 'limit'],
    validators: { symbol, interval: oneOf(BINANCE_INTERVALS), limit: integer(1, MAX_LIMIT) },
  }],
  /**
   * USD-M order book (задача §4). Отдельный фиксированный upstream-путь:
   * стакан фьючерса берётся ТОЛЬКО с `fapi.binance.com/fapi/v1/depth` и
   * никогда со спотового `/api/v3/depth` — это разные книги заявок
   * с разной ликвидностью, подмена была бы фальсификацией рынка.
   *
   * `limit` ограничен сеткой Binance (5/10/20/50/100/500/1000): произвольное
   * число биржа отвергает, а вес запроса растёт с глубиной (2…20),
   * поэтому UI использует 50 уровней.
   */
  ['/binance/futures/fapi/v1/depth', {
    origin: BINANCE_FUTURES, path: '/fapi/v1/depth', required: ['symbol'], optional: ['limit'],
    validators: { symbol, limit: oneOf(FUTURES_DEPTH_LIMITS) },
  }],
  ['/binance/futures/futures/data/openInterestHist', {
    origin: BINANCE_FUTURES, path: '/futures/data/openInterestHist', required: ['symbol', 'period', 'limit'],
    validators: { symbol, period: oneOf(FUTURES_PERIODS), limit: integer(1, 500) },
  }],
]);

/**
 * Server-computed, cached catalog endpoints. The browser gets a compact list
 * instead of downloading multi-MB exchangeInfo itself; upstream is hit at most
 * once per cache TTL regardless of the number of clients.
 */
const COMPUTED_ROUTES = new Map([
  ['/universe/spot', { handler: spotUniversePayload, cacheSeconds: 300 }],
  ['/universe/futures', { handler: futuresUniversePayload, cacheSeconds: 300 }],
  ['/metadata/assets', { handler: assetMetadataPayload, cacheSeconds: 3600 }],
  /**
   * Aggregated USD-M snapshot (RC-1): price/funding/basis/volume/change for
   * every active perpetual plus the server-swept per-symbol open interest.
   * One browser request per poll replaces the previous N+1 OI storm.
   */
  ['/derivatives/futures', { handler: futuresMarketSnapshotPayload, cacheSeconds: 10 }],
]);

/**
 * Proxies one allowlisted GET request to a fixed public exchange endpoint.
 * Returns JSON rather than exposing a generic proxy. No cookies or credentials
 * are forwarded, and cache/memory use is bounded to the request lifetime.
 *
 * @param {string} routePath path below /api/market
 * @param {URLSearchParams} query
 * @param {{ fetchFn?: typeof fetch, timeoutMs?: number }} [options]
 * @returns {Promise<{status: number, body: unknown, cacheSeconds?: number}>}
 */
export async function requestMarketData(routePath, query, options = {}) {
  if (typeof routePath !== 'string' || routePath.length > 180 || routePath.includes('..')) {
    return { status: 404, body: { error: 'Unknown market-data endpoint' } };
  }
  const computed = COMPUTED_ROUTES.get(routePath);
  if (computed) {
    if (!(query instanceof URLSearchParams) || [...query.keys()].length > 0) {
      return { status: 400, body: { error: 'Invalid market-data query' } };
    }
    try {
      return { status: 200, body: await computed.handler(), cacheSeconds: computed.cacheSeconds };
    } catch {
      return { status: 503, body: { error: 'Exchange universe temporarily unavailable' } };
    }
  }
  const route = ROUTES.get(routePath);
  if (!route) return { status: 404, body: { error: 'Unknown market-data endpoint' } };
  if (!(query instanceof URLSearchParams)) return { status: 400, body: { error: 'Invalid query' } };

  const allowed = [...(route.required ?? []), ...(route.optional ?? [])];
  const safeQuery = buildQuery(query, allowed, route.validators ?? {});
  if (!safeQuery || (route.required ?? []).some((key) => !safeQuery.has(key))) {
    return { status: 400, body: { error: 'Invalid market-data query' } };
  }

  const upstreamUrl = `${route.origin}${route.path}${safeQuery.size ? `?${safeQuery}` : ''}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? REQUEST_TIMEOUT_MS);
  try {
    const fetchFn = options.fetchFn ?? globalThis.fetch;
    const response = await fetchFn(upstreamUrl, {
      method: 'GET',
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    let body;
    try {
      body = await response.json();
    } catch {
      return { status: 502, body: { error: 'Exchange returned invalid JSON' } };
    }
    recordGatewayFreshness(routePath, safeQuery, body, response.ok);
    return { status: response.status, body, cacheSeconds: response.ok ? 2 : 0 };
  } catch (error) {
    recordGatewayFreshness(routePath, safeQuery, null, false);
    if (error?.name === 'AbortError') return { status: 504, body: { error: 'Market-data source timed out' } };
    return { status: 502, body: { error: 'Market-data source unavailable' } };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Публикация свежести прокси-маршрута. Никогда не бросает: шлюз рыночных
 * данных не должен падать из-за наблюдения за самим собой.
 */
function recordGatewayFreshness(routePath, query, body, ok) {
  const feedId = FRESHNESS_FEED_BY_ROUTE[routePath];
  if (!feedId) return;
  try {
    const registry = getHealthTelemetry();
    if (!ok) {
      registry.recordMarketDataFailure(feedId, 'UPSTREAM_ERROR');
      return;
    }
    const interval = query?.get?.('interval') ?? query?.get?.('type') ?? null;
    registry.recordMarketData(feedId, {
      sourceTimestampMs: extractSourceTimestampMs(routePath, body),
      receivedAtMs: Date.now(),
      intervalSeconds: INTERVAL_SECONDS_BY_PARAM[interval] ?? 0,
    });
  } catch {
    // наблюдение не является зависимостью
  }
}

/** Длительность бара по параметру запроса (Binance interval / KuCoin type). */
const INTERVAL_SECONDS_BY_PARAM = Object.freeze({
  '1m': 60, '1min': 60, '3m': 180, '3min': 180, '5m': 300, '5min': 300,
  '15m': 900, '15min': 900, '30m': 1800, '30min': 1800,
  '1h': 3600, '1hour': 3600, '2h': 7200, '2hour': 7200, '4h': 14400, '4hour': 14400,
  '6h': 21600, '6hour': 21600, '8h': 28800, '8hour': 28800, '12h': 43200, '12hour': 43200,
  '1d': 86400, '1day': 86400, '3d': 259200, '1w': 604800, '1week': 604800,
});

export const marketDataGatewayRoutes = Object.freeze([...ROUTES.keys(), ...COMPUTED_ROUTES.keys()]);

import { spotUniversePayload, futuresUniversePayload } from './exchangeUniverse.js';
import { assetMetadataPayload } from './assetMetadata.js';

const BINANCE_SPOT = 'https://api.binance.com';
const BINANCE_FUTURES = 'https://fapi.binance.com';
const KUCOIN_SPOT = 'https://api.kucoin.com';

const SYMBOL_RE = /^[A-Z0-9]{2,25}$/;
const BINANCE_INTERVALS = new Set(['1s', '1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w', '1M']);
const KUCOIN_CANDLE_TYPES = new Set(['1min', '3min', '5min', '15min', '30min', '1hour', '2hour', '4hour', '6hour', '8hour', '12hour', '1day', '1week']);
const FUTURES_PERIODS = new Set(['5m', '15m', '30m', '1h', '2h', '4h', '6h', '12h', '1d']);
const MAX_LIMIT = 1000;
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
    return { status: response.status, body, cacheSeconds: response.ok ? 2 : 0 };
  } catch (error) {
    if (error?.name === 'AbortError') return { status: 504, body: { error: 'Market-data source timed out' } };
    return { status: 502, body: { error: 'Market-data source unavailable' } };
  } finally {
    clearTimeout(timer);
  }
}

export const marketDataGatewayRoutes = Object.freeze([...ROUTES.keys(), ...COMPUTED_ROUTES.keys()]);

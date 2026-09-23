/**
 * CRYPTORA — Authoritative exchange universe (Binance Spot + USD-M Futures).
 *
 * WHY: `/api/v3/ticker/24hr` returns thousands of HISTORICAL records (VEN,
 * XRPBULL, BCC, BCHABC, *UP/*DOWN leveraged tokens…). A ticker record is NOT
 * proof that an instrument is tradable today. The only authoritative source is
 * `exchangeInfo`:
 *   Spot:    quoteAsset === 'USDT' && status === 'TRADING' && spot trading allowed
 *   Futures: quoteAsset === 'USDT' && status === 'TRADING' (USD-M), UI shows PERPETUAL
 *
 * Counts are never hardcoded: whatever exchangeInfo says today is the universe.
 *
 * The server fetches exchangeInfo (multi-MB) at most once per TTL and serves a
 * compact list to browsers, so N clients never download exchangeInfo N times.
 */

const BINANCE_SPOT_EXCHANGE_INFO = 'https://api.binance.com/api/v3/exchangeInfo';
const BINANCE_FUTURES_EXCHANGE_INFO = 'https://fapi.binance.com/fapi/v1/exchangeInfo';

export const UNIVERSE_TTL_MS = 10 * 60_000;
/** Last good universe may be served while the exchange is unreachable, but not forever. */
export const UNIVERSE_STALE_MAX_MS = 6 * 60 * 60_000;
const REQUEST_TIMEOUT_MS = 15_000;
const BASE_RE = /^[A-Z0-9]{1,20}$/;

/**
 * Spot trading permission as exchangeInfo expresses it. Binance has used three
 * shapes over time: `isSpotTradingAllowed`, `permissions: ['SPOT', …]` and
 * `permissionSets: [['SPOT', …], …]`. An explicit `false` always wins.
 * @param {any} s
 */
export function isSpotTradingAllowed(s) {
  if (s?.isSpotTradingAllowed === false) return false;
  if (s?.isSpotTradingAllowed === true) return true;
  if (Array.isArray(s?.permissions) && s.permissions.length > 0) return s.permissions.includes('SPOT');
  if (Array.isArray(s?.permissionSets) && s.permissionSets.length > 0) {
    return s.permissionSets.some((set) => Array.isArray(set) && set.includes('SPOT'));
  }
  return false;
}

/**
 * @param {any} exchangeInfo Binance `/api/v3/exchangeInfo` body
 * @returns {Array<{symbol: string, exchangeSymbol: string, baseAsset: string}>}
 *   `symbol` is the base ticker used by CRYPTORA routes (/coin/:symbol).
 */
export function filterActiveSpotUsdt(exchangeInfo) {
  const rows = Array.isArray(exchangeInfo?.symbols) ? exchangeInfo.symbols : [];
  const seen = new Set();
  const out = [];
  for (const s of rows) {
    if (!s || typeof s !== 'object') continue;
    if (s.quoteAsset !== 'USDT' || s.status !== 'TRADING' || !isSpotTradingAllowed(s)) continue;
    const base = String(s.baseAsset ?? '').toUpperCase();
    const exchangeSymbol = String(s.symbol ?? '').toUpperCase();
    if (!BASE_RE.test(base) || exchangeSymbol !== `${base}USDT` || seen.has(base)) continue;
    seen.add(base);
    out.push({ symbol: base, exchangeSymbol, baseAsset: base });
  }
  return out.sort((a, b) => a.symbol.localeCompare(b.symbol));
}

/**
 * @param {any} exchangeInfo Binance `/fapi/v1/exchangeInfo` body
 * @returns {{
 *   activeUsdtContracts: number,
 *   perpetualCount: number,
 *   contracts: Array<{symbol: string, exchangeSymbol: string, baseAsset: string, contractType: string}>
 * }} `contracts` = active USDT-M PERPETUAL contracts (what the Futures page shows:
 *   funding/OI/basis only exist for perpetual swaps; dated quarterlies are
 *   counted but not listed).
 */
export function filterActiveUsdmFutures(exchangeInfo) {
  const rows = Array.isArray(exchangeInfo?.symbols) ? exchangeInfo.symbols : [];
  let activeUsdtContracts = 0;
  const contracts = [];
  const seen = new Set();
  for (const s of rows) {
    if (!s || typeof s !== 'object') continue;
    if (s.quoteAsset !== 'USDT' || s.status !== 'TRADING') continue;
    activeUsdtContracts++;
    if (s.contractType !== 'PERPETUAL') continue;
    const exchangeSymbol = String(s.symbol ?? '').toUpperCase();
    const base = String(s.baseAsset ?? '').toUpperCase();
    if (!BASE_RE.test(base) || !/^[A-Z0-9]{2,30}$/.test(exchangeSymbol) || seen.has(exchangeSymbol)) continue;
    seen.add(exchangeSymbol);
    contracts.push({ symbol: base, exchangeSymbol, baseAsset: base, contractType: 'PERPETUAL' });
  }
  contracts.sort((a, b) => a.exchangeSymbol.localeCompare(b.exchangeSymbol));
  return { activeUsdtContracts, perpetualCount: contracts.length, contracts };
}

/**
 * Small TTL cache with in-flight dedupe and bounded stale fallback.
 * @template T
 */
export class UniverseCache {
  /**
   * @param {{ url: string, transform: (body: any) => T, fetchFn?: typeof fetch, now?: () => number, ttlMs?: number }} opts
   */
  constructor({ url, transform, fetchFn, now, ttlMs = UNIVERSE_TTL_MS }) {
    this.url = url;
    this.transform = transform;
    this.fetchFn = fetchFn ?? ((...a) => globalThis.fetch(...a));
    this.now = now ?? (() => Date.now());
    this.ttlMs = ttlMs;
    /** @type {{ value: T, at: number } | null} */
    this.entry = null;
    /** @type {Promise<{ value: T, at: number, stale: boolean }> | null} */
    this.pending = null;
    this.upstreamRequests = 0;
  }

  /** @returns {Promise<{ value: T, at: number, stale: boolean }>} */
  async get() {
    const now = this.now();
    if (this.entry && now - this.entry.at < this.ttlMs) return { ...this.entry, stale: false };
    if (this.pending) return this.pending;
    this.pending = (async () => {
      try {
        const value = await this.fetchOnce();
        this.entry = { value, at: this.now() };
        return { ...this.entry, stale: false };
      } catch (err) {
        if (this.entry && this.now() - this.entry.at < UNIVERSE_STALE_MAX_MS) return { ...this.entry, stale: true };
        throw err;
      } finally {
        this.pending = null;
      }
    })();
    return this.pending;
  }

  async fetchOnce() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    this.upstreamRequests++;
    try {
      const res = await this.fetchFn(this.url, { method: 'GET', signal: controller.signal, headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`exchangeInfo HTTP ${res.status}`);
      const body = await res.json();
      const value = this.transform(body);
      return value;
    } finally {
      clearTimeout(timer);
    }
  }
}

let spotCache = null;
let futuresCache = null;

export function getSpotUniverseCache() {
  if (!spotCache) {
    spotCache = new UniverseCache({ url: BINANCE_SPOT_EXCHANGE_INFO, transform: (b) => {
      const list = filterActiveSpotUsdt(b);
      if (list.length === 0) throw new Error('Spot exchangeInfo returned no active USDT symbols');
      return list;
    } });
  }
  return spotCache;
}

export function getFuturesUniverseCache() {
  if (!futuresCache) {
    futuresCache = new UniverseCache({ url: BINANCE_FUTURES_EXCHANGE_INFO, transform: (b) => {
      const result = filterActiveUsdmFutures(b);
      if (result.contracts.length === 0) throw new Error('Futures exchangeInfo returned no active USDT perpetuals');
      return result;
    } });
  }
  return futuresCache;
}

/** Test seam. */
export function __resetUniverseCachesForTests(overrides = {}) {
  spotCache = overrides.spot ?? null;
  futuresCache = overrides.futures ?? null;
}

/** Compact JSON payload for `/api/market/universe/spot`. */
export async function spotUniversePayload() {
  const { value, at, stale } = await getSpotUniverseCache().get();
  return {
    source: 'binance-spot-exchangeInfo',
    filter: 'quoteAsset=USDT & status=TRADING & spot trading allowed',
    count: value.length,
    fetchedAt: new Date(at).toISOString(),
    stale,
    symbols: value,
  };
}

/** Compact JSON payload for `/api/market/universe/futures`. */
export async function futuresUniversePayload() {
  const { value, at, stale } = await getFuturesUniverseCache().get();
  return {
    source: 'binance-usdm-exchangeInfo',
    filter: 'quoteAsset=USDT & status=TRADING; listed: contractType=PERPETUAL',
    activeUsdtContracts: value.activeUsdtContracts,
    perpetualCount: value.perpetualCount,
    count: value.contracts.length,
    fetchedAt: new Date(at).toISOString(),
    stale,
    contracts: value.contracts,
  };
}

/**
 * Set of active Spot base symbols, or null when exchangeInfo is unavailable
 * (callers decide how to degrade — never by trusting historical tickers).
 * @returns {Promise<Set<string> | null>}
 */
export async function getActiveSpotBaseSet() {
  try {
    const { value } = await getSpotUniverseCache().get();
    return new Set(value.map((s) => s.symbol));
  } catch {
    return null;
  }
}

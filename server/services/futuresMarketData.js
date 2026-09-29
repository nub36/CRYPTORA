/**
 * CRYPTORA — server-side USD-M futures market snapshot.
 *
 * WHY THIS EXISTS (root cause RC-1, see docs/DIAGNOSTICS_SPOT_FUTURES_2026-09-29.md)
 * ---------------------------------------------------------------------------
 * Binance USD-M has no bulk open-interest endpoint: `/fapi/v1/openInterest`
 * and `/futures/data/openInterestHist` are per-symbol. The browser therefore
 * capped itself at 30 contracts (`FUTURES_OI_DETAIL_LIMIT`) and ~470 active
 * perpetuals rendered `—` / «Нет данных» even though upstream had the data.
 *
 * Moving the sweep here fixes both halves of the problem:
 *   - coverage: every active contract gets a real OI value;
 *   - load: ONE sweep per TTL serves every browser, with bounded concurrency,
 *     instead of N browsers × N symbols.
 *
 * Guarantees:
 *   - read-only; no database access, no writes, no scheduler;
 *   - bulk data (price/funding/basis/volume/change) is served immediately;
 *     the expensive per-symbol OI sweep is stale-while-revalidate, so a cold
 *     request never blocks on 500 upstream calls;
 *   - a metric that upstream did not return is emitted as `null`, never as 0
 *     and never estimated. Math (funding APR, basis, Δ OI) stays in
 *     DerivativesEngine on the client — this module only fetches and caches.
 */

import { getFuturesUniverseCache } from './exchangeUniverse.js';

const BINANCE_FUTURES = 'https://fapi.binance.com';

/** Bulk endpoints are cheap (weight 40/1) — a short TTL keeps the table live. */
export const BULK_TTL_MS = 15_000;
/** Per-symbol OI sweep; Binance refreshes OI roughly every few seconds, 60s is ample. */
export const OI_TTL_MS = 60_000;
/** `/futures/data/*` has its own 1000-req/5-min IP budget — one sweep per 5 min. */
export const OI_HIST_TTL_MS = 5 * 60_000;
/** Bounded parallelism so a sweep never bursts the USD-M 2400 weight/min budget. */
export const OI_CONCURRENCY = 8;
export const OI_HIST_CONCURRENCY = 4;
/**
 * Hard cap on `/futures/data/openInterestHist` calls per sweep, ranked by 24h
 * quote volume. Kept under the documented 1000-req/5-min budget with headroom
 * for the rest of the app. Contracts outside the head honestly report
 * «Нет данных» for Δ OI instead of an estimate.
 */
export const OI_HIST_MAX_SYMBOLS = 400;

const REQUEST_TIMEOUT_MS = 10_000;

function nowMs() {
  return Date.now();
}

async function getJson(fetchFn, url, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, { method: 'GET', signal: controller.signal, headers: { Accept: 'application/json' } });
    if (res.status === 429 || res.status === 418) {
      const err = new Error(`rate_limited:${res.status}`);
      err.rateLimited = true;
      throw err;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run `worker` over `items` with at most `concurrency` in flight.
 * Never rejects: each result is `{ item, value }` or `{ item, error }`.
 */
export async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const limit = Math.max(1, Math.min(concurrency, items.length || 1));
  const runners = Array.from({ length: limit }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      try {
        results[index] = { item: items[index], value: await worker(items[index], index) };
      } catch (error) {
        results[index] = { item: items[index], error };
      }
    }
  });
  await Promise.all(runners);
  return results;
}

function finite(value) {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Compact an openInterestHist series down to exactly the three samples the
 * client's Δ OI math consumes: [t-24h (or earliest), t-1h, latest].
 *
 * DerivativesEngine.calculateOpenInterestChanges reads `values[len-2]` for Δ1h
 * and `values[max(0, len-1-24)]` for Δ24h; with len === 3 those resolve to the
 * second and the first sample, so the client formula is unchanged.
 *
 * @param {Array<{symbol: string, sumOpenInterest: string, sumOpenInterestValue: string, timestamp: number}>} hist
 */
export function compactOpenInterestHistory(hist) {
  if (!Array.isArray(hist) || hist.length < 2) return null;
  const sorted = [...hist]
    .filter((h) => h && finite(h.sumOpenInterest) !== null && finite(h.sumOpenInterestValue) !== null && finite(h.timestamp) !== null)
    .sort((a, b) => a.timestamp - b.timestamp);
  if (sorted.length < 2) return null;
  const latest = sorted[sorted.length - 1];
  const prev1h = sorted[sorted.length - 2];
  const idx24 = Math.max(0, sorted.length - 1 - 24);
  const prev24h = sorted[idx24];
  const pick = (h) => ({
    symbol: String(h.symbol ?? ''),
    sumOpenInterest: String(h.sumOpenInterest),
    sumOpenInterestValue: String(h.sumOpenInterestValue),
    timestamp: Number(h.timestamp),
  });
  return [pick(prev24h), pick(prev1h), pick(latest)];
}

/**
 * Snapshot store with stale-while-revalidate semantics.
 * One instance per process; `createFuturesMarketSnapshotStore` is exported for tests.
 */
export function createFuturesMarketSnapshotStore(options = {}) {
  const fetchFn = options.fetchFn ?? ((...a) => globalThis.fetch(...a));
  const now = options.now ?? nowMs;
  const universeCache = options.universeCache ?? getFuturesUniverseCache();
  const bulkTtlMs = options.bulkTtlMs ?? BULK_TTL_MS;
  const oiTtlMs = options.oiTtlMs ?? OI_TTL_MS;
  const oiHistTtlMs = options.oiHistTtlMs ?? OI_HIST_TTL_MS;
  const oiConcurrency = options.oiConcurrency ?? OI_CONCURRENCY;
  const oiHistConcurrency = options.oiHistConcurrency ?? OI_HIST_CONCURRENCY;
  const oiHistMaxSymbols = options.oiHistMaxSymbols ?? OI_HIST_MAX_SYMBOLS;

  /** @type {{ at: number, tickers: Map<string, any>, premiums: Map<string, any> } | null} */
  let bulk = null;
  let bulkPending = null;
  /** @type {{ at: number, values: Map<string, string>, failures: number, rateLimited: boolean } | null} */
  let oi = null;
  let oiPending = null;
  /** @type {{ at: number, values: Map<string, any[]>, failures: number, rateLimited: boolean, covered: number } | null} */
  let oiHist = null;
  let oiHistPending = null;

  const stats = { bulkRequests: 0, oiRequests: 0, oiHistRequests: 0, sweeps: 0 };

  async function loadBulk() {
    const t = now();
    if (bulk && t - bulk.at < bulkTtlMs) return bulk;
    if (bulkPending) return bulkPending;
    bulkPending = (async () => {
      try {
        stats.bulkRequests += 2;
        const [tickersRaw, premiumsRaw] = await Promise.all([
          getJson(fetchFn, `${BINANCE_FUTURES}/fapi/v1/ticker/24hr`),
          getJson(fetchFn, `${BINANCE_FUTURES}/fapi/v1/premiumIndex`),
        ]);
        const tickers = new Map();
        for (const t24 of Array.isArray(tickersRaw) ? tickersRaw : []) {
          if (t24 && typeof t24.symbol === 'string') tickers.set(t24.symbol.toUpperCase(), t24);
        }
        const premiums = new Map();
        for (const p of Array.isArray(premiumsRaw) ? premiumsRaw : []) {
          if (p && typeof p.symbol === 'string') premiums.set(p.symbol.toUpperCase(), p);
        }
        if (tickers.size === 0 && premiums.size === 0) throw new Error('empty bulk futures payload');
        bulk = { at: now(), tickers, premiums };
        return bulk;
      } catch (error) {
        if (bulk) return bulk; // serve last good, marked stale by the caller
        throw error;
      } finally {
        bulkPending = null;
      }
    })();
    return bulkPending;
  }

  function sweepOpenInterest(symbols) {
    if (oiPending) return oiPending;
    oiPending = (async () => {
      stats.sweeps++;
      const values = new Map();
      let failures = 0;
      let rateLimited = false;
      const results = await mapWithConcurrency(symbols, oiConcurrency, async (symbol) => {
        stats.oiRequests++;
        return getJson(fetchFn, `${BINANCE_FUTURES}/fapi/v1/openInterest?symbol=${symbol}`);
      });
      for (const r of results) {
        if (r?.error) {
          failures++;
          if (r.error.rateLimited) rateLimited = true;
          continue;
        }
        const value = r?.value;
        if (value && typeof value.openInterest === 'string') values.set(r.item, value.openInterest);
      }
      // A sweep that returned nothing keeps the previous (still-honest) values.
      if (values.size > 0 || !oi) oi = { at: now(), values, failures, rateLimited };
      else oi = { ...oi, at: now(), failures, rateLimited };
      oiPending = null;
      return oi;
    })().catch(() => { oiPending = null; return oi; });
    return oiPending;
  }

  function sweepOpenInterestHistory(symbols) {
    if (oiHistPending) return oiHistPending;
    oiHistPending = (async () => {
      const values = new Map();
      let failures = 0;
      let rateLimited = false;
      const results = await mapWithConcurrency(symbols, oiHistConcurrency, async (symbol) => {
        stats.oiHistRequests++;
        return getJson(fetchFn, `${BINANCE_FUTURES}/futures/data/openInterestHist?symbol=${symbol}&period=1h&limit=25`);
      });
      for (const r of results) {
        if (r?.error) {
          failures++;
          if (r.error.rateLimited) rateLimited = true;
          continue;
        }
        const compact = compactOpenInterestHistory(r?.value);
        if (compact) values.set(r.item, compact);
      }
      if (values.size > 0 || !oiHist) oiHist = { at: now(), values, failures, rateLimited, covered: symbols.length };
      else oiHist = { ...oiHist, at: now(), failures, rateLimited };
      oiHistPending = null;
      return oiHist;
    })().catch(() => { oiHistPending = null; return oiHist; });
    return oiHistPending;
  }

  /**
   * @param {{ awaitOpenInterest?: boolean }} [opts] test seam: await the sweep
   *   instead of stale-while-revalidate.
   */
  async function snapshot(opts = {}) {
    const universeEntry = await universeCache.get();
    const contracts = universeEntry.value.contracts;
    const bulkEntry = await loadBulk();
    const t = now();

    const symbols = contracts.map((c) => c.exchangeSymbol);
    const oiStale = !oi || t - oi.at >= oiTtlMs;
    const oiHistStale = !oiHist || t - oiHist.at >= oiHistTtlMs;

    const histSymbols = [...symbols]
      .sort((a, b) => (finite(bulkEntry.tickers.get(b)?.quoteVolume) ?? 0) - (finite(bulkEntry.tickers.get(a)?.quoteVolume) ?? 0))
      .slice(0, oiHistMaxSymbols);

    if (oiStale) {
      const sweep = sweepOpenInterest(symbols);
      if (opts.awaitOpenInterest) await sweep;
    }
    if (oiHistStale) {
      const sweep = sweepOpenInterestHistory(histSymbols);
      if (opts.awaitOpenInterest) await sweep;
    }

    const oiValues = oi?.values ?? new Map();
    const oiHistValues = oiHist?.values ?? new Map();

    let withPrice = 0;
    let withChange24h = 0;
    let withVolume = 0;
    let withFunding = 0;
    let withOpenInterest = 0;
    let withOpenInterestDelta = 0;
    let withoutPremium = 0;
    let withoutTicker = 0;

    const rows = contracts.map((contract) => {
      const key = contract.exchangeSymbol;
      const premium = bulkEntry.premiums.get(key) ?? null;
      const ticker = bulkEntry.tickers.get(key) ?? null;
      if (!premium) withoutPremium++;
      if (!ticker) withoutTicker++;

      const markPrice = premium ? finite(premium.markPrice) : null;
      const indexPrice = premium ? finite(premium.indexPrice) : null;
      const lastFundingRate = premium && premium.lastFundingRate !== '' ? finite(premium.lastFundingRate) : null;
      const lastPrice = ticker ? finite(ticker.lastPrice) : null;
      const priceChangePercent = ticker ? finite(ticker.priceChangePercent) : null;
      const quoteVolume = ticker ? finite(ticker.quoteVolume) : null;
      // 24h high/low ПЕРПЕТУАЛА (`/fapi/v1/ticker/24hr`), не спота: блок
      // «Рыночная статистика» на /futures/:symbol показывает именно их.
      const highPrice = ticker ? finite(ticker.highPrice) : null;
      const lowPrice = ticker ? finite(ticker.lowPrice) : null;
      const openInterest = oiValues.has(key) ? oiValues.get(key) : null;
      const openInterestHist = oiHistValues.get(key) ?? null;

      if (markPrice !== null || lastPrice !== null) withPrice++;
      if (priceChangePercent !== null) withChange24h++;
      if (quoteVolume !== null) withVolume++;
      if (lastFundingRate !== null) withFunding++;
      if (openInterest !== null) withOpenInterest++;
      if (openInterestHist) withOpenInterestDelta++;

      return {
        contractSymbol: key,
        baseAsset: contract.baseAsset,
        contractType: contract.contractType,
        markPrice: markPrice === null ? null : String(premium.markPrice),
        indexPrice: indexPrice === null ? null : String(premium.indexPrice),
        lastFundingRate: lastFundingRate === null ? null : String(premium.lastFundingRate),
        nextFundingTime: premium ? Number(premium.nextFundingTime ?? 0) : null,
        premiumTime: premium ? Number(premium.time ?? 0) : null,
        lastPrice: lastPrice === null ? null : String(ticker.lastPrice),
        priceChangePercent: priceChangePercent === null ? null : String(ticker.priceChangePercent),
        quoteVolume: quoteVolume === null ? null : String(ticker.quoteVolume),
        highPrice: highPrice === null ? null : String(ticker.highPrice),
        lowPrice: lowPrice === null ? null : String(ticker.lowPrice),
        baseVolume: ticker && finite(ticker.volume) !== null ? String(ticker.volume) : null,
        openInterest,
        openInterestHist,
      };
    });

    return {
      source: 'binance-usdm',
      filter: 'quoteAsset=USDT & status=TRADING & contractType=PERPETUAL',
      fetchedAt: new Date(bulkEntry.at).toISOString(),
      universeFetchedAt: new Date(universeEntry.at).toISOString(),
      stale: Boolean(universeEntry.stale) || t - bulkEntry.at >= bulkTtlMs,
      activeUsdtContracts: universeEntry.value.activeUsdtContracts,
      perpetualCount: universeEntry.value.perpetualCount,
      coverage: {
        contracts: rows.length,
        withPrice,
        withChange24h,
        withVolume,
        withFunding,
        withOpenInterest,
        withOpenInterestDelta,
        withoutPremium,
        withoutTicker,
        openInterestSweptAt: oi ? new Date(oi.at).toISOString() : null,
        openInterestFailures: oi?.failures ?? null,
        openInterestRateLimited: Boolean(oi?.rateLimited),
        openInterestHistSweptAt: oiHist ? new Date(oiHist.at).toISOString() : null,
        openInterestHistCovered: oiHist?.covered ?? 0,
        openInterestHistFailures: oiHist?.failures ?? null,
        openInterestHistRateLimited: Boolean(oiHist?.rateLimited),
      },
      rows,
    };
  }

  return {
    snapshot,
    stats,
    reset() {
      bulk = null; bulkPending = null;
      oi = null; oiPending = null;
      oiHist = null; oiHistPending = null;
    },
  };
}

let defaultStore = null;

export function getFuturesMarketSnapshotStore() {
  if (!defaultStore) defaultStore = createFuturesMarketSnapshotStore();
  return defaultStore;
}

/** Test seam. */
export function __resetFuturesMarketStoreForTests(store = null) {
  defaultStore = store;
}

/** Payload handler for `GET /api/market/derivatives/futures`. */
export async function futuresMarketSnapshotPayload() {
  return getFuturesMarketSnapshotStore().snapshot();
}

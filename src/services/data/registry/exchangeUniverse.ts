/**
 * Client view of the authoritative exchange universe.
 *
 * The server derives it from Binance `exchangeInfo` (see
 * server/services/exchangeUniverse.js) and serves a compact cached list:
 *   GET /api/market/universe/spot     — active Spot USDT instruments
 *   GET /api/market/universe/futures  — active USD-M USDT perpetuals
 *
 * The browser makes at most one request per list per TTL (shared promise), so
 * any number of components can ask for the universe without a request storm.
 * Counts are never hardcoded: whatever exchangeInfo says is the universe.
 */

import { CANONICAL_ASSETS } from './assetRegistry';

export interface SpotUniverseSymbol {
  symbol: string;
  exchangeSymbol: string;
  baseAsset: string;
}

export interface SpotUniverse {
  count: number;
  symbols: SpotUniverseSymbol[];
  fetchedAt: string;
  stale: boolean;
}

export interface FuturesUniverseContract {
  symbol: string;
  exchangeSymbol: string;
  baseAsset: string;
  contractType: 'PERPETUAL';
}

export interface FuturesUniverse {
  activeUsdtContracts: number;
  perpetualCount: number;
  count: number;
  contracts: FuturesUniverseContract[];
  fetchedAt: string;
  stale: boolean;
}

const TTL_MS = 5 * 60_000;
const FAILURE_BACKOFF_MS = 60_000;
const BASE_RE = /^[A-Z0-9]{1,20}$/;

type Loader<T> = { value: T | null; at: number; failedAt: number | null; pending: Promise<T | null> | null };

const spotState: Loader<SpotUniverse> = { value: null, at: 0, failedAt: null, pending: null };
const futuresState: Loader<FuturesUniverse> = { value: null, at: 0, failedAt: null, pending: null };

function parseSpot(body: unknown): SpotUniverse | null {
  const b = body as Partial<SpotUniverse> | null;
  if (!b || !Array.isArray(b.symbols)) return null;
  const symbols = b.symbols.filter(
    (s): s is SpotUniverseSymbol => !!s && typeof s.symbol === 'string' && BASE_RE.test(s.symbol) && typeof s.exchangeSymbol === 'string',
  );
  if (symbols.length === 0) return null;
  return { count: symbols.length, symbols, fetchedAt: String(b.fetchedAt ?? ''), stale: Boolean(b.stale) };
}

function parseFutures(body: unknown): FuturesUniverse | null {
  const b = body as Partial<FuturesUniverse> | null;
  if (!b || !Array.isArray(b.contracts)) return null;
  const contracts = b.contracts.filter(
    (c): c is FuturesUniverseContract => !!c && typeof c.exchangeSymbol === 'string' && typeof c.symbol === 'string' && BASE_RE.test(c.symbol),
  );
  if (contracts.length === 0) return null;
  return {
    activeUsdtContracts: Number(b.activeUsdtContracts ?? contracts.length),
    perpetualCount: Number(b.perpetualCount ?? contracts.length),
    count: contracts.length,
    contracts,
    fetchedAt: String(b.fetchedAt ?? ''),
    stale: Boolean(b.stale),
  };
}

function load<T>(
  state: Loader<T>,
  url: string,
  parse: (body: unknown) => T | null,
  fetchFn: typeof fetch,
): Promise<T | null> {
  const now = Date.now();
  if (state.value && now - state.at < TTL_MS) return Promise.resolve(state.value);
  if (!state.value && state.failedAt !== null && now - state.failedAt < FAILURE_BACKOFF_MS) return Promise.resolve(null);
  if (state.pending) return state.pending;
  state.pending = (async () => {
    try {
      const res = await fetchFn(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const parsed = parse(await res.json());
      if (!parsed) throw new Error('empty universe');
      state.value = parsed;
      state.at = Date.now();
      return parsed;
    } catch {
      state.failedAt = Date.now();
      return state.value; // last good value (possibly null)
    } finally {
      state.pending = null;
    }
  })();
  return state.pending;
}

const defaultFetch: typeof fetch = (...args) => globalThis.fetch(...args);

/** Active Spot USDT universe, or null if the server/exchange is unavailable. */
export function getSpotUniverse(fetchFn: typeof fetch = defaultFetch): Promise<SpotUniverse | null> {
  return load(spotState, '/api/market/universe/spot', parseSpot, fetchFn);
}

/** Active USD-M USDT perpetual universe, or null if unavailable. */
export function getFuturesUniverse(fetchFn: typeof fetch = defaultFetch): Promise<FuturesUniverse | null> {
  return load(futuresState, '/api/market/universe/futures', parseFutures, fetchFn);
}

/** Set of active Spot base tickers, or null when unknown. */
export async function getActiveSpotBaseSet(fetchFn?: typeof fetch): Promise<Set<string> | null> {
  const u = await getSpotUniverse(fetchFn);
  return u ? new Set(u.symbols.map((s) => s.symbol)) : null;
}

/**
 * Base tickers for selectors: full active Spot universe when known; the
 * canonical catalog only as a degraded fallback when the universe is unknown.
 */
export async function getSelectableSpotSymbols(fetchFn?: typeof fetch): Promise<{ symbols: string[]; authoritative: boolean }> {
  const u = await getSpotUniverse(fetchFn);
  if (u) return { symbols: u.symbols.map((s) => s.symbol), authoritative: true };
  return { symbols: CANONICAL_ASSETS.map((a) => a.symbol), authoritative: false };
}

/**
 * Futures base → Spot base for navigation. Binance lists some perps with a
 * multiplier prefix (1000PEPE, 1000000MOG, 1MBABYDOGE). Returns null when no
 * matching active Spot instrument exists (the row is then not navigable).
 */
export function futuresBaseToSpot(futuresBase: string, spotSet: ReadonlySet<string> | null): string | null {
  const base = futuresBase.toUpperCase();
  if (!spotSet) return base;
  if (spotSet.has(base)) return base;
  const m = base.match(/^(?:1000000|100000|10000|1000|1M)(.+)$/);
  if (m && spotSet.has(m[1]!)) return m[1]!;
  return null;
}

/** Test-only reset. */
export function resetExchangeUniverseForTests(): void {
  for (const s of [spotState, futuresState] as Loader<unknown>[]) {
    s.value = null;
    s.at = 0;
    s.failedAt = null;
    s.pending = null;
  }
}

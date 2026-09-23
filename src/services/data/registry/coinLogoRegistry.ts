/**
 * Coin logo + display-name pipeline for the whole dynamic universe.
 *
 * 1. Primary: ONE request to the server metadata cache
 *    `GET /api/market/metadata/assets` (server/services/assetMetadata.js). The
 *    server pulls CoinGecko top-1000 by market cap a few times a day and serves
 *    a compact SYMBOL → {name, logo} map to every browser from memory.
 * 2. Fallback (server endpoint unavailable, e.g. static hosting): ONE direct
 *    CoinGecko `/coins/markets` request for the top-250 by market cap, plus the
 *    canonical ids, resolved by the same rules.
 * 3. Letter avatar only when neither source knows the ticker or the image fails.
 *
 * No per-coin requests: however many icons render, the browser makes at most one
 * metadata request per TTL (shared promise). Image bytes load lazily
 * (`loading="lazy"`), and only for rows actually rendered (Market is paginated,
 * selectors cap their result lists).
 */

import { CANONICAL_ASSETS, getAssetBySymbol } from './assetRegistry';

const CACHE_TTL_MS = 60 * 60_000;
const FAILURE_RETRY_MS = 5 * 60_000;
const REQUEST_TIMEOUT_MS = 8_000;
const COINGECKO_MARKETS = 'https://api.coingecko.com/api/v3/coins/markets';

export interface CoinMetadata {
  name: string;
  logo: string;
}

type MetaMap = Map<string, CoinMetadata>;

let cached: MetaMap | null = null;
let cachedAt = 0;
let failedAt: number | null = null;
let pending: Promise<MetaMap> | null = null;
let metadataRequests = 0;

function safeHttpsUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

async function fetchJson(fetchFn: typeof fetch, url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  metadataRequests++;
  try {
    const res = await fetchFn(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fromServer(fetchFn: typeof fetch): Promise<MetaMap> {
  const body = (await fetchJson(fetchFn, '/api/market/metadata/assets')) as { assets?: Record<string, { name?: unknown; logo?: unknown }> };
  if (!body || typeof body.assets !== 'object' || body.assets === null) throw new Error('bad metadata payload');
  const map: MetaMap = new Map();
  for (const [sym, meta] of Object.entries(body.assets)) {
    const logo = safeHttpsUrl(meta?.logo);
    if (!logo || !/^[A-Z0-9]{1,20}$/.test(sym)) continue;
    map.set(sym, { name: typeof meta?.name === 'string' ? meta.name : sym, logo });
  }
  if (map.size === 0) throw new Error('empty metadata payload');
  return map;
}

async function fromCoinGeckoDirect(fetchFn: typeof fetch): Promise<MetaMap> {
  const ids = CANONICAL_ASSETS.flatMap((a) => (a.coingeckoId ? [a.coingeckoId] : []));
  const [topRows, canonicalRows] = await Promise.all([
    fetchJson(fetchFn, `${COINGECKO_MARKETS}?vs_currency=usd&order=market_cap_desc&per_page=250&page=1&sparkline=false`).catch(() => []),
    fetchJson(fetchFn, `${COINGECKO_MARKETS}?vs_currency=usd&ids=${encodeURIComponent(ids.join(','))}&per_page=250&page=1&sparkline=false`).catch(() => []),
  ]);
  const map: MetaMap = new Map();
  const idToCanonical = new Map(CANONICAL_ASSETS.flatMap((a) => (a.coingeckoId ? [[a.coingeckoId, a.symbol] as const] : [])));
  for (const row of Array.isArray(canonicalRows) ? canonicalRows : []) {
    const r = row as { id?: unknown; name?: unknown; image?: unknown };
    const sym = typeof r.id === 'string' ? idToCanonical.get(r.id) : undefined;
    const logo = safeHttpsUrl(r.image);
    if (sym && logo) map.set(sym, { name: typeof r.name === 'string' ? r.name : sym, logo });
  }
  for (const row of Array.isArray(topRows) ? topRows : []) {
    const r = row as { symbol?: unknown; name?: unknown; image?: unknown };
    if (typeof r.symbol !== 'string') continue;
    const sym = r.symbol.toUpperCase();
    const logo = safeHttpsUrl(r.image);
    if (!logo || map.has(sym) || !/^[A-Z0-9]{1,20}$/.test(sym)) continue;
    map.set(sym, { name: typeof r.name === 'string' ? r.name : sym, logo });
  }
  if (map.size === 0) throw new Error('CoinGecko metadata unavailable');
  return map;
}

function loadMetadata(fetchFn: typeof fetch): Promise<MetaMap> {
  const now = Date.now();
  if (cached && now - cachedAt < CACHE_TTL_MS) return Promise.resolve(cached);
  if (!cached && failedAt !== null && now - failedAt < FAILURE_RETRY_MS) return Promise.resolve(new Map());
  if (!pending) {
    pending = fromServer(fetchFn)
      .catch(() => fromCoinGeckoDirect(fetchFn))
      .then((map) => {
        cached = map;
        cachedAt = Date.now();
        return map;
      })
      .catch(() => {
        failedAt = Date.now();
        return cached ?? new Map<string, CoinMetadata>();
      })
      .finally(() => {
        pending = null;
      });
  }
  return pending;
}

function normalize(symbol: string): string {
  return (symbol || '').split('/')[0]!.toUpperCase().replace(/USDT$/, '');
}

const defaultFetch: typeof fetch = (...args) => globalThis.fetch(...args);

/** Logo URL for any ticker in the universe, or null (→ letter avatar). */
export function getCoinLogoUrl(symbol: string, fetchFn: typeof fetch = defaultFetch): Promise<string | null> {
  const sym = normalize(symbol);
  if (!sym) return Promise.resolve(null);
  return loadMetadata(fetchFn).then((m) => m.get(sym)?.logo ?? null);
}

/** Synchronous lookup (null until metadata loaded) — for search by name. */
export function peekCoinMetadata(symbol: string): CoinMetadata | null {
  return cached?.get(normalize(symbol)) ?? null;
}

/** Display names for the selector search: canonical name > metadata name > ticker. */
export async function getCoinNames(symbols: readonly string[], fetchFn: typeof fetch = defaultFetch): Promise<Map<string, string>> {
  const meta = await loadMetadata(fetchFn);
  const out = new Map<string, string>();
  for (const s of symbols) out.set(s, getAssetBySymbol(s)?.name ?? meta.get(s)?.name ?? s);
  return out;
}

/** Diagnostics for tests: how many metadata HTTP requests were made. */
export function coinMetadataRequestCount(): number {
  return metadataRequests;
}

/** Test-only cache reset; production relies on the shared cache. */
export function resetCoinLogoCacheForTests(): void {
  cached = null;
  cachedAt = 0;
  failedAt = null;
  pending = null;
  metadataRequests = 0;
}

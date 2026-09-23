/**
 * CRYPTORA — Asset metadata (name + logo) for the dynamic universe.
 *
 * Source: CoinGecko `/coins/markets` (already the project's metadata source,
 * see src/services/data/adapters/CoinGeckoAdapter.ts). The server pulls the top
 * N coins by market cap in a FEW paged requests at most once per TTL, builds a
 * compact `SYMBOL → { name, logo }` map and serves it to every browser from
 * memory. Browsers therefore make ONE metadata request, never one per coin.
 *
 * Symbol collisions (many CoinGecko tokens share a ticker) are resolved by
 * market-cap order: the first (largest) coin wins. Canonical assets with an
 * explicit coingeckoId are resolved by id first, so BTC/ETH/… are never hijacked.
 */

const BASE_URL = 'https://api.coingecko.com/api/v3/coins/markets';
export const METADATA_TTL_MS = 12 * 60 * 60_000;
export const METADATA_PAGES = 4; // 4 × 250 = top-1000 by market cap
const PER_PAGE = 250;
const REQUEST_TIMEOUT_MS = 10_000;
const PAGE_DELAY_MS = 1_500; // sequential pages: stay well below the free rate limit

/** CoinGecko ids of canonical assets whose ticker is ambiguous. Kept tiny on purpose. */
export const PINNED_IDS = Object.freeze({
  BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', BNB: 'binancecoin', XRP: 'ripple', ADA: 'cardano',
  DOGE: 'dogecoin', AVAX: 'avalanche-2', LINK: 'chainlink', DOT: 'polkadot', SUI: 'sui', NEAR: 'near',
  APT: 'aptos', RENDER: 'render-token', TAO: 'bittensor', INJ: 'injective-protocol', UNI: 'uniswap',
  AAVE: 'aave', OP: 'optimism', ARB: 'arbitrum', TIA: 'celestia', FET: 'fetch-ai', KAS: 'kaspa',
  RUNE: 'thorchain', SEI: 'sei-network', LTC: 'litecoin', BCH: 'bitcoin-cash', ZEC: 'zcash',
  PEPE: 'pepe', USDC: 'usd-coin', TRX: 'tron', TON: 'the-open-network', SHIB: 'shiba-inu',
});

/**
 * @param {unknown[]} rows CoinGecko markets rows in market-cap order
 * @returns {Record<string, {name: string, logo: string}>}
 */
export function buildMetadataMap(rows) {
  /** @type {Record<string, {name: string, logo: string}>} */
  const bySymbol = {};
  const pinnedById = new Map(Object.entries(PINNED_IDS).map(([sym, id]) => [id, sym]));
  const valid = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row !== 'object') continue;
    const { id, symbol, name, image } = /** @type {any} */ (row);
    if (typeof id !== 'string' || typeof symbol !== 'string' || typeof name !== 'string' || typeof image !== 'string') continue;
    let logo;
    try {
      const u = new URL(image);
      if (u.protocol !== 'https:') continue;
      logo = u.toString();
    } catch {
      continue;
    }
    const sym = symbol.toUpperCase();
    if (!/^[A-Z0-9]{1,20}$/.test(sym)) continue;
    valid.push({ id, sym, name: name.slice(0, 80), logo });
  }
  // Pass 1: pinned ids win their ticker.
  for (const r of valid) {
    const pinnedSym = pinnedById.get(r.id);
    if (pinnedSym) bySymbol[pinnedSym] = { name: r.name, logo: r.logo };
  }
  // Pass 2: remaining tickers — first (largest market cap) wins.
  for (const r of valid) {
    if (!bySymbol[r.sym]) bySymbol[r.sym] = { name: r.name, logo: r.logo };
  }
  return bySymbol;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class AssetMetadataCache {
  constructor({ fetchFn, now, pages = METADATA_PAGES, pageDelayMs = PAGE_DELAY_MS } = {}) {
    this.fetchFn = fetchFn ?? ((...a) => globalThis.fetch(...a));
    this.now = now ?? (() => Date.now());
    this.pages = pages;
    this.pageDelayMs = pageDelayMs;
    this.entry = null;
    this.pending = null;
    this.upstreamRequests = 0;
    /** @type {number | null} */
    this.lastFailureAt = null;
  }

  async fetchPage(page) {
    const url = `${BASE_URL}?vs_currency=usd&order=market_cap_desc&per_page=${PER_PAGE}&page=${page}&sparkline=false`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    this.upstreamRequests++;
    try {
      const res = await this.fetchFn(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`CoinGecko markets HTTP ${res.status}`);
      const body = await res.json();
      if (!Array.isArray(body)) throw new Error('CoinGecko markets payload is not an array');
      return body;
    } finally {
      clearTimeout(timer);
    }
  }

  async load() {
    const rows = [];
    for (let page = 1; page <= this.pages; page++) {
      try {
        rows.push(...(await this.fetchPage(page)));
      } catch (err) {
        if (rows.length === 0) throw err; // nothing at all → honest failure
        break; // partial: keep what we have
      }
      if (page < this.pages && this.pageDelayMs > 0) await sleep(this.pageDelayMs);
    }
    return buildMetadataMap(rows);
  }

  /** @returns {Promise<{ assets: Record<string, {name: string, logo: string}>, at: number }>} */
  async get() {
    const now = this.now();
    if (this.entry && now - this.entry.at < METADATA_TTL_MS) return this.entry;
    // Failure back-off: one retry per 5 minutes, never a storm.
    if (!this.entry && this.lastFailureAt !== null && now - this.lastFailureAt < 5 * 60_000) {
      throw new Error('Metadata source recently failed; backing off');
    }
    if (this.pending) return this.pending;
    this.pending = this.load()
      .then((assets) => {
        this.entry = { assets, at: this.now() };
        return this.entry;
      })
      .catch((err) => {
        this.lastFailureAt = this.now();
        if (this.entry) return this.entry; // stale but valid logos are fine
        throw err;
      })
      .finally(() => { this.pending = null; });
    return this.pending;
  }
}

let cache = null;
export function getAssetMetadataCache() {
  if (!cache) cache = new AssetMetadataCache();
  return cache;
}
export function __resetAssetMetadataCacheForTests(injected = null) {
  cache = injected;
}

export async function assetMetadataPayload() {
  const { assets, at } = await getAssetMetadataCache().get();
  return { source: 'coingecko-markets', fetchedAt: new Date(at).toISOString(), count: Object.keys(assets).length, assets };
}

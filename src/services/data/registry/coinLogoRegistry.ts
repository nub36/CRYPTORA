import { CANONICAL_ASSETS, getAssetBySymbol } from './assetRegistry';

const CACHE_TTL_MS = 60 * 60_000;
const REQUEST_TIMEOUT_MS = 5_000;
const BASE_URL = 'https://api.coingecko.com/api/v3';

type LogoMap = Map<string, string>;

let cachedLogos: LogoMap | null = null;
let cachedAt = 0;
let pending: Promise<LogoMap> | null = null;

function getCanonicalLogoIds(): string[] {
  return CANONICAL_ASSETS.flatMap((asset) => asset.coingeckoId ? [asset.coingeckoId] : []);
}

async function fetchLogoMap(fetchFn: typeof fetch): Promise<LogoMap> {
  const ids = getCanonicalLogoIds();
  const url = `${BASE_URL}/coins/markets?vs_currency=usd&ids=${encodeURIComponent(ids.join(','))}&per_page=250&page=1&sparkline=false`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchFn(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`CoinGecko logo metadata HTTP ${response.status}`);
    const rows: unknown = await response.json();
    if (!Array.isArray(rows)) throw new Error('CoinGecko logo metadata was not an array');

    const urlById = new Map<string, string>();
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const item = row as { id?: unknown; image?: unknown };
      if (typeof item.id !== 'string' || typeof item.image !== 'string') continue;
      try {
        const imageUrl = new URL(item.image);
        if (imageUrl.protocol === 'https:') urlById.set(item.id, imageUrl.toString());
      } catch {
        // Invalid or non-absolute logo URI: keep the letter fallback.
      }
    }

    const bySymbol: LogoMap = new Map();
    for (const asset of CANONICAL_ASSETS) {
      const logo = asset.coingeckoId ? urlById.get(asset.coingeckoId) : undefined;
      if (logo) bySymbol.set(asset.symbol, logo);
    }
    return bySymbol;
  } finally {
    clearTimeout(timer);
  }
}

/** One cached CoinGecko markets request resolves official logo URIs for the shared catalog. */
export function getCoinLogoUrl(
  symbol: string,
  fetchFn: typeof fetch = ((...args) => globalThis.fetch(...args)),
): Promise<string | null> {
  const asset = getAssetBySymbol(symbol);
  if (!asset?.coingeckoId) return Promise.resolve(null);

  const now = Date.now();
  if (cachedLogos && now - cachedAt < CACHE_TTL_MS) {
    return Promise.resolve(cachedLogos.get(asset.symbol) ?? null);
  }
  if (!pending) {
    pending = fetchLogoMap(fetchFn)
      .catch(() => new Map())
      .then((logos) => {
        cachedLogos = logos;
        cachedAt = Date.now();
        pending = null;
        return logos;
      });
  }
  return pending.then((logos) => logos.get(asset.symbol) ?? null);
}

/** Test-only cache reset; production code should rely on the shared hour cache. */
export function resetCoinLogoCacheForTests(): void {
  cachedLogos = null;
  cachedAt = 0;
  pending = null;
}

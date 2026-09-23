import type { AssetSummary } from '@/types/market';
import { CANONICAL_ASSETS, type CanonicalAsset } from './assetRegistry';

/** A supported market entry may exist in the catalog while its live quote is unavailable. */
export interface MarketUniverseAsset {
  id: string;
  symbol: string;
  name: string;
  category: CanonicalAsset['category'];
  rank: number;
  quote: AssetSummary | null;
}

/**
 * Merge provider quotes with the canonical supported spot catalog. In live mode,
 * missing quotes remain visible as metadata-only rows (never fabricated prices).
 * Providers may return additional supported entries; this function never truncates.
 */
export function buildMarketUniverse(
  quotes: readonly AssetSummary[],
  includeCatalogFallback = true,
): MarketUniverseAsset[] {
  const entries = new Map<string, MarketUniverseAsset>();

  if (includeCatalogFallback) {
    for (const asset of CANONICAL_ASSETS) {
      entries.set(asset.symbol, {
        id: asset.symbol,
        symbol: asset.symbol,
        name: asset.name,
        category: asset.category,
        rank: asset.rank,
        quote: null,
      });
    }
  }

  for (const quote of quotes) {
    const canonical = CANONICAL_ASSETS.find((asset) => asset.symbol === quote.symbol.toUpperCase());
    entries.set(quote.symbol.toUpperCase(), {
      id: quote.id,
      symbol: quote.symbol.toUpperCase(),
      name: quote.name || canonical?.name || quote.symbol.toUpperCase(),
      category: canonical?.category ?? quote.category,
      rank: quote.rank || canonical?.rank || Number.MAX_SAFE_INTEGER,
      quote,
    });
  }

  return [...entries.values()].sort((a, b) => a.rank - b.rank || a.symbol.localeCompare(b.symbol));
}

export function sortMarketUniverse(
  rows: readonly MarketUniverseAsset[],
  key: keyof AssetSummary,
  direction: 'asc' | 'desc',
): MarketUniverseAsset[] {
  const isCatalogKey = key === 'rank' || key === 'symbol' || key === 'name' || key === 'category';
  return [...rows].sort((a, b) => {
    const rawValueA = isCatalogKey ? a[key as keyof Pick<MarketUniverseAsset, 'rank' | 'symbol' | 'name' | 'category'>] : a.quote?.[key];
    const rawValueB = isCatalogKey ? b[key as keyof Pick<MarketUniverseAsset, 'rank' | 'symbol' | 'name' | 'category'>] : b.quote?.[key];
    const valueA = key === 'marketCap' && rawValueA === 0 ? null : rawValueA;
    const valueB = key === 'marketCap' && rawValueB === 0 ? null : rawValueB;
    if (valueA == null && valueB == null) return a.rank - b.rank || a.symbol.localeCompare(b.symbol);
    if (valueA == null) return 1;
    if (valueB == null) return -1;
    const comparison = typeof valueA === 'number' && typeof valueB === 'number'
      ? valueA - valueB
      : String(valueA).localeCompare(String(valueB));
    return direction === 'asc' ? comparison : -comparison;
  });
}

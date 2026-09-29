import type { AssetSummary } from '@/types/market';
import { CANONICAL_ASSETS, type CanonicalAsset } from './assetRegistry';
import { sortMarketRows, type MarketSortField } from '@/utils/marketSort';

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

/**
 * Spot sort model, expressed with the SAME primitives as Futures
 * (`src/utils/marketSort.ts`) so the two tables cannot drift apart again.
 *
 * `marketCap === 0` is a "supply unknown" sentinel, not a real zero cap, so it
 * is mapped to `null` and sinks to the bottom like any other missing metric.
 */
export const SPOT_SORT_FIELDS: ReadonlyArray<MarketSortField<MarketUniverseAsset>> = [
  { key: 'rank', label: '#', shortLabel: 'Ранг', kind: 'numeric', value: (a) => a.rank, defaultDirection: 'asc' },
  { key: 'symbol', label: 'Актив', shortLabel: 'Тикер (A→Z)', kind: 'text', value: (a) => a.symbol, defaultDirection: 'asc' },
  { key: 'name', label: 'Название', kind: 'text', value: (a) => a.name, defaultDirection: 'asc' },
  { key: 'price', label: 'Цена, USD', shortLabel: 'Цена', kind: 'numeric', value: (a) => a.quote?.price ?? null, defaultDirection: 'desc' },
  { key: 'change1h', label: '1ч %', kind: 'numeric', value: (a) => a.quote?.change1h ?? null, defaultDirection: 'desc' },
  { key: 'change24h', label: '24ч %', kind: 'numeric', value: (a) => a.quote?.change24h ?? null, defaultDirection: 'desc' },
  { key: 'change7d', label: '7д %', kind: 'numeric', value: (a) => a.quote?.change7d ?? null, defaultDirection: 'desc' },
  { key: 'volume24h', label: 'Объём 24ч', shortLabel: 'Объём', kind: 'numeric', value: (a) => a.quote?.volume24h ?? null, defaultDirection: 'desc' },
  {
    key: 'marketCap',
    label: 'Капитализация',
    shortLabel: 'Капитализация',
    kind: 'numeric',
    value: (a) => (a.quote && a.quote.marketCap > 0 ? a.quote.marketCap : null),
    defaultDirection: 'desc',
  },
];

/**
 * Backwards-compatible wrapper around the shared comparator.
 * Ties fall back to the catalog order (rank, then ticker), which is already
 * the incoming order produced by `buildMarketUniverse`, so the stable sort of
 * `sortMarketRows` reproduces the previous deterministic tie-break.
 */
export function sortMarketUniverse(
  rows: readonly MarketUniverseAsset[],
  key: keyof AssetSummary | string,
  direction: 'asc' | 'desc',
): MarketUniverseAsset[] {
  const ordered = [...rows].sort((a, b) => a.rank - b.rank || a.symbol.localeCompare(b.symbol));
  return sortMarketRows(ordered, SPOT_SORT_FIELDS, { key: String(key), direction });
}

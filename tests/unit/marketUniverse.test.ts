import { describe, expect, it } from 'vitest';
import type { AssetSummary } from '@/types/market';
import { CANONICAL_ASSETS } from '@/services/data/registry/assetRegistry';
import { buildMarketUniverse, sortMarketUniverse } from '@/services/data/registry/marketUniverse';

function quote(symbol: string, rank: number): AssetSummary {
  return {
    id: symbol,
    symbol,
    name: `${symbol} asset`,
    category: 'l1',
    rank,
    price: 10 + rank,
    change1h: null,
    change24h: 1,
    change7d: null,
    volume24h: 100,
    marketCap: 1_000,
    circulatingSupply: 100,
    sparkline: [],
    isDemo: false,
  };
}

describe('shared spot market universe', () => {
  it('retains the full supported catalog when the live provider returns only a partial quote set', () => {
    const rows = buildMarketUniverse([quote('BTC', 1), quote('ETH', 2)], true);
    expect(rows).toHaveLength(CANONICAL_ASSETS.length);
    expect(rows.map((row) => row.symbol)).toContain('LINK');
    expect(rows.find((row) => row.symbol === 'SOL')?.quote).toBeNull();
    expect(rows.find((row) => row.symbol === 'BTC')?.quote?.price).toBe(11);
  });

  it('never truncates provider-supported additions with a fixed top/slice limit', () => {
    const dynamic = Array.from({ length: 80 }, (_, index) => quote(`COIN${index}`, index + 100));
    const rows = buildMarketUniverse(dynamic, true);
    expect(rows).toHaveLength(CANONICAL_ASSETS.length + dynamic.length);
    expect(rows.some((row) => row.symbol === 'COIN79')).toBe(true);
    expect(sortMarketUniverse(rows, 'rank', 'asc')).toHaveLength(rows.length);
  });
});

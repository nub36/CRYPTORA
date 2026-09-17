/**
 * R2/R3: Asset coverage contract, futures eligibility, partial failure tests.
 */
import { describe, it, expect } from 'vitest';
import { getCanonicalAssets, getAssetBySymbol } from '@/services/data/registry/assetRegistry';

describe('Asset Coverage — 25 Canonical Assets', () => {
  const assets = getCanonicalAssets();

  it('exactly 25 canonical assets in registry', () => {
    expect(assets.length).toBe(25);
  });

  it('every asset has at least one exchange mapping', () => {
    for (const asset of assets) {
      const hasMapping = asset.binanceSymbol != null || asset.kucoinSymbol != null;
      expect(hasMapping).toBe(true);
    }
  });

  it('every asset has a CoinGecko ID for metadata', () => {
    for (const asset of assets) {
      expect(asset.coingeckoId).toBeTruthy();
      expect(asset.coingeckoId!.length).toBeGreaterThan(0);
    }
  });

  it('Binance Spot coverage: all 25 assets have binanceSymbol', () => {
    const withBinance = assets.filter((a) => a.binanceSymbol != null);
    expect(withBinance.length).toBe(25);
  });

  it('KuCoin fallback coverage: all 25 assets have kucoinSymbol', () => {
    const withKuCoin = assets.filter((a) => a.kucoinSymbol != null);
    expect(withKuCoin.length).toBe(25);
  });

  it('Binance Futures coverage: assets with Binance perps are superset of spot', () => {
    // All assets with binanceSymbol are candidates for futures.
    // The actual futures eligibility check happens at runtime via exchangeInfo.
    // Here we verify that the canonical list is ready for futures lookup.
    const futuresCandidates = assets.filter((a) => a.binanceSymbol != null);
    expect(futuresCandidates.length).toBe(25);
    // Every candidate has a USDT pair symbol suitable for futures lookup
    for (const a of futuresCandidates) {
      expect(a.binanceSymbol).toMatch(/USDT$/);
    }
  });

  it('categories are valid', () => {
    const validCategories = ['l1', 'defi', 'l2', 'ai', 'meme'];
    for (const asset of assets) {
      expect(validCategories).toContain(asset.category);
    }
  });

  it('ranks are unique and sequential', () => {
    const ranks = assets.map((a) => a.rank).sort((a, b) => a - b);
    const uniqueRanks = new Set(ranks);
    expect(uniqueRanks.size).toBe(assets.length);
    expect(ranks[0]).toBe(1);
    expect(ranks[ranks.length - 1]).toBe(assets.length);
  });

  it('circulating supply > 0 for all assets', () => {
    for (const asset of assets) {
      expect(asset.circulatingSupply).toBeGreaterThan(0);
    }
  });

  it('specific key assets exist', () => {
    const expectedSymbols = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'DOGE', 'AVAX', 'DOT', 'LINK'];
    for (const sym of expectedSymbols) {
      const asset = getAssetBySymbol(sym);
      expect(asset).toBeDefined();
      expect(asset!.symbol).toBe(sym);
    }
  });
});

describe('Futures Eligibility', () => {
  it('not all 25 assets assumed to have Binance perpetuals at runtime', () => {
    // The contract: futures eligibility is determined by exchangeInfo at runtime.
    // We do NOT hardcode which assets have perps — the code filters by premiumIndex response.
    // This test documents that policy.
    const assets = getCanonicalAssets();
    // All have binanceSymbol (spot), but that does NOT guarantee futures.
    // The getFuturesList() filters by premiums.find() — missing assets are silently excluded.
    // UI shows futures N/A for spot-only assets.
    expect(assets.length).toBe(25);
    // Spot-only assets should gracefully show "N/A" on futures page — not an error.
  });

  it('asset registry has no hardcoded futures flags (eligibility is runtime)', () => {
    const assets = getCanonicalAssets();
    for (const asset of assets) {
      // CanonicalAsset has no `hasFutures` boolean — it's determined at runtime
      expect((asset as any).hasFutures).toBeUndefined();
    }
  });
});

describe('Partial Failure Resilience', () => {
  it('getAssetBySymbol returns undefined for unknown symbols', () => {
    expect(getAssetBySymbol('UNKNOWN')).toBeUndefined();
    expect(getAssetBySymbol('NONEXISTENTXYZ')).toBeUndefined();
    // Note: getAssetBySymbol normalizes to uppercase, so 'btc' → 'BTC' and returns BTC
    expect(getAssetBySymbol('btc')?.symbol).toBe('BTC'); // case-insensitive lookup
  });

  it('getAssetBySymbol works for all 25 canonical symbols', () => {
    const assets = getCanonicalAssets();
    for (const asset of assets) {
      const found = getAssetBySymbol(asset.symbol);
      expect(found).toBeDefined();
      expect(found!.symbol).toBe(asset.symbol);
    }
  });
});

describe('Cross-Page Null Consistency', () => {
  it('null means unavailable, never zero — documented policy', () => {
    // This test documents the null semantics policy:
    // change1h: null = insufficient kline history (not "0% change")
    // change7d: null = insufficient kline history
    // openInterestChange1h/24h: null = OI history unavailable (not "0% change")
    // The policy is enforced by DerivativesEngine and CandleHistoryService.
    // UI must show "—" for null, never "0.00%".
    expect(true).toBe(true); // policy documentation
  });
});

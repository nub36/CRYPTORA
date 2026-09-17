import { describe, it, expect } from 'vitest';
import {
  getCanonicalAssets,
  getAssetBySymbol,
  getBinanceSymbol,
  getKuCoinSymbol,
  getCanonicalByBinanceSymbol,
  getCanonicalByKuCoinSymbol,
  CANONICAL_ASSETS,
} from '@/services/data/registry/assetRegistry';

describe('Asset Registry Unit Tests (Stage 2 Controlled Universe)', () => {
  it('contains exactly 25 canonical crypto assets', () => {
    const assets = getCanonicalAssets();
    expect(assets.length).toBe(25);
    expect(CANONICAL_ASSETS.length).toBe(25);
  });

  it('verifies strict sequential ranks from 1 to 25 without duplicates', () => {
    const assets = getCanonicalAssets();
    const ranks = assets.map((a) => a.rank);
    for (let i = 1; i <= 25; i++) {
      expect(ranks).toContain(i);
    }
    const uniqueRanks = new Set(ranks);
    expect(uniqueRanks.size).toBe(25);
  });

  it('verifies all canonical assets have valid category and circulating supply', () => {
    const validCategories = ['l1', 'defi', 'l2', 'ai', 'meme'];
    for (const asset of CANONICAL_ASSETS) {
      expect(asset.symbol.length).toBeGreaterThan(0);
      expect(asset.name.length).toBeGreaterThan(0);
      expect(validCategories).toContain(asset.category);
      expect(asset.circulatingSupply).toBeGreaterThan(0);
    }
  });

  it('correctly maps canonical symbols to Binance and KuCoin symbols', () => {
    expect(getBinanceSymbol('BTC')).toBe('BTCUSDT');
    expect(getKuCoinSymbol('BTC')).toBe('BTC-USDT');

    expect(getBinanceSymbol('ETH')).toBe('ETHUSDT');
    expect(getKuCoinSymbol('ETH')).toBe('ETH-USDT');

    expect(getBinanceSymbol('SOL')).toBe('SOLUSDT');
    expect(getKuCoinSymbol('SOL')).toBe('SOL-USDT');
  });

  it('handles lowercase and whitespace inputs gracefully', () => {
    const btc = getAssetBySymbol('  btc  ');
    expect(btc).toBeDefined();
    expect(btc?.symbol).toBe('BTC');
    expect(btc?.name).toBe('Bitcoin');

    expect(getBinanceSymbol('sol')).toBe('SOLUSDT');
    expect(getKuCoinSymbol('eth')).toBe('ETH-USDT');
  });

  it('returns undefined/null for unsupported symbols without crashing', () => {
    expect(getAssetBySymbol('UNKNOWN_COIN_XYZ')).toBeUndefined();
    expect(getBinanceSymbol('NON_EXISTENT')).toBeNull();
    expect(getKuCoinSymbol('NON_EXISTENT')).toBeNull();
    expect(getCanonicalByBinanceSymbol('INVALIDUSDT')).toBeUndefined();
    expect(getCanonicalByKuCoinSymbol('INVALID-USDT')).toBeUndefined();
  });

  it('reverse maps exchange symbols back to canonical asset', () => {
    const btcFromBinance = getCanonicalByBinanceSymbol('BTCUSDT');
    expect(btcFromBinance?.symbol).toBe('BTC');

    const solFromKuCoin = getCanonicalByKuCoinSymbol('SOL-USDT');
    expect(solFromKuCoin?.symbol).toBe('SOL');
  });
});

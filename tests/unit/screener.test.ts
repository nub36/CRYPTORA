import { describe, it, expect } from 'vitest';
import { ScreenerEngine, BUILT_IN_PRESETS } from '@/services/screener/ScreenerEngine';
import { AssetSummary } from '@/types/market';

const MOCK_ASSETS: AssetSummary[] = [
  {
    id: 'btc',
    symbol: 'BTC',
    name: 'Bitcoin',
    category: 'l1',
    rank: 1,
    price: 65000,
    change1h: 0.5,
    change24h: 3.2,
    change7d: 8.5,
    volume24h: 25000000000,
    marketCap: 1250000000000,
    circulatingSupply: 19700000,
    sparkline: [63000, 65000],
    isDemo: false,
  },
  {
    id: 'sol',
    symbol: 'SOL',
    name: 'Solana',
    category: 'l1',
    rank: 3,
    price: 150,
    change1h: -0.2,
    change24h: 6.8,
    change7d: 12.0,
    volume24h: 3500000000,
    marketCap: 70000000000,
    circulatingSupply: 460000000,
    sparkline: [140, 150],
    isDemo: false,
  },
  {
    id: 'fet',
    symbol: 'FET',
    name: 'Artificial Superintelligence Alliance',
    category: 'ai',
    rank: 22,
    price: 1.45,
    change1h: -1.5,
    change24h: -4.2,
    change7d: -2.0,
    volume24h: 220000000,
    marketCap: 3600000000,
    circulatingSupply: 2500000000,
    sparkline: [1.5, 1.45],
    isDemo: false,
  },
];

describe('ScreenerEngine Multi-Factor Unit Tests', () => {
  it('filters assets by category', () => {
    const aiAssets = ScreenerEngine.filterAssets(MOCK_ASSETS, { category: 'ai' });
    expect(aiAssets.length).toBe(1);
    expect(aiAssets[0].symbol).toBe('FET');
  });

  it('filters assets by 24h price change range', () => {
    const gainers = ScreenerEngine.filterAssets(MOCK_ASSETS, { minPriceChange24h: 5 });
    expect(gainers.length).toBe(1);
    expect(gainers[0].symbol).toBe('SOL');

    const losers = ScreenerEngine.filterAssets(MOCK_ASSETS, { maxPriceChange24h: 0 });
    expect(losers.length).toBe(1);
    expect(losers[0].symbol).toBe('FET');
  });

  it('filters assets by minimum 24h volume threshold', () => {
    const highVolume = ScreenerEngine.filterAssets(MOCK_ASSETS, { minVolume24h: 10000000000 });
    expect(highVolume.length).toBe(1);
    expect(highVolume[0].symbol).toBe('BTC');
  });

  it('filters assets by RSI values using external rsi map', () => {
    const rsiMap = { BTC: 65, SOL: 75, FET: 28 };

    const oversold = ScreenerEngine.filterAssets(MOCK_ASSETS, { maxRsi: 30 }, rsiMap);
    expect(oversold.length).toBe(1);
    expect(oversold[0].symbol).toBe('FET');

    const overbought = ScreenerEngine.filterAssets(MOCK_ASSETS, { minRsi: 70 }, rsiMap);
    expect(overbought.length).toBe(1);
    expect(overbought[0].symbol).toBe('SOL');
  });

  it('filters assets by funding rate (Short Squeeze Watch)', () => {
    const fundingMap = { BTC: 0.01, SOL: 0.02, FET: -0.03 };

    const negativeFunding = ScreenerEngine.filterAssets(
      MOCK_ASSETS,
      { fundingFilter: 'negative' },
      {},
      fundingMap
    );

    expect(negativeFunding.length).toBe(1);
    expect(negativeFunding[0].symbol).toBe('FET');
  });

  it('manages custom presets and includes built-in presets', () => {
    const engine = new ScreenerEngine();
    const presets = engine.getAllPresets();
    expect(presets.length).toBeGreaterThanOrEqual(BUILT_IN_PRESETS.length);

    const custom = engine.savePreset('My Preset', 'Custom strategy filters', {
      category: 'l1',
      minVolume24h: 1000000000,
    });

    expect(custom.id).toBeDefined();
    expect(custom.name).toBe('My Preset');

    const updated = engine.getAllPresets();
    expect(updated.some((p) => p.id === custom.id)).toBe(true);

    const deleted = engine.deletePreset(custom.id);
    expect(deleted).toBe(true);
  });
});

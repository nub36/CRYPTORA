import { describe, it, expect } from 'vitest';
import { DemoMarketDataProvider } from '@/services/data/DemoMarketDataProvider';
import {
  MarketOverviewDataSchema,
  AssetSummarySchema,
  AssetDetailSchema,
  FuturesAssetSchema,
  LiquidationDataSchema,
  RadarEventSchema,
} from '@/types/market';

describe('DemoMarketDataProvider Contracts & Determinism', () => {
  const provider = new DemoMarketDataProvider();

  it('marks provider as isDemo === true', () => {
    expect(provider.isDemo).toBe(true);
  });

  it('validates getMarketOverview schema and demo flag', async () => {
    const overview = await provider.getMarketOverview();
    const parsed = MarketOverviewDataSchema.parse(overview);
    expect(parsed.isDemo).toBe(true);
    expect(parsed.btcDominance).toBeGreaterThan(50);
    expect(parsed.totalMarketCap).toBeGreaterThan(1e12);
  });

  it('returns exactly 30 demo assets validating AssetSummarySchema', async () => {
    const assets = await provider.getAssets();
    expect(assets.length).toBe(30);

    for (const asset of assets) {
      const parsed = AssetSummarySchema.parse(asset);
      expect(parsed.isDemo).toBe(true);
      expect(parsed.sparkline.length).toBeGreaterThan(1);
    }
  });

  it('filters assets by category correctly', async () => {
    const l1 = await provider.getAssets('l1');
    expect(l1.length).toBeGreaterThan(0);
    expect(l1.every((a) => a.category === 'l1')).toBe(true);

    const meme = await provider.getAssets('meme');
    expect(meme.length).toBeGreaterThan(0);
    expect(meme.every((a) => a.category === 'meme')).toBe(true);
  });

  it('returns valid AssetDetail with indicators and pairs', async () => {
    const btc = await provider.getAssetDetail('BTC');
    expect(btc).not.toBeNull();
    if (btc) {
      const parsed = AssetDetailSchema.parse(btc);
      expect(parsed.symbol).toBe('BTC');
      expect(parsed.indicators?.rsi14).toBeDefined();
      expect(parsed.pairs.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('generates deterministic candles for different timeframes', async () => {
    const candles1 = await provider.getCandles('BTC', '1h');
    const candles2 = await provider.getCandles('BTC', '1h');

    expect(candles1.length).toBe(100);
    expect(candles1).toEqual(candles2); // 100% deterministic, no Math.random()
  });

  it('returns valid futures snapshot and liquidation data', async () => {
    const futures = await provider.getFuturesList();
    expect(futures.length).toBeGreaterThan(5);
    futures.forEach((f) => FuturesAssetSchema.parse(f));

    const liqs = await provider.getLiquidations();
    const parsedLiqs = LiquidationDataSchema.parse(liqs);
    expect(parsedLiqs.total24h).toBe(parsedLiqs.totalLong24h + parsedLiqs.totalShort24h);
  });

  it('returns radar events with valid severity and types', async () => {
    const events = await provider.getRadarEvents();
    expect(events.length).toBeGreaterThanOrEqual(5);
    events.forEach((e) => RadarEventSchema.parse(e));
  });

  it('filters screener results correctly on multiple criteria', async () => {
    // Filter min price change > 5%
    const gainers = await provider.getScreenerResults({ minPriceChange24h: 5 });
    expect(gainers.every((a) => a.change24h >= 5)).toBe(true);

    // Filter by sector
    const aiAssets = await provider.getScreenerResults({ category: 'ai' });
    expect(aiAssets.every((a) => a.category === 'ai')).toBe(true);
  });
});

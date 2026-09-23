/**
 * LiveMarketDataProvider with the authoritative dynamic universe:
 *  - Spot: bulk ticker ∩ exchangeInfo active set (dead tickers excluded);
 *  - Futures: all active USDT-M perpetuals, not canonical 25;
 *  - no N×candles / N×OI request storm for a 500+ universe.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { LiveMarketDataProvider, FUTURES_OI_DETAIL_LIMIT } from '@/services/data/LiveMarketDataProvider';
import { BinanceSpotAdapter } from '@/services/data/adapters/BinanceSpotAdapter';
import { BinanceFuturesAdapter } from '@/services/data/adapters/BinanceFuturesAdapter';
import { CANONICAL_ASSETS } from '@/services/data/registry/assetRegistry';
import { LiquidationPipeline } from '@/services/liquidations/LiquidationPipeline';

const ticker = (symbol: string, quoteVolume = '1000000') => ({
  symbol, priceChange: '1', priceChangePercent: '1.00', lastPrice: '1.5', openPrice: '1.4', highPrice: '1.6', lowPrice: '1.3',
  volume: '1000', quoteVolume, openTime: 1, closeTime: 2,
});

const DEAD = ['VEN', 'XRPBULL', 'XRPBEAR', 'XLMUP', 'XLMDOWN', 'XTZUP', 'XTZDOWN', 'YFIUP', 'YFIDOWN', 'BCC', 'BCHABC'];

function spotProvider(activeDynamic: string[], dead = DEAD) {
  const binance = new BinanceSpotAdapter();
  const all = [
    ...CANONICAL_ASSETS.map((a) => ticker(a.binanceSymbol as string)),
    ...activeDynamic.map((b) => ticker(`${b}USDT`)),
    ...dead.map((b) => ticker(`${b}USDT`)),
    ticker('ETHBTC'),
  ];
  vi.spyOn(binance, 'fetchAll24hrTickers').mockResolvedValue(all as any);
  const perSymbol = vi.spyOn(binance, 'fetch24hrTicker');
  const klines = vi.spyOn(binance, 'fetchKlines').mockResolvedValue([]);
  const candleHistoryService = { getAll: vi.fn().mockResolvedValue(new Map()) } as any;
  const active = new Set([...CANONICAL_ASSETS.map((a) => a.symbol), ...activeDynamic]);
  const provider = new LiveMarketDataProvider({
    binanceAdapter: binance, candleHistoryService, activeSpotSymbols: async () => active,
  });
  return { provider, perSymbol, klines, candleHistoryService };
}

describe('Spot universe = exchangeInfo active set (never historical tickers)', () => {
  it('shows ALL active Spot USDT assets (not cut to canonical 25) and excludes dead records', async () => {
    const dynamic = Array.from({ length: 520 }, (_, i) => `DYN${i}`).concat(['LTC', 'BCH', 'ZEC', 'PEPE', 'USDC']);
    const { provider } = spotProvider(dynamic);
    const assets = await provider.getAssets();
    expect(assets).toHaveLength(CANONICAL_ASSETS.length + dynamic.length);
    const symbols = new Set(assets.map((a) => a.symbol));
    for (const s of ['LTC', 'BCH', 'ZEC', 'PEPE', 'USDC', 'DYN519']) expect(symbols.has(s), s).toBe(true);
    for (const d of DEAD) expect(symbols.has(d), d).toBe(false);
  });

  it('when exchangeInfo is unknown, historical tickers are NOT trusted (canonical only)', async () => {
    const binance = new BinanceSpotAdapter();
    vi.spyOn(binance, 'fetchAll24hrTickers').mockResolvedValue([
      ...CANONICAL_ASSETS.map((a) => ticker(a.binanceSymbol as string)), ticker('VENUSDT'), ticker('PEPEUSDT'),
    ] as any);
    const provider = new LiveMarketDataProvider({
      binanceAdapter: binance, candleHistoryService: { getAll: vi.fn().mockResolvedValue(new Map()) } as any,
      activeSpotSymbols: async () => null,
    });
    const assets = await provider.getAssets();
    expect(assets.map((a) => a.symbol)).not.toContain('VEN');
    expect(assets).toHaveLength(CANONICAL_ASSETS.length);
  });

  it('500+ assets in the catalog cost ONE bulk request — no per-symbol tickers, no N×candles', async () => {
    const dynamic = Array.from({ length: 600 }, (_, i) => `D${i}`);
    const { provider, perSymbol, klines, candleHistoryService } = spotProvider(dynamic);
    await provider.getAssets();
    await provider.getAssets();
    expect(perSymbol).not.toHaveBeenCalled();
    expect(klines).not.toHaveBeenCalled();
    // enrichment is the shared canonical CandleHistoryService (bounded), never per dynamic asset
    expect(candleHistoryService.getAll).toHaveBeenCalledTimes(1);
  });
});

describe('Futures universe = all active USDT-M perpetuals', () => {
  beforeEach(() => LiquidationPipeline.resetInstance());

  function futuresProvider(bases: string[]) {
    const adapter = new BinanceFuturesAdapter();
    const syms = bases.map((b) => `${b}USDT`);
    const premium = (s: string) => ({ symbol: s, markPrice: '10', indexPrice: '10', lastFundingRate: '0.0001', nextFundingTime: 0, time: 0 });
    vi.spyOn(adapter, 'fetchPremiumIndexes').mockResolvedValue([...syms, 'BTCUSDT_261225'].map(premium) as any);
    vi.spyOn(adapter, 'fetch24hrTickers').mockResolvedValue(syms.map((s, i) => ({ ...ticker(s, String(1e6 - i)) })) as any);
    const oiHist = vi.spyOn(adapter, 'fetchOpenInterestHist').mockRejectedValue(new Error('n/a'));
    const oi = vi.spyOn(adapter, 'fetchOpenInterest').mockRejectedValue(new Error('n/a'));
    const provider = new LiveMarketDataProvider({
      futuresAdapter: adapter, cacheTtlMs: 0,
      futuresUniverse: async () => ({
        activeUsdtContracts: bases.length + 1, perpetualCount: bases.length, count: bases.length, fetchedAt: '', stale: false,
        contracts: bases.map((b) => ({ symbol: b, exchangeSymbol: `${b}USDT`, baseAsset: b, contractType: 'PERPETUAL' as const })),
      }),
    });
    return { provider, oi, oiHist };
  }

  it('lists every active perpetual (not ~25), canonical first, quarterlies not mixed in', async () => {
    const bases = ['BTC', 'ETH', ...Array.from({ length: 480 }, (_, i) => `P${i}`), '1000PEPE'];
    const { provider } = futuresProvider(bases);
    const list = await provider.getFuturesList();
    expect(list).toHaveLength(bases.length);
    expect(list[0]!.symbol).toBe('BTC/USDT');
    expect(list.some((f) => f.symbol === '1000PEPE/USDT')).toBe(true);
    expect(list.some((f) => f.symbol.includes('261225'))).toBe(false);
  });

  it('per-contract OI requests are bounded (no 500× storm); other rows get null OI, not an estimate', async () => {
    const bases = Array.from({ length: 500 }, (_, i) => `P${i}`);
    const { provider, oi, oiHist } = futuresProvider(bases);
    const list = await provider.getFuturesList();
    expect(oi.mock.calls.length).toBeLessThanOrEqual(FUTURES_OI_DETAIL_LIMIT);
    expect(oiHist.mock.calls.length).toBeLessThanOrEqual(FUTURES_OI_DETAIL_LIMIT);
    expect(list.every((f) => f.openInterest === null)).toBe(true);
  });
});

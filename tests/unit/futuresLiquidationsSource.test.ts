import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LiveMarketDataProvider } from '@/services/data/LiveMarketDataProvider';
import { BinanceFuturesAdapter } from '@/services/data/adapters/BinanceFuturesAdapter';
import { LiquidationPipeline } from '@/services/liquidations/LiquidationPipeline';
import { getCanonicalAssets } from '@/services/data/registry/assetRegistry';

const T0 = 1758100000000;
const PREMIUM = { markPrice: '65000', indexPrice: '64990', lastFundingRate: '0.0001', nextFundingTime: 0, time: T0 };
const TICKER = { priceChange: '1300', priceChangePercent: '2.00', lastPrice: '65000', volume: '10000', quoteVolume: '650000000' } as any;

function makeProvider() {
  const adapter = new BinanceFuturesAdapter();
  const symbols = getCanonicalAssets().filter((a) => a.binanceSymbol).map((a) => a.binanceSymbol as string);
  vi.spyOn(adapter, 'fetchPremiumIndexes').mockResolvedValue(symbols.map((s) => ({ ...PREMIUM, symbol: s })));
  vi.spyOn(adapter, 'fetch24hrTickers').mockResolvedValue(symbols.map((s) => ({ ...TICKER, symbol: s })));
  vi.spyOn(adapter, 'fetchOpenInterestHist').mockRejectedValue(new Error('n/a'));
  return new LiveMarketDataProvider({ futuresAdapter: adapter, cacheTtlMs: 0 });
}

describe('Ликвидации 24ч по инструменту: фактический поток vs эвристика', () => {
  beforeEach(() => LiquidationPipeline.resetInstance());

  it('поток недоступен → ESTIMATED (эвристика сохранена, но помечена)', async () => {
    LiquidationPipeline.getInstance().setStreamState('unavailable');
    const list = await makeProvider().getFuturesList();
    const btc = list.find((f) => f.symbol === 'BTC/USDT')!;
    expect(btc.liquidationsSource).toBe('ESTIMATED');
    expect(btc.longLiquidations24h + btc.shortLiquidations24h).toBeGreaterThan(0);
  });

  it('поток подключён: суммы только из фактических событий; без событий по инструменту → UNAVAILABLE и нули', async () => {
    const pipe = LiquidationPipeline.getInstance();
    pipe.setStreamState('connected');
    pipe.recordEvent({ id: 'e1', symbol: 'BTC', exchange: 'binance', side: 'LONG', amountUsd: 120000, price: 65000, quantity: 1.85, timestamp: new Date().toISOString(), provenance: { exchange: 'binance', market: 'futures', symbol: 'BTCUSDT', timestamp: Date.now() } } as any);
    pipe.recordEvent({ id: 'e2', symbol: 'BTC', exchange: 'bybit', side: 'SHORT', amountUsd: 30000, price: 65000, quantity: 0.46, timestamp: new Date().toISOString(), provenance: { exchange: 'binance', market: 'futures', symbol: 'BTCUSDT', timestamp: Date.now() } } as any);
    const list = await makeProvider().getFuturesList();
    const btc = list.find((f) => f.symbol === 'BTC/USDT')!;
    const eth = list.find((f) => f.symbol === 'ETH/USDT')!;
    expect(btc.liquidationsSource).toBe('ACTUAL');
    expect(btc.longLiquidations24h).toBe(120000);
    expect(btc.shortLiquidations24h).toBe(30000);
    expect(eth.liquidationsSource).toBe('UNAVAILABLE');
    expect(eth.longLiquidations24h).toBe(0);
    expect(eth.shortLiquidations24h).toBe(0);
  });
});

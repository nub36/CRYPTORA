import { describe, it, expect, vi } from 'vitest';
import { DerivativesEngine } from '@/services/derivatives/DerivativesEngine';
import { BinanceFuturesAdapter } from '@/services/data/adapters/BinanceFuturesAdapter';
import { LiveMarketDataProvider } from '@/services/data/LiveMarketDataProvider';
import { getCanonicalAssets } from '@/services/data/registry/assetRegistry';

const T0 = 1758100000000;
const hist = (values: number[]) =>
  values.map((v, i) => ({ symbol: 'BTCUSDT', sumOpenInterest: String(v), sumOpenInterestValue: String(v * 65000), timestamp: T0 + i * 3600_000 }));

const PREMIUM = { symbol: 'BTCUSDT', markPrice: '65000', indexPrice: '64990', lastFundingRate: '0.0001', nextFundingTime: 0, time: T0 };
const TICKER = { symbol: 'BTCUSDT', priceChange: '1300', priceChangePercent: '2.00', lastPrice: '65000', volume: '10000', quoteVolume: '650000000' } as any;
const btc = getCanonicalAssets().find((a) => a.symbol === 'BTC')!;

describe('Δ OI по фактическому ряду openInterestHist', () => {
  it('Δ1ч — против предыдущей точки, Δ24ч — против точки на 24 шага назад; сортировка по времени', () => {
    const vals = Array.from({ length: 25 }, (_, i) => 1000 + i * 10); // 1000 … 1240
    const r = DerivativesEngine.calculateOpenInterestChanges(hist(vals).reverse())!;
    expect(r.points).toBe(25);
    expect(r.change1hPct).toBe(Number((((1240 - 1230) / 1230) * 100).toFixed(2)));
    expect(r.change24hPct).toBe(24); // (1240-1000)/1000
    expect(r.latestValueUsd).toBe(1240 * 65000);
  });

  it('короткий ряд: Δ24ч против самой ранней точки; <2 точек или нечисло → null', () => {
    expect(DerivativesEngine.calculateOpenInterestChanges(hist([100, 110, 121]))!.change24hPct).toBe(21);
    expect(DerivativesEngine.calculateOpenInterestChanges(hist([100]))).toBeNull();
    expect(DerivativesEngine.calculateOpenInterestChanges([])).toBeNull();
    expect(DerivativesEngine.calculateOpenInterestChanges(undefined)).toBeNull();
    expect(DerivativesEngine.calculateOpenInterestChanges([{ ...hist([1])[0], sumOpenInterest: 'nan' }, hist([2])[0]])).toBeNull();
  });

  it('normalizeFuturesAsset: с рядом → ACTUAL и Δ из ряда; без ряда → ESTIMATED и эвристика от цены', () => {
    const withHist = DerivativesEngine.normalizeFuturesAsset(btc, PREMIUM, TICKER, undefined, hist([1000, 1000, 1050]));
    expect(withHist.openInterestChangeSource).toBe('ACTUAL');
    expect(withHist.openInterestChange1h).toBe(5);
    expect(withHist.openInterest).toBe(1050 * 65000);

    const noHist = DerivativesEngine.normalizeFuturesAsset(btc, PREMIUM, TICKER);
    expect(noHist.openInterestChangeSource).toBe('ESTIMATED');
    expect(noHist.openInterestChange1h).toBe(0.2); // 2.00 × 0.1 — прежняя эвристика сохранена и помечена
    expect(noHist.openInterestChange24h).toBe(0.8);
  });

  it('LiveMarketDataProvider: ряд запрашивается по каждому символу; отказ по символу → ESTIMATED только у него', async () => {
    const adapter = new BinanceFuturesAdapter();
    const symbols = getCanonicalAssets().filter((a) => a.binanceSymbol).map((a) => a.binanceSymbol as string);
    vi.spyOn(adapter, 'fetchPremiumIndexes').mockResolvedValue(symbols.map((s) => ({ ...PREMIUM, symbol: s })));
    vi.spyOn(adapter, 'fetch24hrTickers').mockResolvedValue(symbols.map((s) => ({ ...TICKER, symbol: s })));
    const histSpy = vi.spyOn(adapter, 'fetchOpenInterestHist').mockImplementation(async (sym) => {
      if (sym === 'ETHUSDT') throw new Error('HTTP 500');
      return hist([100, 100, 103]).map((h) => ({ ...h, symbol: sym }));
    });

    const provider = new LiveMarketDataProvider({ futuresAdapter: adapter, cacheTtlMs: 0 });
    const list = await provider.getFuturesList();
    expect(histSpy).toHaveBeenCalledTimes(symbols.length);
    const b = list.find((f) => f.symbol === 'BTC/USDT')!;
    const e = list.find((f) => f.symbol === 'ETH/USDT')!;
    expect(b.openInterestChangeSource).toBe('ACTUAL');
    expect(b.openInterestChange1h).toBe(3);
    expect(e.openInterestChangeSource).toBe('ESTIMATED');

    // Кэш ряда OI (5 мин) — повторный вызов не дёргает openInterestHist заново.
    await provider.getFuturesList();
    expect(histSpy).toHaveBeenCalledTimes(symbols.length);
  });

  it('адаптер: URL публичного endpoint /futures/data/openInterestHist с period=1h и валидация схемы', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      expect(url).toBe('https://fapi.binance.com/futures/data/openInterestHist?symbol=BTCUSDT&period=1h&limit=25');
      return new Response(JSON.stringify(hist([1, 2])), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    const adapter = new BinanceFuturesAdapter({ fetchFn: fetchFn as unknown as typeof fetch });
    const out = await adapter.fetchOpenInterestHist('btcusdt');
    expect(out.length).toBe(2);
    expect(out[1].sumOpenInterest).toBe('2');
  });
});

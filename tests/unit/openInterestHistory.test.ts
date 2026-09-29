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

  it('normalizeFuturesAsset: с рядом → ACTUAL и Δ из ряда; без ряда → UNAVAILABLE и null (не 0!)', () => {
    const withHist = DerivativesEngine.normalizeFuturesAsset(btc, PREMIUM, TICKER, undefined, hist([1000, 1000, 1050]));
    expect(withHist.openInterestChangeSource).toBe('ACTUAL');
    expect(withHist.openInterestChange1h).toBe(5);
    expect(withHist.openInterest).toBe(1050 * 65000);

    const noHist = DerivativesEngine.normalizeFuturesAsset(btc, PREMIUM, TICKER);
    expect(noHist.openInterestChangeSource).toBe('UNAVAILABLE');
    expect(noHist.openInterestChange1h).toBeNull(); // missing history ≠ zero delta
    expect(noHist.openInterestChange24h).toBeNull(); // missing history ≠ zero delta
  });

  it('З4: без spot-OI и без ряда openInterest = null (эвристика ×0.15 удалена); spot-OI — факт', () => {
    const noSource = DerivativesEngine.normalizeFuturesAsset(btc, PREMIUM, TICKER);
    expect(noSource.openInterest).toBeNull(); // REGRESSION: раньше 650M×0.15 = 97.5M как «факт»

    const spot = DerivativesEngine.normalizeFuturesAsset(
      btc, PREMIUM, TICKER,
      { symbol: 'BTCUSDT', openInterest: '81950.5', time: T0 } as any
    );
    expect(spot.openInterest).toBe(81950.5 * 65000);
  });

  it('REGRESSION: missing OI history !== zero delta', () => {
    // 0.00% means "OI did not change"; null means "no data". Semantics must not be conflated.
    const noHist = DerivativesEngine.normalizeFuturesAsset(btc, PREMIUM, TICKER);
    expect(noHist.openInterestChange1h).not.toBe(0);
    expect(noHist.openInterestChange1h).toBeNull();
    expect(noHist.openInterestChange24h).not.toBe(0);
    expect(noHist.openInterestChange24h).toBeNull();
  });

  it('RC-1: браузер больше НЕ обходит символы сам — OI приходит из серверного снимка', async () => {
    // Раньше клиент дёргал /fapi/v1/openInterest и openInterestHist по каждому
    // символу (и обрывался на лимите в 30 контрактов). Теперь развёртку делает
    // сервер: браузер читает агрегат, а при его недоступности честно деградирует
    // до bulk-эндпоинтов с openInterest = null.
    const adapter = new BinanceFuturesAdapter();
    const symbols = getCanonicalAssets().filter((a) => a.binanceSymbol).map((a) => a.binanceSymbol as string);
    vi.spyOn(adapter, 'fetchPremiumIndexes').mockResolvedValue(symbols.map((s) => ({ ...PREMIUM, symbol: s })));
    vi.spyOn(adapter, 'fetch24hrTickers').mockResolvedValue(symbols.map((s) => ({ ...TICKER, symbol: s })));
    const histSpy = vi.spyOn(adapter, 'fetchOpenInterestHist');
    const oiSpy = vi.spyOn(adapter, 'fetchOpenInterest');

    const provider = new LiveMarketDataProvider({
      futuresAdapter: adapter,
      cacheTtlMs: 0,
      // Серверный агрегат недоступен → путь деградации.
      futuresSnapshotFetcher: async () => { throw new Error('snapshot unavailable'); },
      futuresUniverse: async () => null,
    });
    const list = await provider.getFuturesList();

    expect(histSpy).not.toHaveBeenCalled();
    expect(oiSpy).not.toHaveBeenCalled();

    const b = list.find((f) => f.symbol === 'BTC/USDT')!;
    expect(b.openInterest).toBeNull(); // нет фактического OI — честный «Нет данных»
    expect(b.openInterestChangeSource).toBe('UNAVAILABLE');
    expect(b.openInterestChange1h).toBeNull();
    // Цена/фандинг/объём/24ч% из bulk-эндпоинтов остаются фактическими.
    expect(b.markPrice).toBe(65000);
    expect(b.futuresVolume24h).toBe(650000000);
    expect(b.priceChange24h).toBe(2);
  });

  it('серверный снимок отдаёт фактический OI и Δ по ряду (ACTUAL), пропуски остаются null', async () => {
    const provider = new LiveMarketDataProvider({
      cacheTtlMs: 0,
      futuresSnapshotFetcher: async () => ({
        source: 'binance-usdm',
        filter: 'quoteAsset=USDT & status=TRADING & contractType=PERPETUAL',
        fetchedAt: new Date(T0).toISOString(),
        universeFetchedAt: new Date(T0).toISOString(),
        stale: false,
        activeUsdtContracts: 2,
        perpetualCount: 2,
        coverage: {
          contracts: 2, withPrice: 2, withChange24h: 2, withVolume: 2, withFunding: 2,
          withOpenInterest: 1, withOpenInterestDelta: 1, withoutPremium: 0, withoutTicker: 0,
          openInterestSweptAt: null, openInterestFailures: 1, openInterestRateLimited: false,
          openInterestHistSweptAt: null, openInterestHistCovered: 1, openInterestHistFailures: 1, openInterestHistRateLimited: false,
        },
        rows: [
          {
            contractSymbol: 'BTCUSDT', baseAsset: 'BTC', contractType: 'PERPETUAL',
            markPrice: '65000', indexPrice: '64990', lastFundingRate: '0.0001',
            nextFundingTime: 0, premiumTime: T0,
            lastPrice: '65000', priceChangePercent: '2.00', quoteVolume: '650000000', baseVolume: '10000',
            openInterest: null,
            openInterestHist: hist([100, 100, 103]),
          },
          {
            contractSymbol: 'ETHUSDT', baseAsset: 'ETH', contractType: 'PERPETUAL',
            markPrice: '3200', indexPrice: '3199', lastFundingRate: '0.0002',
            nextFundingTime: 0, premiumTime: T0,
            lastPrice: '3200', priceChangePercent: '-1.00', quoteVolume: '120000000', baseVolume: '1000',
            openInterest: null,
            openInterestHist: null,
          },
        ],
      }) as never,
    });

    const list = await provider.getFuturesList();
    const b = list.find((f) => f.symbol === 'BTC/USDT')!;
    const e = list.find((f) => f.symbol === 'ETH/USDT')!;
    expect(b.openInterestChangeSource).toBe('ACTUAL');
    expect(b.openInterestChange1h).toBe(3);
    expect(b.openInterest).toBe(103 * 65000); // последняя точка ряда — факт
    expect(e.openInterestChangeSource).toBe('UNAVAILABLE');
    expect(e.openInterest).toBeNull(); // REGRESSION З4: не quoteVolume×0.15
  });

  it('адаптер: URL публичного endpoint /futures/data/openInterestHist с period=1h и валидация схемы', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      expect(url).toBe('/api/market/binance/futures/futures/data/openInterestHist?symbol=BTCUSDT&period=1h&limit=25');
      return new Response(JSON.stringify(hist([1, 2])), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    const adapter = new BinanceFuturesAdapter({ fetchFn: fetchFn as unknown as typeof fetch });
    const out = await adapter.fetchOpenInterestHist('btcusdt');
    expect(out.length).toBe(2);
    expect(out[1].sumOpenInterest).toBe('2');
  });
});

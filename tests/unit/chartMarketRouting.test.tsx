import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { LiveMarketDataProvider } from '@/services/data/LiveMarketDataProvider';
import { UnsupportedMarketSymbolError } from '@/services/data/adapters/errors';
import { MarketDataProviderComponent } from '@/context/MarketDataContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { FuturesContractPage } from '@/pages/FuturesContractPage';
import { resetExchangeUniverseForTests } from '@/services/data/registry/exchangeUniverse';
import { RealtimeFeedManager } from '@/services/realtime/RealtimeFeedManager';
import type { MarketDataProvider } from '@/services/data/MarketDataProvider';
import type { OHLCV } from '@/types/market';

/**
 * Task §5 / §6 / §10 — market type is an EXPLICIT parameter of the chart path.
 *
 * A Futures route must reach `/fapi/v1/klines`; a Spot route must reach
 * `/api/v3/klines`. Neither may be inferred from the ticker string, and a slow
 * response for a previous symbol/market must never be painted on the chart.
 */

const KLINES = (base: number) => [
  [1_726_358_400_000, String(base), String(base * 1.01), String(base * 0.99), String(base * 1.005), '1000', 1_726_361_999_999, '1', 10, '1', '1', '0'],
  [1_726_362_000_000, String(base * 1.005), String(base * 1.02), String(base * 0.995), String(base * 1.01), '1100', 1_726_365_599_999, '1', 10, '1', '1', '0'],
];

function makeProvider(overrides: Record<string, unknown> = {}) {
  const spot = { fetchKlines: vi.fn(async (_symbol: string, _interval: string, _limit: number) => KLINES(100)) };
  const futures = { fetchKlines: vi.fn(async (_symbol: string, _interval: string, _limit: number) => KLINES(200)) };
  const provider = new LiveMarketDataProvider({
    cacheTtlMs: 0,
    binanceAdapter: spot as never,
    futuresAdapter: futures as never,
    futuresContracts: async () => new Map([['BTC', 'BTCUSDT'], ['1000PEPE', '1000PEPEUSDT']]),
    ...overrides,
  } as never);
  return { provider, spot, futures };
}

describe('candle source routing (data service)', () => {
  it('uses the Spot kline adapter for market="spot"', async () => {
    const { provider, spot, futures } = makeProvider();
    const candles = await provider.getCandles('BTC', '1h', 100, { market: 'spot' });
    expect(spot.fetchKlines).toHaveBeenCalledTimes(1);
    expect(spot.fetchKlines.mock.calls[0][0]).toBe('BTCUSDT');
    expect(futures.fetchKlines).not.toHaveBeenCalled();
    expect(candles[0].close).toBeCloseTo(100.5, 6);
  });

  it('uses the USD-M kline adapter for market="futures"', async () => {
    const { provider, spot, futures } = makeProvider();
    const candles = await provider.getCandles('BTC', '1h', 100, { market: 'futures' });
    expect(futures.fetchKlines).toHaveBeenCalledTimes(1);
    expect(futures.fetchKlines.mock.calls[0][0]).toBe('BTCUSDT');
    expect(spot.fetchKlines).not.toHaveBeenCalled();
    expect(candles[0].close).toBeCloseTo(201, 6);
  });

  it('defaults to Spot when no market is supplied (legacy callers)', async () => {
    const { provider, spot, futures } = makeProvider();
    await provider.getCandles('BTC', '1h', 100);
    expect(spot.fetchKlines).toHaveBeenCalledTimes(1);
    expect(futures.fetchKlines).not.toHaveBeenCalled();
  });

  it('resolves the multiplier contract symbol from the authoritative universe', async () => {
    const { provider, futures } = makeProvider();
    await provider.getCandles('1000PEPE', '1h', 100, { market: 'futures' });
    expect(futures.fetchKlines.mock.calls[0][0]).toBe('1000PEPEUSDT');
  });

  it('never silently falls back to Spot candles for an unlisted contract', async () => {
    const { provider, spot, futures } = makeProvider();
    await expect(provider.getCandles('PEPE', '1h', 100, { market: 'futures' }))
      .rejects.toBeInstanceOf(UnsupportedMarketSymbolError);
    expect(spot.fetchKlines).not.toHaveBeenCalled();
    expect(futures.fetchKlines).not.toHaveBeenCalled();
  });

  it('caches Spot and Futures candles under separate keys', async () => {
    const { provider, spot, futures } = makeProvider({ cacheTtlMs: 60_000 });
    const spotCandles = await provider.getCandles('BTC', '1h', 100, { market: 'spot' });
    const futuresCandles = await provider.getCandles('BTC', '1h', 100, { market: 'futures' });
    expect(spot.fetchKlines).toHaveBeenCalledTimes(1);
    expect(futures.fetchKlines).toHaveBeenCalledTimes(1);
    expect(spotCandles[0].close).not.toBeCloseTo(futuresCandles[0].close, 6);

    // Second identical request is served from cache — no extra upstream hit.
    await provider.getCandles('BTC', '1h', 100, { market: 'futures' });
    expect(futures.fetchKlines).toHaveBeenCalledTimes(1);
  });

  it('marks futures candles with the futures provenance market', async () => {
    const { provider } = makeProvider();
    const candles = await provider.getCandles('BTC', '1h', 100, { market: 'futures' });
    expect(candles.every((c: OHLCV) => (c as unknown as { provenance?: { market?: string } }).provenance?.market !== 'spot')).toBe(true);
  });
});

/** UI-level routing: the page asks for the market its route represents. */
function renderFuturesContract(provider: MarketDataProvider, path = '/futures/BTC') {
  resetExchangeUniverseForTests();
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ symbols: [], contracts: [], assets: {} }) })));
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ThemeProvider>
        <MarketDataProviderComponent customProvider={provider}>
          <Routes><Route path="/futures/:symbol" element={<FuturesContractPage />} /></Routes>
        </MarketDataProviderComponent>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

/** The chart state banner is addressed by its stable data-qa hook. */
const chartState = () => document.querySelector('[data-qa="futures-chart-state"]');

function stubProvider(getCandles: unknown, extra: Record<string, unknown> = {}): MarketDataProvider {
  return {
    isDemo: true,
    getMarketOverview: vi.fn(),
    getAssets: vi.fn().mockResolvedValue([]),
    getAssetDetail: vi.fn().mockResolvedValue(null),
    getAssetSnapshot: vi.fn().mockResolvedValue(null),
    getCandles,
    getFuturesList: vi.fn().mockResolvedValue([]),
    getFuturesContract: vi.fn().mockResolvedValue(null),
    getLiquidations: vi.fn().mockRejectedValue(new Error('no stream')),
    getRadarEvents: vi.fn().mockResolvedValue([]),
    getScreenerResults: vi.fn().mockResolvedValue([]),
    ...extra,
  } as unknown as MarketDataProvider;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  RealtimeFeedManager.getInstance().destroy();
});

describe('futures contract terminal (UI → data service)', () => {
  it('requests FUTURES candles for a /futures/:symbol deep link', async () => {
    const getCandles = vi.fn().mockResolvedValue(
      Array.from({ length: 30 }, (_, i) => ({ time: 1_726_358_400 + i * 3600, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 })),
    );
    renderFuturesContract(stubProvider(getCandles));
    await waitFor(() => expect(getCandles).toHaveBeenCalled());
    const [symbol, timeframe, limit, options] = getCandles.mock.calls[0];
    expect(symbol).toBe('BTC');
    expect(timeframe).toBe('1h');
    expect(limit).toBe(500);
    expect(options.market).toBe('futures');
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it('shows the unsupported-pair state instead of an empty canvas', async () => {
    const getCandles = vi.fn().mockRejectedValue(new UnsupportedMarketSymbolError('GHOST', 'futures'));
    renderFuturesContract(stubProvider(getCandles), '/futures/GHOST');
    await waitFor(() => expect(chartState()).not.toBeNull());
    expect(chartState()?.getAttribute('data-chart-state')).toBe('unsupported');
  });

  it('shows the upstream-unavailable state with a retry affordance', async () => {
    const getCandles = vi.fn().mockRejectedValue(new Error('binance timeout'));
    renderFuturesContract(stubProvider(getCandles));
    await waitFor(() => expect(chartState()?.getAttribute('data-chart-state')).toBe('unavailable'));
    expect(document.querySelector('[data-qa="futures-chart-state-retry"]')).not.toBeNull();
  });

  it('shows the no-data state when the source returns an empty series', async () => {
    const getCandles = vi.fn().mockResolvedValue([]);
    renderFuturesContract(stubProvider(getCandles));
    await waitFor(() => expect(chartState()?.getAttribute('data-chart-state')).toBe('no-data'));
  });

  it('discards a stale response that arrives after the timeframe changed', async () => {
    const resolvers: Array<(rows: unknown[]) => void> = [];
    const series = (close: number) =>
      Array.from({ length: 30 }, (_, i) => ({ time: 1_726_358_400 + i * 3600, open: close, high: close, low: close, close, volume: 1 }));
    const getCandles = vi.fn((_symbol: string, _timeframe: string, _limit: number, _options: { market: string; signal: AbortSignal }) =>
      new Promise((resolve) => { resolvers.push(resolve as (rows: unknown[]) => void); }));

    renderFuturesContract(stubProvider(getCandles));
    await waitFor(() => expect(getCandles).toHaveBeenCalledTimes(1));

    // Switch the timeframe before the first response lands. Таймфрейм живёт
    // в ЕДИНОМ тулбаре терминала (общий с Spot), а не в аварийном ряду кнопок.
    const trigger = await screen.findByTestId('chart-timeframe-trigger');
    await act(async () => { trigger.click(); });
    const option = await screen.findByTestId('chart-timeframe-4h');
    await act(async () => { option.click(); });
    await waitFor(() => expect(getCandles).toHaveBeenCalledTimes(2));

    // The FIRST (now stale) request resolves last — it must be ignored.
    await act(async () => { resolvers[1](series(50)); resolvers[0](series(10)); await Promise.resolve(); });

    // 'ready' убирает баннер состояния полностью — график отрисован.
    await waitFor(() => expect(chartState()).toBeNull());
    expect(getCandles.mock.calls[1][1]).toBe('4h');
    // The abort signal of the superseded request was cancelled.
    expect(getCandles.mock.calls[0][3].signal.aborted).toBe(true);
  });
});

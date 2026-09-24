import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { MarketDataProvider } from '@/services/data/MarketDataProvider';
import type { AssetDetail, OHLCV, Timeframe } from '@/types/market';
import { CoinDetailPage } from '@/pages/CoinDetailPage';
import { MarketDataProviderComponent } from '@/context/MarketDataContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { RealtimeFeedManager } from '@/services/realtime/RealtimeFeedManager';

/**
 * P0 regression: switching the timeframe on /coin/:symbol froze the Chrome
 * renderer. These tests bound the observable per-switch work so a regression
 * shows up as an assertion failure (or a runner timeout) instead of a hang.
 *
 * They assert, after every switch:
 *   - chart time-scale callbacks stay bounded (no A<->B logical-range ping-pong),
 *   - React render count stays bounded (no setState feedback loop),
 *   - exactly ONE kline subscription is live and the previous one was removed,
 *   - candles for the newly selected timeframe are rendered.
 */

/** Counts every logical-range callback + tracks live chart instances. */
const chartProbe = vi.hoisted(() => ({
  rangeCallbacks: 0,
  created: 0,
  removed: 0,
  instances: [] as any[],
  reset() {
    this.rangeCallbacks = 0;
    this.created = 0;
    this.removed = 0;
    this.instances = [];
  },
}));

vi.mock('lightweight-charts', () => {
  const makeSeries = () => ({
    setData: vi.fn(), update: vi.fn(), applyOptions: vi.fn(),
    createPriceLine: vi.fn(() => ({})), removePriceLine: vi.fn(), setMarkers: vi.fn(),
    priceScale: () => ({ applyOptions: vi.fn() }),
  });
  return {
    ColorType: { Solid: 'solid' },
    LineStyle: { Solid: 0, Dotted: 1, Dashed: 2, LargeDashed: 3, SparseDotted: 4 },
    TickMarkType: { Year: 0, Month: 1, DayOfMonth: 2, Time: 3, TimeWithSeconds: 4 },
    createChart: vi.fn(() => {
      // A realistic time scale: it REMEMBERS the range and NOTIFIES subscribers,
      // so a genuine feedback loop between panes would be counted here.
      let range: { from: number; to: number } | null = null;
      const listeners = new Set<(r: { from: number; to: number } | null) => void>();
      const timeScale = {
        fitContent: vi.fn(() => {
          range = { from: 0, to: 100 };
          listeners.forEach((listener) => listener(range));
        }),
        applyOptions: vi.fn(),
        getVisibleLogicalRange: vi.fn(() => range),
        setVisibleLogicalRange: vi.fn((next: { from: number; to: number }) => {
          if (range && range.from === next.from && range.to === next.to) return;
          range = next;
          listeners.forEach((listener) => listener(range));
        }),
        subscribeVisibleLogicalRangeChange: vi.fn((cb: (r: { from: number; to: number } | null) => void) => {
          listeners.add((value) => { chartProbe.rangeCallbacks += 1; cb(value); });
        }),
        unsubscribeVisibleLogicalRangeChange: vi.fn(() => { listeners.clear(); }),
      };
      const instance = {
        applyOptions: vi.fn(),
        addCandlestickSeries: makeSeries, addHistogramSeries: makeSeries,
        addLineSeries: makeSeries, addBarSeries: makeSeries,
        priceScale: () => ({ applyOptions: vi.fn() }),
        subscribeCrosshairMove: vi.fn(), unsubscribeCrosshairMove: vi.fn(),
        subscribeClick: vi.fn(), unsubscribeClick: vi.fn(),
        timeScale: () => timeScale,
        remove: vi.fn(() => { chartProbe.removed += 1; listeners.clear(); }),
      };
      chartProbe.created += 1;
      chartProbe.instances.push(instance);
      return instance;
    }),
  };
});

/**
 * Produces a REAL-SHAPED gapped volume distribution — the exact geometry that
 * froze the renderer in production:
 *   bucket 23 (top) -> the POC
 *   bucket 22       -> empty (a price gap, ordinary in real OHLCV)
 *   buckets 0..21   -> the remaining volume, stranded beyond the gap
 * The page computes indicators from these candles on every timeframe switch, so
 * without the value-area fix this data hangs the thread synchronously.
 */
function candles(count: number, stepSeconds: number): OHLCV[] {
  const rows: OHLCV[] = [];
  let time = 1_780_000_000;
  // Establishes the 1..100 price range => 24 buckets of 4.125.
  rows.push({ time, open: 50, high: 100, low: 1, close: 50, volume: 0 });
  // Two heavy candles in the TOP bucket make it the POC.
  for (let i = 0; i < 2; i += 1) {
    time += stepSeconds;
    rows.push({ time, open: 97.875, high: 97.875, low: 97.875, close: 97.875, volume: 30 });
  }
  // The rest of the volume sits in buckets 0..21, unreachable past the empty bucket 22.
  for (let i = rows.length; i < count; i += 1) {
    time += stepSeconds;
    const price = 1 + 4.125 * (i % 22) + 2;
    rows.push({ time, open: price, high: price, low: price, close: price, volume: 1 });
  }
  return rows;
}

const STEP: Record<string, number> = { '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '4h': 14400, '1D': 86400, '1W': 604800 };

function detail(symbol: string): AssetDetail {
  return {
    id: symbol.toLowerCase(), symbol, name: symbol === 'BTC' ? 'Bitcoin' : 'Solana', category: 'l1',
    rank: 1, price: 81_000, change1h: null, change24h: 1, change7d: null, volume24h: 10_000,
    marketCap: 1_000_000, circulatingSupply: 100, sparkline: [], isDemo: false,
    description: '', indicators: null, pairs: [], high24h: 82_000, low24h: 80_000,
  } as AssetDetail;
}

/** Tracks kline subscribe/unsubscribe so we can assert exactly one live stream. */
function trackKlineStreams() {
  const feed = RealtimeFeedManager.getInstance();
  const live = new Set<string>();
  const history: string[] = [];
  const subscribeSpy = vi.spyOn(feed, 'subscribeKline').mockImplementation((symbol: string, interval: string) => {
    live.add(`${symbol.toUpperCase()}:${interval}`);
    history.push(`+${symbol.toUpperCase()}:${interval}`);
  });
  const unsubscribeSpy = vi.spyOn(feed, 'unsubscribeKline').mockImplementation((symbol: string, interval: string) => {
    live.delete(`${symbol.toUpperCase()}:${interval}`);
    history.push(`-${symbol.toUpperCase()}:${interval}`);
  });
  return { live, history, restore: () => { subscribeSpy.mockRestore(); unsubscribeSpy.mockRestore(); } };
}

function renderCoinPage(symbol: string, getCandles: MarketDataProvider['getCandles'], onRender: () => void) {
  localStorage.setItem('cryptora_qa_fixture', '1');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
  const provider = {
    isDemo: false,
    getMarketOverview: vi.fn(),
    getAssets: vi.fn().mockResolvedValue([]),
    getAssetDetail: vi.fn().mockResolvedValue(detail(symbol)),
    getAssetSnapshot: vi.fn(async () => detail(symbol)),
    getCandles,
    getFuturesList: vi.fn().mockResolvedValue([]),
    getLiquidations: vi.fn().mockResolvedValue(null),
    getRadarEvents: vi.fn().mockResolvedValue([]),
    getScreenerResults: vi.fn().mockResolvedValue([]),
  } as unknown as MarketDataProvider;

  const Probe: React.FC = () => { onRender(); return <CoinDetailPage />; };

  return render(
    <MemoryRouter initialEntries={[`/coin/${symbol}`]}>
      <ThemeProvider>
        <MarketDataProviderComponent customProvider={provider}>
          <Routes><Route path="/coin/:symbol" element={<Probe />} /></Routes>
        </MarketDataProviderComponent>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => { chartProbe.reset(); });

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  localStorage.clear();
  RealtimeFeedManager.getInstance().destroy();
});

describe('timeframe switching stays bounded (P0 renderer hang)', () => {
  /**
   * Drives a real sequence of timeframe clicks and asserts the invariants after
   * each one. A synchronous hang (the original bug) never returns from
   * `fireEvent.click` and fails via the runner timeout.
   */
  async function runSwitchSequence(symbol: string, sequence: Timeframe[]) {
    const streams = trackKlineStreams();
    let renders = 0;
    const getCandles = vi.fn(async (_symbol: string, timeframe: Timeframe) =>
      candles(500, STEP[timeframe] ?? 3600));

    renderCoinPage(symbol, getCandles as unknown as MarketDataProvider['getCandles'], () => { renders += 1; });
    await screen.findByRole('heading', { name: symbol === 'BTC' ? 'Bitcoin' : 'Solana' });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    for (const timeframe of sequence) {
      chartProbe.rangeCallbacks = 0;
      const rendersBefore = renders;
      const startedAt = Date.now();

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: timeframe }));
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      const elapsed = Date.now() - startedAt;
      const rendersForSwitch = renders - rendersBefore;

      // 1. The switch must complete promptly — the bug froze the thread here.
      expect(elapsed, `switch to ${timeframe} took ${elapsed}ms`).toBeLessThan(3_000);
      // 2. Chart range callbacks bounded => no chart A <-> chart B ping-pong.
      expect(chartProbe.rangeCallbacks, `range callbacks after ${timeframe}`).toBeLessThan(40);
      // 3. React renders bounded => no setState feedback loop.
      expect(rendersForSwitch, `renders after ${timeframe}`).toBeLessThan(30);
      // 4. Exactly one live kline subscription; the previous one was removed.
      expect([...streams.live], `live kline subscriptions after ${timeframe}`).toHaveLength(1);
      expect([...streams.live][0]).toContain(symbol);
      // 5. Candles for the new timeframe were requested and rendered.
      expect(getCandles).toHaveBeenCalledWith(symbol, timeframe, ...(getCandles.mock.calls.at(-1)!.slice(2) as []));
      expect(screen.queryByText(/Источник пока не вернул историю свечей/)).not.toBeInTheDocument();
    }

    // The old subscription must never linger after the whole sequence.
    expect([...streams.live]).toHaveLength(1);
    const lastInterval = sequence.at(-1) === '1D' ? '1d' : sequence.at(-1) === '1W' ? '1w' : sequence.at(-1);
    expect([...streams.live][0]).toBe(`${symbol}:${lastInterval}`);
    streams.restore();
    return { renders };
  }

  it('BTC: 1h -> 15m -> 1h -> 5m stays responsive with one live subscription', async () => {
    await runSwitchSequence('BTC', ['1h', '15m', '1h', '5m']);
  });

  it('SOL: 1h -> 15m stays responsive with one live subscription', async () => {
    await runSwitchSequence('SOL', ['1h', '15m']);
  });

  it('tears every chart instance down when the page unmounts (no leaked panes)', async () => {
    const streams = trackKlineStreams();
    const getCandles = vi.fn(async (_s: string, tf: Timeframe) => candles(300, STEP[tf] ?? 3600));
    const view = renderCoinPage('BTC', getCandles as unknown as MarketDataProvider['getCandles'], () => {});
    await screen.findByRole('heading', { name: 'Bitcoin' });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '15m' }));
      await Promise.resolve();
    });

    const createdBeforeUnmount = chartProbe.created;
    expect(createdBeforeUnmount).toBeGreaterThan(0);

    view.unmount();

    // Every chart created during the session is removed, and no kline stream survives.
    expect(chartProbe.removed).toBe(createdBeforeUnmount);
    expect([...streams.live]).toHaveLength(0);
    streams.restore();
  });
});

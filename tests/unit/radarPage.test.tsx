import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { MarketDataProvider } from '@/services/data/MarketDataProvider';
import type { RadarEvent } from '@/types/market';
import { RealtimeFeedManager } from '@/services/realtime/RealtimeFeedManager';
import { resetScanUniverseForTests } from '@/services/signals/scanUniverse';
import type { TickerTick } from '@/types/realtime';

const marketContext = vi.hoisted(() => ({
  current: null as null | { provider: MarketDataProvider; dataMode: 'live' | 'demo' },
}));

vi.mock('@/context/MarketDataContext', () => ({
  useMarketData: () => marketContext.current,
}));

import { RadarPage } from '@/pages/RadarPage';

function radarEvent(overrides: Partial<RadarEvent> = {}): RadarEvent {
  return {
    id: 'radar-live-1',
    timestamp: '2026-09-26T10:00:00.000Z',
    symbol: 'BTC',
    type: 'PRICE_MOVE',
    severity: 'HIGH',
    metricValue: '+4.5%',
    observation: 'Фактический импульс из ticker-потока.',
    isDemo: false,
    ...overrides,
  };
}

function provider(overrides: Partial<MarketDataProvider> = {}): MarketDataProvider {
  return {
    isDemo: false,
    getMarketOverview: vi.fn().mockResolvedValue({}),
    getAssets: vi.fn().mockResolvedValue([]),
    getAssetDetail: vi.fn().mockResolvedValue(null),
    getCandles: vi.fn().mockResolvedValue([]),
    getFuturesList: vi.fn().mockResolvedValue([]),
    getLiquidations: vi.fn().mockResolvedValue({ events: [], total24h: 0, buyVolume24h: 0, sellVolume24h: 0, source: 'actual' }),
    getRadarEvents: vi.fn().mockResolvedValue([]),
    getScreenerResults: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as MarketDataProvider;
}

function tick(symbol: string, index: number, price = 100): TickerTick {
  return {
    symbol,
    price,
    priceChangePercent24h: 0,
    high24h: price + 1,
    low24h: price - 1,
    volume24h: 1000 + (index % 2),
    quoteVolume24h: (1000 + (index % 2)) * price,
    timestamp: Date.UTC(2026, 8, 26, 10, 0, index),
    provenance: { exchange: 'binance', market: 'spot', symbol: `${symbol}USDT`, timestamp: Date.UTC(2026, 8, 26, 10, 0, index) },
  };
}

function warm(symbols: string[], observations = 20): void {
  const manager = RealtimeFeedManager.getInstance();
  for (let i = 0; i < observations; i += 1) {
    for (const symbol of symbols) {
      manager.anomalyEngine.processTick(tick(symbol, i));
    }
  }
}

function stubScanUniverse(symbols: string[], activeKnown = true): void {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).includes('/api/strategies/scan-universe')) {
      return {
        ok: true,
        json: async () => ({ symbols, activeKnown }),
      };
    }
    return { ok: true, json: async () => ({}) };
  }));
}

function renderRadar(marketProvider: MarketDataProvider, dataMode: 'live' | 'demo' = 'live') {
  marketContext.current = { provider: marketProvider, dataMode };
  return render(
    <MemoryRouter>
      <RadarPage />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetScanUniverseForTests();
  RealtimeFeedManager.getInstance().destroy();
  marketContext.current = null;
});

beforeEach(() => {
  resetScanUniverseForTests();
  RealtimeFeedManager.getInstance().destroy();
});

describe('RadarPage LIVE empty states and event flow', () => {
  it('shows WARMING while the detector lacks sufficient observations', async () => {
    stubScanUniverse(['BTC', 'ETH', 'SOL']);
    renderRadar(provider());

    expect(await screen.findByText('Радар набирает окно наблюдений…')).toBeInTheDocument();
    expect(document.querySelector('[data-qa="radar-empty-state"]') as HTMLElement).toHaveAttribute('data-state', 'warming');
    expect((document.querySelector('[data-qa="radar-live-status"]') as HTMLElement).textContent).toContain('WARMING');
  });

  it('shows READY/no-anomaly state after the subscribed universe is warmed', async () => {
    warm(['BTC', 'ETH']);
    stubScanUniverse(['BTC', 'ETH']);
    renderRadar(provider());

    expect(await screen.findByText('В текущем LIVE-окне аномалий не обнаружено.')).toBeInTheDocument();
    expect(document.querySelector('[data-qa="radar-empty-state"]') as HTMLElement).toHaveAttribute('data-state', 'ready-empty');
    expect((document.querySelector('[data-qa="radar-live-status"]') as HTMLElement).textContent).toContain('LIVE · 2 symbols');
  });

  it('renders a realtime radar event once even if the EventBus emits the same id twice', async () => {
    stubScanUniverse(['BTC']);
    renderRadar(provider());
    await screen.findByText('Радар набирает окно наблюдений…');

    const event = radarEvent();
    act(() => {
      RealtimeFeedManager.getInstance().eventBus.publishRadarEvent(event);
      RealtimeFeedManager.getInstance().eventBus.publishRadarEvent(event);
    });

    expect(await screen.findByText('Фактический импульс из ticker-потока.')).toBeInTheDocument();
    expect(Array.from(document.querySelectorAll('[data-qa="radar-event-row"]'))).toHaveLength(1);
  });

  it('distinguishes filter-empty from live-ready empty state', async () => {
    stubScanUniverse(['BTC']);
    renderRadar(provider({
      getRadarEvents: vi.fn().mockResolvedValue([
        radarEvent({ id: 'price', type: 'PRICE_MOVE', severity: 'HIGH' }),
        radarEvent({ id: 'volume', type: 'VOLUME_SPIKE', severity: 'MEDIUM', metricValue: '+3σ' }),
      ]),
    }));

    await waitFor(() => {
      expect(Array.from(document.querySelectorAll('[data-qa="radar-event-row"]'))).toHaveLength(2);
    });
    fireEvent.change(screen.getByLabelText('Тип аномалии'), { target: { value: 'OI_SPIKE' } });

    expect(await screen.findByText('Нет событий, соответствующих выбранным фильтрам.')).toBeInTheDocument();
    expect(document.querySelector('[data-qa="radar-empty-state"]') as HTMLElement).toHaveAttribute('data-state', 'filtered');
  });

  it('shows source-error state when the live radar source request fails', async () => {
    stubScanUniverse(['BTC']);
    renderRadar(provider({ getRadarEvents: vi.fn().mockRejectedValue(new Error('offline')) }));

    expect(await screen.findByText('Источник LIVE-радара недоступен.')).toBeInTheDocument();
    expect(document.querySelector('[data-qa="radar-empty-state"]') as HTMLElement).toHaveAttribute('data-state', 'source-error');
  });

  it('does not render demo/synthetic radar events in LIVE mode', async () => {
    warm(['BTC']);
    stubScanUniverse(['BTC']);
    renderRadar(provider({
      getRadarEvents: vi.fn().mockResolvedValue([
        radarEvent({ id: 'demo-event', isDemo: true, observation: 'QA event must not leak into LIVE.' }),
      ]),
    }));

    expect(await screen.findByText('В текущем LIVE-окне аномалий не обнаружено.')).toBeInTheDocument();
    expect(screen.queryByText('QA event must not leak into LIVE.')).toBeNull();
    expect(document.querySelector('[data-qa="radar-event-row"]')).toBeNull();
  });
});

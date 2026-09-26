import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { MarketDataProvider } from '@/services/data/MarketDataProvider';
import type { RadarEvent } from '@/types/market';
import type { ServerRadarStatus } from '@/services/radar/serverRadarClient';

const marketContext = vi.hoisted(() => ({
  current: null as null | { provider: MarketDataProvider; dataMode: 'live' | 'demo' },
}));

vi.mock('@/context/MarketDataContext', () => ({
  useMarketData: () => marketContext.current,
}));

import { RadarPage } from '@/pages/RadarPage';

function radarEvent(overrides: Partial<RadarEvent> = {}): RadarEvent {
  return {
    id: '0a2e9e72-bd2a-4c30-8d6b-2b3d7e9d0001',
    timestamp: '2026-09-26T10:00:00.000Z',
    symbol: 'BTC',
    type: 'PRICE_MOVE',
    severity: 'HIGH',
    metricValue: '+4.5%',
    observation: 'Persisted server ticker impulse.',
    isDemo: false,
    provenance: { exchange: 'binance', market: 'spot', symbol: 'BTCUSDT', timestamp: Date.UTC(2026, 8, 26, 10) },
    ...overrides,
  };
}

function status(overrides: Partial<ServerRadarStatus> = {}): ServerRadarStatus {
  return {
    source: 'server',
    running: true,
    lifecycle: 'warming',
    configuredUniverseCount: 3,
    activeUniverseCount: 3,
    inactiveUniverseCount: 0,
    activeUniverseKnown: true,
    detector: {
      windowSize: 20,
      trackedSymbols: 3,
      warmedSymbols: 0,
      maxObservations: 4,
      warm: false,
      symbols: [],
    },
    marketFeed: {
      state: 'connected',
      subscribedSymbols: 3,
      lastMessageAt: '2026-09-26T10:00:00.000Z',
      stale: false,
      reconnectAttempt: 0,
      source: 'binance-spot-ticker',
    },
    startedAt: '2026-09-26T09:00:00.000Z',
    lastUniverseRefreshAt: '2026-09-26T10:00:00.000Z',
    lastPersistedEventAt: null,
    persistedEvents: 0,
    deduplicatedEvents: 0,
    retainedDeletes: 0,
    retentionDays: 30,
    lastError: null,
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

function installServerRadar({ events = [], detectorStatus = status(), fail = false }: {
  events?: RadarEvent[];
  detectorStatus?: ServerRadarStatus;
  fail?: boolean;
} = {}): void {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (fail) return { ok: false, status: 503, json: async () => ({}) };
    if (String(url).startsWith('/api/radar/events')) {
      return { ok: true, status: 200, json: async () => ({ events, count: events.length, source: 'server' }) };
    }
    if (String(url) === '/api/radar/status') {
      return { ok: true, status: 200, json: async () => detectorStatus };
    }
    throw new Error(`unexpected fetch ${url}`);
  }));
}

function renderRadar(marketProvider: MarketDataProvider, dataMode: 'live' | 'demo' = 'live') {
  marketContext.current = { provider: marketProvider, dataMode };
  return render(<MemoryRouter><RadarPage /></MemoryRouter>);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  marketContext.current = null;
});

describe('RadarPage server-authoritative event flow', () => {
  it('shows server WARMING telemetry without creating a local detector', async () => {
    installServerRadar();
    const liveProvider = provider();
    renderRadar(liveProvider);

    expect(await screen.findByText('Радар набирает окно наблюдений…')).toBeInTheDocument();
    expect(document.querySelector('[data-qa="radar-empty-state"]')).toHaveAttribute('data-state', 'warming');
    expect(document.querySelector('[data-qa="radar-source-telemetry"]')?.textContent).toContain('SERVER · Scan Universe: 3 · warmed: 0/3 · feed: connected');
    expect(liveProvider.getRadarEvents).not.toHaveBeenCalled();
  });

  it('shows ready/no-anomaly only after the server detector reports warm', async () => {
    installServerRadar({ detectorStatus: status({
      lifecycle: 'live',
      detector: { windowSize: 20, trackedSymbols: 2, warmedSymbols: 2, maxObservations: 20, warm: true, symbols: [] },
      activeUniverseCount: 2,
    }) });
    renderRadar(provider());

    expect(await screen.findByText('В текущем LIVE-окне аномалий не обнаружено.')).toBeInTheDocument();
    expect(document.querySelector('[data-qa="radar-live-status"]')?.textContent).toContain('LIVE · 2 symbols');
  });

  it('renders persisted server history and filters it without browser EventBus arrivals', async () => {
    installServerRadar({ events: [
      radarEvent({ id: 'one', type: 'PRICE_MOVE', severity: 'HIGH' }),
      radarEvent({ id: 'two', type: 'VOLUME_SPIKE', severity: 'MEDIUM', observation: 'Persisted server volume spike.' }),
    ], detectorStatus: status({ lifecycle: 'live', detector: { windowSize: 20, trackedSymbols: 1, warmedSymbols: 1, maxObservations: 20, warm: true, symbols: [] }, activeUniverseCount: 1 }) });
    renderRadar(provider());

    expect(await screen.findByText('Persisted server ticker impulse.')).toBeInTheDocument();
    expect(Array.from(document.querySelectorAll('[data-qa="radar-event-row"]'))).toHaveLength(2);
    fireEvent.change(screen.getByLabelText('Тип аномалии'), { target: { value: 'OI_SPIKE' } });
    expect(await screen.findByText('Нет событий, соответствующих выбранным фильтрам.')).toBeInTheDocument();
  });

  it('reload reads the same persisted event and does not reset server warm-up', async () => {
    const live = status({ lifecycle: 'live', detector: { windowSize: 20, trackedSymbols: 1, warmedSymbols: 1, maxObservations: 20, warm: true, symbols: [] }, activeUniverseCount: 1 });
    installServerRadar({ events: [radarEvent({ observation: 'Detected while Radar page was closed.' })], detectorStatus: live });
    const view = renderRadar(provider());
    expect(await screen.findByText('Detected while Radar page was closed.')).toBeInTheDocument();
    view.unmount();

    renderRadar(provider());
    expect(await screen.findByText('Detected while Radar page was closed.')).toBeInTheDocument();
    expect(document.querySelector('[data-qa="radar-source-telemetry"]')?.textContent).toContain('warmed: 1/1');
  });

  it('shows source error when server history/status is unavailable', async () => {
    installServerRadar({ fail: true });
    renderRadar(provider());
    expect(await screen.findByText('Источник LIVE-радара недоступен.')).toBeInTheDocument();
    expect(document.querySelector('[data-qa="radar-empty-state"]')).toHaveAttribute('data-state', 'source-error');
  });
});

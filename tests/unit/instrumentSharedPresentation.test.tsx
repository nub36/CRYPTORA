import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { CoinDetailPage } from '@/pages/CoinDetailPage';
import { MarketDataProviderComponent } from '@/context/MarketDataContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { RealtimeFeedManager } from '@/services/realtime/RealtimeFeedManager';
import { resetExchangeUniverseForTests } from '@/services/data/registry/exchangeUniverse';
import { resetCoinLogoCacheForTests } from '@/services/data/registry/coinLogoRegistry';
import type { MarketDataProvider } from '@/services/data/MarketDataProvider';
import type { AssetDetail, OHLCV } from '@/types/market';

/**
 * ОБЩИЙ ПРЕЗЕНТАЦИОННЫЙ СЛОЙ (задачи §2, §17, §18).
 *
 * Требование владельца: «изменение общего тулбара/карточки метрики не должно
 * требовать двух правок» и «не копировать CoinDetailPage во второй огромный
 * компонент». Поэтому проверяется два уровня:
 *   1) runtime — Spot-страница рендерит ТЕ ЖЕ секции, что и фьючерсная, и
 *      запрашивает свечи с market='spot';
 *   2) исходники — обе страницы ходят в один и тот же shared-слой, а не
 *      держат собственные копии карточек/терминала/загрузки свечей.
 */

const SRC = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const COIN_PAGE = SRC('src/pages/CoinDetailPage.tsx');
const FUTURES_PAGE = SRC('src/pages/FuturesContractPage.tsx');

function spotCandles(): OHLCV[] {
  return Array.from({ length: 220 }, (_, i) => ({
    time: 1_726_358_400 + i * 3600,
    open: 60_000, high: 60_500, low: 59_500,
    close: 60_000 * (1 + Math.sin(i / 9) / 100),
    volume: 1_000 + i,
  }));
}

function asset(symbol: string): AssetDetail {
  return {
    id: symbol.toLowerCase(), symbol, name: symbol, category: 'l1', rank: 1,
    price: 60_000, change1h: 0.2, change24h: 1.4, change7d: null, volume24h: 25_000_000_000,
    marketCap: 1_180_000_000_000, circulatingSupply: 19_700_000, sparkline: [], isDemo: false,
    description: 'test', indicators: null, pairs: [], high24h: 61_000, low24h: 59_000,
  };
}

function renderSpot(provider: MarketDataProvider) {
  resetExchangeUniverseForTests();
  resetCoinLogoCacheForTests();
  vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL) => {
    const u = String(url);
    if (u.includes('/api/market/universe/spot')) {
      return { ok: true, json: async () => ({ symbols: [{ symbol: 'BTC', exchangeSymbol: 'BTCUSDT', baseAsset: 'BTC' }], fetchedAt: '', stale: false }) };
    }
    return { ok: true, json: async () => ({ assets: {} }) };
  }));
  return render(
    <MemoryRouter initialEntries={['/coin/BTC']}>
      <ThemeProvider>
        <MarketDataProviderComponent customProvider={provider}>
          <Routes><Route path="/coin/:symbol" element={<CoinDetailPage />} /></Routes>
        </MarketDataProviderComponent>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

function spotProvider(overrides: Record<string, unknown> = {}): MarketDataProvider {
  return {
    isDemo: false,
    getMarketOverview: vi.fn(),
    getAssets: vi.fn().mockResolvedValue([]),
    getAssetDetail: vi.fn().mockResolvedValue(asset('BTC')),
    getAssetSnapshot: vi.fn().mockResolvedValue(asset('BTC')),
    getCandles: vi.fn(async () => spotCandles()),
    getFuturesList: vi.fn().mockResolvedValue([]),
    getLiquidations: vi.fn().mockRejectedValue(new Error('no stream')),
    getRadarEvents: vi.fn().mockResolvedValue([]),
    getScreenerResults: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as MarketDataProvider;
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  RealtimeFeedManager.getInstance().destroy();
});

describe('spot detail page keeps market="spot" end to end', () => {
  it('requests spot candles and tags every shared section as spot', async () => {
    const getCandles = vi.fn(async (_s: string, _tf: string, _l: number, options?: { market?: string }) => {
      expect(options?.market ?? 'spot').toBe('spot');
      return spotCandles();
    });
    renderSpot(spotProvider({ getCandles }));

    await waitFor(() => expect(document.querySelector('[data-qa="spot-market-statistics"]')).not.toBeNull());
    for (const call of getCandles.mock.calls) {
      expect(call[3]?.market ?? 'spot').toBe('spot');
    }
    for (const qa of ['spot-market-statistics', 'spot-indicators']) {
      expect(document.querySelector(`[data-qa="${qa}"]`)?.getAttribute('data-market'), qa).toBe('spot');
    }
    // И тот же самый унифицированный тулбар, что на фьючерсной странице.
    await waitFor(() => expect(document.querySelector('[data-qa="chart-terminal-toolbar"]')).not.toBeNull());
    expect(document.querySelector('[data-qa="chart-terminal-toolbar"]')!.getAttribute('data-controls')).toBe('unified');
  });
});

describe('one presentation layer, two markets', () => {
  it('both pages consume the shared instrument components', () => {
    for (const [name, source] of [['CoinDetailPage', COIN_PAGE], ['FuturesContractPage', FUTURES_PAGE]] as const) {
      expect(source, name).toMatch(/from '@\/components\/instrument'/);
      expect(source, name).toMatch(/InstrumentChartCard/);
      expect(source, name).toMatch(/InstrumentMetricsCard/);
      expect(source, name).toMatch(/InstrumentRadarCard/);
      // Терминал графика инстанцирует только общая карточка.
      expect(source.includes('<ChartTerminal'), `${name} must not mount ChartTerminal directly`).toBe(false);
    }
  });

  it('both pages load candles through the same hook (no duplicated fetch effect)', () => {
    for (const [name, source] of [['CoinDetailPage', COIN_PAGE], ['FuturesContractPage', FUTURES_PAGE]] as const) {
      expect(source, name).toMatch(/useInstrumentCandles\(/);
    }
    expect(FUTURES_PAGE).toMatch(/market: 'futures'/);
    expect(COIN_PAGE).toMatch(/market: 'spot'/);
  });

  it('metric rows, section shell and derivative rows are declared exactly once', () => {
    const metrics = SRC('src/components/instrument/instrumentMetrics.tsx');
    const shell = SRC('src/components/instrument/InstrumentSectionCard.tsx');
    expect(metrics).toMatch(/export function buildSpotStatisticsRows/);
    expect(metrics).toMatch(/export function buildFuturesStatisticsRows/);
    expect(metrics).toMatch(/export function buildDerivativesRows/);
    expect(metrics).toMatch(/export function buildTechnicalRows/);
    expect(metrics).toMatch(/export function buildCorrelationRows/);
    expect(shell).toMatch(/export const InstrumentSectionCard/);
    // Страницы не строят строки метрик самостоятельно.
    for (const source of [COIN_PAGE, FUTURES_PAGE]) {
      expect(source).not.toMatch(/function build(Spot|Futures)StatisticsRows/);
      expect(source).not.toMatch(/function buildDerivativesRows/);
    }
  });

  it('keeps the futures page a thin container rather than a second 2000-line copy', () => {
    const futuresLines = FUTURES_PAGE.split('\n').length;
    expect(futuresLines).toBeLessThan(700);
    expect(futuresLines * 3).toBeLessThan(COIN_PAGE.split('\n').length * 3);
  });

  it('never wires a spot data source into the futures container', () => {
    // Спотовые хуки/эндпоинты на странице контракта недопустимы (§3).
    expect(FUTURES_PAGE).not.toMatch(/useLivePrices|useRealtimeKline/);
    expect(FUTURES_PAGE).not.toMatch(/api\/v3\//);
    expect(FUTURES_PAGE).not.toMatch(/market: 'spot'/);
  });
});

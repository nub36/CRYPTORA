import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CoinDetailPage } from '@/pages/CoinDetailPage';
import { FuturesContractPage } from '@/pages/FuturesContractPage';
import { InstrumentMetricsGrid, trailingFillClasses } from '@/components/instrument';
import { InstrumentMetricsCard } from '@/components/instrument';
import { MarketDataProviderComponent } from '@/context/MarketDataContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { RealtimeFeedManager } from '@/services/realtime/RealtimeFeedManager';
import { resetExchangeUniverseForTests } from '@/services/data/registry/exchangeUniverse';
import { resetCoinLogoCacheForTests } from '@/services/data/registry/coinLogoRegistry';
import type { MarketDataProvider } from '@/services/data/MarketDataProvider';
import type { AssetDetail, FuturesAsset, OHLCV } from '@/types/market';

/**
 * LAYOUT-КОНТРАКТ СЕТКИ МЕТОК ИНСТРУМЕНТА (UI-cleanup после PR #37, §3/§4/§6).
 *
 * Регрессия: четыре карточки («Рыночная статистика», «Деривативы»,
 * «Технические индикаторы», «Корреляция с BTC») рендерились в фиксированный
 * 3-колоночный grid. Четвёртая карточка занимала первую ячейку второй
 * строки, а ДВЕ оставшиеся ячейки оставались пустыми — на desktop ниже
 * трёх карточек висела «дыра» в 2/3 ширины страницы.
 *
 * Контракт заполнения (общий для Spot и Futures):
 *   mobile  (<768px)  — 1 колонка;
 *   tablet  (768px+)  — 2 колонки, нечётный «хвост» закрывает обе;
 *   desktop (1024px+) — 3 колонки, 4-я карточка («Корреляция с BTC»)
 *                       занимает ВСЮ вторую строку (lg:col-span-3) с
 *                       горизонтальным inline-контентом внутри.
 */

const SRC = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const COIN_PAGE = SRC('src/pages/CoinDetailPage.tsx');
const FUTURES_PAGE = SRC('src/pages/FuturesContractPage.tsx');
const CHART_CARD = SRC('src/components/instrument/InstrumentChartCard.tsx');

const hasClass = (className: string, fragment: string) =>
  new RegExp(`(^| )${fragment}( |$)`).test(className);

afterEach(() => {
  vi.unstubAllGlobals();
  RealtimeFeedManager.getInstance().destroy();
  cleanupDom();
});

function cleanupDom() {
  document.body.innerHTML = '';
}

/* ============================== UNIT: правила заполнения ============================== */

describe('trailingFillClasses — правило поглощения хвостовых ячеек', () => {
  it('четыре карточки: последняя занимает всю строку только на desktop (3 колонки)', () => {
    // tablet: 4 % 2 === 0 → 2×2 без пустых ячеек, span не нужен.
    expect(trailingFillClasses(4)).toEqual(['lg:col-span-3']);
  });

  it('три карточки: последняя закрывает обе колонки tablet и сбрасывается на desktop', () => {
    expect(trailingFillClasses(3)).toEqual(['md:col-span-2', 'lg:col-span-1']);
  });

  it('одна/две/шесть карточек: сетка заполняется ровно, span-правила не нужны', () => {
    expect(trailingFillClasses(1)).toEqual([]);
    expect(trailingFillClasses(2)).toEqual([]);
    expect(trailingFillClasses(6)).toEqual([]);
  });
});

/* ============================== COMPONENT: сетка и карточки ============================== */

describe('InstrumentMetricsGrid — DOM-контракт', () => {
  const cards = (count: number) => Array.from({ length: count }, (_, i) => (
    <InstrumentMetricsCard
      key={i}
      title={`Карточка ${i + 1}`}
      market="futures"
      status="ready"
      qa={`grid-card-${i}`}
      rows={[{ label: 'Метка', value: '1', qa: 'row' }]}
    />
  ));

  it('контейнер: 1 колонка (mobile) → 2 (tablet) → 3 (desktop)', () => {
    render(<InstrumentMetricsGrid>{cards(4)}</InstrumentMetricsGrid>);
    const grid = document.querySelector('[data-qa="instrument-metrics-grid"]')!;
    expect(grid).not.toBeNull();
    expect(hasClass(grid.className, 'grid')).toBe(true);
    expect(hasClass(grid.className, 'grid-cols-1')).toBe(true);
    expect(hasClass(grid.className, 'md:grid-cols-2')).toBe(true);
    expect(hasClass(grid.className, 'lg:grid-cols-3')).toBe(true);
    expect(grid.getAttribute('data-count')).toBe('4');
  });

  it('четыре карточки: «Корреляция»-позиция (последняя) растягивается на всю строку desktop', () => {
    render(<InstrumentMetricsGrid>{cards(4)}</InstrumentMetricsGrid>);
    const last = document.querySelector('[data-qa="grid-card-3"]')!;
    const others = [0, 1, 2].map((i) => document.querySelector(`[data-qa="grid-card-${i}"]`)!);

    expect(hasClass(last.className, 'lg:col-span-3')).toBe(true);
    // Никаких col-span у карточек первой строки — они стоят ровно в 3 колонки.
    for (const card of others) {
      expect(card.className).not.toMatch(/col-span/);
    }
    // На tablet (2 колонки) 4 карточки дают ровные 2×2 — span не нужен.
    expect(hasClass(last.className, 'md:col-span-2')).toBe(false);
  });

  it('три карточки: последняя закрывает обе колонки tablet и становится обычной ячейкой на desktop', () => {
    render(<InstrumentMetricsGrid>{cards(3)}</InstrumentMetricsGrid>);
    const last = document.querySelector('[data-qa="grid-card-2"]')!;
    expect(hasClass(last.className, 'md:col-span-2')).toBe(true);
    expect(hasClass(last.className, 'lg:col-span-1')).toBe(true);
    expect(hasClass(last.className, 'lg:col-span-3')).toBe(false);
  });

  it('собственный className карточки сохраняется при слиянии со span-классами', () => {
    render(
      <InstrumentMetricsGrid>
        {cards(3)}
        <InstrumentMetricsCard
          title="Корреляция"
          market="futures"
          status="ready"
          qa="wide-card"
          className="custom-marker"
          rows={[]}
        />
      </InstrumentMetricsGrid>,
    );
    const wide = document.querySelector('[data-qa="wide-card"]')!;
    expect(hasClass(wide.className, 'custom-marker')).toBe(true);
    expect(hasClass(wide.className, 'lg:col-span-3')).toBe(true);
  });
});

/* ============================== INTEGRATION: страница фьючерса ============================== */

const solContract: FuturesAsset = {
  symbol: 'SOL/USDT',
  contractSymbol: 'SOLUSDT',
  baseAsset: 'SOL',
  isDemo: false,
  markPrice: 148.2,
  indexPrice: 148.1,
  lastPrice: 148.2,
  priceChange24h: -3.42,
  high24h: 152.0,
  low24h: 144.0,
  baseVolume24h: 8_400_000,
  fundingRate: 0.01,
  predictedFundingRate: 0.01,
  nextFundingTime: Date.now() + 3_600_000,
  annualizedFundingRate: 10.95,
  openInterest: 412_000_000,
  openInterestChange1h: 0.8,
  openInterestChange24h: -2.4,
  openInterestChangeSource: 'ACTUAL',
  futuresVolume24h: 941_200_000,
  longLiquidations24h: 1_200_000,
  shortLiquidations24h: 800_000,
  basisPct: 0.2096,
};

const candles = (): OHLCV[] =>
  Array.from({ length: 220 }, (_, i) => ({
    time: 1_726_358_400 + i * 3600,
    open: 148, high: 149.5, low: 146.5,
    close: 148 * (1 + Math.sin(i / 7) / 200),
    volume: 1_000 + i,
  }));

function futuresProvider(): MarketDataProvider {
  return {
    isDemo: false,
    getMarketOverview: vi.fn(),
    getAssets: vi.fn().mockResolvedValue([]),
    getAssetDetail: vi.fn().mockResolvedValue(null),
    getAssetSnapshot: vi.fn().mockResolvedValue(null),
    getCandles: vi.fn(async () => candles()),
    getFuturesList: vi.fn().mockResolvedValue([solContract]),
    getFuturesContract: vi.fn().mockResolvedValue(solContract),
    getFuturesOrderBook: vi.fn().mockResolvedValue({
      symbol: 'SOL',
      bids: [[148.2, 120]],
      asks: [[148.3, 90]],
      timestamp: Date.now(),
      provenance: { exchange: 'binance', market: 'futures', symbol: 'SOLUSDT', timestamp: Date.now(), isFallback: false },
    }),
    getLiquidations: vi.fn().mockRejectedValue(new Error('no stream')),
    getRadarEvents: vi.fn().mockResolvedValue([]),
    getScreenerResults: vi.fn().mockResolvedValue([]),
  } as unknown as MarketDataProvider;
}

function stubUniverse(bases: string[]) {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({
    symbols: bases.map((base) => ({ symbol: base, exchangeSymbol: `${base}USDT`, baseAsset: base })),
    fetchedAt: new Date().toISOString(),
    stale: false,
  })));
}

function renderFuturesContract() {
  resetExchangeUniverseForTests();
  stubUniverse(['SOL']);
  return render(
    <MemoryRouter initialEntries={['/futures/SOL']}>
      <ThemeProvider>
        <MarketDataProviderComponent customProvider={futuresProvider()}>
          <Routes><Route path="/futures/:symbol" element={<FuturesContractPage />} /></Routes>
        </MarketDataProviderComponent>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

describe('FuturesContractPage — метрики без пустых ячеек', () => {
  it('«Корреляция с BTC» растянута на всю вторую строку desktop и не оставляет дырок', async () => {
    renderFuturesContract();

    await waitFor(() => {
      expect(document.querySelector('[data-qa="futures-btc-correlation"]')?.getAttribute('data-state')).toBe('ready');
    });

    const grid = document.querySelector('[data-qa="instrument-metrics-grid"]')!;
    expect(grid.getAttribute('data-count')).toBe('4');

    const correlation = document.querySelector('[data-qa="futures-btc-correlation"]')!;
    expect(hasClass(correlation.className, 'lg:col-span-3')).toBe(true);
    for (const qa of ['futures-market-statistics', 'futures-derivatives', 'futures-indicators']) {
      expect(document.querySelector(`[data-qa="${qa}"]`)!.className).not.toMatch(/col-span/);
    }
  });

  it('внутри «Корреляции» — горизонтальные ячейки ограниченной ширины (не «километровые» строки)', async () => {
    renderFuturesContract();

    await waitFor(() => {
      expect(document.querySelector('[data-qa="futures-btc-correlation"]')?.getAttribute('data-state')).toBe('ready');
    });

    const cells = document.querySelector('[data-qa="futures-btc-correlation-cells"]')!;
    expect(hasClass(cells.className, 'grid')).toBe(true);
    // Мобильный базовый вид — вертикальный (1 колонка); на широких экранах ячейки в ряд.
    expect(hasClass(cells.className, 'grid-cols-1')).toBe(true);
    expect(hasClass(cells.className, 'sm:grid-cols-3')).toBe(true);
    for (const qa of ['correlation-rho', 'correlation-beta', 'correlation-window']) {
      const cell = cells.querySelector(`[data-qa="${qa}"]`)!;
      expect(hasClass(cell.className, 'min-w-0')).toBe(true);
    }
  });

  it('карточка графика — компактный flex-стек без зарезервированных слотов и растяжения', async () => {
    renderFuturesContract();

    await waitFor(() => expect(document.querySelector('[data-qa="chart-terminal-toolbar"]')).not.toBeNull());

    const card = document.querySelector('[data-qa="futures-chart-card"]')!;
    expect(hasClass(card.className, 'flex')).toBe(true);
    expect(hasClass(card.className, 'flex-col')).toBe(true);
    expect(hasClass(card.className, 'gap-2.5')).toBe(true);
    // Прежний space-y-стек и любые min-height зарезервированные полосы удалены.
    expect(card.className).not.toMatch(/space-y/);
    expect(card.className).not.toMatch(/min-h/);

    // Рабочая область не растягивает карточку графика под высоту Pulse-панели.
    const workspace = document.querySelector('[data-qa="futures-workspace"]')!;
    expect(hasClass(workspace.className, 'items-start')).toBe(true);
    expect(hasClass(workspace.className, 'items-stretch')).toBe(false);
  });
});

/* ============================== INTEGRATION: Spot-страница не регрессировала ============================== */

function ethAsset(): AssetDetail {
  return {
    id: 'ethereum', symbol: 'ETH', name: 'Ethereum', category: 'l1', rank: 2,
    price: 3_200, change1h: 0.2, change24h: 1.4, change7d: null, volume24h: 25_000_000_000,
    marketCap: 380_000_000_000, circulatingSupply: 120_000_000, sparkline: [], isDemo: false,
    description: 'test', indicators: null, pairs: [], high24h: 3_300, low24h: 3_100,
  };
}

function spotProvider(): MarketDataProvider {
  return {
    isDemo: false,
    getMarketOverview: vi.fn(),
    getAssets: vi.fn().mockResolvedValue([]),
    getAssetDetail: vi.fn().mockResolvedValue(ethAsset()),
    getAssetSnapshot: vi.fn().mockResolvedValue(ethAsset()),
    getCandles: vi.fn(async () => candles()),
    getFuturesList: vi.fn().mockResolvedValue([]),
    getLiquidations: vi.fn().mockRejectedValue(new Error('no stream')),
    getRadarEvents: vi.fn().mockResolvedValue([]),
    getScreenerResults: vi.fn().mockResolvedValue([]),
  } as unknown as MarketDataProvider;
}

describe('CoinDetailPage — та же сетка метрик, Spot не регрессировал', () => {
  it('общая сетка и то же правило заполнения для «Корреляции с BTC»', async () => {
    resetExchangeUniverseForTests();
    resetCoinLogoCacheForTests();
    stubUniverse(['ETH']);
    render(
      <MemoryRouter initialEntries={['/coin/ETH']}>
        <ThemeProvider>
          <MarketDataProviderComponent customProvider={spotProvider()}>
            <Routes><Route path="/coin/:symbol" element={<CoinDetailPage />} /></Routes>
          </MarketDataProviderComponent>
        </ThemeProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(document.querySelector('[data-qa="spot-btc-correlation"]')).not.toBeNull();
    });

    const grid = document.querySelector('[data-qa="instrument-metrics-grid"]')!;
    expect(grid.getAttribute('data-count')).toBe('4');
    expect(hasClass(grid.className, 'lg:grid-cols-3')).toBe(true);

    const correlation = document.querySelector('[data-qa="spot-btc-correlation"]')!;
    expect(hasClass(correlation.className, 'lg:col-span-3')).toBe(true);

    // Рабочая область Spot тоже не растягивает карточку графика.
    const workspace = document.querySelector('[data-qa="coin-workspace"]')!;
    expect(hasClass(workspace.className, 'items-start')).toBe(true);
  });
});

/* ============================== SOURCE: общий слой, без per-page хаков ============================== */

describe('общий слой метрик — исходный контракт', () => {
  it('обе страницы используют InstrumentMetricsGrid, а не собственные grid-дивы', () => {
    for (const [name, source] of [['CoinDetailPage', COIN_PAGE], ['FuturesContractPage', FUTURES_PAGE]] as const) {
      expect(source, name).toMatch(/InstrumentMetricsGrid/);
      // Собственной 3-колоночной сетки метрик у страниц больше нет.
      expect(source, name).not.toMatch(/grid-cols-1[^"]*md:grid-cols-2[^"]*lg:grid-cols-3/);
      // И никаких :nth-child / отрицательных margin-хаков.
      expect(source, name).not.toMatch(/:nth-child/);
      expect(source, name).not.toMatch(/margin-top:\s*-/);
      expect(source, name).not.toMatch(/-mt-\d+/);
    }
  });

  it('карточка графика — явный flex-стек без space-y и min-height', () => {
    expect(CHART_CARD).toMatch(/flex min-w-0 flex-col gap-2\.5/);
    expect(CHART_CARD).not.toMatch(/space-y-3/);
    expect(CHART_CARD).not.toMatch(/min-h-\[/);
  });
});

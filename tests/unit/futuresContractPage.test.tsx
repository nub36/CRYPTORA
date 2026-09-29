import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { FuturesContractPage } from '@/pages/FuturesContractPage';
import { MarketDataProviderComponent } from '@/context/MarketDataContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { RealtimeFeedManager } from '@/services/realtime/RealtimeFeedManager';
import { resetExchangeUniverseForTests } from '@/services/data/registry/exchangeUniverse';
import type { MarketDataProvider } from '@/services/data/MarketDataProvider';
import type { FuturesAsset, OHLCV } from '@/types/market';

/**
 * ПАРИТЕТ СТРАНИЦЫ ФЬЮЧЕРСА СО SPOT (задача §2, §3, §5, §6, §7, §8, §9, §15).
 *
 * Корневая проблема задачи: /futures/:symbol был заметно беднее /coin/:symbol.
 * Здесь проверяется, что страница контракта содержит те же секции, что и
 * Spot-страница, и что КАЖДАЯ из них питается данными USD-M, а не спота:
 * статистика, деривативы, индикаторы по фьючерсным свечам, корреляция с
 * фьючерсным BTC, стакан /fapi/v1/depth и явная политика Radar.
 */

const contract: FuturesAsset = {
  symbol: 'MEW/USDT',
  contractSymbol: 'MEWUSDT',
  baseAsset: 'MEW',
  isDemo: false,
  markPrice: 0.000478,
  indexPrice: 0.000477,
  lastPrice: 0.000478,
  priceChange24h: -3.42,
  high24h: 0.000512,
  low24h: 0.000461,
  baseVolume24h: 84_369_082,
  fundingRate: 0.01,
  predictedFundingRate: 0.01,
  nextFundingTime: Date.now() + 3_600_000,
  annualizedFundingRate: 10.95,
  openInterest: 12_400_000,
  // Ряд openInterestHist биржа отдаёт только по top-400 — дельты нет.
  openInterestChange1h: null,
  openInterestChange24h: null,
  openInterestChangeSource: 'UNAVAILABLE',
  futuresVolume24h: 41_200_000,
  longLiquidations24h: 0,
  shortLiquidations24h: 0,
  basisPct: 0.2096,
};

const futuresCandles = (close: number): OHLCV[] =>
  Array.from({ length: 220 }, (_, i) => ({
    time: 1_726_358_400 + i * 3600,
    open: close,
    high: close * 1.01,
    low: close * 0.99,
    close: close * (1 + Math.sin(i / 7) / 200),
    volume: 1_000 + i,
  }));

function stubProvider(overrides: Partial<Record<keyof MarketDataProvider, unknown>> = {}): MarketDataProvider {
  return {
    isDemo: false,
    getMarketOverview: vi.fn(),
    getAssets: vi.fn().mockResolvedValue([]),
    getAssetDetail: vi.fn().mockResolvedValue(null),
    getAssetSnapshot: vi.fn().mockResolvedValue(null),
    getCandles: vi.fn(async (_symbol: string, _tf: string, _limit: number) => futuresCandles(0.000478)),
    getFuturesList: vi.fn().mockResolvedValue([contract]),
    getFuturesContract: vi.fn().mockResolvedValue(contract),
    getFuturesOrderBook: vi.fn().mockResolvedValue({
      symbol: 'MEW',
      bids: [[0.000478, 120_000], [0.000477, 240_000]],
      asks: [[0.000479, 90_000], [0.00048, 180_000]],
      timestamp: Date.now(),
      provenance: { exchange: 'binance', market: 'futures', symbol: 'MEWUSDT', timestamp: Date.now(), isFallback: false },
    }),
    getLiquidations: vi.fn().mockRejectedValue(new Error('no stream')),
    getRadarEvents: vi.fn().mockResolvedValue([]),
    getScreenerResults: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as MarketDataProvider;
}

/** Активная спотовая вселенная нужна, чтобы проверить политику Radar. */
function stubUniverse(spotBases: string[]) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/universe/spot')) {
      return Response.json({
        symbols: spotBases.map((base) => ({ symbol: base, exchangeSymbol: `${base}USDT`, baseAsset: base })),
        fetchedAt: new Date().toISOString(),
        stale: false,
      });
    }
    return Response.json({ symbols: [], contracts: [], assets: {} });
  }));
}

function renderPage(provider: MarketDataProvider, path = '/futures/MEW') {
  resetExchangeUniverseForTests();
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

afterEach(() => {
  vi.unstubAllGlobals();
  RealtimeFeedManager.getInstance().destroy();
});

describe('futures contract page — section parity with the spot page', () => {
  it('renders market statistics, derivatives, indicators and correlation blocks', async () => {
    stubUniverse(['MEW']);
    renderPage(stubProvider());

    await waitFor(() => expect(document.querySelector('[data-qa="futures-market-statistics"]')).not.toBeNull());
    for (const qa of ['futures-market-statistics', 'futures-derivatives', 'futures-indicators', 'futures-btc-correlation']) {
      const section = document.querySelector(`[data-qa="${qa}"]`);
      expect(section, qa).not.toBeNull();
      // Каждая секция помечена рынком — спутать источник нельзя.
      expect(section!.getAttribute('data-market')).toBe('futures');
    }
    expect(screen.getByText('Рыночная статистика')).toBeInTheDocument();
    expect(screen.getByText('Деривативы: детали контракта')).toBeInTheDocument();
    expect(screen.getByText('Технические индикаторы')).toBeInTheDocument();
    expect(screen.getByText('Корреляция с BTC')).toBeInTheDocument();
  });

  it('shows futures 24h high/low and quote volume, and never presents market cap as a contract metric', async () => {
    stubUniverse(['MEW']);
    renderPage(stubProvider());

    const stats = await waitFor(() => {
      const node = document.querySelector('[data-qa="futures-market-statistics"]');
      expect(node?.getAttribute('data-state')).toBe('ready');
      return node as HTMLElement;
    });

    expect(within(stats).getByText('Макс. 24ч').parentElement?.textContent).toContain('0.000512');
    expect(within(stats).getByText('Мин. 24ч').parentElement?.textContent).toContain('0.000461');
    expect(stats.textContent).toContain('Оборот 24ч (USDT)');
    // Капитализации у бессрочного контракта нет — вместо подмены сноска.
    expect(stats.textContent).not.toMatch(/^Капитализация/m);
    expect(stats.textContent).toContain('относятся к базовому активу');
  });

  it('keeps the current open interest while the OI delta is honestly «Нет данных»', async () => {
    stubUniverse(['MEW']);
    renderPage(stubProvider());

    const derivatives = await waitFor(() => {
      const node = document.querySelector('[data-qa="futures-derivatives"]');
      expect(node?.getAttribute('data-state')).toBe('ready');
      return node as HTMLElement;
    });

    expect(derivatives.querySelector('[data-qa="deriv-open-interest"]')!.textContent).toContain('$12.40M');
    expect(derivatives.querySelector('[data-qa="deriv-oi-change-1h"]')!.textContent).toContain('Нет данных');
    expect(derivatives.querySelector('[data-qa="deriv-oi-change-24h"]')!.textContent).toContain('Нет данных');
    // Отсутствие дельты не превращается в 0% и не убирает сам OI.
    expect(derivatives.querySelector('[data-qa="deriv-oi-change-1h"]')!.textContent).not.toContain('0.00%');
    expect(derivatives.querySelector('[data-qa="deriv-basis"]')!.textContent).toContain('%');
  });

  it('prints a low-priced contract without rounding it to $0.0005', async () => {
    stubUniverse(['MEW']);
    renderPage(stubProvider());

    const price = await waitFor(() => {
      const node = document.querySelector('[data-qa="futures-last-price"]');
      expect(node?.textContent).toMatch(/\d/);
      return node as HTMLElement;
    });
    expect(price.textContent).toBe('$0.000478');
    expect(price.textContent).not.toBe('$0.0005');

    const derivatives = await waitFor(() => {
      const node = document.querySelector('[data-qa="futures-derivatives"]');
      expect(node?.getAttribute('data-state')).toBe('ready');
      return node as HTMLElement;
    });
    expect(derivatives.querySelector('[data-qa="deriv-mark-index"]')!.textContent).toContain('$0.000478 / $0.000477');
  });

  it('computes indicators from FUTURES candles only', async () => {
    stubUniverse(['MEW']);
    const getCandles = vi.fn(async (_symbol: string, _tf: string, _limit: number, options: { market?: string }) => {
      // Спотовый запрос на этой странице недопустим.
      expect(options?.market).toBe('futures');
      return futuresCandles(0.000478);
    });
    renderPage(stubProvider({ getCandles }));

    await waitFor(() => {
      const node = document.querySelector('[data-qa="futures-indicators"]');
      expect(node?.getAttribute('data-state')).toBe('ready');
    });
    expect(getCandles).toHaveBeenCalled();
    for (const call of getCandles.mock.calls) {
      expect(call[3].market).toBe('futures');
    }
    expect(document.querySelector('[data-qa="indicator-rsi"]')).not.toBeNull();
  });

  it('compares the contract against the BTC USD-M perpetual, not spot BTC', async () => {
    stubUniverse(['MEW']);
    const getCandles = vi.fn(async () => futuresCandles(0.000478));
    renderPage(stubProvider({ getCandles }));

    const calls = () => getCandles.mock.calls as unknown as Array<[string, string, number, { market?: string }]>;
    await waitFor(() => expect(calls().some((c) => c[0] === 'BTC')).toBe(true));
    const btcCall = calls().find((c) => c[0] === 'BTC')!;
    expect(btcCall[3].market).toBe('futures');

    const correlation = await waitFor(() => {
      const node = document.querySelector('[data-qa="futures-btc-correlation"]');
      expect(node?.getAttribute('data-state')).toBe('ready');
      return node as HTMLElement;
    });
    expect(correlation.textContent).toContain('BTCUSDT PERP');
  });

  it('feeds the order book from the USD-M depth source', async () => {
    stubUniverse(['MEW']);
    const provider = stubProvider();
    renderPage(provider);

    await waitFor(() => expect(provider.getFuturesOrderBook).toHaveBeenCalled());
    const [symbol, options] = (provider.getFuturesOrderBook as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(symbol).toBe('MEW');
    expect(options.limit).toBe(50);
    expect(options.signal).toBeInstanceOf(AbortSignal);

    const book = await waitFor(() => {
      const node = document.querySelector('[data-qa="futures-order-book"]');
      expect(node?.getAttribute('data-state')).toBe('ready');
      return node as HTMLElement;
    });
    expect(book.getAttribute('data-market')).toBe('futures');
    expect(book.querySelector('[data-qa="futures-order-book-scope"]')!.textContent).toBe('USD-M MEW/USDT');
    // Цены уровней — с точностью контракта, а не «$0.00».
    expect(book.textContent).toContain('0.000478');
    expect(book.textContent).not.toContain('$0.00 ');
  });

  it('degrades the order book section without breaking the page when the source fails', async () => {
    stubUniverse(['MEW']);
    renderPage(stubProvider({ getFuturesOrderBook: vi.fn().mockRejectedValue(new Error('binance 503')) }));

    const book = await waitFor(() => {
      const node = document.querySelector('[data-qa="futures-order-book"]');
      expect(node?.getAttribute('data-state')).toBe('unavailable');
      return node as HTMLElement;
    });
    expect(book.textContent).toContain('Источник стакана недоступен');
    // Остальные секции продолжают работать (§15).
    await waitFor(() => expect(document.querySelector('[data-qa="futures-derivatives"]')?.getAttribute('data-state')).toBe('ready'));
  });

  it('marks every metric section as unsupported when the contract is not in the USD-M universe', async () => {
    stubUniverse(['MEW']);
    renderPage(stubProvider({ getFuturesContract: vi.fn().mockResolvedValue(null) }));

    await waitFor(() => {
      expect(document.querySelector('[data-qa="futures-market-statistics"]')?.getAttribute('data-state')).toBe('unsupported');
    });
    expect(document.querySelector('[data-qa="futures-derivatives"]')?.getAttribute('data-state')).toBe('unsupported');
    expect(screen.getAllByText(/отсутствует в активной вселенной Binance USD-M/).length).toBeGreaterThan(0);
  });

  it('labels Radar as the SPOT radar of the underlying asset', async () => {
    stubUniverse(['MEW']);
    renderPage(stubProvider({
      getRadarEvents: vi.fn().mockResolvedValue([
        { id: 'r1', symbol: 'MEW', type: 'VOLUME_SPIKE', severity: 'HIGH', observation: 'x3 объём', metricValue: '+312%', timestamp: new Date().toISOString() },
      ]),
    }));

    const radar = await waitFor(() => {
      const node = document.querySelector('[data-qa="futures-radar"]');
      expect(node).not.toBeNull();
      return node as HTMLElement;
    });
    expect(radar.textContent).toContain('Spot Radar базового актива MEW');
    expect(radar.textContent).toContain('аномалии базового актива, не контракта');
    // Секция честно помечена спотовым источником, а не фьючерсным.
    expect(radar.getAttribute('data-market')).toBe('spot');
  });

  it('hides Radar entirely when the contract has no active spot base', async () => {
    stubUniverse(['BTC']); // MEW отсутствует в спотовой вселенной
    renderPage(stubProvider());

    await waitFor(() => expect(document.querySelector('[data-qa="futures-radar-hidden"]')).not.toBeNull());
    expect(document.querySelector('[data-qa="futures-radar"]')).toBeNull();
    expect(document.querySelector('[data-qa="futures-radar-hidden"]')!.textContent)
      .toContain('нет активной спотовой базы');
  });

  it('uses the shared chart terminal with the same toolbar as the spot page', async () => {
    stubUniverse(['MEW']);
    renderPage(stubProvider());

    await waitFor(() => expect(document.querySelector('[data-qa="chart-terminal-toolbar"]')).not.toBeNull());
    const toolbar = document.querySelector('[data-qa="chart-terminal-toolbar"]')!;
    expect(toolbar.getAttribute('data-controls')).toBe('unified');
    const triggers = Array.from(toolbar.querySelectorAll('button')).map((b) => b.getAttribute('data-qa'));
    expect(triggers).toEqual([
      'chart-timeframe-trigger',
      'chart-type-trigger',
      'chart-indicators-trigger',
      'chart-more-trigger',
    ]);
    // Аварийного ряда кнопок таймфрейма больше нет — контролы одни и те же.
    expect(document.querySelectorAll('[data-qa="chart-fullscreen"]')).toHaveLength(1);
  });
});

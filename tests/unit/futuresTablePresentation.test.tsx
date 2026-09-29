import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FuturesPage } from '@/pages/FuturesPage';
import { MarketDataProviderComponent } from '@/context/MarketDataContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { RealtimeFeedManager } from '@/services/realtime/RealtimeFeedManager';
import { resetExchangeUniverseForTests } from '@/services/data/registry/exchangeUniverse';
import type { MarketDataProvider } from '@/services/data/MarketDataProvider';
import type { FuturesAsset } from '@/types/market';

/**
 * Task §1 / §7 / §8 / §10 — Futures instruments table.
 *
 * Verifies that Futures reuses the SAME shell/sort primitives as Spot, that
 * every required sort field is reachable on desktop AND on a 360–430px
 * viewport, and that missing derivatives metrics render as honest «Нет данных»
 * instead of a fabricated 0.
 */

const contract = (over: Partial<FuturesAsset>): FuturesAsset => ({
  symbol: 'BTC/USDT',
  contractSymbol: 'BTCUSDT',
  baseAsset: 'BTC',
  markPrice: 64_000,
  indexPrice: 63_990,
  lastPrice: 64_001,
  priceChange24h: 2.5,
  fundingRate: 0.01,
  predictedFundingRate: 0.01,
  annualizedFundingRate: 10.95,
  openInterest: 18_000_000_000,
  openInterestChange1h: 1.2,
  openInterestChange24h: 5.4,
  openInterestChangeSource: 'ACTUAL',
  futuresVolume24h: 42_000_000_000,
  longLiquidations24h: 1_000,
  shortLiquidations24h: 2_000,
  basisPct: 0.015,
  isDemo: false,
  ...over,
} as FuturesAsset);

const ROWS: FuturesAsset[] = [
  contract({}),
  contract({
    symbol: 'ETH/USDT', contractSymbol: 'ETHUSDT', baseAsset: 'ETH',
    markPrice: 3_200, indexPrice: 3_199, lastPrice: 3_201, priceChange24h: -1.4,
    fundingRate: -0.004, annualizedFundingRate: -4.38, openInterest: 9_000_000_000,
    openInterestChange1h: -0.4, openInterestChange24h: 2.1, futuresVolume24h: 18_000_000_000, basisPct: 0.01,
  }),
  contract({
    // Contract with genuinely missing upstream metrics.
    symbol: '1000PEPE/USDT', contractSymbol: '1000PEPEUSDT', baseAsset: '1000PEPE',
    markPrice: 0.0085, indexPrice: 0.00849, lastPrice: null, priceChange24h: null,
    fundingRate: 0.002, annualizedFundingRate: 2.19,
    openInterest: null, openInterestChange1h: null, openInterestChange24h: null,
    openInterestChangeSource: 'UNAVAILABLE', futuresVolume24h: null, basisPct: 0.012,
  }),
];

function stubProvider(over: Partial<MarketDataProvider> = {}): MarketDataProvider {
  return {
    isDemo: false,
    getMarketOverview: vi.fn().mockResolvedValue(null),
    getAssets: vi.fn().mockResolvedValue([]),
    getAssetDetail: vi.fn().mockResolvedValue(null),
    getAssetSnapshot: vi.fn().mockResolvedValue(null),
    getCandles: vi.fn().mockResolvedValue([]),
    getFuturesList: vi.fn().mockResolvedValue(ROWS),
    getLiquidations: vi.fn().mockRejectedValue(new Error('no stream')),
    getRadarEvents: vi.fn().mockResolvedValue([]),
    getScreenerResults: vi.fn().mockResolvedValue([]),
    ...over,
  } as unknown as MarketDataProvider;
}

function renderFutures(provider: MarketDataProvider) {
  resetExchangeUniverseForTests();
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ symbols: [], contracts: [], assets: {} }) })));
  return render(
    <MemoryRouter initialEntries={['/futures']}>
      <ThemeProvider>
        <MarketDataProviderComponent customProvider={provider}>
          <FuturesPage />
        </MarketDataProviderComponent>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

const qa = (name: string) => document.querySelector(`[data-qa="${name}"]`);
const qaAll = (name: string) => Array.from(document.querySelectorAll(`[data-qa="${name}"]`));
const rowSymbols = () => qaAll('futures-row').map((row) => row.querySelector('[data-qa="futures-symbol"]')?.textContent?.trim()
  ?? row.textContent?.trim().slice(0, 12) ?? '');

afterEach(() => {
  vi.unstubAllGlobals();
  RealtimeFeedManager.getInstance().destroy();
});

describe('Futures instruments table — shared Spot shell', () => {
  it('renders the shared market table shell with a ready status', async () => {
    renderFutures(stubProvider());
    await waitFor(() => expect(qa('futures-table')?.getAttribute('data-status')).toBe('ready'));
    expect(qa('futures-table')?.classList.contains('market-table')).toBe(true);
    expect(qaAll('futures-row')).toHaveLength(3);
  });

  it('shows the loading state before the source answers', async () => {
    const pending = new Promise<FuturesAsset[]>(() => {});
    renderFutures(stubProvider({ getFuturesList: vi.fn().mockReturnValue(pending) as never }));
    await waitFor(() => expect(qa('futures-table-loading')).not.toBeNull());
  });

  it('shows an error state with retry when the derivatives source fails', async () => {
    renderFutures(stubProvider({ getFuturesList: vi.fn().mockRejectedValue(new Error('binance down')) as never }));
    await waitFor(() => expect(qa('futures-table')?.getAttribute('data-status')).toBe('error'));
    expect(qa('futures-table-retry')).not.toBeNull();
  });

  it('shows an empty state when filters exclude every contract', async () => {
    renderFutures(stubProvider());
    await waitFor(() => expect(qaAll('futures-row')).toHaveLength(3));
    fireEvent.change(qa('futures-search') as HTMLInputElement, { target: { value: 'zzzz' } });
    await waitFor(() => expect(qa('futures-table')?.getAttribute('data-status')).toBe('empty'));
  });
});

describe('Futures instruments table — honest missing data', () => {
  it('renders «Нет данных» for null metrics instead of 0', async () => {
    renderFutures(stubProvider());
    await waitFor(() => expect(qaAll('futures-row')).toHaveLength(3));
    const pepeRow = qaAll('futures-row').find((row) => row.textContent?.includes('1000PEPE'))!;
    const volume = pepeRow.querySelector('[data-qa="futures-volume"]')?.textContent ?? '';
    const change = pepeRow.querySelector('[data-qa="futures-change24h"]')?.textContent ?? '';
    const oi = pepeRow.querySelector('[data-qa="futures-oi"]')?.textContent ?? '';
    for (const cell of [volume, change, oi]) {
      expect(cell).toContain('Нет данных');
      expect(cell).not.toMatch(/\$0\.00|0\.00%/);
    }
  });

  it('keeps the funding value of a contract whose volume is missing', async () => {
    renderFutures(stubProvider());
    await waitFor(() => expect(qaAll('futures-row')).toHaveLength(3));
    const pepeRow = qaAll('futures-row').find((row) => row.textContent?.includes('1000PEPE'))!;
    expect(pepeRow.textContent).toContain('0.0020%');
  });
});

describe('Futures instruments table — sorting', () => {
  const headerFor = (key: string) => document.querySelector(`th[data-sort-key="${key}"]`) as HTMLElement;

  it('exposes every required sortable column on desktop', async () => {
    renderFutures(stubProvider());
    await waitFor(() => expect(qaAll('futures-row')).toHaveLength(3));
    for (const key of ['rank', 'symbol', 'markPrice', 'priceChange24h', 'fundingRate', 'openInterest', 'futuresVolume24h']) {
      expect(headerFor(key)).not.toBeNull();
    }
  });

  it('toggles direction on repeated clicks and marks the active column', async () => {
    renderFutures(stubProvider());
    await waitFor(() => expect(qaAll('futures-row')).toHaveLength(3));

    await act(async () => { fireEvent.click(headerFor('markPrice')); });
    expect(headerFor('markPrice').getAttribute('data-sort-active')).toBe('true');
    expect(headerFor('markPrice').getAttribute('aria-sort')).toBe('descending');
    expect(rowSymbols()[0]).toContain('BTC');

    await act(async () => { fireEvent.click(headerFor('markPrice')); });
    expect(headerFor('markPrice').getAttribute('aria-sort')).toBe('ascending');
    expect(rowSymbols()[0]).toContain('1000PEPE');
  });

  it('sorts tickers A→Z and Z→A', async () => {
    renderFutures(stubProvider());
    await waitFor(() => expect(qaAll('futures-row')).toHaveLength(3));

    await act(async () => { fireEvent.click(headerFor('symbol')); });
    expect(rowSymbols().map((s) => s.split('/')[0])).toEqual(['1000PEPE', 'BTC', 'ETH']);
    await act(async () => { fireEvent.click(headerFor('symbol')); });
    expect(rowSymbols().map((s) => s.split('/')[0])).toEqual(['ETH', 'BTC', '1000PEPE']);
  });

  it('keeps contracts without a metric last in both directions', async () => {
    renderFutures(stubProvider());
    await waitFor(() => expect(qaAll('futures-row')).toHaveLength(3));

    await act(async () => { fireEvent.click(headerFor('futuresVolume24h')); });
    expect(rowSymbols()[2]).toContain('1000PEPE');
    await act(async () => { fireEvent.click(headerFor('futuresVolume24h')); });
    expect(rowSymbols()[2]).toContain('1000PEPE');
  });

  it('applies sorting after search filtering', async () => {
    renderFutures(stubProvider());
    await waitFor(() => expect(qaAll('futures-row')).toHaveLength(3));
    fireEvent.change(qa('futures-search') as HTMLInputElement, { target: { value: 'ت' } });
    fireEvent.change(qa('futures-search') as HTMLInputElement, { target: { value: 'e' } });
    await waitFor(() => expect(qaAll('futures-row').length).toBeGreaterThan(0));
    await act(async () => { fireEvent.click(headerFor('markPrice')); });
    const symbols = rowSymbols();
    expect(symbols.every((s) => s.toLowerCase().includes('e'))).toBe(true);
    expect(symbols[0]).toContain('ETH');
  });
});

describe('Futures instruments table — mobile controls (360–430px)', () => {
  it('offers a reachable mobile sort control with field + direction', async () => {
    renderFutures(stubProvider());
    await waitFor(() => expect(qaAll('futures-row')).toHaveLength(3));

    const select = qa('futures-sort-field') as HTMLSelectElement;
    const direction = qa('futures-sort-direction') as HTMLButtonElement;
    expect(select).not.toBeNull();
    expect(direction).not.toBeNull();

    // Columns hidden behind `md:`/`xl:` breakpoints must still be sortable.
    const options = Array.from(select.options).map((o) => o.value);
    for (const key of ['symbol', 'markPrice', 'priceChange24h', 'fundingRate', 'openInterest', 'futuresVolume24h']) {
      expect(options).toContain(key);
    }

    await act(async () => { fireEvent.change(select, { target: { value: 'futuresVolume24h' } }); });
    expect(rowSymbols()[0]).toContain('BTC');
    await act(async () => { fireEvent.click(direction); });
    expect(qa('futures-sort-direction-label')?.textContent).toBe('0→9');
    expect(rowSymbols()[2]).toContain('1000PEPE'); // missing volume still last
  });
});

describe('Futures page source invariants', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/pages/FuturesPage.tsx'), 'utf8');

  it('uses the shared table shell and sort model rather than a private copy', () => {
    expect(source).toContain("from '@/components/market/MarketTableShell'");
    expect(source).toContain("from '@/components/market/MarketSortControls'");
    expect(source).toContain("from '@/utils/marketSort'");
    expect(source).not.toContain("from '@/utils/sorting'");
  });

  it('renders the mobile sort control only below the desktop breakpoint', () => {
    expect(source).toMatch(/lg:hidden/);
  });

  it('routes rows to the dedicated futures contract terminal', () => {
    expect(source).toMatch(/\/futures\/\$\{/);
  });
});

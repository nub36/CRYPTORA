import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MarketPage } from '@/pages/MarketPage';
import { MarketDataProviderComponent } from '@/context/MarketDataContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { RealtimeFeedManager } from '@/services/realtime/RealtimeFeedManager';
import { resetExchangeUniverseForTests } from '@/services/data/registry/exchangeUniverse';
import { resetCoinLogoCacheForTests } from '@/services/data/registry/coinLogoRegistry';
import type { MarketDataProvider } from '@/services/data/MarketDataProvider';
import type { AssetSummary } from '@/types/market';

/**
 * Task §1 / §7 / §10 — the Spot table after its migration onto the shared
 * market-table shell. Spot and Futures must expose the SAME sorting
 * affordances (desktop headers + mobile control) and the same state handling.
 */

const asset = (over: Partial<AssetSummary>): AssetSummary => ({
  id: 'x', symbol: 'XXX', name: 'Asset', category: 'other', rank: 1,
  price: 1, change1h: 0, change24h: 0, change7d: 0, volume24h: 0, marketCap: 0,
  sparkline: [], isDemo: false, ...over,
} as AssetSummary);

const ASSETS: AssetSummary[] = [
  asset({ id: 'btc', symbol: 'BTC', name: 'Bitcoin', category: 'l1', rank: 1, price: 64_000, change1h: 0.2, change24h: 2.5, change7d: 4, volume24h: 40e9, marketCap: 1.2e12 }),
  asset({ id: 'eth', symbol: 'ETH', name: 'Ethereum', category: 'l1', rank: 2, price: 3_200, change1h: -0.1, change24h: -1.4, change7d: 1, volume24h: 18e9, marketCap: 3.9e11 }),
  asset({ id: 'arb', symbol: 'ARB', name: 'Arbitrum', category: 'l2', rank: 3, price: 0.85, change1h: 1.1, change24h: 9.4, change7d: -2, volume24h: 3e8, marketCap: 0 }),
];

function stubProvider(over: Partial<MarketDataProvider> = {}): MarketDataProvider {
  return {
    isDemo: false,
    getMarketOverview: vi.fn().mockResolvedValue(null),
    getAssets: vi.fn().mockResolvedValue(ASSETS),
    getAssetDetail: vi.fn().mockResolvedValue(null),
    getAssetSnapshot: vi.fn().mockResolvedValue(null),
    getCandles: vi.fn().mockResolvedValue([]),
    getFuturesList: vi.fn().mockResolvedValue([]),
    getLiquidations: vi.fn().mockRejectedValue(new Error('no stream')),
    getRadarEvents: vi.fn().mockResolvedValue([]),
    getScreenerResults: vi.fn().mockResolvedValue([]),
    ...over,
  } as unknown as MarketDataProvider;
}

function renderMarket(provider: MarketDataProvider) {
  // QA-фикстура: каталог не дополняется каноническим реестром, в таблице
  // ровно те инструменты, которые вернул провайдер.
  localStorage.setItem('cryptora_qa_fixture', '1');
  resetExchangeUniverseForTests();
  resetCoinLogoCacheForTests();
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ symbols: [], contracts: [], assets: {} }) })));
  return render(
    <MemoryRouter initialEntries={['/market']}>
      <ThemeProvider>
        <MarketDataProviderComponent customProvider={provider}>
          <MarketPage />
        </MarketDataProviderComponent>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

const qa = (name: string) => document.querySelector(`[data-qa="${name}"]`);
const rowSymbols = () => Array.from(document.querySelectorAll('[data-qa="market-row"]'))
  .map((row) => row.querySelector('[data-qa="market-symbol"]')?.textContent?.trim() ?? '');
const headerFor = (key: string) => document.querySelector(`th[data-sort-key="${key}"]`) as HTMLElement;

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  RealtimeFeedManager.getInstance().destroy();
});

describe('Spot table — shared shell', () => {
  it('renders rows through the shared market table shell', async () => {
    renderMarket(stubProvider());
    await waitFor(() => expect(qa('market-table')?.getAttribute('data-status')).toBe('ready'));
    expect(rowSymbols()).toEqual(['BTC', 'ETH', 'ARB']);
  });

  it('shows the loading state until the source answers', async () => {
    renderMarket(stubProvider({ getAssets: vi.fn().mockReturnValue(new Promise<AssetSummary[]>(() => {})) as never }));
    await waitFor(() => expect(qa('market-table-loading')).not.toBeNull());
  });

  it('shows an empty state when the search matches nothing', async () => {
    renderMarket(stubProvider());
    await waitFor(() => expect(rowSymbols()).toHaveLength(3));
    fireEvent.change(qa('market-search') as HTMLInputElement, { target: { value: 'zzzz' } });
    await waitFor(() => expect(qa('market-table')?.getAttribute('data-status')).toBe('empty'));
  });
});

describe('Spot table — sorting parity with Futures', () => {
  it('exposes the required sortable headers', async () => {
    renderMarket(stubProvider());
    await waitFor(() => expect(rowSymbols()).toHaveLength(3));
    for (const key of ['rank', 'symbol', 'price', 'change24h', 'volume24h']) {
      expect(headerFor(key)).not.toBeNull();
    }
  });

  it('toggles a column between descending and ascending', async () => {
    renderMarket(stubProvider());
    await waitFor(() => expect(rowSymbols()).toHaveLength(3));

    await act(async () => { fireEvent.click(headerFor('price')); });
    expect(headerFor('price').getAttribute('aria-sort')).toBe('descending');
    expect(rowSymbols()).toEqual(['BTC', 'ETH', 'ARB']);

    await act(async () => { fireEvent.click(headerFor('price')); });
    expect(headerFor('price').getAttribute('aria-sort')).toBe('ascending');
    expect(rowSymbols()).toEqual(['ARB', 'ETH', 'BTC']);
  });

  it('sorts tickers A→Z and Z→A', async () => {
    renderMarket(stubProvider());
    await waitFor(() => expect(rowSymbols()).toHaveLength(3));
    await act(async () => { fireEvent.click(headerFor('symbol')); });
    expect(rowSymbols()).toEqual(['ARB', 'BTC', 'ETH']);
    await act(async () => { fireEvent.click(headerFor('symbol')); });
    expect(rowSymbols()).toEqual(['ETH', 'BTC', 'ARB']);
  });

  it('keeps assets with an unknown market cap last in both directions', async () => {
    renderMarket(stubProvider());
    await waitFor(() => expect(rowSymbols()).toHaveLength(3));
    await act(async () => { fireEvent.click(headerFor('marketCap')); });
    expect(rowSymbols()[2]).toBe('ARB');
    await act(async () => { fireEvent.click(headerFor('marketCap')); });
    expect(rowSymbols()[2]).toBe('ARB');
  });

  it('sorts after search filtering, not before', async () => {
    renderMarket(stubProvider());
    await waitFor(() => expect(rowSymbols()).toHaveLength(3));
    fireEvent.change(qa('market-search') as HTMLInputElement, { target: { value: 'arb' } });
    await waitFor(() => expect(rowSymbols()).toEqual(['ARB']));
    await act(async () => { fireEvent.click(headerFor('price')); });
    expect(rowSymbols()).toEqual(['ARB']);
  });

  it('offers the same mobile sort control as the Futures table', async () => {
    renderMarket(stubProvider());
    await waitFor(() => expect(rowSymbols()).toHaveLength(3));
    const select = qa('market-sort-field') as HTMLSelectElement;
    expect(select).not.toBeNull();
    // Начальное состояние — «#» по возрастанию; смена поля сохраняет направление.
    await act(async () => { fireEvent.change(select, { target: { value: 'volume24h' } }); });
    expect(qa('market-sort-direction-label')?.textContent).toBe('0→9');
    expect(rowSymbols()).toEqual(['ARB', 'ETH', 'BTC']);
    await act(async () => { fireEvent.click(qa('market-sort-direction') as HTMLButtonElement); });
    expect(qa('market-sort-direction-label')?.textContent).toBe('9→0');
    expect(rowSymbols()).toEqual(['BTC', 'ETH', 'ARB']);
  });
});

describe('Spot page source invariants', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/pages/MarketPage.tsx'), 'utf8');

  it('uses the shared shell and sorting model', () => {
    expect(source).toContain("from '@/components/market/MarketTableShell'");
    expect(source).toContain("from '@/components/market/MarketSortControls'");
    expect(source).toContain("from '@/utils/marketSort'");
  });

  it('sorts after filters and before pagination', () => {
    const sortIndex = source.indexOf('sortMarketRows(result, SPOT_SORT_FIELDS, sortState)');
    const paginateIndex = source.indexOf('paginate(filteredAssets');
    expect(sortIndex).toBeGreaterThan(-1);
    expect(paginateIndex).toBeGreaterThan(sortIndex);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { MarketDataProvider } from '@/services/data/MarketDataProvider';
import type { AssetDetail } from '@/types/market';
import { CoinDetailPage } from '@/pages/CoinDetailPage';
import { MarketDataProviderComponent } from '@/context/MarketDataContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { normalizeCoinRouteSymbol } from '@/pages/CoinDetailPage';
import { filterPickerSymbols } from '@/components/common/SymbolPickerModal';
import { RealtimeFeedManager } from '@/services/realtime/RealtimeFeedManager';

function asset(symbol: string, name: string): AssetDetail {
  return {
    id: symbol.toLowerCase(), symbol, name, category: 'l1', rank: symbol === 'BTC' ? 1 : 2,
    price: symbol === 'BTC' ? 60_000 : 3_000, change1h: null, change24h: 1, change7d: null,
    volume24h: 10_000, marketCap: 1_000_000, circulatingSupply: 100, sparkline: [], isDemo: true,
    description: `${name} test data`, indicators: null, pairs: [], high24h: 61_000, low24h: 59_000,
  };
}

const LocationProbe = () => <output data-testid="current-route">{useLocation().pathname}</output>;

function renderCoin(provider: MarketDataProvider, initialPath = '/coin/BTC') {
  localStorage.setItem('cryptora_qa_fixture', '1');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <ThemeProvider>
        <MarketDataProviderComponent customProvider={provider}>
          <LocationProbe />
          <Routes><Route path="/coin/:symbol" element={<CoinDetailPage />} /></Routes>
        </MarketDataProviderComponent>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

function baseProvider(overrides: Partial<MarketDataProvider> = {}): MarketDataProvider {
  return {
    isDemo: true,
    getMarketOverview: vi.fn(),
    getAssets: vi.fn().mockResolvedValue([]),
    getAssetDetail: vi.fn().mockResolvedValue(null),
    getAssetSnapshot: vi.fn(async (symbol: string) => symbol === 'BTC' ? asset('BTC', 'Bitcoin') : asset('ETH', 'Ethereum')),
    getCandles: vi.fn().mockResolvedValue([]),
    getFuturesList: vi.fn().mockResolvedValue([]),
    getLiquidations: vi.fn().mockRejectedValue(new Error('liquidation stream unavailable')),
    getRadarEvents: vi.fn().mockResolvedValue([]),
    getScreenerResults: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as MarketDataProvider;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  localStorage.clear();
  RealtimeFeedManager.getInstance().destroy();
});

describe('CoinDetailPage failure isolation and symbol navigation', () => {
  it('keeps the selector available immediately and exits loading when the provider rejects', async () => {
    const getAssetSnapshot = vi.fn().mockRejectedValue(new Error('exchange offline'));
    const provider = baseProvider({ getAssetSnapshot });
    renderCoin(provider);

    expect(screen.getByRole('button', { name: /Выбрать монету/ })).toBeInTheDocument();
    await screen.findByText(/Фактический источник недоступен/i);
    expect(screen.queryByText(/Загрузка аналитики монеты/i)).not.toBeInTheDocument();
    expect(getAssetSnapshot).toHaveBeenCalledTimes(1);
  });

  it('bounds a never-settling provider request and does not retry/render-loop afterward', async () => {
    vi.useFakeTimers();
    const getAssetSnapshot = vi.fn(() => new Promise<AssetDetail | null>(() => {}));
    const getCandles = vi.fn(() => new Promise<never>(() => {}));
    renderCoin(baseProvider({ getAssetSnapshot, getCandles }));

    expect(screen.getByRole('button', { name: /Выбрать монету/ })).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(9_500); });
    expect(document.querySelector('[data-qa="coin-load-state"]')?.textContent).toContain('Spot ticker BTC');
    expect(getAssetSnapshot).toHaveBeenCalledTimes(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(getAssetSnapshot).toHaveBeenCalledTimes(1);
    expect(getCandles).toHaveBeenCalledTimes(1);
  });

  it('finishes the independent candle loading state when a provider request never settles', async () => {
    vi.useFakeTimers();
    const getCandles = vi.fn(() => new Promise<never>(() => {}));
    const provider = baseProvider({
      getAssetSnapshot: vi.fn(async () => asset('BTC', 'Bitcoin')),
      getCandles,
    });
    renderCoin(provider);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByRole('heading', { name: 'Bitcoin' })).toBeInTheDocument();

    await act(async () => { await vi.advanceTimersByTimeAsync(17_100); });
    expect(getCandles).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Spot-источник свечей недоступен/)).toBeInTheDocument();
    expect(screen.queryByText('Загрузка свечей… остальные блоки доступны.')).not.toBeInTheDocument();
  });

  it('forces a fresh Spot REST candle reconciliation after the kline WebSocket reconnects', async () => {
    const restRows = [{ time: 1_780_000_000, open: 100, high: 102, low: 99, close: 101, volume: 10 }];
    const getCandles = vi.fn().mockResolvedValue(restRows);
    renderCoin(baseProvider({ getCandles, getAssetSnapshot: vi.fn(async () => asset('BTC', 'Bitcoin')) }));
    await screen.findByRole('heading', { name: 'Bitcoin' });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(getCandles).toHaveBeenCalledTimes(1);

    const feed = RealtimeFeedManager.getInstance();
    act(() => {
      feed.eventBus.publishConnectionState('connected');
      feed.eventBus.publishConnectionState('reconnecting');
      feed.eventBus.publishConnectionState('connected');
    });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(getCandles).toHaveBeenCalledTimes(2);
    expect(getCandles).toHaveBeenLastCalledWith('BTC', '15m', 500, { forceRefresh: true });
  });


  it('selecting ETH changes the route and requests ETH rather than reusing BTC state', async () => {
    const getAssetSnapshot = vi.fn(async (symbol: string) => asset(symbol, symbol === 'BTC' ? 'Bitcoin' : 'Ethereum'));
    const provider = baseProvider({
      getAssetSnapshot,
      getAssets: vi.fn().mockResolvedValue([{ symbol: 'PEPE', name: 'Pepe' }]),
    });
    renderCoin(provider);

    await screen.findByRole('heading', { name: 'Bitcoin' });
    fireEvent.click(screen.getByRole('button', { name: /Выбрать монету/ }));
    const picker = screen.getByRole('dialog', { name: 'Выбор монеты для графика' });
    expect(await within(picker).findByRole('button', { name: /^PEPE Pepe$/ })).toBeInTheDocument();
    fireEvent.click(within(picker).getByRole('button', { name: /^ETH Ethereum$/ }));

    await screen.findByRole('heading', { name: 'Ethereum' });
    expect(screen.getByTestId('current-route')).toHaveTextContent('/coin/ETH');
    expect(getAssetSnapshot.mock.calls.map(([symbol]) => symbol)).toEqual(['BTC', 'ETH']);
  });
});

describe('coin selector uses the shared supported universe', () => {
  it('selects a spot asset supplied by the live market provider and routes to that ticker', async () => {
    const getAssetSnapshot = vi.fn(async (symbol: string) => ({
      ...asset(symbol, symbol), category: 'other' as const, rank: Number.MAX_SAFE_INTEGER,
      marketCap: 0, circulatingSupply: 0, description: '',
    }));
    const provider = baseProvider({
      getAssetSnapshot,
      getAssets: vi.fn().mockResolvedValue([{ symbol: 'PEPE', name: 'Pepe' }]),
    });
    renderCoin(provider);

    await screen.findByRole('heading', { name: 'BTC' });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Выбрать монету/ }));
      await Promise.resolve();
    });
    const picker = screen.getByRole('dialog', { name: 'Выбор монеты для графика' });
    const pepe = await within(picker).findByRole('button', { name: /^PEPE Pepe$/ });
    fireEvent.click(pepe);

    await screen.findByRole('heading', { name: 'PEPE' });
    expect(screen.getByTestId('current-route')).toHaveTextContent('/coin/PEPE');
    expect(getAssetSnapshot.mock.calls.map(([symbol]) => symbol)).toEqual(['BTC', 'PEPE']);
  });

  it('searches by ticker and name and normalizes exchange-style ticker input', () => {
    expect(filterPickerSymbols('ETH').some((entry) => entry.symbol === 'ETH' && !entry.custom)).toBe(true);
    expect(filterPickerSymbols('ethereum').some((entry) => entry.symbol === 'ETH')).toBe(true);
    expect(filterPickerSymbols('PEPE', [{ symbol: 'PEPE', name: 'Pepe' }]).some((entry) => entry.symbol === 'PEPE' && !entry.custom)).toBe(true);
    expect(normalizeCoinRouteSymbol('btcUsdt')).toBe('BTC');
    expect(normalizeCoinRouteSymbol('ETH')).toBe('ETH');
  });
});

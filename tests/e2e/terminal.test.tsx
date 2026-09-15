import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { MarketDataProviderComponent } from '@/context/MarketDataContext';
import App from '@/App';

function renderApp(initialPath = '/') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <MarketDataProviderComponent>
        <App />
      </MarketDataProviderComponent>
    </MemoryRouter>
  );
}

describe('CRYPTORA Terminal E2E / Integration Flow', () => {
  it('renders Overview page with all core command center components', async () => {
    renderApp('/');

    // Check title / branding
    expect(screen.getAllByText(/CRYPTORA/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Рынок\. Данные\. Решения\./i).length).toBeGreaterThan(0);

    // Check Market summary cards (wait for async load)
    await screen.findByText(/Капитализация рынка/i);
    expect(screen.getByText(/24h Спот Объем/i)).toBeInTheDocument();
    expect(screen.getByText(/Доминация BTC/i)).toBeInTheDocument();
    expect(screen.getByText(/Индекс жадности/i)).toBeInTheDocument();
    expect(screen.getByText(/Широта рынка \(Breadth\)/i)).toBeInTheDocument();

    // Check BTC Chart header
    expect(screen.getByText('BTC / USDT')).toBeInTheDocument();

    // Check Futures & Liquidations snapshot
    expect(screen.getByText(/ФЬЮЧЕРСНЫЙ СРЕЗ/i)).toBeInTheDocument();
    expect(screen.getByText(/ЛИКВИДАЦИИ ЗА 24H/i)).toBeInTheDocument();

    // Check Heatmap preview
    expect(screen.getByText('ТЕПЛОВАЯ КАРТА')).toBeInTheDocument();

    // Check Market Radar feed preview
    expect(screen.getByText('MARKET RADAR (LATEST)')).toBeInTheDocument();

    // Check Top Movers & Signals prototype
    expect(screen.getByText(/Лидеры роста \(24h\)/i)).toBeInTheDocument();
    expect(screen.getByText(/АНАЛИТИЧЕСКИЕ СЕТАПЫ \(PREVIEW\)/i)).toBeInTheDocument();
  });

  it('renders global Market Ticker with demo indicator', async () => {
    renderApp('/');
    expect(screen.getByText('DEMO TICKER')).toBeInTheDocument();
  });

  it('navigates to Market page, performs search, sorting and watchlist toggle', async () => {
    const user = userEvent.setup();
    renderApp('/market');

    // Verify Market page loaded
    await screen.findByText('Bitcoin');
    expect(screen.getByText(/РЫНОЧНЫЕ КОТИРОВКИ \(MARKET\)/i)).toBeInTheDocument();
    expect(screen.getByText('Ethereum')).toBeInTheDocument();
    expect(screen.getByText('Solana')).toBeInTheDocument();

    // Test Search input
    const searchInput = screen.getByPlaceholderText(/Фильтр по названию или тикеру/i);
    await user.type(searchInput, 'Solana');

    expect(screen.getByText('Solana')).toBeInTheDocument();
    expect(screen.queryByText('Ethereum')).not.toBeInTheDocument();

    // Clear search
    await user.clear(searchInput);
    expect(screen.getByText('Ethereum')).toBeInTheDocument();

    // Test Watchlist Star toggle
    const solStarBtn = screen.getByLabelText(/Избранное SOL/i);
    await user.click(solStarBtn);
  });

  it('navigates to Coin Detail (/coin/SOL) and displays deep analytics', async () => {
    renderApp('/coin/SOL');

    // Wait for asset details to render
    await screen.findByRole('heading', { name: 'Solana' });

    expect(screen.getByText('Ранг #3')).toBeInTheDocument();
    expect(screen.getByText(/SOL\/USDT Свечной график/i)).toBeInTheDocument();
    expect(screen.getByText(/Рыночная статистика/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Деривативы и фьючерсы/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Технические индикаторы/i)).toBeInTheDocument();
    expect(screen.getByText(/Демо-пары на ведущих биржах/i)).toBeInTheDocument();
  });

  it('navigates to Futures page and verifies derivatives table & filters', async () => {
    const user = userEvent.setup();
    renderApp('/futures');

    await screen.findByText('BTC/USDT');
    expect(screen.getByText(/ФЬЮЧЕРСЫ И ДЕРИВАТИВЫ/i)).toBeInTheDocument();
    expect(screen.getByText(/Суммарный Открытый Интерес \(OI\)/i)).toBeInTheDocument();
    expect(screen.getByText('ETH/USDT')).toBeInTheDocument();

    // Filter by negative funding (Squeeze Watch)
    const negativeFundingBtn = screen.getByRole('button', { name: /Шорт < 0/i });
    await user.click(negativeFundingBtn);

    expect(screen.getByText('SUI/USDT')).toBeInTheDocument();
    expect(screen.queryByText('BTC/USDT')).not.toBeInTheDocument();
  });

  it('navigates to Liquidations page and verifies methodology disclaimer', async () => {
    renderApp('/liquidations');

    await screen.findByText(/КАРТА И ПОТОК ЛИКВИДАЦИЙ/i);
    expect(
      screen.getByText(/КРИТИЧЕСКИЙ ПРИНЦИП: ФАКТИЧЕСКИЕ СОБЫТИЯ ≠ РАСЧЕТНЫЕ УРОВНИ/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/Ликвидировано Long \(24h\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Ликвидировано Short \(24h\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Поток подтвержденных ликвидаций/i)).toBeInTheDocument();
  });

  it('navigates to Screener page and applies interactive filters and presets', async () => {
    const user = userEvent.setup();
    renderApp('/screener');

    await screen.findByText(/КРИПТО-СКРИНЕР \(SCREENER TERMINAL\)/i);

    // Preset: Top Gainers (>5%)
    const gainersBtn = screen.getByRole('button', { name: /Top Gainers/i });
    await user.click(gainersBtn);

    // Verify results counter updated
    await waitFor(() => {
      expect(screen.getByText(/Найдено активов:/i)).toBeInTheDocument();
    });

    // Reset filters
    const resetBtn = screen.getByTitle(/Сбросить все фильтры/i);
    await user.click(resetBtn);
  });

  it('navigates to Market Radar page and verifies anomaly stream', async () => {
    renderApp('/radar');

    await screen.findByText(/MARKET RADAR \(ДЕТЕКТОР АНОМАЛИЙ\)/i);
    expect(
      screen.getByText(/Аномальный всплеск спотового и фьючерсного объема/i)
    ).toBeInTheDocument();
  });

  it('navigates to Heatmaps page and switches metric modes', async () => {
    const user = userEvent.setup();
    renderApp('/heatmaps');

    await screen.findByRole('heading', { name: /ТЕПЛОВАЯ КАРТА РЫНКА/i });

    const volumeModeBtn = screen.getByRole('button', { name: /Объем \(Volume\)/i });
    await user.click(volumeModeBtn);

    const fundingModeBtn = screen.getByRole('button', { name: /Funding Rate/i });
    await user.click(fundingModeBtn);
  });

  it('navigates to Tools page and verifies live Position Size and PnL calculators', async () => {
    renderApp('/tools');

    expect(screen.getByText(/КАЛЬКУЛЯТОРЫ И РИСК-ИНСТРУМЕНТЫ/i)).toBeInTheDocument();
    expect(screen.getByText(/Калькулятор размера позиции/i)).toBeInTheDocument();
    expect(screen.getByText(/Калькулятор PnL & ROE/i)).toBeInTheDocument();

    // Check calculated fields
    expect(screen.getByText(/Сумма риска \(Stop Loss \$\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Чистый PnL \(\$\)/i)).toBeInTheDocument();
  });

  it('navigates to Strategies and Signals preview pages', async () => {
    renderApp('/strategies');
    expect(screen.getByText(/STRATEGY LAB \(ЛАБОРАТОРИЯ СТРАТЕГИЙ\)/i)).toBeInTheDocument();

    renderApp('/signals');
    expect(screen.getByText(/АНАЛИТИЧЕСКИЕ СЕТАПЫ И СИГНАЛЫ/i)).toBeInTheDocument();
    expect(screen.getByText(/НЕ ЯВЛЯЕТСЯ ФИНАНСОВОЙ РЕКОМЕНДАЦИЕЙ/i)).toBeInTheDocument();
  });

  it('opens and closes Demo Information Modal', async () => {
    const user = userEvent.setup();
    renderApp('/');

    const demoBadge = screen.getByTitle(/Нажмите для просмотра информации о демо-режиме/i);
    await user.click(demoBadge);

    expect(screen.getByText(/Статус данных: Демонстрационный режим/i)).toBeInTheDocument();

    const closeBtn = screen.getByRole('button', { name: /Понятно, продолжить/i });
    await user.click(closeBtn);

    await waitFor(() => {
      expect(screen.queryByText(/Статус данных: Демонстрационный режим/i)).not.toBeInTheDocument();
    });
  });

  it('opens and interacts with Watchlist drawer and Alerts modal', async () => {
    const user = userEvent.setup();
    renderApp('/');

    // Open Watchlist
    const watchlistBtn = screen.getByLabelText(/Открыть Watchlist/i);
    await user.click(watchlistBtn);
    expect(screen.getByText(/Избранное \(Watchlist\)/i)).toBeInTheDocument();

    // Close Watchlist
    const closeWatchlistBtn = screen.getByLabelText('Закрыть');
    await user.click(closeWatchlistBtn);

    // Open Alerts Modal
    const alertsBtn = screen.getByLabelText(/Открыть алерты/i);
    await user.click(alertsBtn);
    expect(screen.getByText(/Система алертов \(Alerts Preview\)/i)).toBeInTheDocument();
  });
});

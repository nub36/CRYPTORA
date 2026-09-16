import './setup-dom';
import { resetBrowserStorage } from './setup-dom';
import { test, expect } from '@playwright/test';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
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

// Сброс localStorage до каждого теста: гарантирует режим DEMO по умолчанию
// и исключает реальные сетевые вызовы к биржам из E2E-прогона.
test.beforeEach(() => {
  resetBrowserStorage();
});

test.describe('Playwright E2E: Core Terminal User Flows', () => {
  test.afterEach(() => {
    cleanup();
  });

  test('Overview: renders command center cards, chart, snapshots and demo notification', async () => {
    renderApp('/');

    expect(screen.getAllByText(/CRYPTORA/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Рынок\. Данные\. Решения\./i).length).toBeGreaterThan(0);

    // Explicit demo warning banner at top of command center
    await screen.findByText(/КОМАНДНЫЙ ЦЕНТР/i);

    // Summary cards
    await screen.findByText(/Капитализация рынка/i);
    expect(screen.getByText(/24h Спот Объем/i)).toBeInTheDocument();
    expect(screen.getByText(/Доминация BTC/i)).toBeInTheDocument();
    expect(screen.getByText(/Индекс жадности/i)).toBeInTheDocument();
    expect(screen.getByText(/Широта рынка \(Breadth\)/i)).toBeInTheDocument();

    // Main Chart
    expect(screen.getByText('BTC / USDT')).toBeInTheDocument();

    // Snapshots
    expect(screen.getByText(/ФЬЮЧЕРСНЫЙ СРЕЗ/i)).toBeInTheDocument();
    expect(screen.getByText(/ЛИКВИДАЦИИ ЗА 24H/i)).toBeInTheDocument();
    expect(screen.getByText('ТЕПЛОВАЯ КАРТА')).toBeInTheDocument();
    expect(screen.getByText('MARKET RADAR (LATEST)')).toBeInTheDocument();
    expect(screen.getByText(/АНАЛИТИЧЕСКИЕ СЕТАПЫ \(PREVIEW\)/i)).toBeInTheDocument();
  });

  test('Market Navigation: search, multi-column sorting and watchlist toggling', async () => {
    renderApp('/market');

    await screen.findByText('Bitcoin');
    expect(screen.getByText(/РЫНОЧНЫЕ КОТИРОВКИ \(MARKET\)/i)).toBeInTheDocument();
    expect(screen.getByText('Ethereum')).toBeInTheDocument();
    expect(screen.getByText('Solana')).toBeInTheDocument();

    // Search for Solana
    const searchInput = screen.getByPlaceholderText(/Фильтр по названию или тикеру/i);
    fireEvent.change(searchInput, { target: { value: 'Solana' } });
    expect(screen.getByText('Solana')).toBeInTheDocument();
    expect(screen.queryByText('Ethereum')).toBeNull();

    // Clear search
    fireEvent.change(searchInput, { target: { value: '' } });
    expect(screen.getByText('Ethereum')).toBeInTheDocument();

    // Toggle Watchlist
    const solStarBtn = screen.getByLabelText(/Избранное SOL/i);
    fireEvent.click(solStarBtn);
  });

  test('Coin Detail: displays candlestick chart, indicators and derivatives for selected asset', async () => {
    renderApp('/coin/SOL');

    await screen.findByRole('heading', { name: 'Solana' });
    expect(screen.getByText('Ранг #3')).toBeInTheDocument();
    expect(screen.getByText(/SOL\/USDT Свечной график/i)).toBeInTheDocument();
    expect(screen.getByText(/Рыночная статистика/i)).toBeInTheDocument();
    expect(screen.getByText(/Деривативы: детали контракта/i)).toBeInTheDocument();
    expect(screen.getByText(/Технические индикаторы/i)).toBeInTheDocument();
    expect(screen.getByText(/ORDER BOOK \(L2\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Демо-пары на ведущих биржах/i)).toBeInTheDocument();
  });

  test('Coin Detail workspace: график слева, Derivatives/Liquidation Pulse справа, переходы сохранены', async () => {
    renderApp('/coin/ETH');

    await screen.findByRole('heading', { name: 'Ethereum' });

    // Контракт раскладки: одна колонка по умолчанию и 72/28 от 1280px.
    const workspace = document.querySelector('[data-qa="coin-workspace"]') as HTMLElement;
    expect(workspace).not.toBeNull();
    expect(workspace.className).toContain('grid-cols-1');
    expect(workspace.className).toContain('xl:grid-cols-[72fr_28fr]');

    // График остаётся частью рабочей области и несёт провенанс данных.
    const chartCard = document.querySelector('[data-qa="coin-chart-card"]') as HTMLElement;
    expect(chartCard).not.toBeNull();
    expect(within(chartCard).getByText(/Свечной график/i)).toBeInTheDocument();
    expect(within(chartCard).getByText(/DEMO СВЕЧИ/i)).toBeInTheDocument();

    // Снимок по активу: три обязательных блока с явной маркировкой происхождения.
    const pulse = screen.getByLabelText('Derivatives and liquidation pulse');
    expect(pulse).toBeInTheDocument();
    expect(within(pulse).getByText(/LIQUIDATION PULSE/i)).toBeInTheDocument();
    expect(within(pulse).getByText(/DEMO DATASET/i)).toBeInTheDocument();
    expect(within(pulse).getByText(/^Деривативы$/i)).toBeInTheDocument();
    expect(within(pulse).getByText(/LONG 24H/i)).toBeInTheDocument();
    expect(within(pulse).getByText(/SHORT 24H/i)).toBeInTheDocument();
    expect(within(pulse).getByText(/Открытый интерес \(OI\)/i)).toBeInTheDocument();
    expect(within(pulse).getByText(/Фандинг \(8ч\)/i)).toBeInTheDocument();
    expect(within(pulse).getByText(/Базис \(basis\)/i)).toBeInTheDocument();
    expect(within(pulse).getByText(/ПЕРЕКОС ПОТОКА/i)).toBeInTheDocument();
    expect(within(pulse).getByText(/DERIVED/i)).toBeInTheDocument();
    expect(within(pulse).getByText(/Не является торговым сигналом/i)).toBeInTheDocument();

    // Переходы в детальные разделы доступны прямо из рабочей области.
    expect(
      within(pulse).getByRole('link', { name: /Карта и поток ликвидаций/i }).getAttribute('href')
    ).toBe('/liquidations');
    expect(
      within(pulse).getByRole('link', { name: /Все фьючерсы и фандинг/i }).getAttribute('href')
    ).toBe('/futures');

    // Снимок не подменяет фактические данные: демо-режим помечен, значения не выдуманы.
    expect(within(pulse).getByText(/\$28\.25M/)).toBeInTheDocument();
  });

  test('Futures: derivatives table, aggregated OI and funding rate filtering', async () => {
    renderApp('/futures');

    await screen.findByText('BTC/USDT');
    expect(screen.getByText(/ФЬЮЧЕРСЫ И ДЕРИВАТИВЫ/i)).toBeInTheDocument();
    expect(screen.getByText(/Суммарный Открытый Интерес \(OI\)/i)).toBeInTheDocument();

    // Filter by negative funding (Short Squeeze Watch)
    const negativeFundingBtn = screen.getByRole('button', { name: /Шорт < 0/i });
    fireEvent.click(negativeFundingBtn);

    expect(screen.getByText('SUI/USDT')).toBeInTheDocument();
    expect(screen.queryByText('BTC/USDT')).toBeNull();
  });

  test('Liquidations: verified actual vs estimated disclaimer, ratio gauge and event log', async () => {
    renderApp('/liquidations');

    await screen.findByText(/КАРТА И ПОТОК ЛИКВИДАЦИЙ/i);
    // Mandatory methodology distinction
    expect(
      screen.getByText(/ACTUAL LIQUIDATION EVENT ≠ ESTIMATED LIQUIDATION LEVEL/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/Ликвидировано Long \(24h\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Ликвидировано Short \(24h\)/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Демонстрационный журнал событий ликвидаций/i)
    ).toBeInTheDocument();
  });

  test('Screener: working filters and quick presets over demo dataset', async () => {
    renderApp('/screener');

    await screen.findByText(/КРИПТО-СКРИНЕР \(SCREENER TERMINAL\)/i);

    // Apply preset
    const gainersBtn = screen.getByRole('button', { name: /Top Gainers/i });
    fireEvent.click(gainersBtn);

    await waitFor(() => {
      expect(screen.getByText(/Найдено активов:/i)).toBeInTheDocument();
    });

    // Reset preset
    const resetBtn = screen.getByTitle(/Сбросить все фильтры/i);
    fireEvent.click(resetBtn);
  });

  test('Market Radar: anomaly feed and severity filtering', async () => {
    renderApp('/radar');

    await screen.findByText(/MARKET RADAR \(ДЕТЕКТОР АНОМАЛИЙ\)/i);
    expect(
      screen.getByText(/Аномальный всплеск спотового и фьючерсного объема/i)
    ).toBeInTheDocument();
  });

  test('Tools: position size and PnL calculation modules', async () => {
    renderApp('/tools');

    expect(screen.getByText(/КАЛЬКУЛЯТОРЫ И РИСК-ИНСТРУМЕНТЫ/i)).toBeInTheDocument();
    expect(screen.getByText(/Калькулятор размера позиции/i)).toBeInTheDocument();
    expect(screen.getByText(/Калькулятор PnL & ROE/i)).toBeInTheDocument();
    expect(screen.getByText(/Сумма риска \(Stop Loss \$\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Чистый PnL \(\$\)/i)).toBeInTheDocument();
  });

  test('Strategies & Signals: honest architectural previews without fake performance claims', async () => {
    renderApp('/strategies');
    expect(screen.getByText(/STRATEGY LAB \(ЛАБОРАТОРИЯ СТРАТЕГИЙ\)/i)).toBeInTheDocument();
    expect(screen.getByText(/АРХИТЕКТУРНЫЙ ПРОТОТИП/i)).toBeInTheDocument();

    renderApp('/signals');
    expect(screen.getByText(/АНАЛИТИЧЕСКИЕ СЕТАПЫ И СИГНАЛЫ/i)).toBeInTheDocument();
    expect(screen.getByText(/НЕ ЯВЛЯЕТСЯ ФИНАНСОВОЙ РЕКОМЕНДАЦИЕЙ/i)).toBeInTheDocument();
    expect(screen.getByText(/Кодекс прозрачности сигналов/i)).toBeInTheDocument();
  });

  test('Modals & Drawers: Demo information modal, Watchlist drawer and Alerts preview', async () => {
    renderApp('/');

    // Demo Modal
    const demoBadge = screen.getByTitle(/Нажмите для просмотра информации о демо-режиме/i);
    fireEvent.click(demoBadge);
    expect(screen.getByText(/Статус данных: Демонстрационный режим/i)).toBeInTheDocument();
    const closeDemoBtn = screen.getByRole('button', { name: /Понятно, продолжить/i });
    fireEvent.click(closeDemoBtn);

    // Watchlist Drawer
    const watchlistBtn = screen.getByLabelText(/Открыть Watchlist/i);
    fireEvent.click(watchlistBtn);
    expect(screen.getByText(/Избранное \(Watchlist\)/i)).toBeInTheDocument();
    const closeWatchlistBtn = screen.getByLabelText('Закрыть');
    fireEvent.click(closeWatchlistBtn);

    // Alerts Modal
    const alertsBtn = screen.getByLabelText(/Открыть алерты/i);
    fireEvent.click(alertsBtn);
    expect(screen.getByText(/Система алертов \(Alerts Preview\)/i)).toBeInTheDocument();
  });

  test('Stage 3 Realtime & Mode Switch: toggles Live Spot mode and displays WebSocket status badge', async () => {
    renderApp('/radar');

    // Default is demo stream
    expect(screen.getByText(/ДЕМОНСТРАЦИОННЫЙ СТРИМ/i)).toBeInTheDocument();

    // Open demo modal to switch mode
    const demoBadge = screen.getByTitle(/Нажмите для просмотра информации о демо-режиме/i);
    fireEvent.click(demoBadge);

    // Click Switch to Live Spot
    const switchLiveBtn = screen.getByRole('button', { name: /^LIVE$/i });
    fireEvent.click(switchLiveBtn);

    // Close modal
    const closeDemoBtn = screen.getByRole('button', { name: /Понятно, продолжить/i });
    fireEvent.click(closeDemoBtn);

    // Header now reflects LIVE SPOT with WS indicator
    expect(screen.getByText(/LIVE SPOT/i)).toBeInTheDocument();
    expect(screen.getByText(/LIVE ANOMALY ENGINE/i)).toBeInTheDocument();
  });
});

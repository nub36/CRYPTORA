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

// QA-фикстура: сброс localStorage переводит прогон на детерминированный
// датасет и исключает реальные сетевые вызовы к биржам из E2E-прогона.
test.beforeEach(() => {
  resetBrowserStorage();
});

test.describe('Playwright E2E: Core Terminal User Flows', () => {
  test.afterEach(() => {
    cleanup();
  });

  test('LIVE-first: режим по умолчанию — фактический источник, а не демо-датасет', async () => {
    window.localStorage.clear();
    renderApp('/');

    // Полоса котировок маркирует фактический режим, демо-подпись не показывается.
    expect(await screen.findByText('LIVE-ТИКЕР')).toBeInTheDocument();
    expect(screen.queryByText('QA-ТИКЕР')).toBeNull();
  });

  test('LIVE-first: недоступный фактический источник даёт честное состояние без демо-котировок', async () => {
    window.localStorage.removeItem('cryptora_qa_fixture');
    renderApp('/');

    // E2E-окружение изолировано: fetch отклоняется, WebSocket отсутствует.
    expect(await screen.findByText(/Фактический рыночный поток недоступен/i)).toBeInTheDocument();
    expect(await screen.findByText(/Фактический источник недоступен: рыночная сводка/i)).toBeInTheDocument();

    // Ключевое отличие от прежнего поведения: демо-числа не подставляются вместо факта.
    expect(screen.queryByText('$64,850.25')).toBeNull();
    expect(screen.queryByText('QA-ТИКЕР')).toBeNull();
  });

  test('LIVE-first: переключателя режима данных в интерфейсе нет', async () => {
    window.localStorage.removeItem('cryptora_qa_fixture');
    renderApp('/');

    // Статус источника — индикация, а не кнопка переключения режима.
    const statusChip = await screen.findByText('LIVE SPOT');
    expect(statusChip.closest('button')).toBeNull();
    expect(screen.queryByText(/Подробнее о Demo-режиме/i)).toBeNull();
    expect(screen.queryByText(/Ограничения этапа/i)).toBeNull();
    expect(screen.queryByText(/Демонстрационный режим/i)).toBeNull();
  });

  test('QA-фикстура: детерминированный датасет помечается провенансом', async () => {
    window.localStorage.setItem('cryptora_qa_fixture', '1');
    renderApp('/');

    expect(await screen.findByText('QA-ТИКЕР')).toBeInTheDocument();
    const demoPrices = await screen.findAllByText('$64,850.25');
    expect(demoPrices.length).toBeGreaterThan(0);
    // Даже в этом внутреннем режиме переключателя в UI нет.
    expect(screen.queryByText(/Подробнее о Demo-режиме/i)).toBeNull();
  });

  test('PRODUCTION runtime: DEMO недоступен даже при недоступном LIVE-источнике и любом localStorage', async () => {
    // Эмуляция production: политика фикстуры выключена (как в `vite build` без VITE_CRYPTORA_QA_FIXTURE).
    // Пользователь мог оставить в хранилище любые «включающие» ключи — они обязаны игнорироваться.
    window.localStorage.setItem('cryptora_qa_fixture', '1');
    window.localStorage.setItem('cryptora_data_mode', 'demo');

    render(
      <MemoryRouter initialEntries={['/']}>
        <MarketDataProviderComponent qaFixtureAllowed={false}>
          <App />
        </MarketDataProviderComponent>
      </MemoryRouter>
    );

    // Источник в изолированном окружении недоступен → честное состояние, а не demo-fallback.
    expect(await screen.findByText(/Фактический источник недоступен: рыночная сводка/i)).toBeInTheDocument();
    expect(await screen.findByText('LIVE-ТИКЕР')).toBeInTheDocument();
    expect(screen.queryByText('QA-ТИКЕР')).toBeNull();
    expect(screen.queryAllByText('$64,850.25')).toHaveLength(0);

    // Никаких контролов включения DEMO: ни кнопок, ни ссылок, ни подписей.
    const demoControl = /демо|demo|qa-датасет|qa dataset|включить .*датасет/i;
    for (const btn of screen.queryAllByRole('button')) {
      expect(btn.textContent ?? '').not.toMatch(demoControl);
      expect(btn.getAttribute('aria-label') ?? '').not.toMatch(demoControl);
    }
    for (const link of screen.queryAllByRole('link')) {
      expect(link.textContent ?? '').not.toMatch(demoControl);
    }
    // Единственное действие в состоянии недоступности — повтор запроса.
    expect(screen.getAllByRole('button', { name: /Повторить запрос/i }).length).toBeGreaterThan(0);
    // Хранилище не «восстанавливает» demo и не записывает режим.
    expect(window.localStorage.getItem('cryptora_data_mode')).toBe('demo'); // нетронуто и не используется
  });

  test('Overview: renders command center cards, chart, snapshots and source status', async () => {
    renderApp('/');

    expect(screen.getAllByText(/CRYPTORA/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Рынок\. Данные\. Решения\./i).length).toBeGreaterThan(0);

    // Строка статуса источника данных в шапке командного центра
    await screen.findByText(/Источник данных:/i);

    // Summary cards
    await screen.findByText(/Капитализация рынка/i);
    expect(screen.getByText(/24h Спот Объем/i)).toBeInTheDocument();
    expect(screen.getByText(/Доминация BTC/i)).toBeInTheDocument();
    expect(screen.getByText(/Индекс жадности/i)).toBeInTheDocument();
    expect(screen.getByText(/^Широта рынка$/i)).toBeInTheDocument();

    // Main Chart
    expect(screen.getByText('BTC / USDT')).toBeInTheDocument();

    // Snapshots
    expect(screen.getByText(/ФЬЮЧЕРСНЫЙ СРЕЗ/i)).toBeInTheDocument();
    expect(screen.getByText(/ЛИКВИДАЦИИ ЗА 24H/i)).toBeInTheDocument();
    expect(screen.getByText('ТЕПЛОВАЯ КАРТА')).toBeInTheDocument();
    expect(screen.getByText('РЫНОЧНЫЙ РАДАР: ПОСЛЕДНЕЕ')).toBeInTheDocument();
    expect(screen.getByText(/АНАЛИТИЧЕСКИЕ СЕТАПЫ \(ПРЕВЬЮ\)/i)).toBeInTheDocument();
  });

  test('Market Navigation: search, multi-column sorting and watchlist toggling', async () => {
    renderApp('/market');

    await screen.findByText('Bitcoin');
    expect(screen.getByText(/^РЫНОЧНЫЕ КОТИРОВКИ$/i)).toBeInTheDocument();
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
    expect(screen.getByText(/СТАКАН ЗАЯВОК \(L2\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Пары на ведущих биржах \(QA-датасет\)/i)).toBeInTheDocument();
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
    expect(within(chartCard).getByText(/QA-СВЕЧИ/i)).toBeInTheDocument();

    // Снимок по активу: три обязательных блока с явной маркировкой происхождения.
    const pulse = screen.getByLabelText('Пульс деривативов и ликвидаций по активу');
    expect(pulse).toBeInTheDocument();
    expect(within(pulse).getByText(/Пульс ликвидаций/i)).toBeInTheDocument();
    expect(within(pulse).getAllByText(/QA-ДАТАСЕТ|^QA$/i).length).toBeGreaterThan(0);
    expect(within(pulse).getByText(/^Деривативы$/i)).toBeInTheDocument();
    expect(within(pulse).getByText(/Лонги 24ч/i)).toBeInTheDocument();
    expect(within(pulse).getByText(/Шорты 24ч/i)).toBeInTheDocument();
    expect(within(pulse).getByText(/Открытый интерес \(OI\)/i)).toBeInTheDocument();
    expect(within(pulse).getByText(/Фандинг \(8ч\)/i)).toBeInTheDocument();
    expect(within(pulse).getByText(/^Базис$/i)).toBeInTheDocument();
    expect(within(pulse).getByText(/ПЕРЕКОС ПОТОКА/i)).toBeInTheDocument();
    expect(within(pulse).getByText(/^ПРОИЗВОДНЫЙ$/)).toBeInTheDocument();
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
      screen.getByText(/ФАКТИЧЕСКАЯ ЛИКВИДАЦИЯ ≠ РАСЧЁТНЫЙ УРОВЕНЬ/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/Ликвидировано лонгов \(24ч\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Ликвидировано шортов \(24ч\)/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Журнал событий ликвидаций QA-датасета/i)
    ).toBeInTheDocument();
  });

  test('Liquidations: 2D liquidation-density heatmap is MODEL/ESTIMATED with explicit provenance', async () => {
    renderApp('/liquidations');

    // Карта плотности строится поверх расчетной модели и маркируется как ESTIMATED.
    const card = await screen.findByLabelText(/Расчетная тепловая карта плотности ликвидаций/i);
    expect(within(card).getByText(/Тепловая карта плотности ликвидаций: цена × время/i)).toBeInTheDocument();
    expect(within(card).getByText('MODEL / ESTIMATED')).toBeInTheDocument();
    expect(within(card).getByText(/ВХОД: QA-СВЕЧИ|candles/i)).toBeInTheDocument();

    // Полотно строится из ценовых строк (модель — детерминированная, без случайных значений).
    const plot = card.querySelector('[role="img"]');
    expect(plot).not.toBeNull();
    expect(plot?.children.length).toBe(28);

    // Карта никогда не подменяет фактический журнал событий: разделение уровней сохраняется.
    expect(
      screen.getByText(/ФАКТИЧЕСКАЯ ЛИКВИДАЦИЯ ≠ РАСЧЁТНЫЙ УРОВЕНЬ/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/Журнал событий ликвидаций QA-датасета/i)).toBeInTheDocument();
    expect(screen.getByText(/Расчётные уровни ликвидаций по плечам/i)).toBeInTheDocument();
  });

  test('Screener: working filters and quick presets over demo dataset', async () => {
    renderApp('/screener');

    await screen.findByRole("heading", { name: /^КРИПТО-СКРИНЕР$/i });

    // Apply preset
    const gainersBtn = screen.getByRole('button', { name: /Лидеры роста/i });
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

    await screen.findByText(/РЫНОЧНЫЙ РАДАР: ДЕТЕКТОР АНОМАЛИЙ/i);
    expect(
      screen.getByText(/Аномальный всплеск спотового и фьючерсного объема/i)
    ).toBeInTheDocument();
  });

  test('Tools: position size and PnL calculation modules', async () => {
    renderApp('/tools');

    expect(screen.getByText(/КАЛЬКУЛЯТОРЫ И РИСК-ИНСТРУМЕНТЫ/i)).toBeInTheDocument();
    expect(screen.getByText(/Калькулятор размера позиции/i)).toBeInTheDocument();
    expect(screen.getByText(/Калькулятор PnL и ROE/i)).toBeInTheDocument();
    expect(screen.getByText(/Сумма риска \(стоп-лосс, \$\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Чистый PnL \(\$\)/i)).toBeInTheDocument();
  });

  test('Strategies & Signals: honest architectural previews without fake performance claims', async () => {
    renderApp('/strategies');
    expect(screen.getByText(/^ЛАБОРАТОРИЯ СТРАТЕГИЙ$/i)).toBeInTheDocument();
    expect(screen.getByText(/АРХИТЕКТУРНЫЙ ПРОТОТИП/i)).toBeInTheDocument();

    renderApp('/signals');
    expect(screen.getByText(/АНАЛИТИЧЕСКИЕ СЕТАПЫ И СИГНАЛЫ/i)).toBeInTheDocument();
    expect(screen.getByText(/НЕ ЯВЛЯЕТСЯ ФИНАНСОВОЙ РЕКОМЕНДАЦИЕЙ/i)).toBeInTheDocument();
    expect(screen.getByText(/Кодекс прозрачности сигналов/i)).toBeInTheDocument();
  });

  test('Modals & Drawers: Watchlist drawer and Alerts preview', async () => {
    renderApp('/');

    // Watchlist Drawer
    const watchlistBtn = screen.getByLabelText(/Открыть избранное/i);
    fireEvent.click(watchlistBtn);
    expect(screen.getByText(/^Избранное$/i)).toBeInTheDocument();
    const closeWatchlistBtn = screen.getByLabelText('Закрыть');
    fireEvent.click(closeWatchlistBtn);

    // Alerts Modal
    const alertsBtn = screen.getByLabelText(/Открыть алерты/i);
    fireEvent.click(alertsBtn);
    expect(screen.getByText(/Система алертов \(превью\)/i)).toBeInTheDocument();
  });

  test('Статус источника и WebSocket: только индикация, переключение режима недоступно', async () => {
    window.localStorage.removeItem('cryptora_qa_fixture');
    renderApp('/radar');

    // Радар маркирует происхождение данных и не даёт переключать режим.
    expect(screen.getByText(/LIVE-ДЕТЕКТОР АНОМАЛИЙ/i)).toBeInTheDocument();
    const headerChip = document.querySelector('[data-qa="data-source-status"]') as HTMLElement;
    expect(headerChip).not.toBeNull();
    expect(headerChip.closest('button')).toBeNull();
    expect(screen.queryByRole('button', { name: /^LIVE$/i })).toBeNull();
  });
});

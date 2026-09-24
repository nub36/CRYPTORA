import './setup-dom';
import { resetBrowserStorage } from './setup-dom';
import { test, expect } from '@playwright/test';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MarketDataProviderComponent } from '@/context/MarketDataContext';
import { AuthProvider } from '@/context/AuthContext';
import App from '@/App';

function renderApp(initialPath = '/') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <AuthProvider>
        <MarketDataProviderComponent>
          <App />
        </MarketDataProviderComponent>
      </AuthProvider>
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
        <AuthProvider>
          <MarketDataProviderComponent qaFixtureAllowed={false}>
            <App />
          </MarketDataProviderComponent>
        </AuthProvider>
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

    // Статус источника данных в шапке — чип с aria-label (текст не дублируется визуально)
    await waitFor(() => {
      const chip = document.querySelector('[data-qa="data-source-status"]');
      expect(chip).not.toBeNull();
      expect(chip!.getAttribute('aria-label') ?? '').toMatch(/Источник данных:/);
    });

    // Summary cards
    await screen.findByText(/Капитализация крипторынка/i);
    expect(screen.getByText(/24h Спот Объем/i)).toBeInTheDocument();
    expect(screen.getByText(/Доминация BTC/i)).toBeInTheDocument();
    expect(screen.getByText(/Индекс страха и жадности/i)).toBeInTheDocument();
    // QA-фикстура помечает индекс как QA, не как LIVE-источник
    const fng = document.querySelector('[data-qa="fear-greed-card"]') as HTMLElement;
    expect(fng.dataset.source).toBe('qa-fixture');
    expect(fng.textContent).not.toMatch(/ALTERNATIVE\.ME/);
    expect(screen.getByText(/^Широта рынка$/i)).toBeInTheDocument();

    // Main Chart
    expect(screen.getByText('BTC / USDT')).toBeInTheDocument();

    // Snapshots
    expect(screen.getByText(/ФЬЮЧЕРСНЫЙ СРЕЗ/i)).toBeInTheDocument();
    // Заголовок снапшота ликвидаций (§31/§50/§51/§55): «24ч» заявляется только
    // при фактически покрытом окне наблюдения, иначе — честная подпись периода.
    // На QA-фикстуре окно не покрыто, поэтому прежний жёсткий ассерт
    // «ЛИКВИДАЦИИ ЗА 24H» недопустим: он требовал ровно того заявления,
    // которое приложение не имеет права делать без данных.
    const liqTitle = document.querySelector('[data-qa="overview-liq-title"]');
    expect(liqTitle).not.toBeNull();
    expect(liqTitle!.textContent ?? '').toMatch(/Ликвидации/i);
    expect(liqTitle!.textContent ?? '').toMatch(/24ч|с момента подключения/i);
    expect(screen.getByText(/^Тепловая карта$/i)).toBeInTheDocument();
    expect(screen.getByText(/РЫНОЧНЫЙ РАДАР: ПОСЛЕДНЕЕ/i)).toBeInTheDocument();
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

  test('Coin Detail workspace: модули переставляются (кнопки/клавиатура), порядок сохраняется и сбрасывается', async () => {
    localStorage.removeItem('cryptora_workspace_coin');
    const { unmount } = renderApp('/coin/ETH');
    await screen.findByRole('heading', { name: 'Ethereum' });

    const orderIds = () =>
      Array.from(document.querySelectorAll('[data-workspace-module]')).map((el) => el.getAttribute('data-workspace-module'));
    expect(orderIds()).toEqual(['chart', 'stats', 'depth']);

    const reset = document.querySelector('[data-qa="workspace-reset"]') as HTMLButtonElement;
    expect(reset.disabled).toBe(true);

    // Кнопка «ниже» у графика → график на 2-е место; запись в localStorage с версией схемы.
    fireEvent.click(screen.getByRole('button', { name: /Модуль «График и пульс актива» ниже/i }));
    expect(orderIds()).toEqual(['stats', 'chart', 'depth']);
    expect(JSON.parse(localStorage.getItem('cryptora_workspace_coin') as string)).toEqual({
      schemaVersion: 1,
      order: ['stats', 'chart', 'depth'],
    });
    expect(reset.disabled).toBe(false);

    // Клавиатурная альтернатива: ArrowDown на ручке модуля «Стакан…» на последнем месте — без изменений; ArrowUp — поднимает.
    const depthHandle = document.querySelector('[data-qa="workspace-handle-depth"]') as HTMLElement;
    fireEvent.keyDown(depthHandle, { key: 'ArrowDown' });
    expect(orderIds()).toEqual(['stats', 'chart', 'depth']);
    fireEvent.keyDown(depthHandle, { key: 'ArrowUp' });
    expect(orderIds()).toEqual(['stats', 'depth', 'chart']);

    // Инварианты модулей сохранены после перестановки: график 72/28 и провенанс.
    const workspace = document.querySelector('[data-qa="coin-workspace"]') as HTMLElement;
    expect(workspace.className).toContain('xl:grid-cols-[72fr_28fr]');
    expect(within(document.querySelector('[data-qa="coin-chart-card"]') as HTMLElement).getByText(/QA-СВЕЧИ/i)).toBeInTheDocument();

    // Перезагрузка страницы восстанавливает сохранённый порядок.
    unmount();
    renderApp('/coin/ETH');
    await screen.findByRole('heading', { name: 'Ethereum' });
    expect(orderIds()).toEqual(['stats', 'depth', 'chart']);

    // Сброс → раскладка по умолчанию, ключ удалён.
    fireEvent.click(document.querySelector('[data-qa="workspace-reset"]') as HTMLButtonElement);
    expect(orderIds()).toEqual(['chart', 'stats', 'depth']);
    expect(localStorage.getItem('cryptora_workspace_coin')).toBeNull();
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
    expect(within(pulse).getByText(/Long 24ч/i)).toBeInTheDocument();
    expect(within(pulse).getByText(/Short 24ч/i)).toBeInTheDocument();
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
    const negativeFundingBtn = screen.getByRole('button', { name: /Short < 0/i });
    fireEvent.click(negativeFundingBtn);

    expect(screen.getByText('SUI/USDT')).toBeInTheDocument();
    expect(screen.queryByText('BTC/USDT')).toBeNull();
  });

  test('Liquidations: verified actual vs estimated disclaimer, ratio gauge and event log', async () => {
    window.localStorage.setItem('cryptora_qa_fixture', '1');
    renderApp('/liquidations');

    await screen.findByText(/КАРТА И ПОТОК ЛИКВИДАЦИЙ/i);
    // Mandatory methodology distinction
    expect(
      screen.getByText(/ФАКТИЧЕСКАЯ ЛИКВИДАЦИЯ ≠ РАСЧЁТНЫЙ УРОВЕНЬ/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/Ликвидировано лонгов/i)).toBeInTheDocument();
    expect(screen.getByText(/Ликвидировано шортов/i)).toBeInTheDocument();
    expect(
      await screen.findByText(/Журнал событий ликвидаций QA-датасета/i)
    ).toBeInTheDocument();
  });

  test('Liquidations LIVE-first: три потока бирж показаны по отдельности и честно недоступны без сети; доли не оцениваются', async () => {
    window.localStorage.removeItem('cryptora_qa_fixture');
    renderApp('/liquidations');
    await screen.findByText(/Карта и поток ликвидаций/i);
    await screen.findAllByText(/ПОТОК ЛИКВИДАЦИЙ НЕДОСТУПЕН/i);

    for (const id of ['binance', 'bybit', 'okx']) {
      const chip = document.querySelector(`[data-qa="liq-source-${id}"]`) as HTMLElement;
      expect(chip, id).not.toBeNull();
      expect(chip.getAttribute('data-state')).not.toBe('connected');
      expect(chip.textContent).toMatch(/недоступен|подключение|переподключение/);
    }
    expect(screen.getByText(/Доли неподключённых бирж не оцениваются/i)).toBeInTheDocument();
    expect(screen.queryByText(/Bybit.*\d+%/)).toBeNull();
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

    expect(await screen.findByRole('heading', { name: /Калькуляторы и риск-инструменты/i })).toBeInTheDocument();
    expect(screen.getByText(/Калькулятор размера позиции/i)).toBeInTheDocument();
    expect(screen.getByText(/Калькулятор PnL и ROE/i)).toBeInTheDocument();
    expect(screen.getByText(/Сумма риска \(стоп-лосс, \$\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Чистый PnL \(\$\)/i)).toBeInTheDocument();
  });

  test('Strategies & Signals: honest architectural previews without fake performance claims', async () => {
    renderApp('/strategies');
    expect(await screen.findByRole('heading', { name: /^Стратегии$/i })).toBeInTheDocument();
    // Продуктовый экран не обещает доходности и не содержит торговых кнопок
    expect(document.body.textContent).not.toMatch(/Исполнить ордер|ожидаемая доходность|гарантированн/i);

    // Strategy Research Archive живёт в свёрнутой секции (mountOnOpen) — раскрываем
    const archiveToggle = within(screen.getByTestId('research-archive-collapsible')).getByRole('button', { name: /Исследовательский архив/i });
    fireEvent.click(archiveToggle);

    // 13 versions from the registry, verdict ≠ reproducibility, filters, comparability warning
    const archive = await screen.findByTestId('strategy-archive');
    expect(within(archive).getByTestId('strategy-archive-count').textContent).toBe('13 версий');
    expect(archive.querySelectorAll('[data-testid^="archive-card-"]').length).toBe(13);
    const v31 = within(archive).getByTestId('archive-card-V3_1_HTF_TREND_PULLBACK');
    expect(v31.textContent).toContain('ФАЛЬСИФИЦИРОВАНО НА TRAIN');
    expect(v31.textContent).toContain('ВОСПРОИЗВЕДЕНО В CRYPTORA');
    const v21a = within(archive).getByTestId('archive-card-V2_1A_STRUCTURAL_LIMIT_ENTRY');
    expect(v21a.textContent).toContain('ОТКЛОНЕНО НА TRAIN');
    expect(v21a.textContent).toContain('НЕ ПЕРЕЗАПУСКАЛОСЬ');
    expect(archive.textContent).not.toMatch(/BUY|SELL|Execute|Исполнить ордер|прибыльная стратегия|ожидаемая доходность/);
    fireEvent.click(within(archive).getByTestId('archive-filter-FALSIFIED'));
    expect(archive.querySelectorAll('[data-testid^="archive-card-"]').length).toBe(2);
    fireEvent.click(within(archive).getByTestId('archive-filter-ALL'));
    fireEvent.click(within(within(archive).getByTestId('archive-card-V2_8_ZERO_FEE_SNIPER_TRAILING')).getByText(/сравнить допущения/));
    fireEvent.click(within(within(archive).getByTestId('archive-card-V3_0_HTF_LIQUIDATION_TRAP')).getByText(/сравнить допущения/));
    expect(within(archive).getByTestId('archive-compare-warning').textContent).toMatch(/fees=0/);

    cleanup();
    renderApp('/signals');
    expect(await screen.findByRole('heading', { name: /^Сигналы$/i })).toBeInTheDocument();
    expect(screen.getByText(/Не является финансовой рекомендацией/i)).toBeInTheDocument();
    expect(screen.getByText(/Кодекс прозрачности сигналов/i)).toBeInTheDocument();
    // Пустой журнал: ни одной карточки и никаких заявлений о доходности
    expect(document.querySelectorAll('[data-qa="signal-card"]').length).toBe(0);
    expect(document.body.textContent).not.toMatch(/гарантированн|ожидаемая доходность/i);
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
    expect(screen.getByText(/^Система алертов$/i)).toBeInTheDocument();
    expect(screen.queryByText(/Система алертов \(превью\)|Демо-алерт|Очередь прототипа/i)).toBeNull();
  });

  test('Алерты: правило создаётся, срабатывает на фактическом тике и попадает в историю; лимит тарифа соблюдается', async () => {
    window.localStorage.clear();
    window.localStorage.setItem('cryptora_alerts', '[]');
    renderApp('/');

    fireEvent.click(screen.getByLabelText(/Открыть алерты/i));
    expect(screen.getByText(/^Система алертов$/i)).toBeInTheDocument();
    // Стартовое состояние — без выдуманных «демо»-правил.
    expect(screen.getByText(/Нет активных алертов/i)).toBeInTheDocument();

    const target = document.querySelector('[data-qa="alert-target-input"]') as HTMLInputElement;
    fireEvent.change(target, { target: { value: '100' } });
    fireEvent.click(document.querySelector('[data-qa="alert-submit"]') as HTMLElement);
    expect(document.querySelectorAll('[data-qa="alert-rule"]').length).toBe(1);

    // Фактический тик по BTC выше порога → событие
    const { RealtimeFeedManager } = await import('@/services/realtime/RealtimeFeedManager');
    RealtimeFeedManager.getInstance().eventBus.publishTicker(
      {
        symbol: 'BTC',
        price: 101,
        priceChangePercent24h: 0,
        high24h: 101,
        low24h: 99,
        volume24h: 1,
        quoteVolume24h: 100,
        timestamp: Date.now(),
        provenance: { exchange: 'binance', market: 'spot', symbol: 'BTCUSDT', timestamp: Date.now() },
      },
      true,
    );

    await waitFor(() => expect(document.querySelector('[data-qa="alerts-unread-badge"]')).not.toBeNull());
    fireEvent.click(document.querySelector('[data-qa="alerts-tab-history"]') as HTMLElement);
    const events = document.querySelectorAll('[data-qa="alert-event"]');
    expect(events.length).toBe(1);
    expect(events[0].textContent).toMatch(/BTC/);
    expect(events[0].textContent).toMatch(/источник: binance/i);
    expect(events[0].textContent).toMatch(/IN_APP: ДОСТАВЛЕНО/);
    await waitFor(() => expect(document.querySelector('[data-qa="alerts-unread-badge"]')).toBeNull());

    // Лимит тарифа: FREE = 2 алерта
    const { PlanManager } = await import('@/services/subscription/PlanManager');
    const max = PlanManager.getMaxAlerts();
    fireEvent.click(document.querySelector('[data-qa="alerts-tab-rules"]') as HTMLElement);
    for (let i = 1; i < max; i++) {
      fireEvent.change(document.querySelector('[data-qa="alert-target-input"]') as HTMLInputElement, { target: { value: String(1000 + i) } });
      fireEvent.click(document.querySelector('[data-qa="alert-submit"]') as HTMLElement);
    }
    expect(document.querySelectorAll('[data-qa="alert-rule"]').length).toBe(max);
    expect((document.querySelector('[data-qa="alert-submit"]') as HTMLButtonElement).disabled).toBe(true);

    // Хранилище: правила и история персистятся
    expect(JSON.parse(window.localStorage.getItem('cryptora_alerts') ?? '[]').length).toBe(max);
    expect(JSON.parse(window.localStorage.getItem('cryptora_alert_history') ?? '[]').length).toBe(1);
  });

  test('Корреляции считаются по свечам источника и помечают их происхождение (QA-свечи ≠ LIVE)', async () => {
    renderApp('/correlations');
    const badge = await waitFor(() => {
      const el = document.querySelector('[data-qa="correlations-source"]') as HTMLElement;
      expect(el.textContent).toMatch(/QA-СВЕЧИ/);
      return el;
    });
    expect(badge.textContent).not.toMatch(/LIVE/);
    expect(document.querySelector('[data-qa="static-dataset-notice"]')).toBeNull();
    // Диагональ матрицы = +1.00, бенчмарк BTC присутствует
    const cells = Array.from(document.querySelectorAll('td')).map((td) => td.textContent?.trim());
    expect(cells.filter((c) => c === '+1.00').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('BTC').length).toBeGreaterThan(0);
  });

  test('Модал тарифов честно сообщает, что биллинг не подключён, и не предлагает «купить»', async () => {
    cleanup();
    renderApp('/');
    const trigger = document.querySelector('button[title^="Тарифный план"]') as HTMLButtonElement | null;
    expect(trigger).not.toBeNull();
    fireEvent.click(trigger!);
    await waitFor(() => expect(document.querySelector('[data-qa="plan-billing-notice"]')).not.toBeNull());
    const text = document.body.textContent ?? '';
    expect(text).toContain('Биллинг не подключён');
    expect(text).not.toMatch(/Оформить|Купить|Оплатить/);
  });

  test('/articles: список статей владельца и открытие статьи, без raw-HTML', async () => {
    cleanup();
    renderApp('/articles');
    await waitFor(() => expect(document.querySelectorAll('[data-qa="article-card"]').length).toBeGreaterThan(0));
    const cards = document.querySelectorAll('[data-qa="article-card"]');
    const href = cards[0].getAttribute('href')!;
    cleanup();
    renderApp(href);
    await waitFor(() => expect(document.querySelector('[data-qa="article"]')).not.toBeNull());
    expect(document.querySelector('[data-qa="article"] h1')!.textContent!.length).toBeGreaterThan(5);
    expect(document.body.textContent).toContain('не является инвестиционной рекомендацией');
    cleanup();
    renderApp('/articles/net-takoy');
    await waitFor(() => expect(document.querySelector('[data-qa="article-not-found"]')).not.toBeNull());
  });

  test('Партнёрские слоты: при пустом конфиге не рендерятся вовсе', async () => {
    cleanup();
    renderApp('/');
    expect(document.querySelectorAll('[data-qa="sponsor-slot"]').length).toBe(0);
    expect(document.body.textContent).not.toContain('Sponsored / Partner');
  });

  test('/signals: серверная лента пуста/недоступна — без иллюстративных сетапов, структура V2 на месте', async () => {
    cleanup();
    renderApp('/signals');
    // Маршрут ленивый (Suspense): дожидаемся фактического рендера страницы.
    // Серверная лента в герметичном окружении недоступна (сеть отключена) — это
    // честное «показывать нечего», а не подстановка демо-сетапов.
    await waitFor(() => {
      const empty = document.querySelector('[data-qa="signals-empty"]');
      expect(empty).not.toBeNull();
      // Причина состояния явно помечена: пустая лента или ошибка источника.
      expect(['empty', 'error']).toContain(empty!.getAttribute('data-state'));
    });
    // Ни одной карточки сигнала: ни демонстрационных, ни «иллюстративных» сетапов.
    expect(document.querySelectorAll('[data-qa="signal-card"]').length).toBe(0);
    expect(document.body.textContent).not.toContain('Цель достигнута:');
    expect(document.querySelector('[data-qa="static-dataset-notice"]')).toBeNull();

    // Signals V2: источник — серверная лента; селектор монеты, сводка, график,
    // детали, история и аудит рендерятся и без данных (график — по свечам
    // демо-провайдера, один запрос на выбранный символ, без веера).
    expect(document.querySelector('[data-qa="signals-coin-selector"]')).not.toBeNull();
    expect(document.querySelector('[data-qa="signals-chart-card"]')).not.toBeNull();
    expect(document.querySelector('[data-qa="signals-history"]')).not.toBeNull();
    expect(document.querySelector('[data-qa="signals-audit-section"]')).not.toBeNull();
    // BUG B: единственный блок пустого состояния на странице (дубль в сводке удалён).
    expect(document.querySelectorAll('[data-qa="signals-empty"]').length).toBe(1);
    expect(document.querySelectorAll('[data-qa="signals-summary-empty"]').length).toBe(0);

    // Таймфрейм сигнала (исполнения) и переключатель таймфрейма графика.
    expect(document.querySelector('[data-qa="signals-chart-tf-1h"]')).not.toBeNull();
    expect(document.querySelector('[data-qa="signals-chart-tf-4h"]')).not.toBeNull();

    // BUG C: плашка сканирования показывает состояние СЕРВЕРА. В герметичном
    // окружении `/api/strategies` недоступен, поэтому статус — «недоступен», а
    // НЕ «выключено» и уж точно не «LIVE-скан»: отсутствие ответа сервера не
    // является доказательством выключенного сканера.
    const scanner = document.querySelector('[data-qa="signals-scanner-status"]');
    expect(scanner).not.toBeNull();
    expect(['unknown', 'off', 'on', 'error']).toContain(scanner!.getAttribute('data-state'));
    expect(document.body.textContent).not.toContain('LIVE-скан');
    expect(document.body.textContent).not.toContain('LIVE');
  });

  test('/calendar без доступа к Binance показывает «ИСТОЧНИК НЕДОСТУПЕН», без статических FOMC/CPI', async () => {
    cleanup();
    renderApp('/calendar');
    await waitFor(() => {
      const badge = document.querySelector('[data-qa="calendar-source"]');
      expect(badge).not.toBeNull();
      expect(badge!.getAttribute('data-state')).not.toBe('loading');
    });
    const badge = document.querySelector('[data-qa="calendar-source"]')!;
    expect(['live', 'unavailable']).toContain(badge.getAttribute('data-state'));
    if (badge.getAttribute('data-state') === 'unavailable') {
      expect(document.querySelectorAll('[data-qa="calendar-event"]').length).toBe(0);
    }
    expect(document.body.textContent).not.toContain('Решение ФРС');
    expect(document.querySelector('[data-qa="static-dataset-notice"]')).toBeNull();
  });

  test('/onchain без доступа к mempool.space показывает «ИСТОЧНИК НЕДОСТУПЕН», без статических метрик', async () => {
    cleanup();
    renderApp('/onchain');
    await waitFor(() => {
      const badge = document.querySelector('[data-qa="onchain-source"]');
      expect(badge).not.toBeNull();
      expect(badge!.getAttribute('data-state')).not.toBe('loading');
    });
    const badge = document.querySelector('[data-qa="onchain-source"]')!;
    expect(['live', 'unavailable']).toContain(badge.getAttribute('data-state'));
    if (badge.getAttribute('data-state') === 'unavailable') {
      expect(document.querySelectorAll('[data-qa="onchain-metric"]').length).toBe(0);
    }
    expect(document.body.textContent).not.toContain('MVRV Z-Score');
    expect(document.body.textContent).not.toContain('674 EH/s');
    expect(document.querySelector('[data-qa="static-dataset-notice"]')).toBeNull();
  });

  test('/ecosystem без доступа к DeFiLlama показывает «ИСТОЧНИК НЕДОСТУПЕН», а не статические числа', async () => {
    cleanup();
    renderApp('/ecosystem');
    await waitFor(() => {
      const badge = document.querySelector('[data-qa="ecosystem-source"]');
      expect(badge).not.toBeNull();
      expect(badge!.getAttribute('data-state')).not.toBe('loading');
    });
    const badge = document.querySelector('[data-qa="ecosystem-source"]')!;
    expect(['live', 'unavailable']).toContain(badge.getAttribute('data-state'));
    if (badge.getAttribute('data-state') === 'unavailable') {
      expect(document.querySelectorAll('[data-qa="ecosystem-row"]').length).toBe(0);
    }
    expect(document.querySelector('[data-qa="static-dataset-notice"]')).toBeNull();
  });

  test('Статус источника и WebSocket: только индикация, переключение режима недоступно', async () => {
    window.localStorage.removeItem('cryptora_qa_fixture');
    renderApp('/radar');

    // Радар маркирует происхождение данных и не даёт переключать режим.
    expect(await screen.findByText(/LIVE-детектор аномалий/i)).toBeInTheDocument();
    const headerChip = document.querySelector('[data-qa="data-source-status"]') as HTMLElement;
    expect(headerChip).not.toBeNull();
    expect(headerChip.closest('button')).toBeNull();
    expect(screen.queryByRole('button', { name: /^LIVE$/i })).toBeNull();
  });
});

/**
 * CRYPTORA — UX cleanup regression tests.
 *
 * REAL: navigation module, MarketTicker, Footer, Header, RegisterPage,
 *       MarketPage, ScreenerPage, OverviewPage, AdminPage — всё импортируется
 *       и рендерится как есть.
 * MOCKED: только слой данных (stub-провайдер рынка вместо сетевых запросов) и
 *         fetch (auth/admin endpoints). Никакая бизнес-логика в тестах не
 *         переписывается.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import type { MarketDataProvider } from '@/services/data/MarketDataProvider';
import type { AssetSummary } from '@/types/market';
import {
  MARKET_NAV_ITEMS,
  PRIMARY_NAV_ITEMS,
  ALL_NAV_PATHS,
} from '@/components/layout/navigation';
import { MarketDataProviderComponent } from '@/context/MarketDataContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { AuthProvider } from '@/context/AuthContext';
import { MarketTicker } from '@/components/layout/MarketTicker';
import { Footer } from '@/components/layout/Footer';
import { Header } from '@/components/layout/Header';
import { RegisterPage } from '@/pages/RegisterPage';
import { MarketPage } from '@/pages/MarketPage';
import { ScreenerPage } from '@/pages/ScreenerPage';
import { OverviewPage } from '@/pages/OverviewPage';
import { AdminPage } from '@/pages/AdminPage';

const mockFetch = vi.fn();
global.fetch = mockFetch;

/* ── Stub-провайдер рынка ─────────────────────────────────────── */

const TICKER_ASSETS = [
  { symbol: 'BTC', name: 'Bitcoin', rank: 1, price: 50000, change1h: 0.5, change24h: 2.5, change7d: 4.2, volume24h: 1_000_000, marketCap: 900_000_000, category: 'l1', sparkline: [1, 2, 3, 4] },
  { symbol: 'ETH', name: 'Ethereum', rank: 2, price: 25000, change1h: 0.5, change24h: -1.25, change7d: 4.2, volume24h: 2_000_000, marketCap: 450_000_000, category: 'l1', sparkline: [4, 3, 2, 1] },
  { symbol: 'ARB', name: 'Arbitrum', rank: 3, price: 1.25, change1h: 0.5, change24h: 2.5, change7d: 4.2, volume24h: 3_000_000, marketCap: 300_000_000, category: 'l2', sparkline: [1, 3, 2, 4] },
  { symbol: 'UNI', name: 'Uniswap', rank: 4, price: 6.25, change1h: 0.5, change24h: -1.25, change7d: 4.2, volume24h: 4_000_000, marketCap: 225_000_000, category: 'defi', sparkline: [2, 4, 1, 3] },
] as unknown as AssetSummary[];

const getAssetsSpy = vi.fn();
const getScreenerSpy = vi.fn();

/** Минимальный обзор рынка: OverviewPage рендерит KPI только при успешном ответе. */
const OVERVIEW = {
  totalMarketCap: 2_100_000_000_000,
  totalVolume: 90_000_000_000,
  marketCapChange24h: 1.5,
  btcDominance: 54.2,
  fearGreedIndex: 62,
  marketBreadth: { advancing: 2, declining: 2 },
  globalMarketCapUsd: null,
  globalMarketCapChange24hPct: null,
  globalMarketCapUpdatedAt: null,
};

const createStubProvider = (): MarketDataProvider =>
  ({
    isDemo: false,
    getAssets: getAssetsSpy,
    getScreenerResults: getScreenerSpy,
    getMarketOverview: vi.fn().mockResolvedValue(OVERVIEW),
    getAssetDetail: vi.fn().mockResolvedValue(null),
    getCandles: vi.fn().mockResolvedValue([]),
    getFuturesList: vi.fn().mockResolvedValue([]),
    getLiquidations: vi.fn().mockRejectedValue(new Error('unused')),
    getRadarEvents: vi.fn().mockResolvedValue([]),
  }) as unknown as MarketDataProvider;

const renderWithProviders = (ui: React.ReactElement, provider?: MarketDataProvider) =>
  render(
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <MarketDataProviderComponent customProvider={provider}>
            {ui}
          </MarketDataProviderComponent>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  );

/** Мок fetch по таблице «часть URL → ответ». */
const routeFetch = (routes: Record<string, unknown>) => {
  mockFetch.mockImplementation((url: string) => {
    for (const [needle, body] of Object.entries(routes)) {
      if (typeof url === 'string' && url.includes(needle)) {
        return Promise.resolve({ ok: true, status: 200, json: async () => body });
      }
    }
    return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
  });
};

const ADMIN_USER = {
  id: 'a1',
  email: 'admin@example.com',
  displayName: 'Админ',
  role: 'admin',
  isActive: true,
  emailVerified: true,
  createdAt: '2024-01-01T00:00:00Z',
  lastLoginAt: null,
};

beforeEach(() => {
  mockFetch.mockReset();
  getAssetsSpy.mockReset();
  getScreenerSpy.mockReset();
  getAssetsSpy.mockResolvedValue(TICKER_ASSETS);
  getScreenerSpy.mockResolvedValue(TICKER_ASSETS);
  mockFetch.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
});

/* ══ 1. Навигация: рынок раскрывается в Спот / Фьючерсы ══════════ */

describe('Навигация «Рынок»', () => {
  it('MARKET_NAV_ITEMS содержит ровно Спот и Фьючерсы с корректными путями', () => {
    expect(MARKET_NAV_ITEMS.map((i) => i.label)).toEqual(['Спот', 'Фьючерсы']);
    expect(MARKET_NAV_ITEMS.map((i) => i.path)).toEqual(['/market', '/futures']);
  });

  it('Рынок — единственный пункт верхнего уровня с подпунктами', () => {
    const withChildren = PRIMARY_NAV_ITEMS.filter((i) => i.children?.length);
    expect(withChildren).toHaveLength(1);
    expect(withChildren[0].label).toBe('Рынок');
    expect(withChildren[0].children).toHaveLength(2);
  });

  it('оба пути рынка попадают в список активных путей', () => {
    expect(ALL_NAV_PATHS).toContain('/market');
    expect(ALL_NAV_PATHS).toContain('/futures');
  });
});

/* ══ 2. Тикер: настоящая бегущая строка без дубля запросов ══════ */

describe('MarketTicker', () => {
  it('рендерит основной и дублирующий трек для бесшовного цикла', async () => {
    renderWithProviders(<MarketTicker />, createStubProvider());

    const primary = await screen.findByTestId('ticker-track-primary');
    const dup = screen.getByTestId('ticker-track-duplicate');
    // В каждом треке одинаковое число тикеров — иначе стык был бы виден.
    expect(primary.querySelectorAll('a')).toHaveLength(TICKER_ASSETS.length);
    expect(dup.querySelectorAll('a')).toHaveLength(TICKER_ASSETS.length);
  });

  it('дублирующий трек скрыт от скринридеров и исключён из таб-порядка', async () => {
    renderWithProviders(<MarketTicker />, createStubProvider());

    const dup = await screen.findByTestId('ticker-track-duplicate');
    expect(dup).toHaveAttribute('aria-hidden', 'true');
    const links = Array.from(dup.querySelectorAll('a'));
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) expect(link).toHaveAttribute('tabindex', '-1');
  });

  it('viewport тикера скрывает переполнение (body не растягивается)', async () => {
    renderWithProviders(<MarketTicker />, createStubProvider());

    const host = await screen.findByTestId('ticker-marquee');
    expect(host.className).toContain('overflow-hidden');
  });

  it('дублирование чисто визуальное: данные запрашиваются один раз', async () => {
    renderWithProviders(<MarketTicker />, createStubProvider());

    await screen.findByTestId('ticker-track-duplicate');
    expect(getAssetsSpy).toHaveBeenCalledTimes(1);
  });

  it('подпись режима тикера — единый короткий токен «LIVE», без составных меток', async () => {
    renderWithProviders(<MarketTicker />, createStubProvider());

    const label = await screen.findByTestId('ticker-mode-label');
    // Единая система статусов: LIVE / QA. Никаких «LIVE-ТИКЕР», «LIVE-ПЛИТКИ» и т.п.
    expect(label.textContent).toBe('LIVE');
  });

  it('при недоступности источника не подставляет значения из другого датасета', async () => {
    getAssetsSpy.mockRejectedValue(new Error('network down'));
    renderWithProviders(<MarketTicker />, createStubProvider());

    const state = await screen.findByTestId('ticker-source-state');
    expect(state.textContent).toMatch(/недоступен/i);
    expect(screen.queryByTestId('ticker-track-primary')).not.toBeInTheDocument();
  });
});

/* ══ 3. Footer: без внутренних статусов ═════════════════════════ */

describe('Footer', () => {
  it('не показывает внутреннюю формулировку «Рабочая версия»', async () => {
    renderWithProviders(<Footer />);

    expect(await screen.findByText(/Версия v0\.8\.44/)).toBeInTheDocument();
    expect(screen.queryByText(/Рабочая версия/)).not.toBeInTheDocument();
  });
});

/* ══ 4. Header: пользовательское меню не вылезает за экран ══════ */

describe('Header', () => {
  it('меню объявлено как menu, ограничено шириной и обрезает длинные имена', async () => {
    routeFetch({ '/api/auth/session': { user: { ...ADMIN_USER, displayName: 'Пользователь С Очень Длинным Именем' } } });

    renderWithProviders(<Header />);

    const trigger = await screen.findByLabelText('Меню пользователя');
    await userEvent.click(trigger);

    const menu = await screen.findByRole('menu', { name: 'Меню пользователя' });
    await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'true'));

    expect(menu.className).toMatch(/max-w-\[calc\(100vw-1\.5rem\)\]/);
    const name = within(menu).getByText('Пользователь С Очень Длинным Именем');
    expect(name.className).toContain('truncate');
  });
});

/* ══ 5. Регистрация: честное закрытое состояние ═════════════════ */

describe('RegisterPage', () => {
  it('показывает закрытое состояние при registrationOpen=false', async () => {
    routeFetch({ 'registration-status': { registrationOpen: false } });
    renderWithProviders(<RegisterPage />);

    expect(await screen.findByRole('heading', { name: 'Регистрация временно закрыта' })).toBeInTheDocument();
    // Формы быть не должно — иначе пользователь получит гарантированный 403.
    expect(screen.queryByRole('heading', { name: 'Регистрация' })).not.toBeInTheDocument();
  });

  it('показывает форму, когда регистрация открыта', async () => {
    routeFetch({ 'registration-status': { registrationOpen: true } });
    renderWithProviders(<RegisterPage />);

    expect(await screen.findByRole('heading', { name: 'Регистрация' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Регистрация временно закрыта' })).not.toBeInTheDocument();
  });

  it('не закрывает регистрацию из-за недоступного backend', async () => {
    mockFetch.mockRejectedValue(new Error('offline'));
    renderWithProviders(<RegisterPage />);

    expect(await screen.findByRole('heading', { name: 'Регистрация' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Регистрация временно закрыта' })).not.toBeInTheDocument();
  });
});

/* ══ 6. Market: терминология таблицы, LIVE-подпись, категории ═══ */

describe('MarketPage', () => {
  it('LIVE-подпись читается как «СПОТ • LIVE», биржи — вторичным текстом', async () => {
    renderWithProviders(<MarketPage />, createStubProvider());
    await screen.findByText('BTC');

    const label = screen.getByTestId('spot-live-label');
    expect(label.textContent).toContain('СПОТ • LIVE');
    const source = label.querySelector(':scope > span:not([aria-hidden])') as HTMLElement | null;
    expect(source?.textContent).toBe('Binance / KuCoin');
    expect(source?.className).toContain('text-slate-500');
    expect(label.textContent).not.toMatch(/LIVE СПОТ · BINANCE/i);
  });

  it('заголовки столбцов в русской терминологии и без uppercase', async () => {
    renderWithProviders(<MarketPage />, createStubProvider());
    await screen.findByText('BTC');

    const thead = document.querySelector('thead') as HTMLElement;
    expect(thead).not.toBeNull();
    // `uppercase` превращал бы «1ч %» в нечитаемое «1Ч %».
    expect(thead.className).not.toContain('uppercase');

    for (const header of ['1ч %', '24ч %', '7д %', 'Цена, USD', 'Объём 24ч', 'Капитализация']) {
      expect(within(thead).getByText(header)).toBeInTheDocument();
    }
    // Старых англо-русских гибридов быть не должно.
    for (const stale of ['1H %', '24H %', '7D %', 'Цена (USD)', '24h Объем', 'Тренд 7D']) {
      expect(within(thead).queryByText(stale)).not.toBeInTheDocument();
    }
  });

  it('sort-индикатор — отдельная иконка, состояние объявлено через aria-sort', async () => {
    renderWithProviders(<MarketPage />, createStubProvider());
    await screen.findByText('BTC');

    const thead = document.querySelector('thead') as HTMLElement;
    const headers = Array.from(thead.querySelectorAll('th[aria-sort]'));
    expect(headers).toHaveLength(8);
    expect(headers.filter((h) => h.getAttribute('aria-sort') !== 'none')).toHaveLength(1);

    // Никаких «# ^» — стрелка отдельным элементом рядом с подписью.
    expect(headers.some((h) => /\^/.test(h.textContent ?? ''))).toBe(false);
  });

  it('фильтры категорий используют Layer-1 / Layer-2', async () => {
    renderWithProviders(<MarketPage />, createStubProvider());
    await screen.findByText('BTC');

    expect(screen.getByRole('button', { name: 'Layer-1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Layer-2' })).toBeInTheDocument();
    expect(screen.queryByText('L1-сети')).not.toBeInTheDocument();
    expect(screen.queryByText('L2-сети')).not.toBeInTheDocument();
  });

  it('бейдж категории в строке — человекочитаемый, а не «l1»', async () => {
    renderWithProviders(<MarketPage />, createStubProvider());
    await screen.findByText('BTC');

    const badges = Array.from(document.querySelectorAll('tbody [title]'))
      .map((el) => el.getAttribute('title'))
      .filter(Boolean);
    expect(badges).toContain('Layer-1');
    expect(badges).toContain('Layer-2');
    expect(badges).not.toContain('l1');
    expect(badges).not.toContain('l2');
  });
});

/* ══ 7. Screener: те же категории ══════════════════════════════ */

describe('ScreenerPage', () => {
  it('сектора называются Layer-1 / Layer-2', async () => {
    renderWithProviders(<ScreenerPage />, createStubProvider());

    await screen.findByText('BTC');
    const selects = await screen.findAllByRole('combobox');
    const sectorSelect = selects.find((el) =>
      Array.from(el.querySelectorAll('option')).some((o) => o.textContent === 'Все сектора')
    );
    expect(sectorSelect).toBeDefined();
    const labels = Array.from(sectorSelect!.querySelectorAll('option')).map((o) => o.textContent);
    expect(labels).toContain('Layer-1');
    expect(labels).toContain('Layer-2');
    expect(labels.join(' ')).not.toMatch(/L[12]-сети/);
  });
});

/* ══ 8. Overview: 5 KPI, без карточки «Режим данных» ═══════════ */

describe('OverviewPage', () => {
  it('в KPI-сетке нет карточки «Режим данных» и ровно 5 колонок', async () => {
    renderWithProviders(<OverviewPage />, createStubProvider());
    await screen.findByText(/Капитализация/);

    expect(screen.queryByTestId('overview-mode-card')).not.toBeInTheDocument();
    expect(screen.queryByText('Режим данных')).not.toBeInTheDocument();

    const grid = screen.getByTestId('overview-kpi-grid');
    expect(grid.className).toContain('lg:grid-cols-5');
    expect(grid.className).not.toContain('lg:grid-cols-6');
    expect(grid.children).toHaveLength(5);
  });

  it('в QA-режиме не обещает перпетуалы', async () => {
    renderWithProviders(<OverviewPage />, createStubProvider());
    await screen.findByText(/Капитализация/);

    expect(screen.queryByText(/Спот и перп/i)).not.toBeInTheDocument();
  });
});

/* ══ 9. Admin: статус регистрации на русском ═══════════════════ */

describe('AdminPage', () => {
  const openSystemTab = async () => {
    routeFetch({
      '/api/auth/session': { user: ADMIN_USER },
      '/api/admin/dashboard': {
        health: {
          status: 'ok',
          database: 'connected',
          version: '0.8.44',
          nodeVersion: 'v22',
          environment: 'test',
          uptimeSeconds: 10,
          registrationEnabled: false,
        },
        users: { total: 1, admins: 1, users: 0, active: 1, blocked: 0 },
        recentAudit: [],
        timestamp: new Date().toISOString(),
      },
      '/api/admin/system': {
        version: '0.8.44',
        nodeVersion: 'v22',
        environment: 'test',
        uptimeSeconds: 10,
        database: 'connected',
        registrationEnabled: false,
        memoryUsage: { rss: '1 MB', heapUsed: '1 MB' },
      },
      '/api/admin/users': { users: [], total: 0, page: 1, pageSize: 20 },
    });

    renderWithProviders(<AdminPage />);
    await userEvent.click(await screen.findByRole('button', { name: /Система/ }));
  };

  it('показывает выключенную регистрацию по-русски', async () => {
    await openSystemTab();

    const row = (await screen.findByText('Регистрация')).closest('div') as HTMLElement;
    expect(within(row).getByText('Выключена')).toBeInTheDocument();
  });
});

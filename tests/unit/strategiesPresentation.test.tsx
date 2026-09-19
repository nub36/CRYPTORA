/**
 * CRYPTORA — presentation-регрессии компактного терминала.
 *
 * REAL: StrategiesPage, ProductStrategiesSection, реестр strategyArchive,
 *       Footer, MarketTicker — всё импортируется и рендерится как есть.
 * MOCKED: только слой рыночных данных (stub-провайдер) и fetch.
 *
 * Математика стратегий здесь не переопределяется: тесты проверяют только то,
 * что показывается пользователю и в каком состоянии (свёрнуто/развёрнуто).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import type { MarketDataProvider } from '@/services/data/MarketDataProvider';
import { MarketDataProviderComponent } from '@/context/MarketDataContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { AuthProvider } from '@/context/AuthContext';
import { StrategiesPage } from '@/pages/StrategiesPage';
import { ProductStrategiesSection, PRODUCT_STRATEGY_IDS } from '@/components/strategies/ProductStrategiesSection';
import { Footer } from '@/components/layout/Footer';

const mockFetch = vi.fn();
global.fetch = mockFetch;

const SRC = (p: string) => fs.readFileSync(path.resolve(__dirname, '../..', p), 'utf8');

const createStubProvider = (): MarketDataProvider =>
  ({
    isDemo: false,
    getAssets: vi.fn().mockResolvedValue([]),
    getMarketOverview: vi.fn().mockRejectedValue(new Error('unused')),
    getAssetDetail: vi.fn().mockResolvedValue(null),
    getCandles: vi.fn().mockResolvedValue([]),
    getFuturesList: vi.fn().mockResolvedValue([]),
    getLiquidations: vi.fn().mockRejectedValue(new Error('unused')),
    getRadarEvents: vi.fn().mockResolvedValue([]),
    getScreenerResults: vi.fn().mockResolvedValue([]),
  }) as unknown as MarketDataProvider;

const renderPage = (ui: React.ReactElement) =>
  render(
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <MarketDataProviderComponent customProvider={createStubProvider()}>
            {ui}
          </MarketDataProviderComponent>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  );

beforeEach(() => {
  mockFetch.mockReset();
  mockFetch.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
});

/* ══ 1. Primary UI = ровно три стратегии ════════════════════════ */

describe('/strategies — primary UI', () => {
  it('показывает ровно три продуктовые стратегии', () => {
    const { container } = render(<ProductStrategiesSection />);
    const ids = Array.from(
      container.querySelectorAll('[data-testid^="product-strategy-"]')
    ).map((el) => (el.getAttribute('data-testid') ?? '').replace('product-strategy-', ''));

    expect(ids.sort()).toEqual([...PRODUCT_STRATEGY_IDS].sort());
    expect(ids).toHaveLength(3);
  });

  it('названия соответствуют фактической реализации реестра', () => {
    render(<ProductStrategiesSection />);
    expect(screen.getByText('HTF Liquidation Trap')).toBeInTheDocument();
    expect(screen.getByText('HTF Zone Mitigation & LTF Squeeze')).toBeInTheDocument();
    expect(screen.getByText('Zero-fee Sniper + Trailing (gross-only)')).toBeInTheDocument();
  });

  it('версии V3.0 / V3.3 / V2.8 видны сразу', () => {
    render(<ProductStrategiesSection />);
    for (const v of ['V3.0', 'V3.3', 'V2.8']) {
      expect(screen.getByText(v)).toBeInTheDocument();
    }
  });

  it('заголовок страницы — «Стратегии», а не «Лаборатория стратегий»', async () => {
    renderPage(<StrategiesPage />);
    expect(await screen.findByRole('heading', { name: 'Стратегии' })).toBeInTheDocument();
    expect(screen.queryByText('Лаборатория стратегий')).not.toBeInTheDocument();
    expect(screen.queryByText('Архитектурный прототип')).not.toBeInTheDocument();
  });
});

/* ══ 2. Статусы не врут ════════════════════════════════════════ */

describe('/strategies — честность статусов', () => {
  it('статусы соответствуют фактическому verdict реестра', () => {
    render(<ProductStrategiesSection />);
    expect(screen.getByText('Research validated')).toBeInTheDocument();
    expect(screen.getByText('Train only')).toBeInTheDocument();
    expect(screen.getByText('Gross-only validated')).toBeInTheDocument();
  });

  it('нигде не обещается доходность или проверка в live', () => {
    render(<ProductStrategiesSection />);
    const text = document.body.textContent ?? '';
    for (const forbidden of ['Рабочая', 'Прибыльная', 'Проверенная в live', 'Гарантир']) {
      expect(text, `запрещённая формулировка «${forbidden}»`).not.toContain(forbidden);
    }
  });
});

/* ══ 3. Исследовательский архив — не primary UI ════════════════ */

describe('/strategies — исследовательский архив', () => {
  it('свёрнут по умолчанию и не показывает 13 карточек сразу', async () => {
    renderPage(<StrategiesPage />);

    const archive = await screen.findByTestId('research-archive-collapsible');
    expect(archive).toHaveAttribute('data-open', 'false');
    // Внутри — скрыто, поэтому карточек архива в доступном дереве нет.
    expect(archive.querySelector('[data-testid^="archive-card-"]')).toBeNull();
    expect(archive.querySelector('[role="region"]')).toHaveAttribute('hidden');
  });

  it('раскрывается по клику и показывает полный архив', async () => {
    renderPage(<StrategiesPage />);

    const archive = await screen.findByTestId('research-archive-collapsible');
    await userEvent.click(within(archive).getByRole('button'));

    expect(archive).toHaveAttribute('data-open', 'true');
    const cards = archive.querySelectorAll('[data-testid^="archive-card-"]');
    expect(cards.length).toBeGreaterThan(3);
  });
});

/* ══ 4. Длинные блоки свёрнуты по умолчанию ════════════════════ */

describe('/strategies — collapsible по умолчанию', () => {
  it('риски и ограничения свёрнуты', () => {
    render(<ProductStrategiesSection />);
    for (const id of PRODUCT_STRATEGY_IDS) {
      const risks = screen.getByTestId(`risks-${id}`);
      expect(risks, `риски ${id} должны быть свёрнуты`).toHaveAttribute('data-open', 'false');
      expect(risks.querySelector('[role="region"]')).toHaveAttribute('hidden');
    }
  });

  it('технические сведения с хешами свёрнуты', () => {
    render(<ProductStrategiesSection />);
    for (const id of PRODUCT_STRATEGY_IDS) {
      const tech = screen.getByTestId(`technical-${id}`);
      expect(tech).toHaveAttribute('data-open', 'false');
      expect(tech.querySelector('[role="region"]')).toHaveAttribute('hidden');
    }
  });

  it('длинный SHA не виден в свёрнутом состоянии', () => {
    render(<ProductStrategiesSection />);
    const visible = Array.from(document.querySelectorAll('.ui-hash')).filter(
      (el) => !(el.closest('[role="region"]') as HTMLElement | null)?.hidden
    );
    expect(visible, 'в primary UI не должно быть хешей').toHaveLength(0);
  });

  it('оговорки про отсутствие исполнения свёрнуты', async () => {
    renderPage(<StrategiesPage />);
    const notice = await screen.findByTestId('non-execution-collapsible');
    expect(notice).toHaveAttribute('data-open', 'false');
  });
});

/* ══ 5. Дисклеймер футера ══════════════════════════════════════ */

describe('Footer — дисклеймер', () => {
  it('компактный и свёрнут по умолчанию, полный текст сохраняется', async () => {
    renderPage(<Footer />);

    const disclaimer = await screen.findByTestId('footer-disclaimer');
    expect(disclaimer).toHaveAttribute('data-open', 'false');
    expect(within(disclaimer).getByText('Дисклеймер')).toBeInTheDocument();
    // Текст не удалён — он просто скрыт.
    expect(disclaimer.textContent).toContain('не является биржей или брокером');

    await userEvent.click(within(disclaimer).getByRole('button'));
    expect(disclaimer).toHaveAttribute('data-open', 'true');
  });
});

/* ══ 6. Терминология: устаревшие формулировки ══════════════════ */

describe('Терминология — сканирование исходников', () => {
  const USER_FACING = [
    'src/pages/OverviewPage.tsx',
    'src/pages/FuturesPage.tsx',
    'src/pages/MarketPage.tsx',
    'src/pages/ScreenerPage.tsx',
    'src/pages/SignalsPage.tsx',
    'src/pages/LiquidationsPage.tsx',
    'src/components/market/AssetPulsePanel.tsx',
    'src/utils/labels.ts',
  ];

  it('user-facing «перп/перпы/перпов» больше нет', () => {
    for (const f of USER_FACING) {
      const src = SRC(f);
      // Комментарии не в счёт — только строки/JSX-текст.
      const stripped = src
        .split('\n')
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .join('\n');
      expect(stripped, `${f} всё ещё содержит «перп»`).not.toMatch(/перп/i);
    }
  });

  it('«Лонг/Шорт» заменены на industry English', () => {
    for (const f of USER_FACING) {
      expect(SRC(f), `${f} всё ещё содержит «Лонг/Шорт»`).not.toMatch(/Лонг|Шорт/);
    }
  });

  it('L1-сети / L2-сети заменены на Layer-1 / Layer-2', () => {
    for (const f of ['src/pages/MarketPage.tsx', 'src/pages/ScreenerPage.tsx']) {
      const src = SRC(f);
      expect(src).not.toMatch(/L[12]-сети/);
      expect(src).toContain('Layer-1');
      expect(src).toContain('Layer-2');
    }
  });
});

/* ══ 7. Mobile-safe структура ══════════════════════════════════ */

describe('Mobile-safe', () => {
  it('хеши используют класс с безопасным переносом', () => {
    const css = SRC('src/index.css');
    expect(css).toMatch(/\.ui-hash\s*\{[^}]*overflow-wrap:\s*anywhere/s);
    expect(css).toMatch(/\.ui-hash\s*\{[^}]*word-break:\s*break-all/s);
  });

  it('в global CSS есть защита от горизонтального переполнения', () => {
    const css = SRC('src/index.css');
    expect(css).toMatch(/body\s*\{[^}]*overflow-x:\s*hidden/s);
  });

  it('карточка стратегии — одна колонка на узких экранах', () => {
    const src = SRC('src/components/strategies/ProductStrategiesSection.tsx');
    expect(src).toContain('grid-cols-1');
    expect(src).toMatch(/lg:grid-cols-3/);
  });

  it('кнопки раскрытия touch-friendly (>= 40px)', () => {
    const card = SRC('src/components/strategies/ProductStrategiesSection.tsx');
    expect(card).toMatch(/min-h-\[40px\]/);
    const collapsible = SRC('src/components/common/Collapsible.tsx');
    expect(collapsible).toMatch(/min-h-\[44px\]/);
  });

  it('бегущая строка не расширяет страницу и уважает reduced-motion', () => {
    const css = SRC('src/index.css');
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce/);
    expect(css).toMatch(/\.ticker-marquee\s*\{[^}]*animation:\s*none\s*!important/s);
    const ticker = SRC('src/components/layout/MarketTicker.tsx');
    expect(ticker).toContain('overflow-hidden');
  });
});

import './setup-dom';
import { resetBrowserStorage } from './setup-dom';
import { test, expect } from '@playwright/test';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MarketDataProviderComponent } from '@/context/MarketDataContext';
import App from '@/App';
import { PRIMARY_NAV_ITEMS, PRIMARY_NAV_CAPACITY } from '@/components/layout/navigation';

function setWindowDimensions(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: height });
  window.dispatchEvent(new Event('resize'));
}

function renderApp(initialPath = '/') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <MarketDataProviderComponent>
        <App />
      </MarketDataProviderComponent>
    </MemoryRouter>
  );
}

/**
 * Регрессионный набор шапки CRYPTORA.
 *
 * Предыдущая версия набора проверяла только наличие ссылок и класс `whitespace-nowrap`
 * и поэтому пропустила реальный UI-регресс: на 1280px правая часть шапки выходила
 * за пределы вьюпорта, а элементы накладывались друг на друга (пункт «Обзор»
 * перекрывал бейдж версии). Здесь добавлены проверки архитектурных инвариантов,
 * которые такой регресс делают невозможным:
 *   1. Ёмкость primary-навигации ограничена (6 пунктов) — бюджет места.
 *   2. Кегль primary-навигации читаемый (>= 13px) — запрет «микроскопического» текста.
 *   3. В шапке нет текста мельче 11px.
 *   4. Компактный desktop-диапазон переводит навигацию во вторую строку (stacking)
 *      вместо сжатия/наложения.
 *   5. Вторичные service controls сворачиваются в иконки при нехватке места.
 *
 * Геометрические инварианты (реальные размеры и overflow) проверяются в браузере:
 * `node scripts/screenshot-qa.mjs` — JSDOM не рассчитывает layout.
 */
// QA-фикстура: сброс localStorage переводит прогон на детерминированный датасет
// и исключает реальные сетевые вызовы к биржам из E2E-прогона.
test.beforeEach(() => {
  resetBrowserStorage();
});

test.describe('UI/UX Premium Redesign Regression Suite', () => {
  test.afterEach(() => {
    cleanup();
    // Изоляция состояния обеспечивается общим before-each хуком в e2e/setup-dom.ts
  });

  test('Header capacity budget: прямая навигация ограничена и сохраняет читаемый кегль', async () => {
    setWindowDimensions(1280, 800);
    renderApp('/');

    // Ёмкость прямой навигации — жёсткий архитектурный бюджет
    expect(PRIMARY_NAV_ITEMS.length).toBe(PRIMARY_NAV_CAPACITY);
    expect(PRIMARY_NAV_ITEMS.length).toBeLessThanOrEqual(6);

    // Кегль навигации: 13px (14px от 1536px), без микротекста
    const nav = screen.getByLabelText('Главная навигация');
    expect(nav.className).toContain('text-[13px]');
    expect(nav.className).not.toMatch(/text-\[(9|10|11)px\]/);

    // Все пункты прямой навигации доступны и не ломают строку
    for (const item of PRIMARY_NAV_ITEMS) {
      const links = screen.getAllByRole('link', { name: new RegExp(item.label, 'i') });
      expect(links.length).toBeGreaterThan(0);
      expect(links[0].className).toContain('whitespace-nowrap');
    }

    // Вторичные разделы живут в группированных меню
    expect(screen.getByRole('button', { name: /Аналитика/i }).className).toContain('whitespace-nowrap');
    expect(screen.getByRole('button', { name: /Инструменты/i }).className).toContain('whitespace-nowrap');
  });

  const MIN_HEADER_FONT_PX = 11;

  function collectTinyHeaderText(container: HTMLElement): string[] {
    const header = container.querySelector('header') as HTMLElement;
    expect(header).not.toBeNull();

    const tiny: string[] = [];
    header.querySelectorAll<HTMLElement>('*').forEach((el) => {
      if (el.children.length > 0) return;
      const text = (el.textContent || '').trim();
      if (!text) return;
      // Кегль в JSDOM не рассчитывается из Tailwind-классов — читаем классы
      const match = el.className.match(/text-\[(\d+(?:\.\d+)?)px\]/);
      if (match && parseFloat(match[1]) < MIN_HEADER_FONT_PX) tiny.push(`"${text}" (${match[1]}px)`);
    });
    return tiny;
  }

  // Регресс возник именно в режиме LIVE SPOT: плашка режима данных со статусом WS
  // рендерится только при dataMode === 'live'. Поэтому проверяем оба режима.
  for (const mode of ['demo', 'live'] as const) {
    test(`Header typography (${mode}): ни один текстовый узел шапки не мельче ${MIN_HEADER_FONT_PX}px`, async () => {
      setWindowDimensions(1440, 900);
      if (mode === 'demo') window.localStorage.setItem('cryptora_qa_fixture', '1');
      else window.localStorage.removeItem('cryptora_qa_fixture');

      // Шапка идентична на всех маршрутах: берём раздел без загрузки рыночных
      // данных, чтобы тест проверял типографику шапки, а не data-слой.
      const { container } = renderApp('/journal');

      if (mode === 'live') {
        // Подтверждаем, что плашка LIVE + WS действительно отрендерена
        expect(container.querySelector('header')!.textContent).toMatch(/LIVE/);
        expect(container.querySelector('header')!.textContent).toMatch(/WS/);
      }

      expect(collectTinyHeaderText(container as HTMLElement)).toEqual([]);
    });
  }

  test('Header compact desktop (1024–1279px): навигация в отдельной строке (stacking), а не сжатие текста', async () => {
    setWindowDimensions(1024, 768);
    const { container } = renderApp('/');

    const nav = container.querySelector('nav[aria-label="Главная навигация"]') as HTMLElement;
    expect(nav).not.toBeNull();

    // Компактный режим: полная ширина, вторая строка, рамка-разделитель
    expect(nav.className).toContain('order-3');
    expect(nav.className).toContain('w-full');
    expect(nav.className).toContain('border-t');
    // Расширенный режим (от 1280px) возвращает навигацию в первую строку
    expect(nav.className).toContain('xl:order-2');
    expect(nav.className).toContain('xl:w-auto');
    expect(nav.className).toContain('xl:flex-1');
    expect(nav.className).toContain('xl:border-t-0');
  });

  test('Header service controls: вторичный поиск сворачивается до иконки, когда места мало', async () => {
    setWindowDimensions(1024, 768);
    renderApp('/');

    // Inline-поле поиска существует в DOM, но раскрывается только от 1440px
    const inlineInput = screen.getByLabelText('Поиск монеты', { selector: 'input' });
    expect(inlineInput).toBeInTheDocument();
    expect(inlineInput.parentElement?.parentElement?.className).toContain('navxl:block');

    // Компактная кнопка поиска видна до 1440px и раскрывает панель поиска
    const searchButton = screen.getAllByLabelText('Поиск монеты').find((el) => el.tagName === 'BUTTON');
    expect(searchButton).toBeTruthy();
    expect(searchButton!.parentElement?.className).toContain('navxl:hidden');

    fireEvent.click(searchButton!);
    const inputs = screen.getAllByLabelText('Поиск монеты', { selector: 'input' });
    expect(inputs.length).toBeGreaterThan(1);
    fireEvent.change(inputs[1], { target: { value: 'sol' } });
    expect(screen.getAllByText('Solana').length).toBeGreaterThan(0);

    // Повторный клик закрывает панель
    fireEvent.click(searchButton!);
    expect(screen.getAllByLabelText('Поиск монеты', { selector: 'input' }).length).toBe(1);
  });

  test('Dropdown Navigation: opens on click, renders items, and closes on Escape', async () => {
    setWindowDimensions(1440, 900);
    renderApp('/');

    const analyticsBtn = screen.getByRole('button', { name: /Аналитика/i });
    fireEvent.click(analyticsBtn);

    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByText('Карта рынка')).toBeInTheDocument();
    expect(screen.getByText('Корреляции')).toBeInTheDocument();
    expect(screen.getByText('Он-чейн')).toBeInTheDocument();
    expect(screen.getByText('Экосистемы')).toBeInTheDocument();
    expect(screen.getByText('Календарь')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();

    const toolsBtn = screen.getByRole('button', { name: /Инструменты/i });
    fireEvent.click(toolsBtn);

    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByText('Портфель')).toBeInTheDocument();
    expect(screen.getByText('Журнал')).toBeInTheDocument();
    expect(screen.getByText('Стратегии')).toBeInTheDocument();
    expect(screen.getByText('Сигналы')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  test('Mobile navigation (< 1024px): toggle button displays menu with categorized sections', async () => {
    setWindowDimensions(390, 844);
    renderApp('/');

    const menuBtn = screen.getByLabelText(/Меню/i);
    expect(menuBtn).toBeInTheDocument();

    fireEvent.click(menuBtn);

    expect(screen.getByText('Основные разделы')).toBeInTheDocument();
    expect(screen.getAllByText('Аналитика').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Инструменты').length).toBeGreaterThan(0);

    // Статусные метки drawer: режим данных, WebSocket, тариф
    expect(screen.getAllByText(/QA-ДАТАСЕТ/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/WS (ОНЛАЙН|ОЖИДАНИЕ)/i)).toBeInTheDocument();
    expect(screen.getByTitle(/Тарифный план/i)).toBeInTheDocument();

    fireEvent.click(menuBtn);
  });

  test('Header инвариант: бейдж версии обновлён до v0.8.39', async () => {
    setWindowDimensions(1920, 1080);
    const { container } = renderApp('/');
    const header = container.querySelector('header') as HTMLElement;
    expect(header.textContent).toContain('v0.8.39');
  });

  test('Viewports layout smoke check: 390, 768, 1024, 1280, 1366, 1440, 1920', async () => {
    const viewports = [390, 768, 1024, 1280, 1366, 1440, 1920];

    for (const w of viewports) {
      setWindowDimensions(w, 800);
      const { container } = render(
        <MemoryRouter initialEntries={['/']}>
          <MarketDataProviderComponent>
            <App />
          </MarketDataProviderComponent>
        </MemoryRouter>
      );

      expect(container.querySelector('header')).not.toBeNull();
      expect(container.querySelector('main')).not.toBeNull();
      expect(container.querySelector('footer')).not.toBeNull();
      cleanup();
    }
  });
});

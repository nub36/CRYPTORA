import { test, expect, type Locator, type Page } from '@playwright/test';

/**
 * PIXEL-ГЕОМЕТРИЯ страницы контракта после UI-cleanup PR #37.
 *
 * Юнит-контракты (tests/unit/chartToolbarGap.test.tsx,
 * tests/unit/instrumentMetricsGrid.test.tsx) фиксируют DOM/классы; этот спек
 * проверяет ФАКТИЧЕСКУЮ геометрию в браузере на ширинах из задачи §8:
 *
 *   1440 / 1280 — desktop: toolbar без «дыры» между «Индикаторами» и «•••»,
 *                 три карточки метрик в одну строку, «Корреляция с BTC» на
 *                 всю ширину второй строки, «Книга заявок и аномалии»
 *                 начинается сразу после метрик, нет horizontal overflow;
 *   1024       — tablet: 2 колонки с полным заполнением 2×2;
 *   430/390/360 — mobile: одна колонка, toolbar в одну строку.
 *
 * Прогон использует детерминированный QA-датасет (`cryptora_qa_fixture=1`),
 * реальные биржевые вызовы не выполняются. Спек требует Chromium
 * (`npx playwright test e2e/futuresLayout.spec.ts`); в песочнице без
 * egress к cdn.playwright.dev его запустить нельзя — см. STATUS.md.
 */

const VIEWPORTS_DESKTOP = [1440, 1280] as const;
const VIEWPORTS_MOBILE = [430, 390, 360] as const;

async function openContract(page: Page, width: number, height = 900) {
  await page.setViewportSize({ width, height });
  await page.goto('/futures/SOL');
  await expect(page.getByTestId('chart-terminal-toolbar')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('futures-market-statistics')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('futures-btc-correlation')).toBeVisible({ timeout: 20_000 });
}

async function box(locator: Locator) {
  const bounding = await locator.boundingBox();
  expect(bounding, `no bounding box for ${locator}`).not.toBeNull();
  return bounding!;
}

async function expectNoHorizontalOverflow(page: Page, width: number) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(1);
}

test.describe('Futures contract layout — toolbar, metrics grid, depth section', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('cryptora_qa_fixture', '1');
    });
  });

  for (const width of VIEWPORTS_DESKTOP) {
    test(`desktop ${width}px: four toolbar controls adjacent on the left`, async ({ page }) => {
      await openContract(page, width);

      const toolbar = page.getByTestId('chart-terminal-toolbar');
      const indicators = page.getByTestId('chart-indicators-trigger');
      const more = page.getByTestId('chart-more-trigger');
      const timeframe = page.getByTestId('chart-timeframe-trigger');

      const toolbarBox = await box(toolbar);
      const indicatorsBox = await box(indicators);
      const moreBox = await box(more);
      const timeframeBox = await box(timeframe);

      // «•••» стоит сразу за «Индикаторами»: тот же gap (~6px), не прижат к краю.
      const gap = moreBox.x - (indicatorsBox.x + indicatorsBox.width);
      expect(gap, `gap between «Индикаторы» and «•••» at ${width}px`).toBeGreaterThan(0);
      expect(gap, `gap between «Индикаторы» and «•••» at ${width}px`).toBeLessThan(24);

      // Все контролы — в одном ряду у левого края терминала.
      const leftOffset = timeframeBox.x - toolbarBox.x;
      expect(leftOffset).toBeLessThan(20);
      for (const control of [indicatorsBox, moreBox]) {
        expect(Math.abs(control.y - timeframeBox.y)).toBeLessThan(2);
      }
      // Правый край «•••» не достаёт до правого края toolbar — «дыры» больше нет.
      const trailing = toolbarBox.x + toolbarBox.width - (moreBox.x + moreBox.width);
      expect(trailing, `trailing empty space in toolbar at ${width}px`).toBeGreaterThan(100);

      await expectNoHorizontalOverflow(page, width);
      await page.screenshot({ path: `e2e/screenshots/futures-sol-${width}-toolbar.png` });
    });

    test(`desktop ${width}px: correlation spans the metrics row, no empty cells`, async ({ page }) => {
      await openContract(page, width);

      const grid = page.getByTestId('instrument-metrics-grid');
      const gridBox = await box(grid);
      const stats = await box(page.getByTestId('futures-market-statistics'));
      const derivatives = await box(page.getByTestId('futures-derivatives'));
      const indicators = await box(page.getByTestId('futures-indicators'));
      const correlation = await box(page.getByTestId('futures-btc-correlation'));

      // Три карточки — одна строка (одинаковый top).
      expect(Math.abs(stats.y - derivatives.y)).toBeLessThan(2);
      expect(Math.abs(stats.y - indicators.y)).toBeLessThan(2);

      // «Корреляция» — на всю ширину сетки, ВТОРОЙ строкой под тройкой.
      expect(Math.abs(correlation.x - gridBox.x)).toBeLessThan(4);
      expect(Math.abs(correlation.width - gridBox.width)).toBeLessThan(8);
      expect(correlation.y).toBeGreaterThan(indicators.y + indicators.height - 2);

      await expectNoHorizontalOverflow(page, width);
    });

    test(`desktop ${width}px: DEPTH & RADAR starts right after the metrics`, async ({ page }) => {
      await openContract(page, width);

      const gridBox = await box(page.getByTestId('instrument-metrics-grid'));
      const orderBook = await box(page.getByTestId('futures-order-book'));
      const depthGap = orderBook.y - (gridBox.y + gridBox.height);
      // Заголовок секции + штатные отступы ≤ ~140px; «200–400px пустоты» больше нет.
      expect(depthGap, `gap between metrics and DEPTH & RADAR at ${width}px`).toBeGreaterThan(0);
      expect(depthGap, `gap between metrics and DEPTH & RADAR at ${width}px`).toBeLessThan(140);

      // Orderbook ~1/3, Radar ~2/3 ширины.
      const radar = await box(page.getByTestId('futures-radar').or(page.getByTestId('futures-radar-hidden')));
      expect(orderBook.width).toBeLessThan(radar.width);
      expect(radar.width / orderBook.width).toBeGreaterThan(1.4);
    });
  }

  test('1024px (lg boundary): three cards in a row + correlation spanning the full second row', async ({ page }) => {
    await openContract(page, 1024, 768);

    const grid = page.getByTestId('instrument-metrics-grid');
    const gridBox = await box(grid);
    const stats = await box(page.getByTestId('futures-market-statistics'));
    const derivatives = await box(page.getByTestId('futures-derivatives'));
    const indicators = await box(page.getByTestId('futures-indicators'));
    const correlation = await box(page.getByTestId('futures-btc-correlation'));

    // lg начинается ровно на 1024px: сетка уже 3-колоночная, и заполнение
    // полное — тройка в первой строке, «Корреляция» на всю вторую строку.
    expect(Math.abs(stats.y - derivatives.y)).toBeLessThan(2);
    expect(Math.abs(stats.y - indicators.y)).toBeLessThan(2);
    expect(Math.abs(correlation.x - gridBox.x)).toBeLessThan(4);
    expect(Math.abs(correlation.width - gridBox.width)).toBeLessThan(8);
    expect(correlation.y).toBeGreaterThan(indicators.y + indicators.height - 2);

    await expectNoHorizontalOverflow(page, 1024);
    await page.screenshot({ path: 'e2e/screenshots/futures-sol-1024-metrics.png' });
  });

  test('tablet 900px (md range): two filled columns (2×2), no empty cells', async ({ page }) => {
    await openContract(page, 900, 900);

    const grid = page.getByTestId('instrument-metrics-grid');
    const gridBox = await box(grid);
    const stats = await box(page.getByTestId('futures-market-statistics'));
    const derivatives = await box(page.getByTestId('futures-derivatives'));
    const indicators = await box(page.getByTestId('futures-indicators'));
    const correlation = await box(page.getByTestId('futures-btc-correlation'));

    // Ряд 1: статистика слева, деривативы справа — обе колонки заняты.
    expect(Math.abs(stats.y - derivatives.y)).toBeLessThan(2);
    expect(Math.abs(stats.x - gridBox.x)).toBeLessThan(4);
    expect(Math.abs(derivatives.x + derivatives.width - (gridBox.x + gridBox.width))).toBeLessThan(4);

    // Ряд 2: индикаторы + корреляция — тоже обе колонки заняты, «дырок» нет.
    expect(Math.abs(indicators.y - correlation.y)).toBeLessThan(2);
    expect(Math.abs(indicators.x - gridBox.x)).toBeLessThan(4);
    expect(Math.abs(correlation.x + correlation.width - (gridBox.x + gridBox.width))).toBeLessThan(4);

    await expectNoHorizontalOverflow(page, 900);
    await page.screenshot({ path: 'e2e/screenshots/futures-sol-900-metrics.png' });
  });

  for (const width of VIEWPORTS_MOBILE) {
    test(`mobile ${width}px: single column, toolbar in one row, no overflow`, async ({ page }) => {
      await openContract(page, width, 844);

      const grid = page.getByTestId('instrument-metrics-grid');
      const gridBox = await box(grid);
      const cards = [
        page.getByTestId('futures-market-statistics'),
        page.getByTestId('futures-derivatives'),
        page.getByTestId('futures-indicators'),
        page.getByTestId('futures-btc-correlation'),
      ];
      let previousBottom = -1;
      for (const card of cards) {
        const cardBox = await box(card);
        // Одна колонка: карточка на всю ширину сетки и ниже предыдущей.
        expect(Math.abs(cardBox.width - gridBox.width)).toBeLessThan(8);
        expect(cardBox.y).toBeGreaterThan(previousBottom);
        previousBottom = cardBox.y + cardBox.height;
      }

      // Toolbar — одна компактная строка.
      const toolbarBox = await box(page.getByTestId('chart-terminal-toolbar'));
      expect(toolbarBox.height, `toolbar height at ${width}px`).toBeLessThan(60);

      await expectNoHorizontalOverflow(page, width);
      await page.screenshot({ path: `e2e/screenshots/futures-sol-${width}-mobile.png` });
    });
  }
});

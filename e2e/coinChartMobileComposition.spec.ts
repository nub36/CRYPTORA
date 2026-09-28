import { test, expect, type Page } from '@playwright/test';

/**
 * PRODUCTION FOLLOW-UP AFTER PR #32 — mobile ChartTerminal composition.
 *
 * Owner report (real phone, production `/coin/DOGE`): below the `lg` breakpoint
 * the PR #32 desktop toolbar wrapped onto THREE rows (measured 117 px tall), the
 * PR #32 fullscreen side rail ate a whole 32 px column next to an already narrow
 * canvas, and the right price scale took 108 px of a 274 px chart, so the candle
 * plot was only 166 px wide at 360 px.
 *
 * This suite is the browser regression for the new mobile composition and — in
 * the same run — for the untouched desktop UX of PR #32.
 *
 * The QA fixture keeps candles deterministic; it is never presented as LIVE.
 */

const MOBILE_VIEWPORTS = [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
] as const;

interface ChartProbe {
  bars: number;
  volumeBars: number;
  range: { from: number; to: number } | null;
  rangeSpan: number | null;
  width: number;
  height: number;
}

async function readProbe(page: Page): Promise<ChartProbe> {
  return page.evaluate(() => {
    const probe = (window as unknown as { __cryptoraChartProbe?: () => ChartProbe }).__cryptoraChartProbe;
    if (!probe) throw new Error('chart probe not available');
    return probe();
  });
}

async function documentOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

async function isFullscreen(page: Page): Promise<boolean> {
  return page.evaluate(() => Boolean(document.fullscreenElement));
}

/** Geometry of the price pane and the right price scale, read from the real canvases. */
async function chartGeometry(page: Page) {
  return page.evaluate(() => {
    const boxes = Array.from(document.querySelectorAll('[data-qa="chart-terminal"] canvas'))
      .map((c) => c.getBoundingClientRect())
      .filter((r) => r.width > 0 && r.height > 40);
    const unique: Array<{ x: number; width: number; height: number }> = [];
    for (const r of boxes) {
      if (!unique.some((u) => Math.abs(u.x - r.x) < 1 && Math.abs(u.width - r.width) < 1)) {
        unique.push({ x: r.x, width: r.width, height: r.height });
      }
    }
    unique.sort((a, b) => a.x - b.x);
    const terminal = document.querySelector('[data-qa="chart-terminal"]')!.getBoundingClientRect();
    return {
      plot: unique[0] ?? null,
      priceScale: unique[1] ?? null,
      terminalWidth: terminal.width,
      terminalX: terminal.x,
    };
  });
}

/**
 * Dense genuine interaction history before requesting fullscreen: headless
 * Chromium grants the Fullscreen API only after real user gestures (same
 * technique as e2e/coinChartResize.spec.ts).
 */
async function warmUpMobileTerminal(page: Page): Promise<void> {
  const more = page.getByTestId('chart-more-trigger');
  await more.click({ timeout: 10_000 });
  const volume = page.getByRole('menuitemcheckbox', { name: /^Объём/ });
  await volume.click();
  await volume.click();
  await page.keyboard.press('Escape');

  const timeframe = page.getByTestId('chart-timeframe-trigger');
  await timeframe.click();
  await page.getByTestId('chart-timeframe-1h').click();

  const chartType = page.getByTestId('chart-type-trigger');
  await chartType.click();
  await page.getByRole('menuitem', { name: /Линия/ }).click();
  await chartType.click();
  await page.getByRole('menuitem', { name: /Свечи/ }).click();

  const indicators = page.getByTestId('chart-indicators-trigger');
  await indicators.click();
  const rsi = page.getByRole('menuitemcheckbox', { name: /RSI/ });
  await rsi.click();
  await rsi.click();
  await page.keyboard.press('Escape');
}

test.describe('Mobile ChartTerminal composition (post-#32 production defect)', () => {
  test.describe.configure({ timeout: 120_000 });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('cryptora_qa_fixture', '1');
    });
  });

  test.afterEach(async ({ page }) => {
    await page
      .evaluate(() => (document.fullscreenElement ? document.exitFullscreen().catch(() => undefined) : undefined))
      .catch(() => undefined);
  });

  for (const viewport of MOBILE_VIEWPORTS) {
    test(`${viewport.width}px: one compact toolbar row, no side rail, canvas uses the width`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto('/coin/DOGE');

      const terminal = page.getByTestId('chart-terminal');
      await expect(terminal).toBeVisible({ timeout: 20_000 });
      await expect.poll(async () => (await readProbe(page)).bars, { timeout: 15_000 }).toBeGreaterThan(10);

      await expect(terminal).toHaveAttribute('data-composition', 'compact');

      // Bring the terminal into the viewport: the geometry probes below use
      // elementFromPoint, which only answers for on-screen coordinates.
      await page.evaluate(() => document.querySelector('[data-qa="coin-chart-card"]')?.scrollIntoView({ block: 'start' }));
      await page.waitForTimeout(400);

      // ---- 1. Toolbar is ONE row ----
      const toolbar = page.getByTestId('chart-terminal-toolbar');
      await expect(toolbar).toHaveAttribute('data-layout', 'compact');
      const toolbarRows = await page.evaluate(() => {
        const bar = document.querySelector('[data-qa="chart-terminal-toolbar"]')!;
        const tops = Array.from(bar.querySelectorAll('button'))
          .filter((b) => b.getClientRects().length > 0)
          .map((b) => Math.round(b.getBoundingClientRect().top));
        return [...new Set(tops)];
      });
      expect(toolbarRows, `${viewport.width}: every control shares one row`).toHaveLength(1);

      const toolbarBox = (await toolbar.boundingBox())!;
      expect(toolbarBox.height, `${viewport.width}: compact toolbar height`).toBeLessThanOrEqual(56);

      // ---- 2. The four intended controls are visible ----
      await expect(page.getByTestId('chart-timeframe-trigger')).toBeVisible();
      await expect(page.getByTestId('chart-type-trigger')).toBeVisible();
      await expect(page.getByTestId('chart-indicators-trigger')).toBeVisible();
      await expect(page.getByTestId('chart-more-trigger')).toBeVisible();
      // Readable, not microscopic, with a real tap target.
      for (const qa of ['chart-timeframe-trigger', 'chart-type-trigger', 'chart-indicators-trigger', 'chart-more-trigger']) {
        const box = (await page.getByTestId(qa).boundingBox())!;
        expect(box.height, `${qa}: tap height`).toBeGreaterThanOrEqual(32);
        expect(box.width, `${qa}: tap width`).toBeGreaterThanOrEqual(32);
        const fontSize = await page.getByTestId(qa).evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
        expect(fontSize, `${qa}: readable label size`).toBeGreaterThanOrEqual(11);
      }

      // ---- 3. Шаблоны / Настройки / Вписать are NOT permanent controls ----
      await expect(toolbar.locator('[data-qa="chart-templates-trigger"]')).toHaveCount(0);
      await expect(toolbar.locator('[data-qa="chart-settings-trigger"]')).toHaveCount(0);
      await expect(toolbar.locator('[data-qa="chart-reset-view"]')).toHaveCount(0);

      // ---- 4. Mobile fullscreen creates NO side rail column ----
      await expect(page.locator('[data-qa="chart-side-rail"]')).toHaveCount(0);
      const fullscreen = page.locator('[data-qa="chart-fullscreen"]');
      await expect(fullscreen, 'exactly one fullscreen control exists').toHaveCount(1);
      await expect(fullscreen).toHaveAttribute('data-variant', 'overlay');
      await expect(fullscreen).toBeVisible();

      // ---- 5. Canvas geometry: plot gets the width, price scale stays visible ----
      const geometry = await chartGeometry(page);
      expect(geometry.plot, 'price plot canvas exists').not.toBeNull();
      expect(geometry.priceScale, 'right price scale is NOT hidden').not.toBeNull();
      expect(geometry.priceScale!.width, 'price scale has a real width').toBeGreaterThan(20);

      const chartWidth = geometry.plot!.width + geometry.priceScale!.width;
      // Practically the whole terminal width is handed to the chart (only the
      // 1px terminal borders are not).
      expect(chartWidth, `${viewport.width}: chart uses the terminal width`)
        .toBeGreaterThanOrEqual(geometry.terminalWidth - 6);
      // The defect was 166/274 = 61%. The plot must now clearly dominate.
      expect(geometry.plot!.width / chartWidth, `${viewport.width}: plot share of the chart`).toBeGreaterThan(0.7);
      expect(geometry.priceScale!.width / chartWidth, `${viewport.width}: price scale share`).toBeLessThan(0.3);
      // Absolute guard against the reported defect (166 px at 360 px).
      expect(geometry.plot!.width, `${viewport.width}: plot width`).toBeGreaterThan(viewport.width * 0.6);

      // ---- 6. The overlay control covers neither the price scale nor the badges ----
      const overlapping = await page.evaluate(() => {
        const control = document.querySelector('[data-qa="chart-fullscreen"]')!.getBoundingClientRect();
        const slot = document.querySelector('[data-qa="chart-top-right-slot"]')!;
        const badges = slot.parentElement!.firstElementChild!.getBoundingClientRect();
        const canvases = Array.from(document.querySelectorAll('[data-qa="chart-terminal"] canvas'))
          .map((c) => c.getBoundingClientRect())
          .filter((r) => r.width > 0 && r.height > 40)
          .sort((a, b) => a.x - b.x);
        const priceScale = canvases[canvases.length - 1];
        const hit = document.elementFromPoint(control.x + control.width / 2, control.y + control.height / 2);
        const el = document.querySelector('[data-qa="chart-fullscreen"]')!;
        const frame = document.querySelector('[data-qa="chart-terminal"]')!.getBoundingClientRect();
        return {
          overlapsPriceScale: control.right > priceScale.x + 1,
          overlapsBadges: control.x < badges.right - 1 && control.right > badges.x + 1
            && control.y < badges.bottom - 1 && control.bottom > badges.y + 1,
          insideTerminal: control.x >= frame.x - 1 && control.right <= frame.right + 1
            && control.y >= frame.y - 1 && control.bottom <= frame.bottom + 1,
          topmost: Boolean(hit && (hit === el || el.contains(hit))),
        };
      });
      expect(overlapping.overlapsPriceScale, 'control stays left of the right price scale').toBe(false);
      expect(overlapping.overlapsBadges, 'control does not cover the symbol/status badges').toBe(false);
      expect(overlapping.insideTerminal, 'control stays inside the terminal boundary').toBe(true);
      expect(overlapping.topmost, 'control is tappable (topmost at its own centre)').toBe(true);

      // ---- 7. No horizontal page overflow and no overflow masking ----
      expect(await documentOverflow(page), `${viewport.width}: no horizontal page overflow`).toBeLessThanOrEqual(1);
      const bodyOverflowX = await page.evaluate(() => getComputedStyle(document.body).overflowX);
      expect(bodyOverflowX, 'body overflow-x must not be hidden').not.toBe('hidden');
      const terminalOverflow = await page.evaluate(() => {
        const el = document.querySelector('[data-qa="chart-terminal"]') as HTMLElement;
        return { scroll: el.scrollWidth, client: el.clientWidth, overflowX: getComputedStyle(el).overflowX };
      });
      expect(terminalOverflow.scroll, 'terminal is not wider than itself').toBeLessThanOrEqual(terminalOverflow.client + 1);

      if (viewport.width === 360) {
        await page.screenshot({ path: 'e2e/screenshots/mobile-doge-360-after.png', fullPage: false });
      }
    });
  }

  test('«Ещё» holds Шаблоны, Настройки and «Вписать» and drives the same chart state', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto('/coin/DOGE');
    await expect(page.getByTestId('chart-terminal')).toBeVisible({ timeout: 20_000 });
    await expect.poll(async () => (await readProbe(page)).bars, { timeout: 15_000 }).toBeGreaterThan(10);

    const more = page.getByTestId('chart-more-trigger');
    await more.click();
    const menu = page.getByTestId('chart-more-trigger-menu');
    await expect(menu).toBeVisible();
    await page.screenshot({ path: 'e2e/screenshots/mobile-more-menu-360.png', fullPage: false });

    // Everything that left the toolbar is reachable here.
    await expect(menu.getByText('Шаблоны')).toBeVisible();
    await expect(menu.getByText('Настройки')).toBeVisible();
    await expect(menu.locator('[data-qa="chart-template-default"]')).toBeVisible();
    await expect(menu.locator('[data-qa="chart-template-clean"]')).toBeVisible();
    await expect(menu.locator('[data-qa="chart-template-momentum"]')).toBeVisible();
    await expect(menu.locator('[data-qa="chart-setting-volume"]')).toBeVisible();
    await expect(menu.locator('[data-qa="chart-setting-timezone"]')).toBeVisible();
    await expect(menu.locator('[data-qa="chart-reset-view"]')).toBeVisible();

    // Inside the viewport, not clipped away.
    const menuBox = (await menu.boundingBox())!;
    expect(menuBox.x).toBeGreaterThanOrEqual(0);
    expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(360 + 1);
    expect(menuBox.y).toBeGreaterThanOrEqual(-1);
    expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(800 + 1);

    // The template really drives the chart panes (same handlers as desktop).
    await menu.locator('[data-qa="chart-template-momentum"]').click();
    await expect(page.locator('[aria-label="RSI indicator pane"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[aria-label="MACD indicator pane"]')).toBeVisible({ timeout: 10_000 });

    // «Вписать» from «Ещё» restores a healthy visible range without killing history.
    const barsBefore = (await readProbe(page)).bars;
    await more.click();
    await menu.locator('[data-qa="chart-reset-view"]').click();
    await expect(menu).toBeHidden();
    const afterFit = await readProbe(page);
    expect(afterFit.bars).toBe(barsBefore);
    expect(afterFit.rangeSpan ?? 0).toBeGreaterThan(8);

    // Back to default template so the rest of the suite is not affected.
    await more.click();
    await menu.locator('[data-qa="chart-template-default"]').click();
  });

  test('every mobile popover closes on Escape and on an outside tap, and none overlap', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto('/coin/DOGE');
    await expect(page.getByTestId('chart-terminal')).toBeVisible({ timeout: 20_000 });

    const triggers = [
      'chart-timeframe-trigger',
      'chart-type-trigger',
      'chart-indicators-trigger',
      'chart-more-trigger',
    ] as const;

    for (const qa of triggers) {
      const trigger = page.getByTestId(qa);
      const menu = page.getByTestId(`${qa}-menu`);

      // open -> Escape
      await trigger.click();
      await expect(menu).toBeVisible();
      const box = (await menu.boundingBox())!;
      expect(box.x, `${qa}: menu inside viewport (left)`).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, `${qa}: menu inside viewport (right)`).toBeLessThanOrEqual(361);
      expect(box.y, `${qa}: menu inside viewport (top)`).toBeGreaterThanOrEqual(-1);
      expect(box.y + box.height, `${qa}: menu inside viewport (bottom)`).toBeLessThanOrEqual(801);
      // The popover paints above the chart canvas.
      const topmost = await page.evaluate((menuQa) => {
        const el = document.querySelector(`[data-qa="${menuQa}"]`)! as HTMLElement;
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.x + r.width / 2, r.y + Math.min(20, r.height / 2));
        return Boolean(hit && (hit === el || el.contains(hit)));
      }, `${qa}-menu`);
      expect(topmost, `${qa}: menu is above the chart`).toBe(true);

      await page.keyboard.press('Escape');
      await expect(menu).toBeHidden();

      // open -> outside tap (touch-style tap, not only mouse)
      await trigger.click();
      await expect(menu).toBeVisible();
      await page.mouse.click(6, 6);
      await expect(menu).toBeHidden();

      // Only one popover can be open at a time -> they cannot overlap.
      await trigger.click();
      await expect(page.locator('[role="menu"]')).toHaveCount(1);
      await page.keyboard.press('Escape');
    }

    expect(await documentOverflow(page)).toBeLessThanOrEqual(1);
  });

  test('«Индикаторы» stays aligned and fully inside a 360px viewport', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto('/coin/DOGE');
    await expect(page.getByTestId('chart-terminal')).toBeVisible({ timeout: 20_000 });

    await page.getByTestId('chart-indicators-trigger').click();
    const menu = page.getByTestId('chart-indicators-trigger-menu');
    await expect(menu).toBeVisible();
    await page.screenshot({ path: 'e2e/screenshots/mobile-indicators-menu-360.png', fullPage: false });

    const rows = await page.evaluate(() =>
      ['ma', 'rsi', 'macd'].map((key) => {
        const row = document.querySelector(`[data-qa="chart-indicator-row-${key}"]`) as HTMLElement;
        const label = document.querySelector(`[data-qa="chart-indicator-label-${key}"]`) as HTMLElement;
        const box = document.querySelector(`[data-qa="chart-indicator-box-${key}"]`) as HTMLElement;
        const r = row.getBoundingClientRect();
        const l = label.getBoundingClientRect();
        const b = box.getBoundingClientRect();
        return {
          key,
          height: r.height,
          left: r.left,
          right: r.right,
          labelLeft: l.left,
          boxRight: b.right,
          gap: b.left - l.right,
          clipped: label.scrollWidth - label.clientWidth,
        };
      }),
    );

    // PR #32 alignment invariant preserved on mobile.
    for (const row of rows) {
      expect(Math.abs(row.height - rows[0].height), `${row.key}: equal row height`).toBeLessThanOrEqual(0.5);
      expect(Math.abs(row.labelLeft - rows[0].labelLeft), `${row.key}: one label axis`).toBeLessThanOrEqual(0.5);
      expect(Math.abs(row.boxRight - rows[0].boxRight), `${row.key}: one control axis`).toBeLessThanOrEqual(0.5);
      expect(row.clipped, `${row.key}: label is not truncated`).toBeLessThanOrEqual(1);
      expect(row.height, `${row.key}: touch target`).toBeGreaterThanOrEqual(32);
      expect(row.left, `${row.key}: inside viewport`).toBeGreaterThanOrEqual(0);
      expect(row.right, `${row.key}: inside viewport`).toBeLessThanOrEqual(361);
    }
    const gaps = rows.map((r) => r.gap);
    expect(Math.max(...gaps) - Math.min(...gaps), 'constant label→checkbox gap').toBeLessThanOrEqual(0.5);

    // Не обрезается: список помещается целиком, без внутреннего скролла.
    const scrollable = await menu.evaluate((el) => el.scrollHeight - el.clientHeight);
    expect(scrollable, 'indicators menu is not clipped on 360px').toBeLessThanOrEqual(1);

    // Индикаторы реально переключают панели (математика не трогалась).
    await page.getByRole('menuitemcheckbox', { name: /RSI/ }).click();
    await expect(page.locator('[aria-label="RSI indicator pane"]')).toBeVisible({ timeout: 10_000 });
    await page.getByRole('menuitemcheckbox', { name: /MACD/ }).click();
    await expect(page.locator('[aria-label="MACD indicator pane"]')).toBeVisible({ timeout: 10_000 });
    expect(await documentOverflow(page)).toBeLessThanOrEqual(1);
  });

  test('mobile overlay fullscreen uses the PR#31 mechanism and keeps candle history', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/coin/ETH');
    await expect(page.getByTestId('chart-terminal')).toBeVisible({ timeout: 20_000 });
    await expect.poll(async () => (await readProbe(page)).bars, { timeout: 15_000 }).toBeGreaterThan(10);

    await warmUpMobileTerminal(page);
    await expect.poll(async () => (await readProbe(page)).bars, { timeout: 15_000 }).toBeGreaterThan(10);

    const initial = await readProbe(page);
    const normalWidth = initial.width;
    expect(initial.bars).toBeGreaterThan(10);

    for (let cycle = 0; cycle < 2; cycle++) {
      const enter = page.getByRole('button', { name: 'Развернуть график' });
      await expect(enter).toBeVisible();
      let engaged = false;
      for (let attempt = 0; attempt < 3 && !engaged; attempt++) {
        await enter.click({ timeout: 10_000 });
        try {
          await expect.poll(() => isFullscreen(page), { timeout: 5_000, intervals: [150, 250, 400, 600] }).toBe(true);
          engaged = true;
        } catch {
          await page.waitForTimeout(300);
        }
      }
      expect(engaged, `cycle ${cycle}: the mobile overlay control really engages the Fullscreen API`).toBe(true);

      // Same single implementation: the terminal element itself goes fullscreen,
      // and there is still exactly one control in the DOM.
      const state = await page.evaluate(() => ({
        isTerminal: document.fullscreenElement === document.querySelector('[data-qa="chart-terminal"]'),
        controls: document.querySelectorAll('[data-qa="chart-fullscreen"]').length,
        rails: document.querySelectorAll('[data-qa="chart-side-rail"]').length,
      }));
      expect(state.isTerminal, 'the chart terminal is the fullscreen element').toBe(true);
      expect(state.controls, 'no second fullscreen implementation').toBe(1);
      expect(state.rails, 'fullscreen does not introduce a mobile side rail').toBe(0);

      await expect.poll(async () => (await readProbe(page)).bars, { timeout: 10_000 }).toBe(initial.bars);
      const inFull = await readProbe(page);
      expect(inFull.bars, `cycle ${cycle}: history preserved in fullscreen`).toBe(initial.bars);
      expect(inFull.rangeSpan ?? 0, `cycle ${cycle}: range not collapsed`).toBeGreaterThan(8);
      if (cycle === 0) await page.screenshot({ path: 'e2e/screenshots/mobile-fullscreen-390.png', fullPage: false });

      const exit = page.getByRole('button', { name: 'Выйти из полноэкранного режима' });
      await expect(exit).toBeVisible();
      await exit.click();
      await expect.poll(() => isFullscreen(page), { timeout: 10_000 }).toBe(false);
      await expect.poll(async () => (await readProbe(page)).width, { timeout: 10_000 })
        .toBeGreaterThan(normalWidth - 40);

      const afterExit = await readProbe(page);
      expect(afterExit.bars, `cycle ${cycle}: history preserved after exit`).toBe(initial.bars);
      expect(afterExit.rangeSpan ?? 0, `cycle ${cycle}: range healthy after exit`).toBeGreaterThan(8);
    }

    await page.screenshot({ path: 'e2e/screenshots/mobile-after-fullscreen-390.png', fullPage: false });
    expect(await documentOverflow(page)).toBeLessThanOrEqual(1);
  });

  test('crossing the composition breakpoint resizes the chart in place (no remount, no data loss)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/coin/BNB');
    await expect(page.getByTestId('chart-terminal')).toBeVisible({ timeout: 20_000 });
    await expect.poll(async () => (await readProbe(page)).bars, { timeout: 15_000 }).toBeGreaterThan(10);

    const baseline = await readProbe(page);

    for (const width of [360, 1280, 390, 1920, 430, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(400);
      const probe = await readProbe(page);
      expect(probe.bars, `${width}: candle history survives the composition switch`).toBe(baseline.bars);
      expect(probe.rangeSpan ?? 0, `${width}: visible range not collapsed`).toBeGreaterThan(8);
      expect(await documentOverflow(page), `${width}: no horizontal page overflow`).toBeLessThanOrEqual(1);

      const expectCompact = width < 1024;
      await expect(page.getByTestId('chart-terminal'))
        .toHaveAttribute('data-composition', expectCompact ? 'compact' : 'desktop');
      await expect(page.locator('[data-qa="chart-side-rail"]')).toHaveCount(expectCompact ? 0 : 1);
      await expect(page.locator('[data-qa="chart-fullscreen"]')).toHaveCount(1);
    }
  });
});

test.describe('Desktop ChartTerminal UX of PR #32 is untouched', () => {
  test.describe.configure({ timeout: 90_000 });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('cryptora_qa_fixture', '1');
    });
  });

  for (const width of [1280, 1920]) {
    test(`${width}px keeps the single-row toolbar, «Вписать» and the fullscreen side rail`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto('/coin/ETH');

      const terminal = page.getByTestId('chart-terminal');
      await expect(terminal).toBeVisible({ timeout: 20_000 });
      await expect(terminal).toHaveAttribute('data-composition', 'desktop');

      const toolbar = page.getByTestId('chart-terminal-toolbar');
      await expect(toolbar).toHaveAttribute('data-layout', 'desktop');

      // The full PR #32 control set, all on ONE row, никакого мобильного «⋯».
      await expect(toolbar.locator('[data-qa="chart-more-trigger"]')).toHaveCount(0);
      const controls = [
        'chart-timeframe-trigger',
        'chart-type-trigger',
        'chart-indicators-trigger',
        'chart-templates-trigger',
        'chart-settings-trigger',
        'chart-reset-view',
      ];
      const tops: number[] = [];
      for (const qa of controls) {
        const locator = toolbar.locator(`[data-qa="${qa}"]`);
        await expect(locator, `${width}: ${qa} present in the desktop toolbar`).toHaveCount(1);
        tops.push((await locator.boundingBox())!.y);
      }
      expect(Math.max(...tops) - Math.min(...tops), `${width}: one toolbar row`).toBeLessThan(6);
      expect((await toolbar.boundingBox())!.height, `${width}: single compact row`).toBeLessThan(60);

      // «Вписать» is the right-most toolbar control (no leftover spacer).
      const toolbarBox = (await toolbar.boundingBox())!;
      const reset = (await toolbar.locator('[data-qa="chart-reset-view"]').boundingBox())!;
      expect(toolbarBox.x + toolbarBox.width - (reset.x + reset.width)).toBeLessThan(20);

      // Fullscreen still lives on the side rail, outside the toolbar.
      const rail = page.locator('[data-qa="chart-side-rail"]');
      await expect(rail).toHaveCount(1);
      await expect(rail.locator('[data-qa="chart-fullscreen"]')).toHaveCount(1);
      await expect(toolbar.locator('[data-qa="chart-fullscreen"]')).toHaveCount(0);
      await expect(page.locator('[data-qa="chart-fullscreen"]')).toHaveAttribute('data-variant', 'rail');
      // No in-frame overlay slot on desktop.
      await expect(page.locator('[data-qa="chart-top-right-slot"]')).toHaveCount(0);

      // Desktop price labels keep the full PR#32 format (no compact units).
      const geometry = await chartGeometry(page);
      expect(geometry.priceScale!.width, `${width}: desktop price scale unchanged`).toBeGreaterThan(80);

      expect(await documentOverflow(page), `${width}: no horizontal overflow`).toBeLessThanOrEqual(1);

      if (width === 1280) {
        await page.screenshot({ path: 'e2e/screenshots/desktop-1280-no-regression.png', fullPage: false });
      }
    });
  }
});

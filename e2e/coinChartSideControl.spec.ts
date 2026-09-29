import { test, expect, type Page } from '@playwright/test';

/**
 * PR#32 — final ChartTerminal UI polish.
 *
 * 1. The expand/fullscreen control was MOVED out of the top toolbar onto the
 *    RIGHT SIDE EDGE of the chart terminal. This suite proves the new placement
 *    is geometrically safe (no price-scale overlap, no overlap with the right
 *    info cards, no horizontal overflow, still clickable) and that the single
 *    fullscreen implementation from PR#31 still works — including candle history
 *    survival across normal -> fullscreen -> normal cycles.
 * 2. The «Индикаторы» dropdown rows must be aligned on a real grid: identical
 *    row height, identical paddings, one label axis, one control axis.
 *
 * Fixture mode keeps the run deterministic without presenting fixtures as LIVE.
 */

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

async function isFullscreen(page: Page): Promise<boolean> {
  return page.evaluate(() => Boolean(document.fullscreenElement));
}

/**
 * Dense genuine interaction history before requesting fullscreen — headless
 * Chromium grants the Fullscreen API only after real user gestures (documented
 * in coinChartResize.spec.ts).
 */
async function warmUpTerminal(page: Page): Promise<void> {
  // Настройки графика живут в общем «•••» единого тулбара.
  const settings = page.getByTestId('chart-more-trigger');
  await settings.click({ timeout: 10_000 });
  const volume = page.getByRole('menuitemcheckbox', { name: /^Объём/ });
  await volume.click();
  await volume.click();
  await page.mouse.click(8, 8);

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
  await page.mouse.click(8, 8);
}

/** Enter fullscreen through the NEW side control; hard-fails if it does not engage. */
async function enterFullscreenViaSideControl(page: Page): Promise<void> {
  const button = page.getByRole('button', { name: 'Развернуть график' });
  await expect(button).toBeVisible();
  let engaged = false;
  for (let attempt = 0; attempt < 3 && !engaged; attempt++) {
    await button.click({ timeout: 10_000 });
    try {
      await expect.poll(() => isFullscreen(page), { timeout: 5_000, intervals: [150, 250, 400, 600] }).toBe(true);
      engaged = true;
    } catch {
      await page.waitForTimeout(300);
    }
  }
  expect(engaged, 'the NEW side control must really engage the Fullscreen API').toBe(true);
  const terminalIsFullscreen = await page.evaluate(() => {
    const el = document.fullscreenElement;
    const term = document.querySelector('[data-qa="chart-terminal"]');
    return Boolean(el && term && (el === term || el.contains(term)));
  });
  expect(terminalIsFullscreen, 'the chart terminal is the fullscreen element').toBe(true);
}

async function documentOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

test.describe('ChartTerminal side expand control', () => {
  test.describe.configure({ timeout: 90_000 });

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

  test('desktop: control sits on the right edge of the terminal, clear of price scale and right cards', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('/coin/ETH');
    const terminal = page.getByTestId('chart-terminal');
    await expect(terminal).toBeVisible({ timeout: 20_000 });
    await expect.poll(async () => (await readProbe(page)).bars, { timeout: 15_000 }).toBeGreaterThan(10);

    const control = page.locator('[data-qa="chart-fullscreen"]');
    const rail = page.locator('[data-qa="chart-side-rail"]');
    const toolbar = page.getByTestId('chart-terminal-toolbar');

    // Moved, not duplicated.
    await expect(control).toHaveCount(1);
    await expect(toolbar.locator('[data-qa="chart-fullscreen"]')).toHaveCount(0);
    await expect(rail.locator('[data-qa="chart-fullscreen"]')).toHaveCount(1);
    await expect(control).toBeVisible();
    await expect(control).toHaveAttribute('title', 'Развернуть график');

    const terminalBox = (await terminal.boundingBox())!;
    const controlBox = (await control.boundingBox())!;
    const canvasBox = (await terminal.locator('canvas').first().boundingBox())!;

    // On the RIGHT edge of the terminal, with a small safe inset (no negative offsets).
    const rightGap = terminalBox.x + terminalBox.width - (controlBox.x + controlBox.width);
    expect(rightGap, 'control hugs the terminal right edge').toBeLessThan(12);
    expect(rightGap, 'control stays inside the terminal box').toBeGreaterThanOrEqual(0);
    expect(controlBox.x, 'control is in the right half of the terminal')
      .toBeGreaterThan(terminalBox.x + terminalBox.width * 0.7);

    // Roughly in the upper part of the right edge.
    expect(controlBox.y, 'control is near the top of the chart workspace')
      .toBeLessThan(terminalBox.y + terminalBox.height * 0.35);

    // It does NOT overlay the chart canvas at all (so it cannot cover price
    // labels or candles) — the rail is a layout column beside the canvas.
    expect(controlBox.x, 'control starts to the right of the chart canvas')
      .toBeGreaterThanOrEqual(canvasBox.x + canvasBox.width - 1);

    // It does not collide with the right-hand info cards (separate grid column).
    const workspace = page.locator('[data-qa="coin-workspace"]');
    if ((await workspace.count()) > 0) {
      const chartCard = (await page.locator('[data-qa="coin-chart-card"]').boundingBox())!;
      expect(controlBox.x + controlBox.width, 'control stays inside the chart column')
        .toBeLessThanOrEqual(chartCard.x + chartCard.width + 1);
    }

    // Clickable: nothing is painted on top of the control's own center point.
    const hitsControl = await page.evaluate(() => {
      const el = document.querySelector('[data-qa="chart-fullscreen"]') as HTMLElement | null;
      if (!el) return false;
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return Boolean(hit && (hit === el || el.contains(hit)));
    });
    expect(hitsControl, 'the side control is the topmost element at its own center').toBe(true);

    expect(await documentOverflow(page), 'no horizontal page overflow at 1920').toBeLessThanOrEqual(1);

    await page.screenshot({ path: 'e2e/screenshots/coin-eth-side-fullscreen-desktop.png', fullPage: false });
    await page.screenshot({
      path: 'e2e/screenshots/coin-eth-side-fullscreen-closeup.png',
      clip: {
        x: Math.max(0, terminalBox.x + terminalBox.width - 260),
        y: Math.max(0, terminalBox.y - 10),
        width: 280,
        height: 240,
      },
    });
  });

  test('side control drives the PR#31 fullscreen lifecycle without losing candle history', async ({ page }) => {
    await page.goto('/coin/ETH');
    const terminal = page.getByTestId('chart-terminal');
    await expect(terminal).toBeVisible({ timeout: 20_000 });
    await expect.poll(async () => (await readProbe(page)).bars, { timeout: 15_000 }).toBeGreaterThan(10);

    await warmUpTerminal(page);
    await expect.poll(async () => (await readProbe(page)).bars, { timeout: 15_000 }).toBeGreaterThan(10);

    const initial = await readProbe(page);
    expect(initial.bars).toBeGreaterThan(10);
    const normalWidth = initial.width;

    for (let cycle = 0; cycle < 2; cycle++) {
      await enterFullscreenViaSideControl(page);
      await expect.poll(async () => (await readProbe(page)).bars, { timeout: 10_000 }).toBe(initial.bars);
      const inFull = await readProbe(page);
      expect(inFull.bars, `cycle ${cycle}: history preserved in fullscreen`).toBe(initial.bars);
      expect(inFull.rangeSpan ?? 0, `cycle ${cycle}: range not collapsed`).toBeGreaterThan(8);

      // The control must remain reachable in fullscreen and flip to the exit label.
      const exit = page.getByRole('button', { name: 'Выйти из полноэкранного режима' });
      await expect(exit).toBeVisible();
      if (cycle === 0) {
        await page.screenshot({ path: 'e2e/screenshots/coin-eth-fullscreen-side-control.png', fullPage: false });
      }

      // Exit through the SAME side control (the moved button, both directions).
      await exit.click();
      await expect.poll(() => isFullscreen(page), { timeout: 10_000 }).toBe(false);
      await expect.poll(async () => (await readProbe(page)).width, { timeout: 10_000 })
        .toBeGreaterThan(normalWidth - 40);

      const afterExit = await readProbe(page);
      expect(afterExit.bars, `cycle ${cycle}: history preserved after exit`).toBe(initial.bars);
      expect(afterExit.rangeSpan ?? 0, `cycle ${cycle}: range healthy after exit`).toBeGreaterThan(8);
    }

    await page.screenshot({ path: 'e2e/screenshots/coin-eth-after-fullscreen-side-control.png', fullPage: false });
    expect(await documentOverflow(page)).toBeLessThanOrEqual(1);
  });

  test('responsive: 1280 / 1024 / 360 keep the control inside the viewport with no overflow', async ({ page }) => {
    await page.goto('/coin/ETH');
    await expect(page.getByTestId('chart-terminal')).toBeVisible({ timeout: 20_000 });

    for (const width of [1280, 1024, 360]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(400);

      const control = page.locator('[data-qa="chart-fullscreen"]');
      await expect(control).toBeVisible();
      const box = (await control.boundingBox())!;
      expect(box.x, `${width}: control not off-screen left`).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, `${width}: control inside the viewport`).toBeLessThanOrEqual(width + 1);
      expect(box.width, `${width}: control keeps a tappable size`).toBeGreaterThanOrEqual(24);
      expect(box.height, `${width}: control keeps a tappable size`).toBeGreaterThanOrEqual(24);

      const terminalBox = (await page.getByTestId('chart-terminal').boundingBox())!;
      expect(box.x + box.width, `${width}: control inside the terminal`)
        .toBeLessThanOrEqual(terminalBox.x + terminalBox.width + 1);

      expect(await documentOverflow(page), `${width}: no horizontal page overflow`).toBeLessThanOrEqual(1);

      if (width === 360) {
        await page.screenshot({ path: 'e2e/screenshots/coin-eth-side-control-mobile-360.png', fullPage: false });
      }
    }

    // The mask that would hide a real overflow must NOT be used.
    const bodyOverflowX = await page.evaluate(() => getComputedStyle(document.body).overflowX);
    expect(bodyOverflowX, 'body overflow-x must not be hidden').not.toBe('hidden');
  });
});

test.describe('«Индикаторы» dropdown alignment', () => {
  test.describe.configure({ timeout: 90_000 });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('cryptora_qa_fixture', '1');
    });
  });

  test('rows share one geometry, one label axis and one control axis', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/coin/ETH');
    await expect(page.getByTestId('chart-terminal')).toBeVisible({ timeout: 20_000 });

    const trigger = page.getByTestId('chart-indicators-trigger');
    await trigger.click();
    const menu = page.getByTestId('chart-indicators-trigger-menu');
    await expect(menu).toBeVisible();

    const keys = ['ma', 'rsi', 'macd'] as const;
    const geometry = async () =>
      page.evaluate((rowKeys) =>
        rowKeys.map((key) => {
          const row = document.querySelector(`[data-qa="chart-indicator-row-${key}"]`) as HTMLElement;
          const label = document.querySelector(`[data-qa="chart-indicator-label-${key}"]`) as HTMLElement;
          const box = document.querySelector(`[data-qa="chart-indicator-box-${key}"]`) as HTMLElement;
          const r = row.getBoundingClientRect();
          const l = label.getBoundingClientRect();
          const b = box.getBoundingClientRect();
          return {
            key,
            rowLeft: r.left,
            rowRight: r.right,
            rowWidth: r.width,
            rowHeight: r.height,
            labelLeft: l.left,
            boxRight: b.right,
            boxLeft: b.left,
            boxWidth: b.width,
            boxHeight: b.height,
            gapLabelToBox: b.left - l.right,
            padLeft: l.left - r.left,
            padRight: r.right - b.right,
            labelOverflow: label.scrollWidth - label.clientWidth,
          };
        }), [...keys]);

    const before = await geometry();

    for (const row of before) {
      expect(Math.abs(row.rowHeight - before[0].rowHeight), `${row.key}: equal row height`).toBeLessThanOrEqual(0.5);
      expect(Math.abs(row.rowWidth - before[0].rowWidth), `${row.key}: equal row width`).toBeLessThanOrEqual(0.5);
      expect(Math.abs(row.rowLeft - before[0].rowLeft), `${row.key}: rows share left edge`).toBeLessThanOrEqual(0.5);
      expect(Math.abs(row.labelLeft - before[0].labelLeft), `${row.key}: one label axis`).toBeLessThanOrEqual(0.5);
      expect(Math.abs(row.boxRight - before[0].boxRight), `${row.key}: one control right axis`).toBeLessThanOrEqual(0.5);
      expect(Math.abs(row.boxLeft - before[0].boxLeft), `${row.key}: one control left axis`).toBeLessThanOrEqual(0.5);
      expect(Math.abs(row.boxWidth - before[0].boxWidth), `${row.key}: identical control box`).toBeLessThanOrEqual(0.5);
      expect(Math.abs(row.boxHeight - before[0].boxHeight), `${row.key}: identical control box`).toBeLessThanOrEqual(0.5);
      expect(Math.abs(row.padLeft - before[0].padLeft), `${row.key}: equal left padding`).toBeLessThanOrEqual(0.5);
      expect(Math.abs(row.padRight - before[0].padRight), `${row.key}: equal right padding`).toBeLessThanOrEqual(0.5);
      expect(row.padLeft, `${row.key}: real left padding`).toBeGreaterThan(4);
      expect(row.padRight, `${row.key}: real right padding`).toBeGreaterThan(4);
      // The long «MA и Bollinger Bands» label must not be clipped.
      expect(row.labelOverflow, `${row.key}: label is not truncated`).toBeLessThanOrEqual(1);
    }
    // The label->control distance is constant across rows of very different text length.
    const gaps = before.map((row) => row.gapLabelToBox);
    expect(Math.max(...gaps) - Math.min(...gaps), 'constant text→checkbox distance').toBeLessThanOrEqual(0.5);

    await page.screenshot({ path: 'e2e/screenshots/coin-indicators-dropdown-aligned.png', fullPage: false });
    const menuBox = (await menu.boundingBox())!;
    await page.screenshot({
      path: 'e2e/screenshots/coin-indicators-dropdown-closeup.png',
      clip: { x: menuBox.x - 6, y: menuBox.y - 6, width: menuBox.width + 12, height: menuBox.height + 12 },
    });

    // ---- hover must not change geometry ----
    await page.getByTestId('chart-indicator-row-rsi').hover();
    const hovered = await geometry();
    expect(hovered).toEqual(before);

    // ---- keyboard focus must be visible and must not shift layout ----
    await page.getByTestId('chart-indicator-row-macd').focus();
    const focused = await geometry();
    expect(focused).toEqual(before);
    const focusVisible = await page.evaluate(() => {
      const el = document.querySelector('[data-qa="chart-indicator-row-macd"]') as HTMLElement;
      el.focus();
      const cs = getComputedStyle(el);
      return {
        active: document.activeElement === el,
        ring: cs.boxShadow,
        outline: cs.outlineStyle,
      };
    });
    expect(focusVisible.active, 'row is focusable').toBe(true);
    expect(
      focusVisible.ring !== 'none' || focusVisible.outline !== 'none',
      'keyboard focus is visible',
    ).toBe(true);

    // ---- toggling must not make the row geometry jump ----
    const rsi = page.getByRole('menuitemcheckbox', { name: /RSI/ });
    await rsi.click();
    await expect(rsi).toHaveAttribute('aria-checked', 'true');
    const afterToggle = await geometry();
    for (let i = 0; i < afterToggle.length; i++) {
      expect(Math.abs(afterToggle[i].rowWidth - before[i].rowWidth), 'no width jump on activation').toBeLessThanOrEqual(0.5);
      expect(Math.abs(afterToggle[i].rowHeight - before[i].rowHeight), 'no height jump on activation').toBeLessThanOrEqual(0.5);
      expect(Math.abs(afterToggle[i].boxRight - before[i].boxRight), 'control axis stable on activation').toBeLessThanOrEqual(0.5);
    }
  });

  test('toggles really drive the chart-only panes and state survives reopening', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/coin/ETH');
    await expect(page.getByTestId('chart-terminal')).toBeVisible({ timeout: 20_000 });

    const trigger = page.getByTestId('chart-indicators-trigger');
    const rsiPane = page.locator('[aria-label="RSI indicator pane"]');
    const macdPane = page.locator('[aria-label="MACD indicator pane"]');

    await expect(rsiPane).toHaveCount(0);
    await expect(macdPane).toHaveCount(0);

    await trigger.click();
    await page.getByRole('menuitemcheckbox', { name: /RSI/ }).click();
    await expect(rsiPane).toBeVisible({ timeout: 10_000 });

    await page.getByRole('menuitemcheckbox', { name: /MACD/ }).click();
    await expect(macdPane).toBeVisible({ timeout: 10_000 });

    // MA/Bollinger is an overlay on the price pane: no extra pane, chart stays alive.
    const ma = page.getByRole('menuitemcheckbox', { name: /MA и Bollinger/ });
    await expect(ma).toHaveAttribute('aria-checked', 'true');
    await ma.click();
    await expect(ma).toHaveAttribute('aria-checked', 'false');
    await ma.click();
    await expect(ma).toHaveAttribute('aria-checked', 'true');

    // Close the dropdown with a real outside click.
    await page.mouse.click(8, 8);
    await expect(page.getByTestId('chart-indicators-trigger-menu')).toBeHidden();
    await expect(rsiPane).toBeVisible();
    await expect(macdPane).toBeVisible();

    // Reopening reflects the current semantics (state is preserved).
    await trigger.click();
    await expect(page.getByRole('menuitemcheckbox', { name: /RSI/ })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('menuitemcheckbox', { name: /MACD/ })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('menuitemcheckbox', { name: /MA и Bollinger/ })).toHaveAttribute('aria-checked', 'true');

    // Turning them back off really removes the panes.
    await page.getByRole('menuitemcheckbox', { name: /RSI/ }).click();
    await page.getByRole('menuitemcheckbox', { name: /MACD/ }).click();
    await expect(rsiPane).toHaveCount(0);
    await expect(macdPane).toHaveCount(0);
  });

  test('360px: the indicators menu stays inside the viewport and keeps its alignment', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto('/coin/ETH');
    await expect(page.getByTestId('chart-terminal')).toBeVisible({ timeout: 20_000 });

    await page.getByTestId('chart-indicators-trigger').click();
    const menu = page.getByTestId('chart-indicators-trigger-menu');
    await expect(menu).toBeVisible();
    const box = (await menu.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(360);

    const axes = await page.evaluate(() =>
      ['ma', 'rsi', 'macd'].map((key) => {
        const b = document.querySelector(`[data-qa="chart-indicator-box-${key}"]`)!.getBoundingClientRect();
        const l = document.querySelector(`[data-qa="chart-indicator-label-${key}"]`)!.getBoundingClientRect();
        return { right: b.right, left: l.left };
      }),
    );
    expect(Math.max(...axes.map((a) => a.right)) - Math.min(...axes.map((a) => a.right))).toBeLessThanOrEqual(0.5);
    expect(Math.max(...axes.map((a) => a.left)) - Math.min(...axes.map((a) => a.left))).toBeLessThanOrEqual(0.5);

    await page.screenshot({ path: 'e2e/screenshots/coin-indicators-dropdown-mobile-360.png', fullPage: false });

    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
    ).toBeLessThanOrEqual(1);
  });
});

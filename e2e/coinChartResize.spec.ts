import { test, expect, type Page } from '@playwright/test';

/**
 * Regression coverage for the production ChartTerminal resize/fullscreen defect
 * (owner-reported on /coin/BNB): after expanding/entering fullscreen and returning
 * to a smaller size, historical candles disappeared and the chart collapsed to a
 * single giant last candle / an extremely narrow time range, staying broken until
 * a page reload.
 *
 * Root cause: the chart was recreated on every `height` change (fullscreen toggles
 * the height prop), but the REST data effect keyed on `[data, timeframe]` did not
 * re-run — so the freshly created series stayed empty (in LIVE the next WS tick then
 * painted the lone giant candle). The fix resizes the existing chart in place, so
 * the series data and the horizontal logical range survive the geometry change.
 *
 * This test asserts OBSERVABLE geometry/range via a dev-only probe rather than
 * relying on a screenshot, and it distinguishes "data actually disappeared"
 * (`bars === 0`) from "only the visible range/geometry broke" (`bars > 0` but the
 * logical span collapsed). Screenshots are additional evidence only.
 */

interface ChartProbe {
  bars: number;
  volumeBars: number;
  lineBars: number;
  range: { from: number; to: number } | null;
  rangeSpan: number | null;
  width: number;
  height: number;
  symbol: string;
}

async function readProbe(page: Page): Promise<ChartProbe> {
  return page.evaluate(() => {
    const probe = (window as unknown as { __cryptoraChartProbe?: () => ChartProbe }).__cryptoraChartProbe;
    if (!probe) throw new Error('chart probe not available');
    return probe();
  });
}

/** A healthy chart: real history present and a sane, non-collapsed visible window. */
function expectHealthyChart(probe: ChartProbe, context: string): void {
  // Data must actually be on the series — not zero (disappeared) and not a lone bar.
  expect(probe.bars, `${context}: candle count`).toBeGreaterThan(10);
  expect(probe.volumeBars, `${context}: volume count`).toBeGreaterThan(10);
  expect(probe.range, `${context}: visible range present`).not.toBeNull();
  const span = probe.rangeSpan ?? 0;
  // Not collapsed to ~1 candle, and not an absurdly wide/degenerate range.
  expect(span, `${context}: visible span not collapsed`).toBeGreaterThan(8);
  expect(span, `${context}: visible span not degenerate`).toBeLessThan(probe.bars + 60);
}

test.describe('Coin chart resize / fullscreen regression', () => {
  test.describe.configure({ timeout: 90_000 });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('cryptora_qa_fixture', '1');
    });
  });

  test('normal -> fullscreen -> normal keeps historical candles and a sane range', async ({ page }) => {
    await page.goto('/coin/BNB');
    const terminal = page.getByTestId('chart-terminal');
    await expect(page.getByTestId('coin-chart-card')).toBeVisible({ timeout: 20_000 });
    await expect(terminal).toBeVisible({ timeout: 20_000 });
    await expect(terminal.locator('canvas').first()).toBeVisible();

    // Wait until the probe reports a populated chart.
    await expect.poll(async () => (await readProbe(page)).bars, { timeout: 15_000 }).toBeGreaterThan(10);

    const initial = await readProbe(page);
    expectHealthyChart(initial, 'initial');
    const normalHeight = initial.height;
    const normalWidth = initial.width;
    await page.screenshot({ path: 'e2e/screenshots/coin-chart-before-fullscreen.png', fullPage: false });

    const enter = page.getByRole('button', { name: 'Полный экран' });
    const exitName = 'Выйти из полноэкранного режима';

    for (let cycle = 0; cycle < 2; cycle++) {
      // ---- enter fullscreen ----
      await enter.click();
      await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
      // Height must actually grow (geometry transition happened).
      await expect.poll(async () => (await readProbe(page)).height, { timeout: 10_000 })
        .toBeGreaterThan(normalHeight);
      const inFull = await readProbe(page);
      expectHealthyChart(inFull, `cycle ${cycle}: fullscreen`);
      if (cycle === 0) await page.screenshot({ path: 'e2e/screenshots/coin-chart-in-fullscreen.png', fullPage: false });

      // ---- exit fullscreen ----
      await page.getByRole('button', { name: exitName }).click();
      await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(false);
      // Height returns to the normal container height (stale dimensions must not stick).
      await expect.poll(async () => (await readProbe(page)).height, { timeout: 10_000 })
        .toBeLessThan(normalHeight + 8);

      const afterExit = await readProbe(page);
      expectHealthyChart(afterExit, `cycle ${cycle}: after exit`);
      // No data loss across the round trip and no giant-single-candle corruption.
      expect(afterExit.bars, `cycle ${cycle}: bars preserved`).toBe(initial.bars);
      expect(Math.abs(afterExit.width - normalWidth), `cycle ${cycle}: width restored`).toBeLessThan(4);
    }

    await page.screenshot({ path: 'e2e/screenshots/coin-chart-after-fullscreen.png', fullPage: false });

    // Document has no horizontal overflow after the round trips.
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
  });

  test('viewport wide -> narrow -> wide does not corrupt the chart', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/coin/BNB');
    await expect(page.getByTestId('chart-terminal')).toBeVisible({ timeout: 20_000 });
    await expect.poll(async () => (await readProbe(page)).bars, { timeout: 15_000 }).toBeGreaterThan(10);

    const baseline = await readProbe(page);
    expectHealthyChart(baseline, 'baseline 1280');

    const widths = [1600, 1024, 1280, 1600, 1280];
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      // Let ResizeObserver + layout settle.
      await expect.poll(async () => (await readProbe(page)).width, { timeout: 8_000 })
        .toBeGreaterThan(0);
      const probe = await readProbe(page);
      expectHealthyChart(probe, `viewport ${width}`);
      expect(probe.bars, `viewport ${width}: bars preserved`).toBe(baseline.bars);

      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(overflow.scrollWidth, `viewport ${width}: no horizontal overflow`)
        .toBeLessThanOrEqual(overflow.clientWidth + 1);
    }

    await page.screenshot({ path: 'e2e/screenshots/coin-chart-after-resize.png', fullPage: false });
  });

  test('desktop toolbar stays on a single row and ASSET STATE has no stray cyan rule', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/coin/BNB');
    const toolbar = page.getByTestId('chart-terminal-toolbar');
    await expect(toolbar).toBeVisible({ timeout: 20_000 });

    // Single row: first control and the fullscreen control share the same row.
    const firstTrigger = page.getByTestId('chart-timeframe-trigger');
    const fullscreen = page.getByRole('button', { name: 'Полный экран' });
    const a = await firstTrigger.boundingBox();
    const b = await fullscreen.boundingBox();
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(Math.abs(a!.y - b!.y), 'toolbar controls on same row').toBeLessThan(6);
    // Fullscreen sits to the right of the dropdowns (flex spacer pushes it right).
    expect(b!.x).toBeGreaterThan(a!.x);

    const toolbarBox = await toolbar.boundingBox();
    expect(toolbarBox!.height, 'toolbar is a single compact row').toBeLessThan(60);

    // Defect A: the ASSET STATE region must not carry the left cyan border.
    const borderLeft = await page.locator('.coin-identity').first().evaluate(
      (el) => getComputedStyle(el).borderLeftWidth,
    );
    expect(borderLeft).toBe('0px');

    await page.screenshot({ path: 'e2e/screenshots/coin-toolbar-single-row.png', fullPage: false });
  });

  test('XRP terminal also survives a fullscreen round trip', async ({ page }) => {
    await page.goto('/coin/XRP');
    await expect(page.getByTestId('chart-terminal')).toBeVisible({ timeout: 20_000 });
    await expect.poll(async () => (await readProbe(page)).bars, { timeout: 15_000 }).toBeGreaterThan(10);

    const initial = await readProbe(page);
    expectHealthyChart(initial, 'XRP initial');

    await page.getByRole('button', { name: 'Полный экран' }).click();
    await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
    await expect.poll(async () => (await readProbe(page)).height, { timeout: 10_000 })
      .toBeGreaterThan(initial.height);
    expectHealthyChart(await readProbe(page), 'XRP fullscreen');

    await page.getByRole('button', { name: 'Выйти из полноэкранного режима' }).click();
    await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(false);
    await expect.poll(async () => (await readProbe(page)).height, { timeout: 10_000 })
      .toBeLessThan(initial.height + 8);

    const afterExit = await readProbe(page);
    expectHealthyChart(afterExit, 'XRP after exit');
    expect(afterExit.bars).toBe(initial.bars);
  });
});

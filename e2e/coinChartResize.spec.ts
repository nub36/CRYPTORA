import { test, expect, type Page } from '@playwright/test';

/**
 * Regression coverage for the production ChartTerminal resize/fullscreen defect
 * (owner-reported on /coin/BNB): after expanding/entering fullscreen and returning
 * to a smaller size, historical candles disappeared and the chart collapsed to a
 * single giant last candle / an extremely narrow time range, staying broken until
 * a page reload.
 *
 * Root cause: the chart was recreated on every `height` change (fullscreen toggles
 * the height prop; the coin page also flips chartHeight 460<->340 at the 1280px
 * breakpoint), but the REST data effect keyed on `[data, timeframe]` did not re-run
 * — so the freshly created series stayed empty (in LIVE the next WS tick then
 * painted the lone giant candle; in QA/no-WS the chart went blank). The fix resizes
 * the existing chart in place, so the series data and the horizontal logical range
 * survive the geometry change.
 *
 * These tests assert OBSERVABLE geometry/range via a dev-only probe rather than
 * relying on a screenshot, and distinguish "data actually disappeared" (`bars === 0`)
 * from "only the visible range/geometry broke" (`bars > 0` but the logical span
 * collapsed). Screenshots are additional evidence only.
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

async function forceExitFullscreen(page: Page): Promise<void> {
  await page.evaluate(() => {
    if (document.fullscreenElement) return document.exitFullscreen().catch(() => undefined);
    return undefined;
  }).catch(() => undefined);
}

test.describe('Coin chart resize / fullscreen regression', () => {
  test.describe.configure({ timeout: 90_000 });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('cryptora_qa_fixture', '1');
    });
  });

  test.afterEach(async ({ page }) => {
    await forceExitFullscreen(page);
  });

  test('normal -> fullscreen -> normal keeps historical candles and a sane range', async ({ page }) => {
    await page.goto('/coin/BNB');
    const terminal = page.getByTestId('chart-terminal');
    await expect(page.getByTestId('coin-chart-card')).toBeVisible({ timeout: 20_000 });
    await expect(terminal).toBeVisible({ timeout: 20_000 });
    await expect(terminal.locator('canvas').first()).toBeVisible();

    await expect.poll(async () => (await readProbe(page)).bars, { timeout: 15_000 }).toBeGreaterThan(10);

    const initial = await readProbe(page);
    expectHealthyChart(initial, 'initial');
    const normalWidth = initial.width;
    await page.screenshot({ path: 'e2e/screenshots/coin-chart-before-fullscreen.png', fullPage: false }).catch(() => undefined);

    for (let cycle = 0; cycle < 2; cycle++) {
      // ---- enter fullscreen (real user gesture required by the Fullscreen API) ----
      await page.getByRole('button', { name: 'Полный экран' }).click({ timeout: 15_000 });
      await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement)), { timeout: 10_000 }).toBe(true);
      // Let the fullscreenchange -> React re-render (height prop change) -> resize settle.
      await expect.poll(async () => (await readProbe(page)).bars, { timeout: 10_000 }).toBe(initial.bars);
      const inFull = await readProbe(page);
      expectHealthyChart(inFull, `cycle ${cycle}: fullscreen`);
      if (cycle === 0) await page.screenshot({ path: 'e2e/screenshots/coin-chart-in-fullscreen.png', fullPage: false }).catch(() => undefined);

      // ---- exit fullscreen (via API so the assertion does not depend on the
      //      button's aria-label toggling in a given headless environment) ----
      await page.evaluate(() => document.exitFullscreen().catch(() => undefined));
      await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement)), { timeout: 10_000 }).toBe(false);
      await expect.poll(async () => (await readProbe(page)).width, { timeout: 10_000 })
        .toBeGreaterThan(normalWidth - 40);

      const afterExit = await readProbe(page);
      expectHealthyChart(afterExit, `cycle ${cycle}: after exit`);
      // No data loss across the round trip and no giant-single-candle corruption.
      expect(afterExit.bars, `cycle ${cycle}: bars preserved`).toBe(initial.bars);
      expect(Math.abs(afterExit.width - normalWidth), `cycle ${cycle}: width restored`).toBeLessThan(40);
    }

    await page.screenshot({ path: 'e2e/screenshots/coin-chart-after-fullscreen.png', fullPage: false }).catch(() => undefined);

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
  });

  test('viewport wide -> narrow -> wide (incl. 1280 height breakpoint) does not corrupt the chart', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/coin/BNB');
    await expect(page.getByTestId('chart-terminal')).toBeVisible({ timeout: 20_000 });
    await expect.poll(async () => (await readProbe(page)).bars, { timeout: 15_000 }).toBeGreaterThan(10);

    const baseline = await readProbe(page);
    expectHealthyChart(baseline, 'baseline 1280');

    // Crossing 1280 flips the coin page chartHeight (460 <-> 340) -> the same
    // height-prop change that fullscreen triggers. This deterministically exercises
    // the recreation bug in headless without relying on the browser fullscreen API.
    const widths = [1600, 1000, 1280, 1600, 1000, 1280];
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(350); // ResizeObserver + layout settle
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

    await page.screenshot({ path: 'e2e/screenshots/coin-chart-after-resize.png', fullPage: false }).catch(() => undefined);
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

    await page.screenshot({ path: 'e2e/screenshots/coin-toolbar-single-row.png', fullPage: false }).catch(() => undefined);
  });

  test('XRP terminal also survives a fullscreen round trip', async ({ page }) => {
    await page.goto('/coin/XRP');
    await expect(page.getByTestId('chart-terminal')).toBeVisible({ timeout: 20_000 });
    await expect.poll(async () => (await readProbe(page)).bars, { timeout: 15_000 }).toBeGreaterThan(10);

    const initial = await readProbe(page);
    expectHealthyChart(initial, 'XRP initial');

    await page.getByRole('button', { name: 'Полный экран' }).click({ timeout: 15_000 });
    await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement)), { timeout: 10_000 }).toBe(true);
    await expect.poll(async () => (await readProbe(page)).bars, { timeout: 10_000 }).toBe(initial.bars);
    expectHealthyChart(await readProbe(page), 'XRP fullscreen');

    await page.evaluate(() => document.exitFullscreen().catch(() => undefined));
    await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement)), { timeout: 10_000 }).toBe(false);
    await expect.poll(async () => (await readProbe(page)).bars, { timeout: 10_000 }).toBe(initial.bars);

    const afterExit = await readProbe(page);
    expectHealthyChart(afterExit, 'XRP after exit');
    expect(afterExit.bars).toBe(initial.bars);
  });
});

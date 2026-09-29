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

async function isFullscreen(page: Page): Promise<boolean> {
  return page.evaluate(() => Boolean(document.fullscreenElement));
}

/**
 * Warm the terminal with a dense series of GENUINE control interactions before
 * requesting fullscreen. This mirrors the *passing* coinTerminal.spec flow: that
 * test (same route, same component, same config) enters fullscreen successfully
 * only after many real clicks, while a sparse warm-up leaves headless Chromium
 * refusing the request. The sole difference between the two is this interaction
 * history, so we reproduce it here. All controls used are core PR#30 features
 * already covered by coinTerminal.spec, so this stays stable.
 */
async function warmUpTerminal(page: Page): Promise<void> {
  // Настройки живут в общем «•••» (единый тулбар desktop + mobile).
  const more = page.getByTestId('chart-more-trigger');
  await more.click({ timeout: 10_000 });
  const volume = page.getByRole('menuitemcheckbox', { name: /^Объём/ });
  await volume.click();
  await volume.click();
  await page.mouse.click(8, 8); // dismiss the menu with a real outside click

  const timeframe = page.getByTestId('chart-timeframe-trigger');
  await timeframe.click();
  await page.getByTestId('chart-timeframe-1h').click();

  const chartType = page.getByTestId('chart-type-trigger');
  await chartType.click();
  await page.getByRole('menuitem', { name: /Линия/ }).click();
  await chartType.click();
  await page.getByRole('menuitem', { name: /Свеч/ }).click();

  const indicators = page.getByTestId('chart-indicators-trigger');
  await indicators.click();
  const rsi = page.getByRole('menuitemcheckbox', { name: /RSI/ });
  await rsi.click();
  await rsi.click();
  await page.mouse.click(8, 8);
}

/**
 * Enter fullscreen via the toolbar control and HARD-assert that the Fullscreen API
 * actually engaged (the request needs a real user gesture, which Playwright's
 * click provides). This deliberately has NO graceful-skip escape hatch: a green CI
 * run is therefore real proof that fullscreen was entered, not merely that the
 * assertions were bypassed. The click is retried a couple of times only to absorb
 * transient gesture-activation timing, not to tolerate a non-functional API.
 */
async function enterFullscreen(page: Page): Promise<void> {
  // PR#32: the control now lives on the RIGHT SIDE RAIL of the terminal, not in
  // the top toolbar. The regression contract itself is unchanged — the same
  // single fullscreen implementation must still engage the real Fullscreen API.
  const button = page.getByRole('button', { name: 'Развернуть график' });
  await expect(button).toBeVisible();
  const railHasButton = await page.evaluate(() => {
    const rail = document.querySelector('[data-qa="chart-side-rail"]');
    const control = document.querySelector('[data-qa="chart-fullscreen"]');
    const toolbar = document.querySelector('[data-qa="chart-terminal-toolbar"]');
    return Boolean(rail && control && rail.contains(control) && toolbar && !toolbar.contains(control));
  });
  expect(railHasButton, 'fullscreen control is on the chart side rail, not in the toolbar').toBe(true);
  let engaged = false;
  for (let attempt = 0; attempt < 3 && !engaged; attempt++) {
    await button.click({ timeout: 10_000 });
    try {
      await expect
        .poll(() => isFullscreen(page), { timeout: 5_000, intervals: [150, 250, 400, 600] })
        .toBe(true);
      engaged = true;
    } catch {
      await page.waitForTimeout(300); // absorb a stray activation-timing miss, then retry
    }
  }
  expect(
    engaged,
    'Fullscreen API must actually engage (real user gesture) — the test does NOT pass without genuine fullscreen',
  ).toBe(true);
  // The element taken fullscreen must be the terminal (or an ancestor of it).
  const terminalIsFullscreen = await page.evaluate(() => {
    const el = document.fullscreenElement;
    const term = document.querySelector('[data-qa="chart-terminal"]');
    return Boolean(el && term && (el === term || el.contains(term)));
  });
  expect(terminalIsFullscreen, 'the chart terminal is the fullscreen element').toBe(true);
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

    // Warm up first so the Fullscreen API is granted (see warmUpTerminal), then read
    // the baseline from the settled post-warm-up state so bar counts compare cleanly.
    await warmUpTerminal(page);
    await expect.poll(async () => (await readProbe(page)).bars, { timeout: 15_000 }).toBeGreaterThan(10);

    const initial = await readProbe(page);
    expectHealthyChart(initial, 'initial');
    const normalWidth = initial.width;
    await page.screenshot({ path: 'e2e/screenshots/coin-chart-before-fullscreen.png', fullPage: false }).catch(() => undefined);

    for (let cycle = 0; cycle < 2; cycle++) {
      // ---- enter fullscreen (mandatory: fails if the API does not engage) ----
      await enterFullscreen(page);
      // Let the fullscreenchange -> React re-render (height prop change) -> resize settle.
      // With the fix bars stay == initial; the buggy recreation dropped them to 0.
      await expect.poll(async () => (await readProbe(page)).bars, { timeout: 10_000 }).toBe(initial.bars);
      const inFull = await readProbe(page);
      expectHealthyChart(inFull, `cycle ${cycle}: fullscreen`);
      if (cycle === 0) await page.screenshot({ path: 'e2e/screenshots/coin-chart-in-fullscreen.png', fullPage: false }).catch(() => undefined);

      // ---- exit fullscreen (via API so the assertion does not depend on the
      //      button's aria-label toggling in a given headless environment) ----
      await page.evaluate(() => document.exitFullscreen().catch(() => undefined));
      await expect.poll(() => isFullscreen(page), { timeout: 10_000 }).toBe(false);
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

    // Single row: first control and the rightmost toolbar control («•••») share
    // the same row. PR#32 moved fullscreen out of this toolbar, and the unified
    // toolbar moved «Вписать данные» into the overflow menu, so the right-hand
    // anchor of the row is now the overflow trigger.
    const firstTrigger = page.getByTestId('chart-timeframe-trigger');
    const overflow = page.locator('[data-qa="chart-more-trigger"]');
    const a = await firstTrigger.boundingBox();
    const b = await overflow.boundingBox();
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(Math.abs(a!.y - b!.y), 'toolbar controls on same row').toBeLessThan(6);
    // «•••» sits to the right of the dropdowns (flex spacer pushes it right).
    expect(b!.x).toBeGreaterThan(a!.x);

    // The fullscreen control left the toolbar and no spacer/hole was left behind:
    // «•••» is flush with the toolbar's right padding edge.
    await expect(toolbar.locator('[data-qa="chart-fullscreen"]')).toHaveCount(0);
    await expect(toolbar.locator('[data-qa="chart-reset-view"]'), '«Вписать данные» lives in the overflow menu').toHaveCount(0);
    const toolbarRight = (await toolbar.boundingBox())!.x + (await toolbar.boundingBox())!.width;
    expect(toolbarRight - (b!.x + b!.width), 'no leftover spacer where fullscreen used to be').toBeLessThan(20);

    const toolbarBox = await toolbar.boundingBox();
    expect(toolbarBox!.height, 'toolbar is a single compact row').toBeLessThan(60);

    // Defect A: the ASSET STATE region must not carry ANY vertical cyan rule to
    // its left — neither a real left border nor a ::before/::after decoration.
    const decor = await page.locator('.coin-identity').first().evaluate((el) => {
      const cs = getComputedStyle(el);
      const before = getComputedStyle(el, '::before');
      const after = getComputedStyle(el, '::after');
      const header = el.querySelector('.terminal-region__header');
      const headerCs = header ? getComputedStyle(header) : null;
      return {
        borderLeftWidth: cs.borderLeftWidth,
        beforeContent: before.content,
        beforeBorderLeft: before.borderLeftWidth,
        beforeWidth: before.width,
        afterContent: after.content,
        afterBorderLeft: after.borderLeftWidth,
        afterWidth: after.width,
        // The intentional horizontal divider under the header must survive.
        headerBorderBottom: headerCs?.borderBottomWidth ?? null,
      };
    });
    // No left border on the region itself (this was the literal source rule).
    expect(decor.borderLeftWidth, 'ASSET STATE has no left border').toBe('0px');
    // No pseudo-element acting as a thin tall cyan bar on the left.
    const pseudoIsBar = (content: string, borderLeft: string, width: string) =>
      content !== 'none' && (parseFloat(borderLeft) > 0 || (parseFloat(width) > 0 && parseFloat(width) <= 4));
    expect(pseudoIsBar(decor.beforeContent, decor.beforeBorderLeft, decor.beforeWidth), '::before is not a cyan rule').toBe(false);
    expect(pseudoIsBar(decor.afterContent, decor.afterBorderLeft, decor.afterWidth), '::after is not a cyan rule').toBe(false);
    // Regression guard: the horizontal divider below the block is NOT removed.
    expect(parseFloat(decor.headerBorderBottom ?? '0'), 'horizontal header divider preserved').toBeGreaterThan(0);

    await page.screenshot({ path: 'e2e/screenshots/coin-asset-state-no-cyan-rule.png', fullPage: false }).catch(() => undefined);
    await page.screenshot({ path: 'e2e/screenshots/coin-toolbar-single-row.png', fullPage: false }).catch(() => undefined);
  });

  test('XRP terminal also survives a fullscreen round trip', async ({ page }) => {
    await page.goto('/coin/XRP');
    await expect(page.getByTestId('chart-terminal')).toBeVisible({ timeout: 20_000 });
    await expect.poll(async () => (await readProbe(page)).bars, { timeout: 15_000 }).toBeGreaterThan(10);

    await warmUpTerminal(page);
    await expect.poll(async () => (await readProbe(page)).bars, { timeout: 15_000 }).toBeGreaterThan(10);

    const initial = await readProbe(page);
    expectHealthyChart(initial, 'XRP initial');

    await enterFullscreen(page);
    await expect.poll(async () => (await readProbe(page)).bars, { timeout: 10_000 }).toBe(initial.bars);
    expectHealthyChart(await readProbe(page), 'XRP fullscreen');

    await page.evaluate(() => document.exitFullscreen().catch(() => undefined));
    await expect.poll(() => isFullscreen(page), { timeout: 10_000 }).toBe(false);
    await expect.poll(async () => (await readProbe(page)).bars, { timeout: 10_000 }).toBe(initial.bars);

    const afterExit = await readProbe(page);
    expectHealthyChart(afterExit, 'XRP after exit');
    expect(afterExit.bars).toBe(initial.bars);
  });
});

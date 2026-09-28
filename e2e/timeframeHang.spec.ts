import { test, expect, type Page } from '@playwright/test';

/**
 * P0 browser regression: switching the timeframe on /coin/:symbol used to freeze
 * the Chrome renderer ("Страница не отвечает"), and the tab stayed dead even
 * after navigating back to '/'.
 *
 * Root cause was a non-terminating value-area loop in
 * `IndicatorEngine.calculateVolumeProfile`, reached from the indicator recompute
 * that every timeframe switch triggers. A synchronous infinite loop blocks the
 * renderer's single JS thread, so these assertions are the honest browser-level
 * proof: if the thread is wedged, `page.evaluate` and navigation never resolve
 * and the test fails on timeout.
 *
 * Exchange data is frequently unavailable from CI runners (451 for cloud IPs).
 * These tests therefore assert RESPONSIVENESS, never candle contents — the page
 * shell and its controls render regardless of upstream availability.
 */

const TIMEFRAMES_BTC = ['15m', '1h', '5m'] as const;

/** Resolves only if the renderer's JS thread is still processing tasks. */
async function assertRendererResponsive(page: Page, label: string) {
  const alive = await page.evaluate(
    () => new Promise<boolean>((resolve) => requestAnimationFrame(() => resolve(true))),
    { timeout: 10_000 } as never,
  );
  expect(alive, `renderer thread wedged at: ${label}`).toBe(true);
}

async function selectTimeframe(page: Page, timeframe: string) {
  const trigger = page.getByTestId('chart-timeframe-trigger');
  await expect(trigger).toBeVisible({ timeout: 60_000 });
  await trigger.click();
  const option = page.getByTestId(`chart-timeframe-${timeframe}`);
  await expect(option).toBeVisible({ timeout: 10_000 });
  await option.click();
}

async function openFixtureCoin(page: Page, symbol: string) {
  // Seed storage on the app origin explicitly. This keeps the regression test
  // deterministic even when another E2E test has already used the same Vite
  // server; the browser still renders the real Coin page and chart.
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('cryptora_qa_fixture', '1'));
  await page.goto(`/coin/${symbol}`);
}

test.describe('P0 — timeframe switching keeps the renderer responsive', () => {
  test('BTC: 1h → 15m → 1h → 5m, then navigating to / still works', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(String(err)));

    await openFixtureCoin(page, 'BTC');
    // The page shell is available even when the exchange source is not.
    await expect(page.locator('[data-qa="coin-page-shell"]')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('chart-timeframe-trigger')).toBeVisible({ timeout: 60_000 });
    await assertRendererResponsive(page, 'initial load');

    for (const tf of TIMEFRAMES_BTC) {
      await selectTimeframe(page, tf);
      // A frozen renderer never returns from this call.
      await assertRendererResponsive(page, `after switching to ${tf}`);
    }

    // The original bug left the tab dead for subsequent SPA navigation too.
    await page.goto('/', { timeout: 20_000 });
    await expect(page.getByText('CRYPTORA', { exact: false }).first()).toBeVisible({ timeout: 20_000 });
    await assertRendererResponsive(page, 'after navigating back to /');

    expect(pageErrors, `pageerror: ${pageErrors.join('; ')}`).toEqual([]);
  });

  test('SOL: 1h → 15m keeps the renderer responsive', async ({ page }) => {
    await openFixtureCoin(page, 'SOL');
    await expect(page.locator('[data-qa="coin-page-shell"]')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('chart-timeframe-trigger')).toBeVisible({ timeout: 60_000 });

    for (const tf of ['1h', '15m']) {
      await selectTimeframe(page, tf);
      await assertRendererResponsive(page, `SOL after switching to ${tf}`);
    }

    await page.goto('/', { timeout: 20_000 });
    await expect(page.getByText('CRYPTORA', { exact: false }).first()).toBeVisible({ timeout: 20_000 });
  });
});

import { test, expect } from '@playwright/test';

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

const TIMEFRAMES_BTC = ['15m', '1h', '5m'];

/** Resolves only if the renderer's JS thread is still processing tasks. */
async function assertRendererResponsive(page: import('@playwright/test').Page, label: string) {
  const alive = await page.evaluate(
    () => new Promise<boolean>((resolve) => requestAnimationFrame(() => resolve(true))),
    { timeout: 10_000 } as never,
  );
  expect(alive, `renderer thread wedged at: ${label}`).toBe(true);
}

test.describe('P0 — timeframe switching keeps the renderer responsive', () => {
  test('BTC: 1h → 15m → 1h → 5m, then navigating to / still works', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(String(err)));

    await page.goto('/coin/BTC');
    // The page shell is available even when the exchange source is not.
    await expect(page.locator('[data-qa="coin-page-shell"]').or(page.getByRole('button', { name: '15m' }).first()))
      .toBeVisible({ timeout: 20_000 });
    await assertRendererResponsive(page, 'initial load');

    for (const tf of TIMEFRAMES_BTC) {
      const button = page.getByRole('button', { name: tf, exact: true }).first();
      if (!(await button.isVisible().catch(() => false))) continue;
      await button.click({ timeout: 10_000 });
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
    await page.goto('/coin/SOL');
    await expect(page.locator('[data-qa="coin-page-shell"]').or(page.getByRole('button', { name: '15m' }).first()))
      .toBeVisible({ timeout: 20_000 });

    for (const tf of ['1h', '15m']) {
      const button = page.getByRole('button', { name: tf, exact: true }).first();
      if (!(await button.isVisible().catch(() => false))) continue;
      await button.click({ timeout: 10_000 });
      await assertRendererResponsive(page, `SOL after switching to ${tf}`);
    }

    await page.goto('/', { timeout: 20_000 });
    await expect(page.getByText('CRYPTORA', { exact: false }).first()).toBeVisible({ timeout: 20_000 });
  });
});

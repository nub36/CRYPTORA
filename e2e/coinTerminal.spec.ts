import { test, expect } from '@playwright/test';

/**
 * Browser coverage for the Coin terminal shell. The explicit QA fixture keeps
 * this visual interaction test deterministic without presenting fixture data as
 * LIVE; the production path still uses the same provider and candle API.
 */
test.describe('Coin terminal chart UX', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('cryptora_qa_fixture', '1');
    });
  });

  test('desktop keeps the Coin context and switches the timeframe through the popup', async ({ page }) => {
    await page.goto('/coin/XRP');
    await expect(page.locator('[data-qa="coin-chart-card"]')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-qa="chart-terminal"]')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('XRP/USDT', { exact: false }).first()).toBeVisible();
    await expect(page.getByText('Макс. 24ч:', { exact: false }).first()).toBeVisible();
    await expect(page.getByText('Мин. 24ч:', { exact: false }).first()).toBeVisible();

    const timeframe = page.getByTestId('chart-timeframe-trigger');
    await expect(timeframe).toContainText('15м');
    await timeframe.click();
    await expect(page.getByTestId('chart-timeframe-trigger-menu')).toBeVisible();
    await page.screenshot({ path: 'screenshots/coin-terminal-timeframe-open.png', fullPage: false });

    await page.getByTestId('chart-timeframe-1h').click();
    await expect(timeframe).toContainText('1ч');
    await expect(page.getByTestId('chart-timeframe-trigger-menu')).toBeHidden();
    await page.screenshot({ path: 'screenshots/coin-terminal-1h.png', fullPage: false });

    await timeframe.click();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('chart-timeframe-trigger-menu')).toBeHidden();
    await timeframe.click();
    await page.mouse.click(8, 8);
    await expect(page.getByTestId('chart-timeframe-trigger-menu')).toBeHidden();
  });

  test('360px mobile keeps the terminal usable without document overflow', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto('/coin/BTC');
    await expect(page.locator('[data-qa="chart-terminal"]')).toBeVisible({ timeout: 20_000 });

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);

    const timeframe = page.getByTestId('chart-timeframe-trigger');
    await timeframe.click();
    const menu = page.getByTestId('chart-timeframe-trigger-menu');
    await expect(menu).toBeVisible();
    const menuBox = await menu.boundingBox();
    expect(menuBox).not.toBeNull();
    expect(menuBox!.x).toBeGreaterThanOrEqual(0);
    expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(360);
    await page.screenshot({ path: 'screenshots/coin-terminal-mobile-360.png', fullPage: false });
  });
});

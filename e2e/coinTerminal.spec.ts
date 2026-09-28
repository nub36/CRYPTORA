import { test, expect } from '@playwright/test';

/**
 * Browser coverage for the Coin terminal shell. The explicit QA fixture keeps
 * this visual interaction test deterministic without presenting fixture data as
 * LIVE; the production path still uses the same provider and candle API.
 */
test.describe('Coin terminal chart UX', () => {
  test.describe.configure({ timeout: 60_000 });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('cryptora_qa_fixture', '1');
    });
  });

  test('desktop keeps the Coin context and exercises the terminal controls', async ({ page }) => {
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(String(error)));
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });

    await page.goto('/coin/XRP');
    const terminal = page.getByTestId('chart-terminal');
    await expect(page.getByTestId('coin-chart-card')).toBeVisible({ timeout: 20_000 });
    await expect(terminal).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('XRP/USDT', { exact: false }).first()).toBeVisible();
    await expect(page.getByText('Макс. 24ч:', { exact: false }).first()).toBeVisible();
    await expect(page.getByText('Мин. 24ч:', { exact: false }).first()).toBeVisible();
    await expect(page.locator('[data-qa="chart-type-switch"]')).toHaveCount(0);
    await expect(page.locator('[data-qa="chart-ma-toggle"]')).toHaveCount(0);
    await expect(terminal.locator('canvas').first()).toBeVisible();
    await page.screenshot({ path: 'e2e/screenshots/coin-terminal-desktop.png', fullPage: false });

    // Volume is a chart-only setting and remains usable from the terminal.
    const settings = page.getByTestId('chart-settings-trigger');
    await settings.click();
    const volume = page.getByRole('menuitemcheckbox', { name: /^Объём/ });
    await expect(volume).toHaveAttribute('aria-checked', 'true');
    await volume.click();
    await expect(volume).toHaveAttribute('aria-checked', 'false');
    await volume.click();
    await expect(volume).toHaveAttribute('aria-checked', 'true');

    // One timeframe trigger drives a real chart update and the menu is dismissible.
    const timeframe = page.getByTestId('chart-timeframe-trigger');
    await expect(timeframe).toContainText('15м');
    await timeframe.click();
    await expect(page.getByTestId('chart-timeframe-trigger-menu')).toBeVisible();
    await page.screenshot({ path: 'e2e/screenshots/coin-terminal-timeframe-open.png', fullPage: false });
    await page.getByTestId('chart-timeframe-1h').click();
    await expect(timeframe).toContainText('1ч');
    await expect(page.getByTestId('chart-timeframe-trigger-menu')).toBeHidden();
    await expect(terminal.locator('canvas').first()).toBeVisible();

    await timeframe.click();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('chart-timeframe-trigger-menu')).toBeHidden();
    await timeframe.click();
    await page.mouse.click(8, 8);
    await expect(page.getByTestId('chart-timeframe-trigger-menu')).toBeHidden();

    // Candle/line switching is presentation-only and does not remove the chart.
    const chartType = page.getByTestId('chart-type-trigger');
    await chartType.click();
    await page.getByRole('menuitem', { name: /Линия/ }).click();
    await expect(page.getByText('Линейный график', { exact: false }).first()).toBeVisible();
    await expect(terminal.locator('canvas').first()).toBeVisible();
    await chartType.click();
    await page.getByRole('menuitem', { name: /Свечи/ }).click();
    await expect(page.getByText('Свечной график', { exact: false }).first()).toBeVisible();

    // RSI, MACD and MA/Bollinger are independent chart panes/overlays.
    const indicators = page.getByTestId('chart-indicators-trigger');
    await indicators.click();
    const ma = page.getByRole('menuitemcheckbox', { name: /MA и Bollinger/ });
    const rsi = page.getByRole('menuitemcheckbox', { name: /RSI/ });
    const macd = page.getByRole('menuitemcheckbox', { name: /MACD/ });
    await ma.click();
    await expect(ma).toHaveAttribute('aria-checked', 'false');
    await ma.click();
    await expect(ma).toHaveAttribute('aria-checked', 'true');
    await rsi.click();
    await macd.click();
    await expect(rsi).toHaveAttribute('aria-checked', 'true');
    await expect(macd).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('[aria-label="RSI indicator pane"]')).toBeVisible();
    await expect(page.locator('[aria-label="MACD indicator pane"]')).toBeVisible();
    await page.screenshot({ path: 'e2e/screenshots/coin-terminal-rsi-macd.png', fullPage: false });

    // Fullscreen must enter and leave without losing the terminal.
    await page.getByRole('button', { name: 'Полный экран' }).click();
    await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
    await expect(terminal).toBeVisible();
    await page.getByRole('button', { name: 'Выйти из полноэкранного режима' }).click();
    await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(false);
    await expect(terminal).toBeVisible();

    expect(pageErrors, `pageerror: ${pageErrors.join('; ')}`).toEqual([]);
    expect(consoleErrors, `console error: ${consoleErrors.join('; ')}`).toEqual([]);
  });

  test('360px mobile keeps the terminal usable without document overflow', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto('/coin/BTC');
    const terminal = page.getByTestId('chart-terminal');
    await expect(terminal).toBeVisible({ timeout: 20_000 });

    const layout = await page.evaluate(() => {
      const header = document.querySelector('header');
      return {
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        headerHeight: header?.getBoundingClientRect().height ?? 0,
        headerScrollWidth: header?.scrollWidth ?? 0,
        headerClientWidth: header?.clientWidth ?? 0,
      };
    });
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 1);
    expect(layout.headerHeight).toBeLessThan(96);
    expect(layout.headerScrollWidth).toBeLessThanOrEqual(layout.headerClientWidth + 1);

    const terminalBox = await terminal.boundingBox();
    expect(terminalBox).not.toBeNull();
    expect(terminalBox!.x).toBeGreaterThanOrEqual(0);
    expect(terminalBox!.x + terminalBox!.width).toBeLessThanOrEqual(360);

    const timeframe = page.getByTestId('chart-timeframe-trigger');
    await timeframe.click();
    const menu = page.getByTestId('chart-timeframe-trigger-menu');
    await expect(menu).toBeVisible();
    const menuBox = await menu.boundingBox();
    expect(menuBox).not.toBeNull();
    expect(menuBox!.x).toBeGreaterThanOrEqual(0);
    expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(360);
    await page.screenshot({ path: 'e2e/screenshots/coin-terminal-mobile-360.png', fullPage: false });

    await page.getByTestId('chart-timeframe-1h').click();
    await expect(timeframe).toContainText('1ч');
    await expect(terminal.locator('canvas').first()).toBeVisible();
  });

  test('unavailable ALGO shows an honest no-data state without fabricated candles', async ({ page }) => {
    await page.goto('/coin/ALGO');
    await expect(page.getByTestId('coin-load-state')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('coin-load-state')).toContainText(/Актив не найден|источник/i);
    await expect(page.getByTestId('chart-terminal')).toHaveCount(0);
  });
});

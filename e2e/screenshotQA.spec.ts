import { test, expect } from '@playwright/test';

/**
 * Screenshot QA specs — prepare visual regression tests for CI.
 * These tests navigate to key pages and take screenshots at multiple viewports.
 *
 * NOT run in sandbox (no Chromium). Run on CI later with:
 *   npx playwright test --update-snapshots
 *
 * Coverage matrix:
 *   Pages: /coin/BTC, /coin/ETH, /market, /heatmaps
 *   Themes: dark, light
 *   Viewports: mobile (375), tablet (768), laptop (1280), desktop (1920)
 */

const PAGES = [
  { name: 'coin-BTC', url: '/coin/BTC' },
  { name: 'coin-ETH', url: '/coin/ETH' },
  { name: 'market', url: '/market' },
  { name: 'heatmaps', url: '/heatmaps' },
] as const;

const VIEWPORTS = [
  { name: 'mobile', width: 375, height: 812 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'laptop', width: 1280, height: 800 },
  { name: 'desktop', width: 1920, height: 1080 },
] as const;

const THEMES = ['dark', 'light'] as const;

for (const page of PAGES) {
  for (const viewport of VIEWPORTS) {
    for (const theme of THEMES) {
      test.describe(`Screenshot: ${page.name} @ ${viewport.name} × ${theme}`, () => {
        test.use({
          viewport: { width: viewport.width, height: viewport.height },
        });

        test(`visual regression ${page.name}-${theme}-${viewport.name}`, async ({ page: p }) => {
          // Set theme
          await p.goto('/');
          await p.evaluate((t) => {
            localStorage.setItem('cryptora_theme', t);
          }, theme);
          await p.goto(page.url);

          // Wait for main content to be visible
          await p.waitForLoadState('networkidle');
          await p.waitForTimeout(1000); // Allow charts to render

          // Take full page screenshot
          await expect(p).toHaveScreenshot(
            `${page.name}-${theme}-${viewport.name}.png`,
            {
              fullPage: true,
              maxDiffPixelRatio: 0.05, // 5% tolerance for minor rendering differences
            }
          );
        });
      });
    }
  }
}

test.describe('Screenshot: workspace modules', () => {
  test.use({ viewport: { width: 1920, height: 1080 } });

  test('chart module with RSI sub-panel', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.setItem('cryptora_theme', 'dark'));
    await page.goto('/coin/BTC');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    // Toggle RSI
    const rsiButton = page.locator('button', { hasText: 'RSI' });
    if (await rsiButton.isVisible()) {
      await rsiButton.click();
      await page.waitForTimeout(300);
    }

    await expect(page.locator('[data-qa="coin-chart-card"]')).toHaveScreenshot(
      'chart-with-rsi-dark.png',
      { maxDiffPixelRatio: 0.05 }
    );
  });

  test('chart module with MACD sub-panel', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.setItem('cryptora_theme', 'dark'));
    await page.goto('/coin/BTC');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    // Toggle MACD
    const macdButton = page.locator('button', { hasText: 'MACD' });
    if (await macdButton.isVisible()) {
      await macdButton.click();
      await page.waitForTimeout(300);
    }

    await expect(page.locator('[data-qa="coin-chart-card"]')).toHaveScreenshot(
      'chart-with-macd-dark.png',
      { maxDiffPixelRatio: 0.05 }
    );
  });
});

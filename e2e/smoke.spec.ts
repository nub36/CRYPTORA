import { test, expect } from '@playwright/test';

test.describe('browser smoke', () => {
  test('главная страница загружается без crash', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/');
    await expect(page.locator('body')).toBeVisible();
    await expect(page.locator('body')).not.toBeEmpty();
    await expect(page.locator('body')).not.toContainText('Something went wrong');
    await expect(page.locator('body')).not.toContainText('Cannot read properties');
    expect(errors).toEqual([]);
  });

  for (const route of [
    { path: '/signals', name: 'Signals' },
    { path: '/strategies', name: 'Strategies' },
    { path: '/market', name: 'Market' },
    { path: '/strategy-lab', name: 'Strategy Lab' },
  ]) {
    test(`${route.name} route loads without crash (${route.path})`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      const response = await page.goto(route.path);
      expect(response?.status()).toBeLessThan(400);
      await expect(page.locator('body')).toBeVisible();
      await expect(page.locator('body')).not.toContainText('Something went wrong');
      expect(errors).toEqual([]);
    });
  }

  test('production initial load does not fetch an oversized chunk', async ({ page }) => {
    const heavyChunks: string[] = [];
    page.on('response', (response) => {
      const contentLength = Number(response.headers()['content-length'] ?? 0);
      if (response.url().endsWith('.js') && contentLength > 500 * 1024) {
        heavyChunks.push(`${response.url()} (${Math.round(contentLength / 1024)} KB)`);
      }
    });
    await page.goto('/');
    await expect(page.locator('body')).toBeVisible();
    expect(heavyChunks).toEqual([]);
  });

  test('production page does not expose demo mode or demo chunks', async ({ page }) => {
    const loadedScripts: string[] = [];
    page.on('response', (response) => {
      if (response.url().endsWith('.js')) loadedScripts.push(response.url());
    });
    await page.goto('/');
    await expect(page.locator('body')).toBeVisible();
    const bodyText = await page.locator('body').textContent() ?? '';
    expect(bodyText).not.toContain('DEMO MODE');
    expect(bodyText).not.toContain('Mock Data');
    expect(loadedScripts.filter((url) => /demo|mock-provider/i.test(url))).toEqual([]);
  });

  test('SPA navigation remains usable', async ({ page }) => {
    await page.goto('/');
    const links = page.locator('nav a, header a');
    await expect(links.first()).toBeVisible();
    await links.first().click();
    await expect(page.locator('body')).toBeVisible();
    await expect(page.locator('body')).not.toContainText('Something went wrong');
  });
});

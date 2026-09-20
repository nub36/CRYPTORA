import { test, expect } from '@playwright/test';

/**
 * Н10 (v0.8.52): настоящие браузерные e2e — Chromium, реальный рендер, маршруты.
 * Ассерты только по статичному UI — не зависят от доступности биржевых API в CI
 * (фоновые отказы источников не роняют тест; страницы честно показывают недоступность).
 */
test.describe('Браузерные e2e (Chromium)', () => {
  test('Обзор: приложение рендерится без необработанных JS-ошибок', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(String(err)));
    await page.goto('/');
    await expect(page.getByText('CRYPTORA', { exact: false }).first()).toBeVisible();
    expect(pageErrors, `pageerror: ${pageErrors.join('; ')}`).toEqual([]);
  });

  test('Навигация: «Рынок» ведёт на /market', async ({ page }) => {
    await page.goto('/');
    const marketLink = page.getByRole('link', { name: 'Рынок' }).first();
    await expect(marketLink).toBeVisible();
    await marketLink.click();
    await expect(page).toHaveURL(/\/market$/);
  });

  test('/strategies: заголовок архива исследований', async ({ page }) => {
    await page.goto('/strategies');
    await expect(page.getByRole('heading', { name: 'Стратегии' })).toBeVisible();
  });

  test('Футер: бейдж версии на месте', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText(/v0\.\d+\.\d+/).first()).toBeVisible();
  });
});

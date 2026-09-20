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

  test('Навигация: пункт «Рынок» доступен, /market рендерит каркас страницы', async ({ page }) => {
    await page.goto('/');
    // «Рынок» — объединённый пункт с подпунктами: ссылка ИЛИ dropdown-кнопка (зависит от брейкпоинта).
    const market = page
      .getByRole('link', { name: 'Рынок' })
      .or(page.getByRole('button', { name: 'Рынок' }))
      .first();
    await expect(market).toBeVisible();

    await page.goto('/market');
    // ВАЖНО: на CI-раннерах биржи часто недоступны (451 для облачных IP) —
    // ассертим каркас страницы (заголовок), а не наличие рыночных данных.
    await expect(page.getByRole('heading', { name: 'Рынок' })).toBeVisible({ timeout: 15_000 });
  });

  test('/strategies: заголовок архива исследований', async ({ page }) => {
    await page.goto('/strategies');
    await expect(page.getByRole('heading', { name: 'Стратегии' })).toBeVisible();
  });

  test('Футер: содержит бренд и версию', async ({ page }) => {
    await page.goto('/');
    const footer = page.locator('footer');
    await expect(footer).toBeVisible({ timeout: 15_000 });
    await expect(footer.getByText('CRYPTORA', { exact: false }).first()).toBeVisible();
    await expect(footer.getByText(/v0\.\d+\.\d+/).first()).toBeVisible();
  });
});

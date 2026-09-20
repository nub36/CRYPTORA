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

  test('Навигация: пункт «Рынок» доступен, /market рендерит таблицу рынка', async ({ page }) => {
    await page.goto('/');
    // «Рынок» — объединённый пункт с подпунктами: ссылка ИЛИ dropdown-кнопка (зависит от брейкпоинта).
    const market = page
      .getByRole('link', { name: 'Рынок' })
      .or(page.getByRole('button', { name: 'Рынок' }))
      .first();
    await expect(market).toBeVisible();

    await page.goto('/market');
    // Таблица рынка: заголовок «Монета» и строки активов (BTC присутствует в каноническом реестре).
    await expect(page.getByText('Монета', { exact: false }).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('BTC', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
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

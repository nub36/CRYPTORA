import { test, expect } from '@playwright/test';

const ROUTES = [
  '/',
  '/market',
  '/coin/BTC',
  '/coin/ETH',
  '/coin/SOL',
  '/futures',
  '/liquidations',
  '/screener',
  '/radar',
  '/heatmaps',
  '/tools',
  '/strategies',
  '/signals',
  '/correlations',
  '/onchain',
  '/journal',
];

test.describe('Terminal Server & Route Availability', () => {
  for (const route of ROUTES) {
    test(`route "${route}" responds with HTTP 200 OK and valid HTML`, async ({ request }) => {
      const response = await request.get(`http://localhost:5173${route}`);
      expect(response.status()).toBe(200);

      const headers = response.headers();
      expect(headers['content-type']).toContain('text/html');

      const body = await response.text();
      expect(body).toContain('CRYPTORA');
      expect(body).toContain('<div id="root"></div>');
      expect(body).toContain('Рынок. Данные. Решения.');
    });
  }

  test('unknown route serves application container for client-side 404 handling', async ({ request }) => {
    const response = await request.get('http://localhost:5173/unknown-section-xyz');
    expect(response.status()).toBe(200);
    const body = await response.text();
    expect(body).toContain('<div id="root"></div>');
  });
});

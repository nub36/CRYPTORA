import { test, expect, type Page, type Route } from '@playwright/test';

const persistedEvent = {
  id: 'fa0e7c8c-0b56-4de4-9d41-8d6020c8a001',
  timestamp: '2026-09-26T10:05:00.000Z',
  symbol: 'DOT',
  type: 'PRICE_MOVE',
  severity: 'HIGH',
  metricValue: '+5.00%',
  observation: 'Persisted while all Radar browser clients were closed.',
  isDemo: false,
  provenance: { exchange: 'binance', market: 'spot', symbol: 'DOTUSDT', timestamp: Date.UTC(2026, 8, 26, 10, 5, 0) },
  metadata: { priceChangePct: 5 },
};

const liveStatus = {
  source: 'server',
  running: true,
  lifecycle: 'live',
  configuredUniverseCount: 3,
  activeUniverseCount: 3,
  inactiveUniverseCount: 0,
  activeUniverseKnown: true,
  detector: { windowSize: 20, trackedSymbols: 3, warmedSymbols: 3, maxObservations: 20, warm: true, symbols: [] },
  marketFeed: { state: 'connected', subscribedSymbols: 3, lastMessageAt: '2026-09-26T10:05:00.000Z', stale: false, reconnectAttempt: 0, source: 'binance-spot-ticker' },
  startedAt: '2026-09-26T09:00:00.000Z',
  lastUniverseRefreshAt: '2026-09-26T10:05:00.000Z',
  lastPersistedEventAt: '2026-09-26T10:05:00.000Z',
  persistedEvents: 1,
  deduplicatedEvents: 0,
  retainedDeletes: 0,
  retentionDays: 30,
  lastError: null,
};

async function installServerRadarFixtures(page: Page): Promise<void> {
  await page.route(/\/api\/radar\/events(?:\?.*)?$/, (route: Route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ events: [persistedEvent], count: 1, source: 'server' }),
  }));
  await page.route('**/api/radar/status', (route: Route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(liveStatus),
  }));
  await page.route(/\/api\/strategies\/scan-universe(?:\?.*)?$/, (route: Route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ symbols: ['DOT', 'AEVO', 'RUNE'], activeKnown: true }),
  }));
  await page.route('**/api/signals**', (route: Route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ signals: [], count: 0, total: 0, source: 'server' }),
  }));
  await page.route('**/api/strategies', (route: Route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ strategies: [], source: 'server' }),
  }));
  await page.route('**/api/market/**', (route: Route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({}),
  }));
}

test.describe('Market Radar server-authoritative lifecycle', () => {
  test('renders persisted server event after a page reload without local Radar warm-up or subscriptions', async ({ page }) => {
    await installServerRadarFixtures(page);
    await page.goto('/radar');

    await expect(page.getByText('Persisted while all Radar browser clients were closed.')).toBeVisible();
    await expect(page.getByTestId('radar-live-status')).toContainText('LIVE · 3 symbols');
    await expect(page.getByTestId('radar-source-telemetry')).toContainText('SERVER · Scan Universe: 3 · warmed: 3/3 · feed: connected');

    await page.reload();
    await expect(page.getByText('Persisted while all Radar browser clients were closed.')).toBeVisible();
    await expect(page.getByTestId('radar-live-status')).toContainText('LIVE · 3 symbols');

    await page.getByLabel('Важность аномалии').selectOption('MEDIUM');
    await expect(page.getByTestId('radar-empty-state')).toHaveAttribute('data-state', 'filtered');
  });
});

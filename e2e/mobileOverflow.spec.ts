import { test, expect, type Page, type Route } from '@playwright/test';

/**
 * Mobile layout guard for the shared shell, admin workbench, and Signals.
 *
 * The route fixtures are network-bound only: production components still make
 * the same requests and production data/settings are never changed. The test
 * deliberately checks the document after body overflow masking is absent.
 */

const VIEWPORTS = [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
] as const;

const ADMIN_USER = {
  id: 'qa-admin',
  email: 'qa-admin@example.test',
  displayName: 'QA Admin',
  role: 'admin',
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  lastLoginAt: null,
  emailVerified: true,
  emailVerifiedAt: '2026-01-01T00:00:00.000Z',
};

const SIGNAL = {
  id: 'qa-signal-mobile-1',
  strategyId: 'V3_0_HTF_LIQUIDATION_TRAP',
  strategyVersion: '3.0',
  engineSetupId: null,
  symbol: 'BTC/USDT',
  timeframe: '1h',
  direction: 'LONG',
  signalCandleTs: '2026-09-20T12:00:00.000Z',
  entryType: 'LIMIT_CORRIDOR',
  validForBars: 3,
  exitRule: 'TP2 или стоп',
  entryMin: 83612.9,
  entryMax: 83734.6,
  stopLoss: 83297.6,
  targets: [85389.3, 87278.5],
  tp1: 85389.3,
  tp2: 87278.5,
  status: 'ACTIVE',
  createdAt: '2026-09-20T12:05:00.000Z',
  updatedAt: '2026-09-20T12:05:00.000Z',
  fillPrice: null,
  filledAt: null,
  fillStop: null,
  fillTargets: null,
  closedAt: null,
  closePrice: null,
  closeReason: null,
  resultR: null,
  netResultR: null,
  pnlResultPct: null,
  barsHeld: null,
  metadata: null,
  hash: 'a'.repeat(64),
  previousHash: 'GENESIS',
  outcomeHash: null,
  chainVersion: 2,
  provenanceStatus: 'VERIFIED',
};

const SIGNAL_STATUSES = [
  'ACTIVE',
  'FILLED',
  'TARGET_REACHED',
  'INVALIDATED',
  'CLOSED',
  'EXPIRED',
  'CANCELLED',
  'UNRESOLVED',
];

function json(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

async function installFixtures(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('cryptora_qa_fixture', '1');
  });

  await page.route('**/api/auth/session', (route) => json(route, { user: ADMIN_USER }));
  await page.route('**/api/strategies', (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith('/scan-universe')) {
      return json(route, { symbols: ['BTC', 'ETH', 'SOL'], activeKnown: true });
    }
    return json(route, { strategies: [] });
  });
  await page.route('**/api/signals/statistics*', (route) => json(route, {
    source: 'server',
    scope: { symbol: null, strategyId: null, period: 'all' },
    totals: {
      published: 1,
      waitingEntry: 1,
      filled: 0,
      completed: 0,
      wins: 0,
      losses: 0,
      breakEven: 0,
      targetReached: 0,
      invalidated: 0,
      unresolved: 0,
      noTrade: 0,
      avgGrossR: null,
      avgNetR: null,
      grossRSum: null,
      netRSum: null,
      winRatePct: null,
      fillRatePct: 0,
      completionRatePct: 0,
    },
    byStrategy: [],
    bySymbol: [],
  }));
  await page.route('**/api/signals/monitor', (route) => json(route, {
    running: false,
    cycles: 0,
    startedAt: null,
    lastCycleAt: null,
    lastCycleDurationMs: null,
    openCount: 1,
    error: null,
    source: 'server',
  }));
  await page.route('**/api/signals*', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/monitor')) {
      return json(route, {
        running: false,
        cycles: 0,
        startedAt: null,
        lastCycleAt: null,
        lastCycleDurationMs: null,
        openCount: 1,
        error: null,
        source: 'server',
      });
    }
    if (url.pathname.endsWith('/statistics')) {
      return json(route, {
        source: 'server',
        scope: { symbol: null, strategyId: null, period: 'all' },
        totals: {
          published: 1,
          waitingEntry: 1,
          filled: 0,
          completed: 0,
          wins: 0,
          losses: 0,
          breakEven: 0,
          targetReached: 0,
          invalidated: 0,
          unresolved: 0,
          noTrade: 0,
          avgGrossR: null,
          avgNetR: null,
          grossRSum: null,
          netRSum: null,
          winRatePct: null,
          fillRatePct: 0,
          completionRatePct: 0,
        },
        byStrategy: [],
        bySymbol: [],
      });
    }
    const open = url.searchParams.get('open') === 'true';
    return json(route, {
      signals: [SIGNAL],
      count: 1,
      total: 1,
      limit: 20,
      offset: 0,
      maxLimit: 200,
      ordering: 'created_at_desc',
      appliedFilters: {
        strategyId: null,
        status: null,
        open,
        symbol: url.searchParams.get('symbol'),
        direction: null,
      },
      statuses: SIGNAL_STATUSES,
      openStatuses: ['ACTIVE', 'FILLED'],
      source: 'server',
    });
  });

  const dashboard = {
    health: {
      status: 'ok',
      database: 'connected',
      version: '0.9.3',
      nodeVersion: 'v22.0.0',
      environment: 'qa',
      uptimeSeconds: 3661,
      registrationEnabled: false,
    },
    users: { total: 12, admins: 1, users: 11, active: 11, blocked: 1 },
    recentAudit: Array.from({ length: 4 }, (_, index) => ({
      action: 'USER_BLOCK',
      target_type: 'user',
      target_id: `user-${index}`,
      created_at: '2026-09-27T12:34:00.000Z',
      actor_name: 'QA Admin',
    })),
  };
  await page.route('**/api/admin/dashboard', (route) => json(route, dashboard));
  await page.route('**/api/admin/users*', (route) => json(route, {
    users: [{
      id: 'qa-user-1',
      email: 'user@example.test',
      displayName: 'QA User',
      role: 'user',
      isActive: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      lastLoginAt: null,
      emailVerified: true,
    }],
    pagination: { totalPages: 1 },
  }));
  await page.route('**/api/admin/system', (route) => json(route, {
    version: '0.9.3',
    nodeVersion: 'v22.0.0',
    environment: 'qa',
    uptimeSeconds: 3661,
    database: 'connected',
    registrationEnabled: false,
    memoryUsage: { rss: '128 MB', heapUsed: '64 MB' },
  }));
  await page.route('**/api/admin/scan-universe', (route) => json(route, {
    saved: ['BTC', 'ETH', 'SOL'],
    effective: ['BTC', 'ETH', 'SOL'],
    inactive: [],
    activeKnown: true,
    activeCount: 500,
    max: 100,
  }));
}

async function assertNoPageOverflow(page: Page): Promise<void> {
  const result = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const pageOverflow = document.documentElement.scrollWidth - width;
    const computedBodyOverflow = getComputedStyle(document.body).overflowX;
    const localOverflowRoots = new Set(
      Array.from(document.querySelectorAll<HTMLElement>('.overflow-x-auto, [data-local-overflow]'))
    );
    const offenders = Array.from(document.querySelectorAll<HTMLElement>('body *'))
      .filter((element) => {
        if (localOverflowRoots.has(element) || element.closest('.overflow-x-auto, [data-local-overflow]')) return false;
        const style = getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        const rect = element.getBoundingClientRect();
        return rect.right > width + 1 || rect.left < -1;
      })
      .slice(0, 10)
      .map((element) => ({
        tag: element.tagName,
        className: typeof element.className === 'string' ? element.className : '',
        right: Math.round(element.getBoundingClientRect().right),
      }));
    return {
      documentWidth: document.documentElement.scrollWidth,
      clientWidth: width,
      pageOverflow,
      computedBodyOverflow,
      offenders,
    };
  });

  expect(result.computedBodyOverflow).not.toBe('hidden');
  expect(result.pageOverflow, JSON.stringify(result)).toBeLessThanOrEqual(1);
  expect(result.offenders, JSON.stringify(result)).toEqual([]);
}

for (const viewport of VIEWPORTS) {
  test.describe(`document width ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });

    test('shared routes and every Admin tab stay within the viewport', async ({ page }) => {
      await installFixtures(page);

      for (const route of ['/', '/signals', '/radar', '/coin/BTC', '/market']) {
        await page.goto(route);
        await page.waitForTimeout(250);
        await assertNoPageOverflow(page);
      }

      await page.goto('/admin');
      await page.locator('[data-qa="admin-page-shell"]').waitFor();
      for (const tab of ['Обзор', 'Пользователи', 'Монеты', 'Система']) {
        await page.getByRole('button', { name: tab, exact: true }).click();
        await page.waitForTimeout(100);
        await assertNoPageOverflow(page);
      }

      if (viewport.width <= 480) {
        const tabsOverflow = await page.locator('[data-qa="admin-tabs"]').evaluate((element) => ({
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
        }));
        expect(tabsOverflow.scrollWidth).toBeGreaterThan(tabsOverflow.clientWidth);
      }
    });

    test('shared header stays a single compact row (no stranded logo / stacked controls)', async ({ page }) => {
      // Regression guard for the mobile header layout: with an authenticated
      // session the service-control cluster is at its widest. Previously the
      // shared top row was `flex-wrap`, so at ~360–390px the `shrink-0` cluster
      // overflowed by a few px and wrapped onto a second line — the logo was
      // stranded above a large empty gap and the header height roughly doubled
      // (~56px -> ~112px). installFixtures() logs in as an admin, reproducing
      // exactly that condition. The controls must share the brand's row and the
      // header must stay compact on every route and viewport.
      await installFixtures(page);

      for (const route of ['/', '/coin/XRP', '/signals', '/radar', '/market']) {
        await page.goto(route);
        await page.locator('header.terminal-header').waitFor();
        await page.waitForTimeout(200);

        const geo = await page.evaluate(() => {
          const header = document.querySelector('header.terminal-header') as HTMLElement;
          const topRow = header.querySelector(':scope > div') as HTMLElement;
          const brand = header.querySelector('a[aria-label*="Главная"]') as HTMLElement;
          const actions = topRow.querySelector(':scope > div.ml-auto') as HTMLElement;
          const b = brand.getBoundingClientRect();
          const a = actions.getBoundingClientRect();
          const h = header.getBoundingClientRect();
          const verticalOverlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          return {
            headerHeight: Math.round(h.height),
            brandTop: Math.round(b.top),
            actionsTop: Math.round(a.top),
            verticalOverlap: Math.round(verticalOverlap),
          };
        });

        const ctx = `${route} @ ${viewport.width}x${viewport.height}: ${JSON.stringify(geo)}`;
        // Brand and controls must occupy the same visual row (positive overlap);
        // a wrapped/stacked layout has zero or negative overlap.
        expect(geo.verticalOverlap, `controls must share the brand row — ${ctx}`).toBeGreaterThan(8);
        // Compact single-row shell: the top row is ~56px. A wrapped header was
        // ~112px+. 72px keeps a safe margin while still catching a second row.
        expect(geo.headerHeight, `compact header height — ${ctx}`).toBeLessThanOrEqual(72);

        // The hamburger must stay visible/tappable at sub-desktop widths.
        if (viewport.width < 1024) {
          await expect(page.getByRole('button', { name: 'Меню', exact: true })).toBeVisible();
        }
      }
    });

    test('Signals compact timezone and readable selected row remain mobile-safe', async ({ page }) => {
      await installFixtures(page);
      await page.goto('/signals');
      await expect(page.locator('[data-qa="signals-page"]')).toBeVisible();
      await expect(page.locator('[data-qa="signal-card"]')).toHaveCount(1);
      await expect(page.locator('[data-qa="signal-card"]')).toHaveAttribute('aria-pressed', 'true');

      if (viewport.width <= 480) {
        const compactZone = page.locator('[data-qa="signals-timezone-label-compact"]');
        await expect(compactZone).toBeVisible();
        await expect(compactZone).toHaveText(/GMT[+-]\d+/);
        await expect(page.locator('[data-qa="signals-timezone-label-full"]')).toBeHidden();
      }
      await assertNoPageOverflow(page);
    });
  });
}

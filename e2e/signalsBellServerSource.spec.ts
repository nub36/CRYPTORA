/**
 * Колокольчик: ЕДИНСТВЕННЫЙ источник продакшн-событий — серверная лента.
 *
 * Инцидент 2026-09-25 (RUNE). В проде существовали два независимых рантайма:
 *   • колокольчик ← браузерный `SignalsAuditLedger` (localStorage) — локальные
 *     сетапы, которых нет в PostgreSQL, выглядели как события продукта;
 *   • страница `/signals` ← `GET /api/signals` (серверная БД).
 * Поэтому колокольчик звонил по RUNE, пока сервер отдавал `count = 0`.
 *
 * Здесь это фиксируется на уровне БРАУЗЕРА (сеть подменяется на границе):
 *   1. легаси-запись `cryptora_signal_notifications_v1` (локальное событие RUNE)
 *      НЕ показывается как серверное — она уходит в карантин;
 *   2. серверное событие показывается ровно один раз и несёт СЕРВЕРНЫЙ id;
 *   3. карантинные строки сервера (MISMATCH/UNKNOWN) не становятся событиями, но
 *      видны числом в честной пометке;
 *   4. ссылка «Открыть сигнал» ведёт на `/signals?symbol=RUNE&signal=<id>` и
 *      выбирает ИМЕННО этот сигнал;
 *   5. отказ свечей RUNE не подставляет свечи BTC: график честно пуст/ошибка, а
 *      запроса `BTCUSDT` после перехода нет.
 *
 * Живые биржи из песочницы недоступны, поэтому подменяются ТОЛЬКО сетевые
 * границы (`page.route`); логика продукта выполняется настоящая.
 */

import { test, expect, type Page, type Route } from '@playwright/test';

const RUNE_ID = '3a7c58d2-9c4e-4f61-8d5a-2b0e7c1f9a44';
const MISMATCH_ID = '8b1d0f22-5c33-4a71-9e02-6f7a8b9c0d11';
const UNKNOWN_ID = 'c4e5a6b7-8d9f-4a10-b2c3-d4e5f6a7b8c9';
const LEGACY_KEY = 'cryptora_signal_notifications_v1';
const LEGACY_QUARANTINE_KEY = 'cryptora_signal_notifications_v1_legacy_quarantine';
const SERVER_KEY = 'cryptora_signal_notifications_v2';

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

const T0 = Date.UTC(2026, 8, 24, 15, 0, 0);

function runeSignal(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: RUNE_ID,
    strategyId: 'V3_3_HTF_ZONE_MITIGATION',
    strategyVersion: '3.3',
    engineSetupId: 'V3_3_HTF_ZONE_MITIGATION-RUNEUSDT-1790121600000',
    symbol: 'RUNE/USDT',
    timeframe: '1h',
    direction: 'LONG',
    signalCandleTs: iso(T0),
    entryType: 'LIMIT_CORRIDOR',
    validForBars: 3,
    exitRule: 'TP2 или стоп',
    entryMin: 0.6312,
    entryMax: 0.6418,
    stopLoss: 0.6104,
    targets: [0.6552, 0.671],
    tp1: 0.6552,
    tp2: 0.671,
    status: 'FILLED',
    createdAt: iso(T0 + 70_000),
    updatedAt: iso(T0 + 3_720_000),
    fillPrice: 0.6321,
    filledAt: iso(T0 + 3_720_000),
    fillStop: 0.6104,
    fillTargets: [0.6552, 0.671],
    closedAt: null,
    closePrice: null,
    closeReason: null,
    resultR: null,
    netResultR: null,
    pnlResultPct: null,
    barsHeld: null,
    metadata: { engineVersion: 'v3.3', riskRewardRatio: 1.42 },
    hash: 'a'.repeat(64),
    previousHash: 'b'.repeat(64),
    outcomeHash: null,
    chainVersion: 2,
    provenanceStatus: 'VERIFIED',
    ...overrides,
  };
}

function signalsEnvelope(signals: Record<string, unknown>[], symbol: string | null) {
  return {
    signals,
    count: signals.length,
    total: signals.length,
    limit: 50,
    offset: 0,
    maxLimit: 200,
    ordering: 'created_at_desc',
    appliedFilters: { strategyId: null, status: null, open: null, symbol, direction: null },
    statuses: ['ACTIVE', 'FILLED', 'TARGET_REACHED', 'INVALIDATED', 'CLOSED', 'EXPIRED', 'CANCELLED', 'UNRESOLVED'],
    openStatuses: ['ACTIVE', 'FILLED'],
    source: 'server',
  };
}

function statisticsEnvelope(symbol: string | null) {
  return {
    period: 'all',
    filters: { strategyId: null, symbol },
    statuses: ['ACTIVE', 'FILLED', 'TARGET_REACHED', 'INVALIDATED', 'CLOSED', 'EXPIRED', 'CANCELLED', 'UNRESOLVED'],
    openStatuses: ['ACTIVE', 'FILLED'],
    tradeClosedStatuses: ['TARGET_REACHED', 'INVALIDATED', 'CLOSED'],
    noTradeStatuses: ['EXPIRED', 'CANCELLED', 'UNRESOLVED'],
    closedStatuses: ['TARGET_REACHED', 'INVALIDATED', 'CLOSED', 'EXPIRED', 'CANCELLED', 'UNRESOLVED'],
    totals: {
      published: 1, waitingEntry: 0, filled: 1, completed: 0, cancelled: 0, expired: 0, unresolved: 0,
      targetReached: 0, invalidated: 0, closed: 0, wins: 0, losses: 0, winRatePct: null,
      avgGrossR: null, avgNetR: null, grossRSum: null, netRSum: null, fillRatePct: null, completionRatePct: null,
    },
    byStrategy: [],
    bySymbol: [],
    definitions: { winRatePct: 'доля успешных', avgGrossR: 'gross', avgNetR: 'net' },
    source: 'server',
  };
}

/**
 * Посев ДО загрузки приложения:
 *   • легаси-лента v1 с ЛОКАЛЬНЫМ событием RUNE (как в проде до исправления);
 *   • серверная лента v2 с пустым списком и снапшотом статусов, где RUNE был
 *     ACTIVE. Значит первый же опрос сервера (FILLED) даёт ровно одно событие —
 *     «вкладка была закрыта, сервер довёл сигнал до исполнения».
 */
async function seedStorage(page: Page): Promise<void> {
  await page.addInitScript(
    ([legacy, server, legacyId, mismatchId, unknownId]) => {
      try {
        window.localStorage.setItem(
          legacy as string,
          JSON.stringify([
            {
              id: `sig-local-${legacyId}-NEW_SIGNAL`,
              kind: 'NEW_SIGNAL',
              setupId: 'local-rune-setup',
              symbol: 'RUNE/USDT',
              title: 'НОВЫЙ СИГНАЛ',
              detail: 'RUNE/USDT · LONG · V3.3 · вход 0.63–0.64',
              at: new Date(Date.UTC(2026, 8, 24, 15, 1, 10)).toISOString(),
              read: false,
            },
          ])
        );
        window.localStorage.setItem(
          server as string,
          JSON.stringify({
            schemaVersion: 2,
            source: 'server',
            savedAt: new Date(Date.UTC(2026, 8, 24, 16, 0, 0)).toISOString(),
            items: [],
            seen: {
              [legacyId as string]: { status: 'ACTIVE', provenance: 'VERIFIED' },
              [mismatchId as string]: { status: 'ACTIVE', provenance: 'MISMATCH' },
              [unknownId as string]: { status: 'ACTIVE', provenance: 'UNKNOWN' },
            },
          })
        );
      } catch {
        /* приватный режим/без localStorage — тест тогда проверит остальное */
      }
    },
    [LEGACY_KEY, SERVER_KEY, RUNE_ID, MISMATCH_ID, UNKNOWN_ID]
  );
}

interface KlineRequest {
  symbol: string;
  at: number;
}

async function installFixtures(page: Page, requests: KlineRequest[]): Promise<void> {
  await seedStorage(page);
  // QA-режим гасит устаревший браузерный скан-движок (детерминизм).
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem('cryptora_qa_fixture', '1');
    } catch {
      /* noop */
    }
  });

  // Общая заглушка рынка регистрируется ПЕРВОЙ: Playwright отдаёт приоритет
  // последнему зарегистрированному маршруту, поэтому конкретные (вселенная,
  // свечи, KuCoin) идут ниже и перекрывают её.
  await page.route('**/api/market/**', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) })
  );

  await page.route('**/api/market/universe/spot*', (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        count: 3,
        symbols: [
          { symbol: 'BTC', exchangeSymbol: 'BTCUSDT', quoteAsset: 'USDT' },
          { symbol: 'RUNE', exchangeSymbol: 'RUNEUSDT', quoteAsset: 'USDT' },
          { symbol: 'SOL', exchangeSymbol: 'SOLUSDT', quoteAsset: 'USDT' },
        ],
        fetchedAt: iso(T0),
        stale: false,
      }),
    })
  );

  await page.route('**/api/market/binance/spot/api/v3/klines*', async (route: Route) => {
    const url = new URL(route.request().url());
    const symbol = url.searchParams.get('symbol') ?? 'BTCUSDT';
    requests.push({ symbol, at: Date.now() });
    if (symbol === 'RUNEUSDT') {
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'boom' }) });
      return;
    }
    const base = symbol === 'BTCUSDT' ? 65_000 : 140;
    const rows = Array.from({ length: 60 }, (_, i) => {
      const openTime = (T0 / 1000 - (60 - i) * 3600) * 1000;
      return [openTime, String(base), String(base + 40), String(base - 40), String(base + 20), '10', openTime + 3599000, '0', 100, '0', '0', '0'];
    });
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) });
  });
  await page.route('**/api/market/kucoin/**', (route: Route) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'boom' }) })
  );

  // Общая лента: страница спрашивает по символу, приложение — без символа
  // (колокольчик). Отвечаем одинаково: одна VERIFIED-строка RUNE + карантин.
  await page.route('**/api/signals*', (route: Route) => {
    const url = new URL(route.request().url());
    const pair = url.searchParams.get('symbol') ?? null;
    const base = pair ? pair.split('/')[0] : 'RUNE';
    const signals =
      base === 'RUNE'
        ? [
            runeSignal(),
            runeSignal({ id: MISMATCH_ID, provenanceStatus: 'MISMATCH', status: 'ACTIVE', fillPrice: null, filledAt: null }),
            runeSignal({ id: UNKNOWN_ID, provenanceStatus: 'UNKNOWN', status: 'ACTIVE', fillPrice: null, filledAt: null }),
          ]
        : [];
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(signalsEnvelope(signals, pair)),
    });
  });

  // Точечное чтение по id — deep-link страницы (регистрируем ПОСЛЕ общей ленты:
  // Playwright отдаёт приоритет последнему совпавшему маршруту).
  await page.route('**/api/signals/*', (route: Route) => {
    const path = new URL(route.request().url()).pathname;
    const id = path.split('/').pop() ?? '';
    if (id === RUNE_ID) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ signal: runeSignal(), source: 'server' }),
      });
    }
    return route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'SIGNAL_NOT_FOUND' }),
    });
  });

  await page.route('**/api/signals/statistics*', (route: Route) => {
    const url = new URL(route.request().url());
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(statisticsEnvelope(url.searchParams.get('symbol'))),
    });
  });

  await page.route('**/api/signals/monitor*', (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        running: true, cycles: 7, inFlight: false, lastTickStartedAt: null, lastTickFinishedAt: null,
        lastTickDurationMs: 140, lastError: null, consecutiveFailures: 0, stale: false, lastSummary: null,
      }),
    })
  );

  await page.route('**/api/strategies*', (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        strategies: [
          {
            strategyId: 'V3_3_HTF_ZONE_MITIGATION', version: '3.3', name: 'HTF Zone Mitigation',
            nameRu: 'HTF Zone Mitigation', timeframes: ['4h', '1h'], execTimeframe: '1h',
            contextTimeframes: ['4h'], badge: 'V3.3', enabled: true, status: 'ON', scanIntervalSeconds: 60,
            symbols: null, lastScanAt: iso(T0 + 3_600_000), lastSignalAt: iso(T0 + 70_000), lastError: null,
            updatedAt: iso(T0 + 3_600_000), activeSignalCount: 1,
          },
        ],
        source: 'server',
      }),
    })
  );

}

test.describe('Колокольчик: продакшн-события только из серверной ленты', () => {
  test('легаси-локальное событие не показывается, серверное — показывается с серверным id', async ({ page }) => {
    const requests: KlineRequest[] = [];
    await installFixtures(page, requests);

    // Колокольчик — приложение, а не страница: проверяем на главной.
    await page.goto('/');
    await page.getByLabel('Открыть алерты').click();
    await page.getByTestId('alerts-tab-signals').click();

    const events = page.getByTestId('signal-notification');
    await expect(events).toHaveCount(1);
    await expect(events.first().getByTestId('signal-notification-identity')).toContainText(RUNE_ID);
    await expect(events.first()).toContainText('ВХОД ИСПОЛНЕН');
    await expect(events.first()).toContainText('RUNE/USDT');

    // Легаси-запись (локальный сетап, которого нет в PostgreSQL) не стала событием.
    await expect(page.getByTestId('signal-notifications-server')).not.toContainText('local-rune-setup');
    await expect(page.getByTestId('signal-notification-identity')).not.toContainText('sig-local-');

    // Карантинные строки сервера — не события, но их число показано честно.
    await expect(page.getByTestId('signal-notifications-excluded')).toContainText('MISMATCH 1');
    await expect(page.getByTestId('signal-notifications-excluded')).toContainText('UNKNOWN 1');

    // Легаси-ключ перенесён в карантин (данные сохранены, лентами не читаются).
    const storage = await page.evaluate(
      ([legacyKey, quarantineKey]) => ({
        legacy: window.localStorage.getItem(legacyKey as string),
        quarantine: window.localStorage.getItem(quarantineKey as string),
      }),
      [LEGACY_KEY, LEGACY_QUARANTINE_KEY]
    );
    expect(storage.legacy).toBeNull();
    expect(storage.quarantine ?? '').toContain('local-rune-setup');
  });

  test('«Открыть сигнал» из колокольчика выбирает ровно этот сигнал на /signals', async ({ page }) => {
    const requests: KlineRequest[] = [];
    await installFixtures(page, requests);

    await page.goto('/');
    await page.getByLabel('Открыть алерты').click();
    await page.getByTestId('alerts-tab-signals').click();
    const event = page.getByTestId('signal-notification').first();
    await expect(event).toBeVisible();

    // Ссылка собрана из СЕРВЕРНОГО id: символ + id, а не «/signals вообще».
    await expect(event.getByTestId('signal-open-signal')).toHaveAttribute('href', `/signals?symbol=RUNE&signal=${RUNE_ID}`);

    await event.getByTestId('signal-open-signal').click();
    await expect(page).toHaveURL(new RegExp(`/signals\\?symbol=RUNE&signal=${RUNE_ID}$`));

    // Страница инициализировалась из ссылки: выбран ровно серверный сигнал, а не
    // «последний в ленте» и не локальный сетап.
    const card = page.locator(`[data-qa="signal-card"][data-signal-id="${RUNE_ID}"]`);
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('signals-summary')).toContainText('RUNE/USDT');
    // График — на инструменте RUNE (в заголовке карточки пара RUNE/USDT).
    await expect(page.getByTestId('signals-chart-symbol')).toHaveText('RUNE');

    // Сеть свечей в QA-режиме синтетическая (движок погашен), поэтому
    // «нет подстановки BTC» проверяется отдельным тестом на живом рынке ниже.
  });

  test('отказ свечей RUNE — честное состояние без подстановки свечей BTC', async ({ page }) => {
    const requests: KlineRequest[] = [];
    await installFixtures(page, requests);
    // Живой рынок (не QA-синтетика): проверяется фактический путь свечей.
    await page.addInitScript(() => {
      try {
        window.localStorage.removeItem('cryptora_qa_fixture');
      } catch {
        /* noop */
      }
    });

    // Сначала BTC — источник отвечает.
    await page.goto('/signals?symbol=BTC');
    await expect(page.getByTestId('signals-chart-card')).toBeVisible();
    await expect.poll(() => requests.some((r) => r.symbol === 'BTCUSDT')).toBe(true);

    // Переход на RUNE: свечи падают (Binance 500, KuCoin 500).
    const switchedAt = Date.now();
    await page.goto(`/signals?symbol=RUNE&signal=${RUNE_ID}`);
    // График — на инструменте RUNE (в заголовке карточки пара RUNE/USDT).
    await expect(page.getByTestId('signals-chart-symbol')).toHaveText('RUNE');
    await expect(page.getByTestId('signals-chart-error')).toBeVisible();
    await expect(page.getByTestId('signals-empty')).toContainText('источника свечей');

    // После перехода запрашивался только RUNE: чужой инструмент не подставляется.
    const afterSwitch = requests.filter((r) => r.at >= switchedAt).map((r) => r.symbol);
    expect(afterSwitch).toContain('RUNEUSDT');
    expect(afterSwitch).not.toContain('BTCUSDT');
  });
});

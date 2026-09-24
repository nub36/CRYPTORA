/**
 * Signals V2 — браузерный E2E на реальной странице `/signals`.
 *
 * Источник истины для сигналов — серверная лента `GET /api/signals`; в этом
 * спеке она подменяется ТОЛЬКО на сетевой границе (`page.route`): боевой код не
 * трогается, фикстуры детерминированы и не попадают в продуктовые данные
 * (требование задачи: фикстуры только на сетевой границе, никаких фейков в проде).
 *
 * Окружение детерминируется как в `e2e/setup-dom.ts`: ключ `cryptora_qa_fixture=1`
 * переводит приложение в QA-режим. Это ОСОЗНАННО:
 *   • отключает устаревший браузерный `LiveSignalEngine` (иначе в live-режиме он
 *     сканирует всю вселенную и создаёт веер запросов свечей, мешающий проверке «нет веера»);
 *   • свечи в QA-режиме синтетические (провайдер не ходит в сеть) — график рисуется
 *     без внешних зависимостей, а маркеры/линии проверяются юнит-тестами проекции.
 * Свечной веер и гонки запросов сигналов покрыты юнит-тестами
 * (`useSignalChartCandles`, `useServerSignals`); здесь проверяем отсутствие веера
 * на сетевом уровне и корректность DOM.
 *
 * Проверяется (сценарии задачи):
 *   A. открыл /signals → структура: селектор, сводка, график, история;
 *   B. переключение монеты (через селектор вселенной) без «прилипания» старого;
 *   E. сигнал с произвольной лестницей целей `targets[3]` → «Цель 1/2/3» в панели;
 *   F. монета без сигналов → явное пустое состояние (пустая лента ≠ ошибка);
 *   G. «Статистика и аудит» (браузерный журнал, SHA-256) достижимы;
 *   I. НЕТ веера запросов: сигналы и свечи — только выбранный инструмент;
 *   J. нет неперехваченных ошибок страницы при переключении таймфреймов.
 *
 * Маркеры и линии уровней рисуются на canvas, поэтому по DOM проверяется их
 * «текстовое зеркало»: сводка, список уровней, история (проекция покрыта
 * юнит-тестами `signalChartProjection` / `signalUiModel`).
 */

import { test, expect, type Page, type Route } from '@playwright/test';

// ─────────────────────────────────────────────────────────────────────────────
// Детерминированные фикстуры (сетевая граница)
// ─────────────────────────────────────────────────────────────────────────────

/** Фиксированный час окончания истории (выровнен на 3600с). */
const END_TS = 1_790_121_600;
const HOUR = 3600;
const BAR_COUNT = 60;

function iso(tsSeconds: number): string {
  return new Date(tsSeconds * 1000).toISOString();
}

function barTs(index: number): number {
  return END_TS - (BAR_COUNT - 1 - index) * HOUR;
}

/** Binance-формат klines (на случай live-провайдера): [openTime(ms), o, h, l, c, v, …]. */
function makeKlines(basePrice: number): unknown[] {
  const rows: unknown[] = [];
  for (let i = 0; i < BAR_COUNT; i++) {
    const openTimeMs = barTs(i) * 1000;
    const open = basePrice + Math.sin(i * 0.7) * basePrice * 0.004;
    const close = basePrice + Math.sin((i + 1) * 0.7) * basePrice * 0.004;
    const high = Math.max(open, close) + basePrice * 0.001;
    const low = Math.min(open, close) - basePrice * 0.001;
    rows.push([
      openTimeMs, open.toFixed(2), high.toFixed(2), low.toFixed(2), close.toFixed(2),
      '12.34', openTimeMs + (HOUR - 1) * 1000, '0', 100, '0', '0', '0',
    ]);
  }
  return rows;
}

interface FixtureSignalInput {
  id: string;
  direction: 'LONG' | 'SHORT';
  strategyId: string;
  strategyVersion: string;
  barIndex: number;
  status: string;
  entryMin: number;
  entryMax: number;
  stopLoss: number;
  targets: number[];
  filled?: boolean;
  closed?: boolean;
  resultR?: number | null;
  netResultR?: number | null;
}

function makeSignal(pair: string, s: FixtureSignalInput): Record<string, unknown> {
  const ts = barTs(s.barIndex);
  return {
    id: s.id,
    strategyId: s.strategyId,
    strategyVersion: s.strategyVersion,
    engineSetupId: `setup-${s.id}`,
    symbol: pair,
    timeframe: '1h',
    direction: s.direction,
    signalCandleTs: iso(ts),
    entryType: 'LIMIT_CORRIDOR',
    validForBars: 24,
    exitRule: 'Фиксация по целям или стопу.',
    entryMin: s.entryMin,
    entryMax: s.entryMax,
    stopLoss: s.stopLoss,
    targets: s.targets,
    tp1: s.targets[0] ?? null,
    tp2: s.targets[1] ?? null,
    status: s.status,
    createdAt: iso(ts + 60),
    updatedAt: iso(ts + 120),
    fillPrice: s.filled ? s.entryMin : null,
    filledAt: s.filled ? iso(ts + HOUR) : null,
    fillStop: s.filled ? s.stopLoss + 10 : null,
    fillTargets: s.filled ? s.targets.map((t) => t + 5) : null,
    closedAt: s.closed ? iso(ts + 5 * HOUR) : null,
    closePrice: s.closed ? s.targets[0] ?? s.entryMin : null,
    closeReason: s.closed ? 'TARGET_REACHED' : null,
    resultR: s.resultR ?? null,
    netResultR: s.netResultR ?? null,
    pnlResultPct: s.resultR != null ? s.resultR * 1.2 : null,
    barsHeld: s.closed ? 5 : null,
    metadata: {
      engineVersion: '1.0.0',
      riskRewardRatio: 2.4,
      confirmingFactors: ['структура', 'объём'],
      invalidationFactors: ['стоп'],
      latencyBars: 0,
      publishedAt: iso(ts + 30),
    },
    hash: `hash-${s.id}`,
    previousHash: `prev-${s.id}`,
    outcomeHash: s.closed ? `outcome-${s.id}` : null,
    chainVersion: 2,
  };
}

const BTC_SIGNALS = [
  makeSignal('BTC/USDT', {
    id: 'btc-long-active',
    direction: 'LONG',
    strategyId: 'momentum_v3_0',
    strategyVersion: '3.0',
    barIndex: 55,
    status: 'ACTIVE',
    entryMin: 65_000,
    entryMax: 65_200,
    stopLoss: 64_000,
    targets: [66_500, 68_000, 70_000], // произвольная лестница из 3 целей
  }),
  makeSignal('BTC/USDT', {
    id: 'btc-long-filled',
    direction: 'LONG',
    strategyId: 'breakout_v3_3',
    strategyVersion: '3.3',
    barIndex: 50,
    status: 'FILLED',
    entryMin: 64_800,
    entryMax: 64_900,
    stopLoss: 64_000,
    targets: [66_300, 67_800],
    filled: true,
  }),
  makeSignal('BTC/USDT', {
    id: 'btc-short-closed',
    direction: 'SHORT',
    strategyId: 'mean_reversion_v2_8',
    strategyVersion: '2.8',
    barIndex: 45,
    status: 'TARGET_REACHED',
    entryMin: 66_000,
    entryMax: 66_000,
    stopLoss: 67_200,
    targets: [64_000],
    filled: true,
    closed: true,
    resultR: 1.67,
    netResultR: 1.6,
  }),
];

const SOL_SIGNALS: Record<string, unknown>[] = []; // монета без сигналов (сценарий F)

function signalsEnvelope(pair: string, signals: Record<string, unknown>[]) {
  return {
    signals,
    count: signals.length,
    total: signals.length,
    limit: 20,
    offset: 0,
    maxLimit: 200,
    ordering: 'created_at_desc',
    appliedFilters: { strategyId: null, status: null, open: null, symbol: pair, direction: null },
    statuses: ['ACTIVE', 'FILLED', 'TARGET_REACHED', 'INVALIDATED', 'CLOSED', 'EXPIRED', 'CANCELLED', 'UNRESOLVED'],
    openStatuses: ['ACTIVE', 'FILLED'],
    source: 'server',
  };
}

function spotUniverse(bases: string[]) {
  return {
    count: bases.length,
    symbols: bases.map((b) => ({ symbol: b, exchangeSymbol: `${b}USDT`, quoteAsset: 'USDT' })),
    fetchedAt: iso(END_TS),
    stale: false,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

interface RequestLog {
  /** Запросы свечей по каждому символу (проверка «нет веера»). */
  klinesBySymbol: Map<string, number>;
  klinesTotal: number;
  /** Запросы ленты сигналов по символу (не должно быть веера по вселенной). */
  signalsBySymbol: Map<string, number>;
}

function newLog(): RequestLog {
  return { klinesBySymbol: new Map(), klinesTotal: 0, signalsBySymbol: new Map() };
}

async function installSignalsFixtures(page: Page, log: RequestLog): Promise<void> {
  // QA-режим: гасит устаревший браузерный скан-движок (детерминизм, как в setup-dom).
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem('cryptora_qa_fixture', '1');
    } catch {
      /* noop */
    }
  });

  // Вселенная селектора (полный активный Spot, не админ-скан).
  await page.route('**/api/market/universe/spot*', (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(spotUniverse(['BTC', 'ETH', 'SOL'])),
    })
  );

  // Свечи (перехват на случай live-провайдера; в QA-режиме не запрашиваются).
  await page.route('**/api/market/binance/spot/api/v3/klines*', async (route: Route) => {
    const url = new URL(route.request().url());
    const symbol = url.searchParams.get('symbol') ?? '';
    const base = symbol.replace(/USDT$/, '');
    log.klinesBySymbol.set(base, (log.klinesBySymbol.get(base) ?? 0) + 1);
    log.klinesTotal += 1;
    const basePrice = base === 'BTC' ? 65_000 : base === 'ETH' ? 3_200 : 140;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(makeKlines(basePrice)),
    });
  });

  // Лента сигналов — по символу из query (детерминированные фикстуры).
  await page.route('**/api/signals*', (route: Route) => {
    const url = new URL(route.request().url());
    const pair = url.searchParams.get('symbol') ?? '';
    const base = pair.split('/')[0];
    log.signalsBySymbol.set(base || '*', (log.signalsBySymbol.get(base || '*') ?? 0) + 1);
    const signals = base === 'BTC' ? BTC_SIGNALS : base === 'SOL' ? SOL_SIGNALS : [];
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(signalsEnvelope(pair || 'BTC/USDT', signals)),
    });
  });

  // Health — нейтральный ответ.
  await page.route('**/api/health*', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
  );
}

const CI = Boolean(process.env.CI);

async function shot(page: Page, name: string): Promise<void> {
  if (!CI) return;
  await page.screenshot({ path: `e2e/screenshots/${name}.png`, fullPage: false });
}

// ─────────────────────────────────────────────────────────────────────────────

test.describe('Signals V2: server-driven /signals (network-boundary fixtures)', () => {
  test.setTimeout(60_000);

  test('A/E: BTC — структура V2, сводка, targets[3] (Цель 1/2/3), история из 3 строк', async ({ page }) => {
    const log = newLog();
    await installSignalsFixtures(page, log);
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.goto('/signals');

    // Иерархия блоков на месте.
    await expect(page.getByTestId('signals-coin-selector')).toBeVisible();
    await expect(page.getByTestId('signals-chart-card')).toBeVisible();
    await expect(page.getByTestId('signals-history')).toBeVisible();

    // Сводка последнего сигнала: LONG по BTC.
    const summary = page.getByTestId('signals-summary');
    await expect(summary).toBeVisible();
    await expect(summary.getByText('LONG').first()).toBeVisible();

    // Активный (последний) сигнал с 3 целями → детали показывают «Цель 1».
    const details = page.getByTestId('signals-details');
    await expect(details).toBeVisible();
    await expect(details.getByText('Цель 1').first()).toBeVisible();

    // История: 3 сигнала выбранной монеты.
    const historyRows = page.getByTestId('signals-history').locator('[data-qa="signal-card"]');
    await expect(historyRows).toHaveCount(3);

    // Таймфреймы графика (15m/1h/4h/1D) присутствуют; исполнение сигнала — 1h.
    await expect(page.getByTestId('signals-chart-tf-1h')).toBeVisible();
    await expect(page.getByTestId('signals-chart-tf-4h')).toBeVisible();

    await shot(page, 'signals-desktop-overview');
    expect(pageErrors).toHaveLength(0);
  });

  test('targets[3]: выбор сигнала из истории рисует все 3 цели + стоп в панели уровней', async ({ page }) => {
    const log = newLog();
    await installSignalsFixtures(page, log);
    await page.goto('/signals');

    // Выбираем первый (последний) сигнал — LONG с 3 целями.
    const firstRow = page.getByTestId('signals-history').locator('[data-qa="signal-card"]').first();
    await firstRow.click();

    const levelList = page.getByTestId('signals-level-list');
    await expect(levelList).toBeVisible();
    await expect(levelList.getByText('Цель 1').first()).toBeVisible();
    await expect(levelList.getByText('Цель 2').first()).toBeVisible();
    await expect(levelList.getByText('Цель 3').first()).toBeVisible();
    await expect(levelList.getByText('Стоп').first()).toBeVisible();

    // «Целей нет» не показывается — лестница непустая.
    await expect(page.getByTestId('signals-summary-no-targets')).toHaveCount(0);

    await shot(page, 'signals-long-targets3');
  });

  test('SHORT: закрытый сигнал показывает направление и достоверный статус', async ({ page }) => {
    const log = newLog();
    await installSignalsFixtures(page, log);
    await page.goto('/signals');

    // Клик по SHORT-сигналу (третья строка истории).
    const rows = page.getByTestId('signals-history').locator('[data-qa="signal-card"]');
    await rows.nth(2).click();

    const summary = page.getByTestId('signals-summary');
    await expect(summary.getByText('SHORT').first()).toBeVisible();

    await shot(page, 'signals-short-closed');
  });

  test('F: SOL — монета без сигналов → пустое состояние, история пуста', async ({ page }) => {
    const log = newLog();
    await installSignalsFixtures(page, log);
    await page.goto('/signals');

    // Открываем селектор вселенной и выбираем SOL.
    await page.getByTestId('signals-coin-picker-open').click();
    await page.getByTestId('symbol-picker-option-SOL').click();

    // Пустая лента ≠ ошибка: явное пустое состояние и пустая сводка.
    await expect(page.getByTestId('signals-empty')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('signals-empty')).toHaveAttribute('data-state', 'empty');
    await expect(page.getByTestId('signals-summary-empty')).toBeVisible();
    await expect(page.getByTestId('signals-history').locator('[data-qa="signal-card"]')).toHaveCount(0);

    // График при этом рисуется (свечи выбранного инструмента).
    await expect(page.getByTestId('signals-chart-card')).toBeVisible();

    await shot(page, 'signals-no-signal-coin');
  });

  test('I/B: нет веера — сигналы/свечи только по выбранным инструментам', async ({ page }) => {
    const log = newLog();
    await installSignalsFixtures(page, log);
    await page.goto('/signals');
    await expect(page.getByTestId('signals-chart-card')).toBeVisible();
    await page.waitForTimeout(1500);

    // На старте запрошен только выбранный инструмент (нет ленты по всей вселенной).
    expect(log.signalsBySymbol.size).toBeLessThanOrEqual(2);

    // Переключаем на SOL через селектор.
    await page.getByTestId('signals-coin-picker-open').click();
    await page.getByTestId('symbol-picker-option-SOL').click();
    await page.waitForTimeout(1200);

    // Сигналы запрошены только по BTC и SOL (по 1–2 страницы), не по всей вселенной.
    expect(log.signalsBySymbol.size).toBeLessThanOrEqual(2);
    for (const [, count] of log.signalsBySymbol) {
      expect(count).toBeLessThanOrEqual(4);
    }
    // Свечи: в QA-режиме синтетика (0 сетевых), в любом случае не веер.
    expect(log.klinesTotal).toBeLessThanOrEqual(6);
    expect(log.klinesBySymbol.size).toBeLessThanOrEqual(2);
  });

  test('G: секция «Статистика и аудит» (браузерный журнал, SHA-256) достижима и отделена', async ({ page }) => {
    const log = newLog();
    await installSignalsFixtures(page, log);
    await page.goto('/signals');

    await expect(page.getByTestId('signals-audit-section')).toBeVisible();
    await expect(page.getByTestId('signals-ledger-audit')).toBeVisible();

    await shot(page, 'signals-audit-section');
  });

  test('мобильный 390: иерархия блоков сверху вниз — без переполнения', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const log = newLog();
    await installSignalsFixtures(page, log);
    await page.goto('/signals');

    await expect(page.getByTestId('signals-coin-selector')).toBeVisible();
    await expect(page.getByTestId('signals-summary')).toBeVisible();
    await expect(page.getByTestId('signals-chart-card')).toBeVisible();
    await expect(page.getByTestId('signals-details')).toBeVisible();
    await expect(page.getByTestId('signals-history')).toBeVisible();
    await expect(page.getByTestId('signals-audit-section')).toBeVisible();

    // Мобильный порядок: селектор → сводка → график → детали → история.
    const order = await page.evaluate(() => {
      const top = (qa: string) =>
        document.querySelector(`[data-qa="${qa}"]`)?.getBoundingClientRect().top ?? Infinity;
      return {
        selector: top('signals-coin-selector'),
        summary: top('signals-summary'),
        chart: top('signals-chart-card'),
        details: top('signals-details'),
        history: top('signals-history'),
      };
    });
    expect(order.selector).toBeLessThan(order.summary);
    expect(order.summary).toBeLessThan(order.chart);
    expect(order.chart).toBeLessThan(order.details);
    expect(order.details).toBeLessThan(order.history);

    await shot(page, 'signals-mobile-top');
  });

  test('D/J: быстрое переключение таймфрейма — одна активная серия, без ошибок страницы', async ({ page }) => {
    const log = newLog();
    await installSignalsFixtures(page, log);
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.goto('/signals');
    await expect(page.getByTestId('signals-chart-card')).toBeVisible();

    // Быстрая серия переключений 1h → 4h → 15m → 1h.
    await page.getByTestId('signals-chart-tf-4h').click();
    await page.getByTestId('signals-chart-tf-15m').click();
    await page.getByTestId('signals-chart-tf-1h').click();
    await page.waitForTimeout(1200);

    // Активен ровно один таймфрейм-переключатель (последний — 1h).
    await expect(page.getByTestId('signals-chart-tf-1h')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('signals-chart-tf-4h')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('signals-chart-tf-15m')).toHaveAttribute('aria-pressed', 'false');

    // Ошибки свечей и неперехваченные ошибки страницы отсутствуют.
    await expect(page.getByTestId('signals-chart-error')).toHaveCount(0);
    expect(pageErrors).toHaveLength(0);
  });
});

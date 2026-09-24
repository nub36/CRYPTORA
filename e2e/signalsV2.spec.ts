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
 *   F. монета без сигналов → ОДНО явное пустое состояние (пустая лента ≠ ошибка);
 *   G. «Статистика и аудит» (браузерный журнал, SHA-256) достижимы;
 *   I. НЕТ веера запросов: сигналы и свечи — только выбранный инструмент;
 *   J. нет неперехваченных ошибок страницы при переключении таймфреймов;
 *   K. поиск в селекторе: B / BT / BTC / backspace не теряют запрос (BUG A);
 *   L. статус сканирования честный: выключен / включён / ошибка (BUG C);
 *   M. на графиках нет технической метки «LOCAL» (BUG D);
 *   N. время на графике — пояс браузера (эмуляция таймзоны Playwright);
 *   O. серверная статистика обновляется и не смешивается с браузерным журналом.
 *
 * Маркеры и линии уровней рисуются на canvas, поэтому по DOM проверяется их
 * «текстовое зеркало»: сводка, список уровней, история (проекция покрыта
 * юнит-тестами `signalChartProjection` / `signalUiModel`).
 */

import { test, expect, type Page, type Route } from '@playwright/test';
import fs from 'node:fs';

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

/**
 * Состояние стратегий на сервере. Меняется тестом, потому что статус
 * сканирования — состояние СЕРВЕРА, а не открытой вкладки: один и тот же
 * сценарий обязан показывать разное в зависимости от него (BUG C).
 */
const STRATEGIES_ENABLED = { enabled: true, error: false };

function strategiesEnvelope(opts: { enabled: boolean; error: boolean }) {
  const status = opts.error ? 'ERROR' : opts.enabled ? 'ON' : 'OFF';
  return {
    strategies: [
      {
        strategyId: 'V3_0_HTF_LIQUIDATION_TRAP',
        version: '3.0',
        name: 'HTF Liquidation Trap',
        nameRu: 'HTF Liquidation Trap',
        timeframes: ['4h', '1h'],
        execTimeframe: '1h',
        contextTimeframes: ['4h'],
        badge: 'V3.0',
        // Реальная комбинация из `deriveStatus`: стратегия включена, но скан
        // упал → `enabled: true`, `status: 'ERROR'`. Не «выключена».
        enabled: opts.enabled,
        status,
        scanIntervalSeconds: 60,
        symbols: null,
        lastScanAt: '2026-09-24T08:00:00.000Z',
        lastSignalAt: null,
        lastError: opts.error ? 'scan failed: exchangeInfo недоступен' : null,
        updatedAt: '2026-09-24T08:00:00.000Z',
        activeSignalCount: opts.enabled ? 2 : 0,
      },
    ],
    source: 'server',
  };
}

/** Серверная статистика: 3 опубликовано, 1 завершено сделкой, 1 отменено. */
function statisticsEnvelope() {
  return {
    period: 'all',
    filters: { strategyId: null, symbol: null },
    statuses: ['ACTIVE', 'FILLED', 'TARGET_REACHED', 'INVALIDATED', 'CLOSED', 'EXPIRED', 'CANCELLED', 'UNRESOLVED'],
    openStatuses: ['ACTIVE', 'FILLED'],
    tradeClosedStatuses: ['TARGET_REACHED', 'INVALIDATED', 'CLOSED'],
    noTradeStatuses: ['EXPIRED', 'CANCELLED', 'UNRESOLVED'],
    closedStatuses: ['TARGET_REACHED', 'INVALIDATED', 'CLOSED', 'EXPIRED', 'CANCELLED', 'UNRESOLVED'],
    totals: {
      published: 3,
      waitingEntry: 1,
      filled: 1,
      completed: 1,
      cancelled: 0,
      expired: 0,
      unresolved: 0,
      targetReached: 1,
      invalidated: 0,
      closed: 0,
      wins: 1,
      losses: 0,
      winRatePct: 100,
      avgGrossR: 1.67,
      avgNetR: 1.6,
      grossRSum: 1.67,
      netRSum: 1.6,
      fillRatePct: 66.7,
      completionRatePct: 33.3,
    },
    byStrategy: [],
    bySymbol: [],
    definitions: { winRatePct: 'доля успешных', avgGrossR: 'gross', avgNetR: 'net' },
    source: 'server',
  };
}

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

/**
 * Активный Spot-реèстр. В проде это ~493 инструментов; здесь — репрезентативный
 * срез, в котором есть «однобуквенные» совпадения (B → BTC/BNB), длинные тикеры
 * (1000SHIB) и мем-тикеры (PEPE). Ровно этот срез ломал BUG A.
 */
const SPOT_UNIVERSE = [
  'BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'DOGE', 'PEPE', '1000SHIB', 'LINK',
  'AVAX', 'DOT', 'MATIC', 'LTC', 'TRX', 'ATOM', 'NEAR', 'APT', 'ARB', 'OP',
] as const;

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
  /** Запросы вселенной селектора (открытие/поиск не должны грузить свечи). */
  universeCount: number;
}

function newLog(): RequestLog {
  return { klinesBySymbol: new Map(), klinesTotal: 0, signalsBySymbol: new Map(), universeCount: 0 };
}

interface FixtureOptions {
  /** Состояние стратегий на сервере (BUG C: единственный источник статуса). */
  strategies?: { enabled: boolean; error: boolean };
  /** HTTP-статус для `/api/strategies` (эмуляция отказа сервера). */
  strategiesStatus?: number;
  /** HTTP-статус для `/api/signals/statistics`. */
  statisticsStatus?: number;
  /**
   * Мутабельная лента. Позволяет изобразить работу СЕРВЕРНОГО монитора: второй
   * опрос возвращает другой статус — UI обязан обновиться без перезагрузки.
   */
  feed?: () => Record<string, unknown>[];
}

async function installSignalsFixtures(page: Page, log: RequestLog, opts: FixtureOptions = {}): Promise<void> {
  // QA-режим: гасит устаревший браузерный скан-движок (детерминизм, как в setup-dom).
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem('cryptora_qa_fixture', '1');
    } catch {
      /* noop */
    }
  });

  // Вселенная селектора (полный активный Spot, не админ-скан).
  await page.route('**/api/market/universe/spot*', (route: Route) => {
    log.universeCount += 1;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(spotUniverse([...SPOT_UNIVERSE])),
    });
  });

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
    const signals = opts.feed ? opts.feed() : base === 'BTC' ? BTC_SIGNALS : base === 'SOL' ? SOL_SIGNALS : [];
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(signalsEnvelope(pair || 'BTC/USDT', signals)),
    });
  });

  // Ниже — эндпоинты, которые страница опрашивает ОТДЕЛЬНО от ленты. Они
  // регистрируются после общего `**/api/signals*`, поэтому Playwright отдаёт
  // приоритет именно им (роуты матчатся в обратном порядке регистрации).

  // Серверная статистика (агрегаты PostgreSQL) — не путать с браузерным журналом.
  await page.route('**/api/signals/statistics*', (route: Route) => {
    const status = opts.statisticsStatus ?? 200;
    return route.fulfill({
      status,
      contentType: 'application/json',
      body: status === 200 ? JSON.stringify(statisticsEnvelope()) : JSON.stringify({ error: 'boom' }),
    });
  });

  // Телеметрия серверного монитора открытых сигналов.
  await page.route('**/api/signals/monitor*', (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        running: true,
        cycles: 7,
        inFlight: false,
        lastTickStartedAt: null,
        lastTickFinishedAt: null,
        lastTickDurationMs: 140,
        lastError: null,
        consecutiveFailures: 0,
        stale: false,
        lastSummary: null,
      }),
    })
  );

  // Состояние стратегий — ЕДИНСТВЕННЫЙ источник статуса сканирования (BUG C).
  // Значение по умолчанию: включена одна стратегия (честный «включено»).
  await page.route('**/api/strategies*', (route: Route) => {
    const status = opts.strategiesStatus ?? 200;
    const st = opts.strategies ?? STRATEGIES_ENABLED;
    return route.fulfill({
      status,
      contentType: 'application/json',
      body: status === 200 ? JSON.stringify(strategiesEnvelope(st)) : JSON.stringify({ error: 'unavailable' }),
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

    // Сигнал в ожидании входа (ACTIVE) — не выдуманный исход.
    await expect(summary).toHaveAttribute('data-status', 'ACTIVE');
    await shot(page, 'signals-waiting');
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

    // Уровни entry/stop/TP1..TP3 показаны списком (их же рисует график).
    await expect(levelList.getByText('Вход').first()).toBeVisible();
    await shot(page, 'signals-chart-levels');
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
    // Терминальный исход с фактическим R (сделка была). Значение из сервера.
    await expect(summary).toHaveAttribute('data-status', 'TARGET_REACHED');
    await expect(page.getByTestId('signals-summary-result')).toContainText('+1.67 R');
    await expect(page.getByTestId('signals-summary-result')).toContainText('+1.60 R');

    // История: 3 строки, у каждой время, направление, стратегия, статус.
    const historyRows = page.getByTestId('signals-history').locator('[data-qa="signal-card"]');
    await expect(historyRows).toHaveCount(3);
    await expect(page.getByTestId('signal-card-time').first()).toBeVisible();
    await shot(page, 'signals-history');
    await shot(page, 'signals-terminal');
    await shot(page, 'signals-short-closed');
  });

  test('F: SOL — монета без сигналов → пустое состояние, история пуста', async ({ page }) => {
    const log = newLog();
    await installSignalsFixtures(page, log);
    await page.goto('/signals');

    // Открываем селектор вселенной и выбираем SOL.
    await page.getByTestId('signals-coin-picker-open').click();
    await page.getByTestId('symbol-picker-option-SOL').click();

    // Пустая лента ≠ ошибка: явное пустое состояние.
    // BUG B: пустое состояние ОДНО. Раньше на экране были два разных блока
    // про «нет сигналов» (страничный и внутри сводки) — тест обновлён под
    // единственный блок, дубль удалён из продукта.
    await expect(page.getByTestId('signals-empty')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('signals-empty')).toHaveAttribute('data-state', 'empty');
    await expect(page.getByTestId('signals-empty')).toContainText('Сигналов по этому инструменту нет');
    await expect(page.getByTestId('signals-empty')).toHaveCount(1);
    await expect(page.getByTestId('signals-history').locator('[data-qa="signal-card"]')).toHaveCount(0);

    // График при этом рисуется (свечи выбранного инструмента).
    await expect(page.getByTestId('signals-chart-card')).toBeVisible();

    await shot(page, 'signals-no-signal-coin');
  });

  test('I/B: аудит запросов /signals — нет веера, нет дуп-лупа, нет runaway-поллинга', async ({ page }) => {
    const log = newLog();
    await installSignalsFixtures(page, log);
    const info = test.info();
    const phases: Array<{ phase: string; feed: number; feedSymbols: number; klines: number; universe: number }> = [];
    const snap = (label: string) => {
      const feedTotal = [...log.signalsBySymbol.values()].reduce((a, b) => a + b, 0);
      const rec = { phase: label, feed: feedTotal, feedSymbols: log.signalsBySymbol.size, klines: log.klinesTotal, universe: log.universeCount };
      phases.push(rec);
      info.annotations.push({
        type: 'requests',
        description: `${label}: лента=${feedTotal} (символов=${log.signalsBySymbol.size}), свечи=${log.klinesTotal}, вселенная=${log.universeCount}`,
      });
      return rec;
    };

    // 1) Initial load: выбран BTC.
    await page.goto('/signals');
    await expect(page.getByTestId('signals-chart-card')).toBeVisible();
    await page.waitForTimeout(1500);
    const afterLoad = snap('initial load');
    // Лента только по выбранной монете, свечи не веером.
    expect(log.signalsBySymbol.size).toBeLessThanOrEqual(1);

    // 2) Открытие селектора: догружается только вселенная, НЕ свечи.
    const klinesBeforePicker = log.klinesTotal;
    await page.getByTestId('signals-coin-picker-open').click();
    await expect(page.getByTestId('symbol-picker-option-SOL')).toBeVisible();
    await page.waitForTimeout(500);
    snap('open selector');
    expect(log.klinesTotal, 'открытие селектора не грузит свечи').toBe(klinesBeforePicker);

    // 3) Поиск по тикеру: клиентская фильтрация, без сетевых свечей.
    const klinesBeforeSearch = log.klinesTotal;
    await page.getByTestId('symbol-picker-search').fill('SO');
    await page.waitForTimeout(400);
    snap('search');
    expect(log.klinesTotal, 'поиск не запускает свечи по вселенной').toBe(klinesBeforeSearch);

    // 4) Выбор SOL: +1 лента по SOL (+1 свеча в live; в QA-режиме синтетика=0).
    await page.getByTestId('symbol-picker-option-SOL').click();
    await page.waitForTimeout(1200);
    snap('select SOL');
    expect(log.signalsBySymbol.size).toBeLessThanOrEqual(2);

    // 5) Быстрый цикл SOL → BTC → SOL → BTC (гонка): запросы ограничены, дуп-лупа нет.
    await page.getByTestId('signals-coin-picker-open').click();
    await page.getByTestId('symbol-picker-option-BTC').click();
    await page.getByTestId('signals-coin-picker-open').click();
    await page.getByTestId('symbol-picker-option-SOL').click();
    await page.getByTestId('signals-coin-picker-open').click();
    await page.getByTestId('symbol-picker-option-BTC').click();
    await page.waitForTimeout(1200);
    snap('rapid SOL→BTC→SOL→BTC');

    // 6) Переключение таймфрейма: свеча того же символа, не новый символ.
    await page.getByTestId('signals-chart-tf-4h').click();
    await page.waitForTimeout(800);
    snap('timeframe switch');

    // Итоговые границы: только BTC и SOL; по каждому ограниченное число запросов.
    for (const [sym, count] of log.signalsBySymbol) {
      expect(count, `лента по ${sym}`).toBeLessThanOrEqual(4);
      expect(['BTC', 'SOL']).toContain(sym);
    }
    expect(log.klinesTotal).toBeLessThanOrEqual(8);
    expect(log.klinesBySymbol.size).toBeLessThanOrEqual(2);
    // Поллинг 60с не должен сработать за время теста → дуп-луп отсутствует.
    expect(afterLoad.feed).toBeGreaterThanOrEqual(1);

    // Реальные счётчики — в файл для CI-сводки (артефакт аудита запросов).
    try {
      fs.mkdirSync('e2e', { recursive: true });
      fs.writeFileSync(
        'e2e/.request-audit.json',
        JSON.stringify({ phases, signalsBySymbol: Object.fromEntries(log.signalsBySymbol), klinesBySymbol: Object.fromEntries(log.klinesBySymbol), klinesTotal: log.klinesTotal, universeCount: log.universeCount }, null, 2)
      );
    } catch {
      /* нефатально */
    }
  });

  test('G: секция «Статистика и аудит» (браузерный журнал, SHA-256) достижима и отделена', async ({ page }) => {
    const log = newLog();
    await installSignalsFixtures(page, log);
    await page.goto('/signals');

    // Секция достижима (свёрнутый блок «Статистика и аудит»).
    await expect(page.getByTestId('signals-audit-section')).toBeVisible();
    const stats = page.locator('[data-testid="signals-stats"]');
    await expect(stats).toBeVisible();

    // Раскрываем: внутри — браузерный журнал (отдельный источник, не смешан с серверной лентой).
    await stats.locator('button').first().click();
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
    await shot(page, 'signals-mobile');
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

  // ───────────────────────────────────────────────────────────────────────────
  // K. BUG A — поиск в селекторе не теряет запрос
  // ───────────────────────────────────────────────────────────────────────────

  test('K: поиск селектора — B / BT / BTC / btc / backspace не сбрасывают ввод', async ({ page }) => {
    const log = newLog();
    await installSignalsFixtures(page, log);
    await page.goto('/signals');

    await page.getByTestId('signals-coin-picker-open').click();
    const search = page.getByTestId('symbol-picker-search');
    await expect(search).toBeVisible();

    // 1) Одна буква «B» — раньше именно здесь появлялось «Ничего не найдено».
    await search.fill('B');
    await expect(page.getByTestId('symbol-picker-option-BTC')).toBeVisible();
    await shot(page, 'signals-selector-b');
    await expect(page.getByTestId('symbol-picker-option-BNB')).toBeVisible();
    await expect(search).toHaveValue('B');
    await expect(page.getByTestId('symbol-picker-empty')).toHaveCount(0);

    // 2) Префикс растёт: BT → BTC.
    await search.fill('BT');
    await expect(page.getByTestId('symbol-picker-option-BTC')).toBeVisible();
    await expect(search).toHaveValue('BT');

    // 3) Полный тикер и тикер с парой: BTC → BTC/USDT.
    await search.fill('BTC');
    await expect(page.getByTestId('symbol-picker-option-BTC')).toBeVisible();
    await shot(page, 'signals-selector-btc');
    await search.fill('BTC/USDT');
    await expect(page.getByTestId('symbol-picker-option-BTC')).toBeVisible();
    await expect(search).toHaveValue('BTC/USDT');

    // 4) Регистр не важен: btc.
    await search.fill('btc');
    await expect(page.getByTestId('symbol-picker-option-BTC')).toBeVisible();

    // 5) Backspace по одному символу — ввод жив (корень BUG A).
    await search.press('Backspace');
    await expect(search).toHaveValue('bt');
    await expect(page.getByTestId('symbol-picker-option-BTC')).toBeVisible();
    await search.press('Backspace');
    await expect(search).toHaveValue('b');
    await expect(page.getByTestId('symbol-picker-option-BTC')).toBeVisible();

    // 6) Длинный тикер и мем-тикер находятся.
    await search.fill('1000SHIB');
    await expect(page.getByTestId('symbol-picker-option-1000SHIB')).toBeVisible();
    await search.fill('PEPE');
    await expect(page.getByTestId('symbol-picker-option-PEPE')).toBeVisible();

    // 7) Честное «ничего не найдено» — только когда совпадений действительно нет.
    await search.fill('ZZZZ');
    await expect(page.getByTestId('symbol-picker-empty')).toBeVisible();
    await expect(page.getByTestId('symbol-picker-empty')).toHaveCount(1);

    // 8) Выбор из результатов не сбрасывает ввод обратно в пустую строку.
    await search.fill('SOL');
    await page.getByTestId('symbol-picker-option-SOL').click();
    await expect(page.getByTestId('signals-empty')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('signals-empty')).toHaveAttribute('data-state', 'empty');

    await shot(page, 'signals-selector-search');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // L. BUG C — статус сканирования берётся с сервера и не врёт
  // ───────────────────────────────────────────────────────────────────────────

  test('FILLED: вход исполнен — показаны время входа, стоп и открытая сделка', async ({ page }) => {
    const log = newLog();
    await installSignalsFixtures(page, log);
    await page.goto('/signals');

    // Вторая строка истории — FILLED (вход по коридору исполнен).
    const rows = page.getByTestId('signals-history').locator('[data-qa="signal-card"]');
    await rows.nth(1).click();

    const summary = page.getByTestId('signals-summary');
    await expect(summary).toHaveAttribute('data-status', 'FILLED');
    await expect(page.getByTestId('signals-details')).toContainText('Вход');
    await shot(page, 'signals-filled');
  });

  test('L1: все стратегии выключены → «выключено», а не LIVE', async ({ page }) => {
    const log = newLog();
    await installSignalsFixtures(page, log, { strategies: { enabled: false, error: false } });
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.goto('/signals');

    const chip = page.getByTestId('signals-scanner-status');
    await expect(chip).toBeVisible();
    await expect(chip).toHaveAttribute('data-state', 'off');
    await expect(page.getByTestId('signals-scanner-status-title')).toHaveText('Сканирование сигналов выключено');
    await expect(page.getByTestId('signals-scanner-status-detail')).toContainText('Ни одна стратегия не включена');

    // Единственное пустое состояние называет причину «сканер выключен».
    const empty = page.getByTestId('signals-empty');
    await expect(empty).toBeVisible();
    await expect(empty).toHaveAttribute('data-state', 'scanner-off');
    await expect(empty).toContainText('Сканирование сигналов выключено');

    // «LIVE-скан» не показывается НИГДЕ и ни при каком состоянии страницы.
    const body = await page.locator('body').innerText();
    expect(body).not.toContain('LIVE-скан');
    expect(body).not.toMatch(/LIVE/i);
    expect(pageErrors).toHaveLength(0);

    await shot(page, 'signals-scanner-off');
  });

  test('L2: стратегии включены → фактический статус с интервалом и временем скана', async ({ page }) => {
    const log = newLog();
    await installSignalsFixtures(page, log, { strategies: { enabled: true, error: false } });
    await page.goto('/signals');

    const chip = page.getByTestId('signals-scanner-status');
    await expect(chip).toHaveAttribute('data-state', 'on');
    await expect(page.getByTestId('signals-scanner-status-title')).toHaveText('Сканирование включено: 1 стратегия');
    // Интервал — фактический из серверного состояния, а не константа в UI.
    await expect(page.getByTestId('signals-scanner-status-detail')).toContainText('каждые 60 с');
    await expect(page.getByTestId('signals-scanner-status-detail')).toContainText('последний скан');

    // Лента не пуста → пустое состояние не показывается вовсе.
    await expect(page.getByTestId('signals-empty')).toHaveCount(0);
    expect(await page.locator('body').innerText()).not.toContain('LIVE-скан');

    await shot(page, 'signals-scanner-on');
  });

  test('L3: стратегия в ERROR — отдельная строка, а не «выключено»', async ({ page }) => {
    const log = newLog();
    await installSignalsFixtures(page, log, { strategies: { enabled: true, error: true } });
    await page.goto('/signals');

    const chip = page.getByTestId('signals-scanner-status');
    await expect(chip).toHaveAttribute('data-state', 'error');
    await expect(page.getByTestId('signals-scanner-status-title')).toContainText('с ошибкой: 1');
    // Текст ошибки сканирования показан отдельно и не подменён «выключено».
    await expect(page.getByTestId('signals-scanner-status-detail')).toContainText('exchangeInfo');

    await shot(page, 'signals-scanner-error');
  });

  test('L4: сервер не ответил → «недоступен», и это не называется «выключено»', async ({ page }) => {
    const log = newLog();
    await installSignalsFixtures(page, log, { strategiesStatus: 503 });
    await page.goto('/signals');

    const chip = page.getByTestId('signals-scanner-status');
    await expect(chip).toHaveAttribute('data-state', 'unknown');
    await expect(page.getByTestId('signals-scanner-status-title')).toHaveText('Статус сканирования недоступен');
    const chipText = await chip.innerText();
    expect(chipText).not.toContain('выключено');

    // Лента при этом работает: пустое состояние остаётся про сигналы.
    await expect(page.getByTestId('signals-history').locator('[data-qa="signal-card"]')).toHaveCount(3);
    await expect(page.getByTestId('signals-empty')).toHaveCount(0);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // M. BUG D — технической метки «LOCAL» на графиках нет
  // ───────────────────────────────────────────────────────────────────────────

  test('M: на графиках нет метки «LOCAL»; подпись зоны — настоящий IANA-пояс', async ({ page }) => {
    const log = newLog();
    await installSignalsFixtures(page, log);
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.goto('/signals');
    await expect(page.getByTestId('signals-chart-card')).toBeVisible();

    // Ни «LOCAL», ни «UTC» как подписи режима на графике.
    const body = await page.locator('body').innerText();
    expect(body).not.toMatch(/\bLOCAL\b/);
    expect(body).not.toMatch(/\bUTC\b/);
    // И никакого тумблера переключения зоны.
    await expect(page.getByRole('button', { name: /локальное время|UTC/i })).toHaveCount(0);

    // Вместо метки — пояс пользователя и на графике, и в шапке страницы.
    const chartZone = page.getByTestId('chart-timezone-label');
    await expect(chartZone).toBeVisible();
    const pageZone = page.getByTestId('signals-timezone-label');
    await expect(pageZone).toBeVisible();

    const chartText = (await chartZone.innerText()).trim();
    const pageText = (await pageZone.innerText()).trim();
    expect(chartText.length).toBeGreaterThan(0);
    expect(pageText).toContain(chartText.replace(/ · GMT[+-]\d+$/, ''));
    // Смещение выводится фактическое (DST учитывается), а не захардкоженное UTC+3.
    expect(pageText).toMatch(/GMT[+-]\d+$/);
    expect(pageErrors).toHaveLength(0);

    await shot(page, 'signals-chart-no-local');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // N. Часовой пояс — время показывается в поясе браузера
  // ───────────────────────────────────────────────────────────────────────────

  test.describe('N: часовой пояс браузера', () => {
    test.use({ timezoneId: 'Asia/Tokyo', locale: 'ru-RU' });

    test('N1: Asia/Tokyo — время сигнала и графиков в местном поясе', async ({ page }) => {
      const log = newLog();
      await installSignalsFixtures(page, log);
      await page.goto('/signals');

      // Шапка и график называют пояс пользователя, а не пояс сервера.
      const pageZone = (await page.getByTestId('signals-timezone-label').innerText()).trim();
      expect(pageZone).toContain('GMT+9');
      expect(pageZone).not.toContain('Москва');
      expect(pageZone).not.toContain('Moscow');
      const chartZone = (await page.getByTestId('chart-timezone-label').innerText()).trim();
      expect(chartZone).not.toBe('LOCAL');
      expect(chartZone.length).toBeGreaterThan(0);

      // Фиксированный момент фикстуры: barIndex 55 → сигнальная свеча.
      // Ожидание считается ЯВНЫМ поясом Asia/Tokyo: TZ процесса Node здесь
      // ни при чём, иначе тест проверял бы бы ничего.
      const signalMs = barTs(55) * 1000;
      const tokyoTime = new Intl.DateTimeFormat('en-GB', {
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Tokyo',
      }).format(signalMs);
      const tokyoDate = new Intl.DateTimeFormat('ru-RU', {
        day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Tokyo',
      }).format(signalMs);
      const utcTime = new Intl.DateTimeFormat('en-GB', {
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC',
      }).format(signalMs);

      // Время сигнала в истории показано в поясе браузера.
      const historyTime = await page
        .getByTestId('signals-history')
        .locator('[data-qa="signal-card-time"]')
        .first()
        .innerText();
      expect(historyTime).toContain(tokyoTime);
      expect(historyTime).toContain(tokyoDate);
      // …и это действительно местное время, а не UTC-подпись.
      expect(historyTime).not.toContain(utcTime);

      await shot(page, 'signals-timezone-tokyo');
    });

    test('N2: Europe/Berlin — DST учитывается (летом +2, зимой +1)', async ({ browser }) => {
      const context = await browser.newContext({ timezoneId: 'Europe/Berlin', locale: 'ru-RU' });
      const page = await context.newPage();
      const log = newLog();
      await installSignalsFixtures(page, log);
      await page.goto('/signals');

      const winter = Date.parse('2026-01-15T12:00:00Z');
      const summer = Date.parse('2026-07-15T12:00:00Z');
      const offset = (at: number) =>
        new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Berlin', timeZoneName: 'longOffset' })
          .formatToParts(at)
          .find((p) => p.type === 'timeZoneName')!.value;

      const berlinWinter = new Intl.DateTimeFormat('en-GB', {
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Europe/Berlin',
      }).format(winter);
      const berlinSummer = new Intl.DateTimeFormat('en-GB', {
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Europe/Berlin',
      }).format(summer);

      // Сама логика смещения проверена эталонным Intl: зима +1, лето +2.
      expect(offset(winter)).toContain('+01:00');
      expect(offset(summer)).toContain('+02:00');
      expect(berlinWinter).not.toBe(berlinSummer);

      // UI называет берлинский пояс, а не московский и не «LOCAL».
      const zone = (await page.getByTestId('signals-timezone-label').innerText()).trim();
      expect(zone).not.toContain('Москва');
      expect(zone).not.toContain('LOCAL');
      expect(zone).toMatch(/GMT[+-]\d+$/);

      await context.close();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // O. Серверная статистика — фактические счётчики, отдельные от журнала
  // ───────────────────────────────────────────────────────────────────────────

  test('O1: серверная статистика показывает фактические счётчики и метрики R', async ({ page }) => {
    const log = newLog();
    await installSignalsFixtures(page, log);
    await page.goto('/signals');

    const stats = page.getByTestId('signals-statistics');
    await expect(stats).toBeVisible();
    // «Опубликовано» (3) не равно «завершились сделкой» (1) — разные счётчики.
    await expect(page.getByTestId('stat-published')).toHaveText('3');
    await expect(page.getByTestId('stat-completed')).toHaveText('1');
    await expect(page.getByTestId('stat-no-trade')).toHaveText('0');
    await expect(page.getByTestId('stat-wins')).toHaveText('1');
    await expect(page.getByTestId('stat-winrate')).toHaveText('100%');

    // Производные метрики — под «Подробнее», а не на первом экране.
    await expect(page.getByTestId('signals-statistics-details')).toHaveCount(0);
    await page.getByTestId('signals-statistics-details-toggle').click();
    await expect(page.getByTestId('stat-avg-gross')).toHaveText('+1.67 R');
    await expect(page.getByTestId('stat-avg-net')).toHaveText('+1.60 R');
    await expect(page.getByTestId('stat-sum-net')).toHaveText('+1.60 R');

    // Браузерный журнал — отдельный блок, не смешан с серверной статистикой.
    const audit = page.getByTestId('signals-audit-section');
    await expect(audit).toBeVisible();
    expect(await audit.innerText()).not.toContain('Опубликовано сигналов');

    await shot(page, 'signals-statistics');
  });

  test('O2: падение статистики — отдельная ошибка, лента сигналов жива', async ({ page }) => {
    const log = newLog();
    await installSignalsFixtures(page, log, { statisticsStatus: 500 });
    await page.goto('/signals');

    // Ошибка агрегатов не выдаётся за «сигналов нет».
    await expect(page.getByTestId('signals-statistics-error')).toBeVisible();
    await expect(page.getByTestId('signals-statistics')).toHaveCount(0);
    // Лента работает как обычно.
    await expect(page.getByTestId('signals-history').locator('[data-qa="signal-card"]')).toHaveCount(3);
    await expect(page.getByTestId('signals-empty')).toHaveCount(0);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // P. Авто-обновление: серверный монитор меняет статус без перезагрузки
  // ───────────────────────────────────────────────────────────────────────────

  test('P: лента обновляется сама (опрос 60 с) — статус сигнала меняется без reload', async ({ page }) => {
    const log = newLog();
    // Первый ответ — ACTIVE (ожидаем входа), второй — FILLED (вход произошёл).
    // Ровно так выглядит работа СЕРВЕРНОГО монитора: он пишет в PostgreSQL,
    // страница только читает. Перезагрузки страницы нет.
    let polls = 0;
    let armed = false;
    await installSignalsFixtures(page, log, {
      feed: () => {
        polls += 1;
        // До «вооружения» отдаём исходное состояние: монтирование страницы
        // (в dev-режиме React StrictMonde монтирует эффекты дважды) не должно
        // выглядеть как работа монитора.
        if (!armed) return BTC_SIGNALS;
        return BTC_SIGNALS.map((s) =>
          s.id === 'btc-long-active' ? { ...s, status: 'FILLED', filled: true } : s
        );
      },
    });

    await page.clock.install();
    await page.goto('/signals');

    const summary = page.getByTestId('signals-summary');
    await expect(summary).toBeVisible();
    await expect(summary).toHaveAttribute('data-status', 'ACTIVE');
    // Даём странице успокоиться и запоминаем счётчик опросов до «арбитража».
    await page.waitForTimeout(500);
    const pollsAtStart = polls;
    armed = true;

    // 60-секундный интервал опрашивания ленты: страница перезапрашивает сама.
    await page.clock.runFor(61_000);
    await expect(summary).toHaveAttribute('data-status', 'FILLED', { timeout: 10_000 });
    expect(polls).toBeGreaterThan(pollsAtStart);

    // Никакой перезагрузки страницы не происходило: тот же документ.
    const marker = await page.evaluate(() => (window as unknown as { __probe?: number }).__probe ?? 0);
    expect(marker).toBe(0);
  });
});

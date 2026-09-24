/** @vitest-environment node */
/**
 * CRYPTORA — Сквозной сценарий стажинга: включённая стратегия → планировщик →
 * `scanNow()` → НАСТОЯЩЕЕ ядро → НАСТОЯЩИЙ PostgreSQL (F-01, F-05, F-10, F-13).
 *
 * Это единственный тест, который проходит ВСЮ серверную цепочку целиком на
 * настоящей базе:
 *
 *   strategy_settings.enabled = TRUE (через админ-API, как это делает владелец)
 *     → StrategyScheduler.tick()  (тот же класс-синглтон, которым владеет
 *                                  server/index.js; timers не поднимаются)
 *     → scanStrategySafely → runStrategyScan → ядро.scanNow()
 *     → signalRepository.insertSignal → PostgreSQL
 *     → strategy_settings.last_scan_at / last_error
 *     → GET /api/strategies, GET /api/admin/strategies/status, GET /api/signals
 *
 * Подменяется ТОЛЬКО сетевой слой рыночных данных (Binance klines и
 * exchangeInfo из песочницы и CI недоступны) — две точки подмены, обе помечены
 * ниже. Математика стратегий не меняется: ядро настоящее, собранное esbuild из
 * `src/`, свечи детерминированные.
 *
 * Чего здесь НЕТ и почему. Синтетические свечи не удовлетворяют условиям
 * замороженных стратегий, поэтому реальное ядро сетап не публикует: проверить
 * «ядро издало сетап на живых данных» можно только на стейджинге с настоящим
 * Binance (порядок — docs/STRATEGY_OPERATIONS.md §10). Всё остальное звено
 * записи доказано здесь же: функция движка `buildSignalRecord` (настоящая, не
 * копия) → `insertSignal` → БД → API, включая дедупликацию повторной записи и
 * сохранение всей лестницы целей (TP3). Хранение сетапов и жизненный цикл на
 * настоящей БД — tests/integration/strategyOperations.test.ts.
 *
 * Окружение node обязательно: сборка бандла esbuild в jsdom падает на
 * собственном инварианте TextEncoder (см. strategyEngineCore.test.ts, F-03).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { startPgHarness, type PgHarness } from '../helpers/embeddedPgHarness';

let H: PgHarness | null = null;
let skipReason: string | null = null;

// Серверные модули импортируются ПОСЛЕ установки DATABASE_URL (см. хелпер).
let schedulerMod: any = null;
let fetcherMod: any = null;
let engineMod: any = null;
let coreMod: any = null;
let signalRepoMod: any = null;
let catalogMod: any = null;
let universeMod: any = null;

let core: any = null;
let loadError: string | null = null;

const ADMIN = { email: 'sched-admin@test.local', password: 'Str0ngPass!234' };
const V30 = 'V3_0_HTF_LIQUIDATION_TRAP';

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/* -------------------------------------------------------------------------- */
/* Точка подмены №1: klines Binance                                            */
/* -------------------------------------------------------------------------- */

/**
 * Детерминированная синтетическая серия (без Math.random — RULES §2).
 * Форма ответа — сырой Binance klines: [openTime, o, h, l, c, v, closeTime, …].
 * Последний бар — формирующийся (как отдаёт эндпоинт): ядро обязано само
 * отсечь его, иначе был бы look-ahead.
 */
const klines = (interval: '1h' | '4h' | '1d', limit: number, nowMs: number) => {
  const stepMs = interval === '1d' ? DAY_MS : interval === '4h' ? 4 * HOUR_MS : HOUR_MS;
  const currentOpen = Math.floor(nowMs / stepMs) * stepMs;
  const first = currentOpen - (limit - 1) * stepMs;
  const out: number[][] = [];
  for (let i = 0; i < limit; i++) {
    const openTime = first + i * stepMs;
    const price = (k: number) =>
      100 * (1 + 0.012 * Math.sin(k / 9) + 0.004 * Math.sin(k / 2.7) + 0.00006 * k);
    const open = price(i);
    const close = price(i + 1);
    const high = Math.max(open, close) * 1.004;
    const low = Math.min(open, close) * 0.996;
    const volume = 120 + 40 * Math.abs(Math.sin(i / 6));
    out.push([
      openTime,
      Number(open.toFixed(4)),
      Number(high.toFixed(4)),
      Number(low.toFixed(4)),
      Number(close.toFixed(4)),
      Number(volume.toFixed(4)),
      openTime + stepMs - 1,
      Number((volume * close).toFixed(2)),
      500,
      Number((volume * 0.4).toFixed(4)),
      Number((volume * 0.4 * close).toFixed(2)),
      0,
    ]);
  }
  return out;
};

type Restore = () => void;
let restoreTransport: Restore = () => {};
let restoreUniverse: Restore = () => {};

/**
 * Подменяет транспорт у ТОГО ЖЕ синглтона фетчера, которым пользуется движок
 * приложения (`getMarketDataFetcher()`): планировщик и маршруты не принимают
 * инжектируемый транспорт, поэтому seam один и он помечен.
 */
function installTransport(opts: { failFor?: RegExp } = {}): Restore {
  const fetcher = fetcherMod.getMarketDataFetcher();
  const original = fetcher.fetchFn;
  fetcher.fetchFn = (async (url: string) => {
    const q = new URL(url).searchParams;
    const symbol = q.get('symbol') ?? '';
    const interval = (q.get('interval') ?? '1h') as '1h' | '4h' | '1d';
    const limit = Number(q.get('limit') ?? 1000);
    if (opts.failFor?.test(symbol)) {
      return { ok: false, status: 503, json: async () => ({ msg: 'Service unavailable' }) };
    }
    return { ok: true, status: 200, json: async () => klines(interval, limit, Date.now()) };
  }) as any;
  fetcher.clearCache();
  return () => {
    fetcher.fetchFn = original;
    fetcher.clearCache();
  };
}

/* -------------------------------------------------------------------------- */
/* Точка подмены №2: exchangeInfo (активный Spot-universe)                     */
/* -------------------------------------------------------------------------- */

/**
 * Без активного Spot-universe `resolveScanSymbols` честно отказывает скану
 * («exchangeInfo недоступен — скан пропущен»), поэтому фикстура обязательна:
 * она имитирует биржу, а не отключает проверку.
 */
function installActiveSpot(bases: string[]): Restore {
  const exchangeInfo = {
    symbols: bases.map((b) => ({
      symbol: `${b}USDT`,
      baseAsset: b,
      quoteAsset: 'USDT',
      status: 'TRADING',
      isSpotTradingAllowed: true,
    })),
  };
  const spot = new universeMod.UniverseCache({
    url: 'fixture://spot',
    transform: (body: any) => {
      const list = universeMod.filterActiveSpotUsdt(body);
      if (!list.length) throw new Error('fixture universe is empty');
      return list;
    },
    fetchFn: async () => ({ ok: true, json: async () => exchangeInfo }),
  });
  const restore = () => universeMod.__resetUniverseCachesForTests({});
  universeMod.__resetUniverseCachesForTests({ spot });
  return restore;
}

/* -------------------------------------------------------------------------- */
/* Обвязка                                                                     */
/* -------------------------------------------------------------------------- */

beforeAll(async () => {
  const started = await startPgHarness({ prefix: 'cryptora-sched-' });
  if (!started.ok) {
    skipReason = started.skipReason;
    return;
  }
  H = started.harness;
  await H.registerAndVerify(ADMIN.email, ADMIN.password, 'admin');

  schedulerMod = await import('../../server/services/strategyEngine/strategyScheduler.js');
  fetcherMod = await import('../../server/services/strategyEngine/marketDataFetcher.js');
  engineMod = await import('../../server/services/strategyEngine/strategyEngine.js');
  coreMod = await import('../../server/services/strategyEngine/strategyCoreBundle.js');
  signalRepoMod = await import('../../server/services/signalRepository.js');
  catalogMod = await import('../../server/services/strategyCatalog.js');
  universeMod = await import('../../server/services/exchangeUniverse.js');

  try {
    core = await coreMod.loadStrategyCore();
  } catch (e) {
    loadError = e instanceof Error ? e.message : String(e);
  }
}, 300_000);

afterAll(async () => {
  restoreTransport();
  restoreUniverse();
  try {
    schedulerMod?.resetStrategyScheduler?.();
  } catch { /* синглтон не создавался */ }
  if (H) await H.close();
});

beforeEach(async () => {
  if (!H) return;
  restoreTransport();
  restoreUniverse();
  schedulerMod.resetStrategyScheduler();
  core?.LiveSignalEngine?.resetInstance?.();
  core?.SignalsAuditLedger?.resetInstance?.();
  // Состояние «как после миграции»: всё выключено, телеметрия пустая, сигналов нет.
  await H.db.query(
    `UPDATE strategy_settings
        SET enabled = FALSE, last_error = NULL, last_scan_at = NULL, last_signal_at = NULL`
  );
  await H.db.query('DELETE FROM signals');
  restoreUniverse = installActiveSpot(['BTC', 'ETH']);
  restoreTransport = installTransport();
});

/** Пропуск через `ctx.skip()`, а не «предупреждение в stderr и успех» (F-03). */
const guard = (ctx: any): boolean => {
  if (skipReason) {
    ctx.skip();
    return true;
  }
  return false;
};

/** Тест выполняется, только если ядро загрузилось; иначе честный skip. */
const withCore = (name: string, fn: (ctx: any) => Promise<void>, timeout = 180_000) =>
  it(
    name,
    async (ctx) => {
      if (guard(ctx)) return;
      if (!core) {
        ctx.skip();
        return;
      }
      await fn(ctx);
    },
    timeout
  );

/** Ждём завершения сканов, запущенных `tick()` (он не возвращает промисы). */
async function drain(scheduler: any, timeoutMs = 180_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (scheduler.stats.inFlight.length > 0) {
    if (Date.now() > deadline) {
      throw new Error(`скан не завершился за ${timeoutMs} мс: ${scheduler.stats.inFlight.join(', ')}`);
    }
    await new Promise((r) => setTimeout(r, 25));
  }
}

/**
 * Состояние ядра, которое вернул последний вызов `getStatus()`.
 *
 * Движок scan-scoped, поэтому спросить состояние у статического синглтона
 * после скана нельзя — его там нет. Наблюдаемость берётся с прототипа: так же
 * проверяется, что сервер действительно работает с ЭКЗЕМПЛЯРОМ ядра.
 */
function lastStatus(spy: any): any {
  const results = spy.mock.results;
  const last = results[results.length - 1];
  expect(last, 'getStatus() обязан быть вызван на экземпляре скана').toBeTruthy();
  return last.value;
}

async function telemetry(strategyId: string) {
  const rows = await H!.q(
    `SELECT enabled, last_scan_at, last_error, last_signal_at, scan_interval_seconds
       FROM strategy_settings WHERE strategy_id = $1`,
    [strategyId]
  );
  return rows[0];
}

/** Включает стратегию через настоящий админ-API (как это делает владелец). */
async function enableViaAdminApi(strategyId: string) {
  const admin = await H!.login(ADMIN.email, ADMIN.password);
  const res = await admin.patch(`/api/admin/strategies/${strategyId}`, { enabled: true });
  expect(res.status, `PATCH enabled: ${JSON.stringify(res.body)}`).toBe(200);
  expect((res.body as any).enabled).toBe(true);
  return admin;
}

describe('Сквозной сценарий: планировщик → ядро → PostgreSQL', () => {
  it('ядро загружено — иначе цепочка ниже непроверяема', (ctx) => {
    if (guard(ctx)) return;
    if (loadError) throw new Error(`Ядро стратегий не загрузилось: ${loadError}`);
    expect(core).toBeTruthy();
    expect(typeof core.LiveSignalEngine.prototype.scanNow).toBe('function');
  });

  withCore('включённая стратегия запускается планировщиком: last_scan_at продвигается, last_error = null', async () => {
    const admin = await enableViaAdminApi(V30);
    // Ограничиваем universe одним символом: скан детерминирован и быстр.
    await H!.db.query(`UPDATE strategy_settings SET symbols = $2 WHERE strategy_id = $1`, [
      V30,
      JSON.stringify(['BTCUSDT']),
    ]);

    const startedAt = new Date();
    const scheduler = schedulerMod.getStrategyScheduler();
    expect(scheduler.stats.running, 'тест не поднимает таймеры приложения').toBe(false);

    const statusSpy = vi.spyOn(core.LiveSignalEngine.prototype, 'getStatus');
    const cycle = await scheduler.tick();
    expect(cycle.launched, 'включённая стратегия обязана быть запущена').toContain(V30);
    await drain(scheduler);

    const row = await telemetry(V30);
    expect(row.enabled).toBe(true);
    expect(row.last_scan_at, 'last_scan_at обязан появиться после скана').not.toBeNull();
    expect(new Date(row.last_scan_at).getTime()).toBeGreaterThanOrEqual(startedAt.getTime() - 1000);
    expect(row.last_error, 'успешный скан не оставляет ошибку в телеметрии').toBeNull();
    expect(row.last_signal_at, 'синтетика не даёт сетапов: сигналов нет, и это честно').toBeNull();

    // Состояние рантайма ядра продвинулось (F-01: раньше скан падал с
    // TypeError). Движок scan-scoped (`new LiveSignalEngine`), поэтому
    // состояние прошедшего скана берётся с ЭКЗЕМПЛЯРА, а не из статического
    // синглтона: `getInstance()` после серверного скана обязан быть пуст.
    expect(core.LiveSignalEngine.getInstance(), 'серверный скан не пользуется статическим синглтоном').toBeNull();
    const status = lastStatus(statusSpy);
    expect(status.scanning).toBe(false);
    expect(status.lastError, 'ядро не сообщает об ошибке скана').toBeNull();
    expect(status.scanCount, 'ядро действительно выполнило проход').toBeGreaterThanOrEqual(1);
    statusSpy.mockRestore();

    // Публичный и админский статус отражают реальное состояние.
    const publicStrategies = await H!.client.get('/api/strategies');
    const v30 = (publicStrategies.body as any).strategies.find((s: any) => s.strategyId === V30);
    expect(v30.status).toBe('ON');

    const adminStatus = await admin.get('/api/admin/strategies/status');
    expect(adminStatus.status).toBe(200);
    expect((adminStatus.body as any).enabledCount).toBe(1);
    expect((adminStatus.body as any).errorCount).toBe(0);
    expect((adminStatus.body as any).scheduler.cycles).toBeGreaterThanOrEqual(1);
    expect((adminStatus.body as any).scheduler.inFlight).toEqual([]);
    expect((adminStatus.body as any).lastScanAt, 'сводка берёт время из БД').not.toBeNull();

    const signals = await H!.client.get('/api/signals');
    expect((signals.body as any).total, 'на синтетических свечах сетапов нет').toBe(0);
  });

  withCore('повторный скан уважает интервал и не дублирует: телеметрия движется, строк не прибавляется', async () => {
    await enableViaAdminApi(V30);
    await H!.db.query(`UPDATE strategy_settings SET symbols = $2 WHERE strategy_id = $1`, [
      V30,
      JSON.stringify(['BTCUSDT']),
    ]);

    // Своя инстанция планировщика с управляемыми часами: тот же класс, те же
    // настоящие getEnabledStrategies/resolveScanSymbols/scanStrategySafely,
    // но без ожидания реального интервала и без таймеров.
    let clock = Date.parse('2026-09-20T12:00:00Z');
    const scheduler = new schedulerMod.StrategyScheduler({ now: () => clock });

    const statusSpy2 = vi.spyOn(core.LiveSignalEngine.prototype, 'getStatus');
    const first = await scheduler.tick();
    expect(first.launched).toContain(V30);
    await drain(scheduler);
    const afterFirst = await telemetry(V30);
    expect(afterFirst.last_error).toBeNull();
    const firstScanAt = new Date(afterFirst.last_scan_at).getTime();

    // Интервал ещё не прошёл — скан пропускается, телеметрия не переписывается.
    const tooSoon = await scheduler.tick();
    expect(tooSoon.launched, 'до истечения интервала новый скан не запускается').toEqual([]);
    expect(tooSoon.skippedNotDue).toContain(V30);
    await drain(scheduler);
    expect(new Date((await telemetry(V30)).last_scan_at).getTime()).toBe(firstScanAt);

    // Интервал прошёл — скан повторяется. Дублей нет: UNIQUE из миграции 007
    // и ключ (strategy_id, symbol, timeframe, signal_candle_ts) срабатывают.
    clock += (Number(afterFirst.scan_interval_seconds) + 1) * 1000;
    const second = await scheduler.tick();
    expect(second.launched).toContain(V30);
    await drain(scheduler);

    const afterSecond = await telemetry(V30);
    expect(afterSecond.last_error, 'повторный скан тоже успешен').toBeNull();
    expect(new Date(afterSecond.last_scan_at).getTime(), 'время скана продвинулось').toBeGreaterThan(
      firstScanAt
    );

    const { rows } = await H!.db.query('SELECT COUNT(*)::int AS n FROM signals');
    expect(rows[0].n, 'повторный скан не создал строк').toBe(0);
    // Движок создаётся ЗАНОВО на каждый скан (scan-scoped контекст), поэтому
    // счётчик снова 1; источник истины о повторах — строки в БД.
    expect(lastStatus(statusSpy2).scanCount).toBe(1);
    statusSpy2.mockRestore();
  });

  withCore('отказ рыночных данных попадает в last_error и в статус ERROR, а не превращается в «сигналов нет»', async () => {
    const admin = await enableViaAdminApi(V30);
    await H!.db.query(`UPDATE strategy_settings SET symbols = $2 WHERE strategy_id = $1`, [
      V30,
      JSON.stringify(['BTCUSDT']),
    ]);
    restoreTransport();
    restoreTransport = installTransport({ failFor: /./ });

    const scheduler = schedulerMod.getStrategyScheduler();
    const cycle = await scheduler.tick();
    expect(cycle.launched).toContain(V30);
    await drain(scheduler);

    const row = await telemetry(V30);
    expect(row.last_scan_at, 'время попытки фиксируется и при отказе').not.toBeNull();
    expect(row.last_error, 'отказ источника виден в телеметрии').toMatch(/MARKET_DATA_UNAVAILABLE|unavailable/i);
    expect(row.last_error).not.toMatch(/secret|password|token/i);

    const strategies = (await H!.client.get('/api/strategies')).body as any;
    expect(strategies.strategies.find((s: any) => s.strategyId === V30).status).toBe('ERROR');

    const adminStatus = (await admin.get('/api/admin/strategies/status')).body as any;
    expect(adminStatus.errorCount).toBe(1);
    expect(adminStatus.enabledCount).toBe(1);
    expect(((await H!.client.get('/api/signals')).body as any).total).toBe(0);

    // Процесс жив: следующий запрос обрабатывается (F-17 не маскирует отказ).
    expect((await H!.client.get('/api/strategies')).status).toBe(200);
  });

  withCore('неизвестный активный universe не роняет цикл: ошибка записана, другие стратегии не задеты', async () => {
    await enableViaAdminApi(V30);
    await H!.db.query(`UPDATE strategy_settings SET symbols = $2 WHERE strategy_id = $1`, [
      V30,
      JSON.stringify(['BTCUSDT']),
    ]);
    // exchangeInfo недоступен ⇒ resolveScanSymbols честно отказывает скану.
    universeMod.__resetUniverseCachesForTests({
      spot: new universeMod.UniverseCache({
        url: 'fixture://spot-down',
        transform: () => {
          throw new Error('exchangeInfo unavailable');
        },
        fetchFn: async () => ({ ok: false, status: 503, json: async () => ({}) }),
      }),
    });

    const scheduler = schedulerMod.getStrategyScheduler();
    await scheduler.tick();
    await drain(scheduler);

    const row = await telemetry(V30);
    expect(row.last_error, 'отказ universe виден в телеметрии').toMatch(/unavailable/i);
    const others = await H!.q(
      `SELECT strategy_id, last_scan_at, last_error FROM strategy_settings WHERE strategy_id <> $1`,
      [V30]
    );
    expect(others.length).toBe(2);
    for (const o of others) {
      expect(o.last_scan_at, 'выключенные стратегии не сканируются').toBeNull();
      expect(o.last_error).toBeNull();
    }
    // Фикстуру восстанавливает beforeEach следующего теста.
  });

  withCore('запись движка доходит до БД и API целиком: лестница из 3 целей, дедупликация, TP3 в ответе', async () => {
    const meta = catalogMod.getStrategy(V30);
    const setupBar = Date.parse('2026-09-19T10:00:00Z');
    /** Сетап в той форме, в которой его публикует ledger ядра. */
    const setup = {
      id: `V3_0-BTCUSDT-${setupBar}`,
      strategyId: V30,
      strategyVersion: meta.version,
      symbol: 'BTC/USDT',
      direction: 'LONG',
      timeframe: '1h',
      setupOpenTime: setupBar,
      entryType: 'LIMIT_CORRIDOR',
      entryZone: [115_200.5, 115_480.25],
      invalidationLevel: 114_310.75,
      targets: [116_900.5, 118_400.25, 121_050.0],
      riskRewardRatio: 1.94,
      confirmingFactors: ['SWEEP_OF_PRIOR_LOW', 'HTF_ZONE_ALIGNED'],
      invalidationFactors: [],
      exitRule: 'TP1 → BE, далее трейлинг по структуре',
      validForBars: 3,
      createdAt: '2026-09-19T11:00:05Z',
      latencyBars: 0,
      status: 'ACTIVE',
    };

    // Настоящая функция движка — та самая, которой пользуется runStrategyScan.
    const built = engineMod.buildSignalRecord({
      setup,
      strategyId: V30,
      fallbackVersion: meta.version,
      engineKey: engineMod.ENGINE_STRATEGY_KEY[V30],
      execTf: meta.execTimeframe,
    });
    expect(built, 'сетап с валидным setupOpenTime обязан получить запись').not.toBeNull();
    expect(built.setupOpenTime).toBe(setupBar);
    expect(built.record.targets).toEqual([116_900.5, 118_400.25, 121_050.0]);

    const first = await signalRepoMod.insertSignal(built.record);
    expect(first.inserted, 'первая запись сохранена').toBe(true);

    // Повторный скан того же бара: тот же ключ ⇒ дубль не создаётся (F-05).
    const again = await signalRepoMod.insertSignal(built.record);
    expect(again.inserted, 'повторная запись того же бара не создаёт вторую строку').toBe(false);
    const { rows } = await H!.db.query('SELECT COUNT(*)::int AS n FROM signals');
    expect(rows[0].n).toBe(1);

    // Сквозная проверка: БД → API. TP3 не теряется (F-06).
    const page = (await H!.client.get('/api/signals?symbol=BTCUSDT')).body as any;
    expect(page.total).toBe(1);
    const dto = page.signals[0];
    expect(dto.strategyId).toBe(V30);
    expect(dto.symbol).toBe('BTC/USDT');
    expect(dto.timeframe).toBe('1h');
    expect(dto.direction).toBe('LONG');
    expect(dto.status).toBe('ACTIVE');
    expect(dto.signalCandleTs).toBe(new Date(setupBar).toISOString());
    expect(dto.entryMin).toBe(115_200.5);
    expect(dto.entryMax).toBe(115_480.25);
    expect(dto.stopLoss).toBe(114_310.75);
    expect(dto.targets).toHaveLength(3);
    expect(Number(dto.targets[2]), 'TP3 доходит до клиента').toBe(121_050.0);
    expect(dto.tp1).toBe(116_900.5);
    expect(dto.tp2).toBe(118_400.25);
    expect(dto.metadata.riskRewardRatio).toBe(1.94);

    const strategies = (await H!.client.get('/api/strategies')).body as any;
    expect(strategies.strategies.find((s: any) => s.strategyId === V30).activeSignalCount).toBe(1);
  });
});

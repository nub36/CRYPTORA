/** @vitest-environment node */
/**
 * CRYPTORA — Контракт серверного движка стратегий (F-01, F-05, F-06, F-08).
 *
 * Что проверяется и почему именно так:
 *
 *  • движок вызывает РЕАЛЬНО существующий метод ядра `scanNow()` — раньше он
 *    звал `scanOnce()`, которого в `LiveSignalEngine` никогда не было: каждый
 *    скан падал с TypeError, а планировщик выглядел живым (F-01);
 *  • отказ рыночных данных пробрасывается НАРУЖУ до скана, а не превращается в
 *    «сетапов нет» — ядро глотает ошибки по каждому символу внутри scanSymbol();
 *  • ключ дедупликации — `setupOpenTime` закрытого бара: повторный скан и
 *    рестарт процесса дают тот же ключ, поэтому UNIQUE из миграции 007
 *    срабатывает, а дубль не создаётся (F-05);
 *  • в БД уходит ВСЯ лестница целей ядра, а не только первые два уровня (F-06);
 *  • жизненный цикл переносится из ретроспективы ядра как есть: R, стоп и цели
 *    здесь НЕ пересчитываются, а отсутствующая в БД запись не выдумывается.
 *
 * Ядро и репозиторий здесь подставные, и это сознательно: математика стратегий
 * заморожена и проверяется своими тестами (tests/unit/liveSignalEngine.test.ts,
 * tests/integration/strategyEngineCore.test.ts), а сохранение в настоящей БД —
 * tests/integration/strategyOperations.test.ts и сквозной сценарий
 * tests/integration/schedulerPersistence.test.ts. Этот файл фиксирует СТЫКИ
 * между ними детерминированно и без сети.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

/* -------------------------------------------------------------------------- */
/* Подстановки                                                                 */
/* -------------------------------------------------------------------------- */

const h = vi.hoisted(() => {
  /** Состояние подставного ядра. Формы полей — как в настоящих типах. */
  const state = {
    /** Что ядро «находит» на этом скане: scanNow() публикует их в ledger. */
    pendingSetups: [] as any[],
    /** AnalyticalSetup[] в ledger (resetInstance() его очищает). */
    setups: [] as any[],
    /** ReplayRecord[] — ретроспектива окна. */
    records: [] as any[],
    /** EngineStatus, который вернёт getStatus(). */
    status: null as any,
    scanNowCalls: 0,
    engineResets: 0,
    ledgerResets: 0,
    instanceConfig: null as any,
    retrospectiveFilter: null as any,
    /** Если задано, scanNow() бросает именно эту ошибку. */
    scanThrows: null as Error | null,
  };

  const repo = {
    insertCalls: [] as any[],
    /** Очередь ответов insertSignal; по умолчанию { inserted: true }. */
    insertResults: [] as Array<{ inserted: boolean }>,
    listOpenCalls: [] as Array<{ strategyId: string; limit: number }>,
    openRows: [] as any[],
    syncCalls: [] as any[],
    syncResults: [] as Array<{ changed: boolean }>,
    activeCount: 0,
  };

  const settings = {
    recordScanCalls: [] as any[],
    recordSignalCalls: [] as any[],
  };

  return { state, repo, settings };
});

/**
 * Подставное ядро повторяет форму собранного бандла
 * (server/services/strategyEngine/entry.ts): те же экспорты, те же имена.
 */
vi.mock('../../server/services/strategyEngine/strategyCoreBundle.js', () => {
  const ARCHIVE_TF_MS = { '1h': 3_600_000, '4h': 14_400_000, '1d': 86_400_000 };

  const makeEngine = (config: any) => ({
    scanNow: async () => {
      h.state.scanNowCalls++;
      h.state.instanceConfig = config;
      if (h.state.scanThrows) throw h.state.scanThrows;
      // Настоящий scanNow() публикует сетапы последнего закрытого бара в ledger.
      h.state.setups = [...h.state.pendingSetups];
    },
    getStatus: () => h.state.status,
    getRetrospective: (filter?: any) => {
      h.state.retrospectiveFilter = filter ?? null;
      return h.state.records;
    },
  });

  return {
    loadStrategyCore: async () => ({
      LiveSignalEngine: {
        resetInstance: () => {
          h.state.engineResets++;
        },
        getInstance: (config: any) => makeEngine(config),
      },
      SignalsAuditLedger: {
        resetInstance: () => {
          h.state.ledgerResets++;
          // Сброс журнала — то, что делает настоящий resetInstance: чужие
          // сетапы прошлого скана не должны попасть в выборку `fresh`.
          h.state.setups = [];
        },
        getInstance: () => ({
          getSetups: () => h.state.setups,
        }),
      },
      validateSetupGeometry: () => [],
      ohlcvToArchive: (c: any) => c,
      ARCHIVE_TF_MS,
      EXEC_TIMEFRAME: '1h',
      CANDLE_LIMIT_1H: 1000,
      CANDLE_LIMIT_4H: 1000,
      CANDLE_LIMIT_1D: 400,
    }),
  };
});

vi.mock('../../server/services/signalRepository.js', () => ({
  insertSignal: async (record: any) => {
    h.repo.insertCalls.push(record);
    return h.repo.insertResults.shift() ?? { inserted: true };
  },
  countActiveSignals: async () => h.repo.activeCount,
  listOpenSignals: async (strategyId: string, limit: number) => {
    h.repo.listOpenCalls.push({ strategyId, limit });
    return h.repo.openRows;
  },
  syncSignalLifecycle: async (payload: any) => {
    h.repo.syncCalls.push(payload);
    return h.repo.syncResults.shift() ?? { changed: true };
  },
}));

vi.mock('../../server/services/strategySettings.js', () => ({
  recordScanResult: async (payload: any) => {
    h.settings.recordScanCalls.push(payload);
  },
  recordSignalEmitted: async (strategyId: string) => {
    h.settings.recordSignalCalls.push(strategyId);
  },
}));

/* -------------------------------------------------------------------------- */
/* Тестируемый модуль и фикстуры                                               */
/* -------------------------------------------------------------------------- */

import { MarketDataFetcher } from '../../server/services/strategyEngine/marketDataFetcher.js';
import {
  runStrategyScan,
  scanStrategySafely,
  buildSignalRecord,
  normalizeScanSymbols,
  ENGINE_STRATEGY_KEY,
  EXEC_TIMEFRAME,
  MAX_LIFECYCLE_SYNC_PER_SCAN,
} from '../../server/services/strategyEngine/strategyEngine.js';

const V30 = 'V3_0_HTF_LIQUIDATION_TRAP';
const V28 = 'V2_8_ZERO_FEE_SNIPER_TRAILING';

const SETUP_BAR = Date.parse('2026-09-19T10:00:00Z');

/** AnalyticalSetup в той форме, в которой его отдаёт ledger ядра. */
const makeSetup = (over: Record<string, unknown> = {}) => ({
  id: `V3_0-BTCUSDT-${SETUP_BAR}`,
  strategyId: V30,
  strategyVersion: '3.0',
  symbol: 'BTC/USDT',
  direction: 'LONG',
  timeframe: '1h',
  setupOpenTime: SETUP_BAR,
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
  ...over,
});

/** EngineStatus: только поля, которые читает движок. */
const makeStatus = (over: Record<string, unknown> = {}) => ({
  running: false,
  scanning: false,
  scanCount: 1,
  lastScanStartedAt: '2026-09-19T11:00:00Z',
  lastScanFinishedAt: '2026-09-19T11:00:04Z',
  lastScanDurationMs: 4000,
  lastError: null,
  nextScanAt: null,
  scanIntervalMs: 60_000,
  symbols: ['BTCUSDT'],
  strategies: ['V3.0'],
  providerIsDemo: false,
  perSymbol: {
    BTCUSDT: {
      symbol: 'BTCUSDT',
      pair: 'BTC/USDT',
      lastScanAt: '2026-09-19T11:00:04Z',
      lastError: null,
      closedBars: { '1h': 999, '4h': 999, '1d': 0 },
      lastEvaluatedBarOpenTime: SETUP_BAR,
      gaps1h: 0,
      source: { exchange: 'Binance', isFallback: false },
      publishedTotal: 1,
      replays: {
        [V30]: {
          strategyId: V30,
          records: 4,
          awaiting: 1,
          filled: 1,
          closed: 2,
          noTrade: 1,
          unpublishable: 2,
          positiveR: 1,
          negativeR: 1,
          netRSum: -0.4,
          grossRSum: 0.6,
          evaluatedBars: 41,
          firstEvaluatedOpenTime: 1,
          lastEvaluatedOpenTime: 2,
          notes: [],
        },
      },
    },
  },
  ...over,
});

/** ReplayRecord в форме live-реплея: symbol — БИРЖЕВОЙ, как у состояния ядра. */
const makeRecord = (over: Record<string, unknown> = {}) => ({
  strategyId: V30,
  strategyVersion: '3.0',
  symbol: 'BTCUSDT',
  direction: 'LONG',
  setupOpenTime: SETUP_BAR,
  setupCloseTime: SETUP_BAR + 3_600_000,
  setupClose: 115_400,
  entryType: 'LIMIT_CORRIDOR',
  entryZone: [115_200.5, 115_480.25],
  stop: 114_310.75,
  targets: [116_900.5, 118_400.25, 121_050.0],
  riskRewardRatio: 1.94,
  validForBars: 3,
  exitRule: 'x',
  confirmingFactors: [],
  invalidationFactors: [],
  publishable: true,
  publishNote: null,
  fill: null,
  outcome: null,
  ...over,
});

/** Фетчер-двойник: пишет запросы, сеть не трогает. */
const makeFetcher = (opts: { fail?: boolean } = {}) => {
  const calls: Array<{ symbol: string; timeframe: string; limit?: number }> = [];
  return {
    calls,
    asProvider: () => ({
      isDemo: false,
      getCandles: async (symbol: string, timeframe: string, limit?: number) => {
        calls.push({ symbol, timeframe, limit });
        if (opts.fail) throw new Error('Binance klines HTTP 503 for ' + symbol);
        return [];
      },
    }),
    getCandles: async (symbol: string, timeframe: string, o?: any) => {
      calls.push({ symbol, timeframe, limit: typeof o === 'number' ? o : o?.limit });
      if (opts.fail) throw new Error('Binance klines HTTP 503 for ' + symbol);
      return [];
    },
  };
};

beforeEach(() => {
  h.state.pendingSetups = [];
  h.state.setups = [];
  h.state.records = [];
  h.state.status = makeStatus();
  h.state.scanNowCalls = 0;
  h.state.engineResets = 0;
  h.state.ledgerResets = 0;
  h.state.instanceConfig = null;
  h.state.retrospectiveFilter = null;
  h.state.scanThrows = null;
  h.repo.insertCalls = [];
  h.repo.insertResults = [];
  h.repo.listOpenCalls = [];
  h.repo.openRows = [];
  h.repo.syncCalls = [];
  h.repo.syncResults = [];
  h.repo.activeCount = 0;
  h.settings.recordScanCalls = [];
  h.settings.recordSignalCalls = [];
});

/* -------------------------------------------------------------------------- */
/* F-01: контракт вызова ядра                                                  */
/* -------------------------------------------------------------------------- */

describe('Движок вызывает ядро по существующему контракту (F-01)', () => {
  it('один скан = один вызов scanNow(); интервал внутри ядра не запускается', async () => {
    const fetcher = makeFetcher();
    const result = await runStrategyScan({
      strategyId: V30,
      symbols: ['BTCUSDT'],
      fetcher: fetcher as any,
      persist: false,
    });

    expect(h.state.scanNowCalls, 'scanNow() обязан быть вызван ровно один раз').toBe(1);
    expect(result.evaluated).toBe(true);
    expect(result.symbolsScanned).toBe(1);
    // Ядро создаётся с одним проходом: расписанием владеет StrategyScheduler.
    expect(h.state.instanceConfig.strategies).toEqual([ENGINE_STRATEGY_KEY[V30]]);
    expect(h.state.instanceConfig.symbols).toEqual(['BTCUSDT']);
    expect(h.state.instanceConfig.provider).toBeTruthy();
    // scanIntervalMs не передаётся ⇒ ядро не заводит собственный таймер.
    expect(h.state.instanceConfig.scanIntervalMs).toBeUndefined();
  });

  it('успешный скан возвращает НАСТОЯЩЕЕ состояние планировщика из ядра', async () => {
    const result = await runStrategyScan({
      strategyId: V30,
      symbols: ['BTCUSDT'],
      fetcher: makeFetcher() as any,
      persist: false,
    });

    expect(result.scan).toMatchObject({
      execTimeframe: '1h',
      scanCount: 1,
      lastScanStartedAt: '2026-09-19T11:00:00Z',
      lastScanFinishedAt: '2026-09-19T11:00:04Z',
      lastScanDurationMs: 4000,
      lastError: null,
      providerIsDemo: false,
    });
    // Счётчики реплея берутся из статуса ядра, а не выдумываются движком.
    expect(result.scan.evaluatedBars).toBe(41);
    expect(result.rejected, 'rejected = Σ unpublishable из ReplaySummary').toBe(2);
    expect(result.scan.timeframes).toEqual(['1h', '4h']);
  });

  it('журнал и экземпляр ядра сбрасываются перед каждым сканом', async () => {
    await runStrategyScan({
      strategyId: V30,
      symbols: ['BTCUSDT'],
      fetcher: makeFetcher() as any,
      persist: false,
    });
    expect(h.state.engineResets).toBeGreaterThan(0);
    expect(h.state.ledgerResets).toBeGreaterThan(0);
  });

  it('отказ рыночных данных бросается ДО скана: «нет данных» не выглядит как «нет сетапов»', async () => {
    const fetcher = makeFetcher({ fail: true });

    await expect(
      runStrategyScan({ strategyId: V30, symbols: ['BTCUSDT'], fetcher: fetcher as any, persist: false })
    ).rejects.toMatchObject({ code: 'MARKET_DATA_UNAVAILABLE' });

    expect(h.state.scanNowCalls, 'ядро не должно сканировать без данных').toBe(0);
    expect(h.repo.insertCalls, 'сигналы не выдумываются').toEqual([]);
  });

  it('ошибка внутри scanNow() пробрасывается наружу, а не глотается', async () => {
    h.state.scanThrows = new Error('IndicatorEngine: insufficient bars');
    await expect(
      runStrategyScan({
        strategyId: V30,
        symbols: ['BTCUSDT'],
        fetcher: makeFetcher() as any,
        persist: false,
      })
    ).rejects.toThrow('IndicatorEngine: insufficient bars');
    expect(h.repo.insertCalls).toEqual([]);
  });

  it('scanStrategySafely фиксирует ошибку в strategy_settings и не роняет процесс', async () => {
    const failed = await scanStrategySafely({
      strategyId: V30,
      symbols: ['BTCUSDT'],
      fetcher: makeFetcher({ fail: true }) as any,
      persist: true,
    });
    if (failed.ok) throw new Error('ожидался отказ скана при недоступных рыночных данных');
    expect(failed.error).toMatch(/Market data unavailable/);
    expect(h.settings.recordScanCalls).toHaveLength(1);
    expect(h.settings.recordScanCalls[0].error).toMatch(/Market data unavailable/);

    // Движок остаётся согласованным: следующий скан с живыми данными проходит.
    h.state.status = makeStatus({ scanCount: 2 });
    const ok = await scanStrategySafely({
      strategyId: V30,
      symbols: ['BTCUSDT'],
      fetcher: makeFetcher() as any,
      persist: true,
    });
    if (!ok.ok) throw new Error(`ожидался успешный скан: ${ok.error}`);
    expect(ok.scan.lastError).toBeNull();
    expect(h.settings.recordScanCalls[1]).toMatchObject({ strategyId: V30, error: null });
  });

  it('неизвестная стратегия — 404, а не пустой результат', async () => {
    await expect(
      runStrategyScan({ strategyId: 'V9_9_MADE_UP', fetcher: makeFetcher() as any, persist: false })
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

/* -------------------------------------------------------------------------- */
/* Таймфреймы и лимиты свечей на границе движка (F-09, F-10)                   */
/* -------------------------------------------------------------------------- */

/**
 * Предзагрузка проверяется на НАСТОЯЩЕМ MarketDataFetcher с подставным HTTP:
 * именно он — граница, на которой каталожный '1D' и пара 'BTC/USDT' обязаны
 * превратиться в interval=1d и symbol=BTCUSDT (F-09), а лимит — в требование
 * ядра, а не в дефолт шима (F-10).
 */
const makeHttpFetcher = () => {
  const requests: Array<{ symbol: string; interval: string; limit: string }> = [];
  const fetcher = new MarketDataFetcher({
    fetchFn: (async (url: string) => {
      const q = new URL(url).searchParams;
      requests.push({ symbol: q.get('symbol')!, interval: q.get('interval')!, limit: q.get('limit')! });
      return { ok: true, status: 200, json: async () => [] };
    }) as any,
  });
  return { fetcher, requests };
};

describe('Предзагрузка свечей: таймфреймы и лимиты ядра', () => {
  it('тянет исполнение + контекст каталога с лимитами ЯДРА (1000/1000, не 300)', async () => {
    const { fetcher, requests } = makeHttpFetcher();
    await runStrategyScan({ strategyId: V30, symbols: ['BTCUSDT'], fetcher: fetcher as any, persist: false });

    // V3.0: исполнение 1h + контекст 4h. Дневную серию ядро просит только для
    // V2.8 (`needs1d = strategies.includes('V2.8')`), поэтому её здесь нет.
    expect(requests).toEqual([
      { symbol: 'BTCUSDT', interval: '1h', limit: '1000' },
      { symbol: 'BTCUSDT', interval: '4h', limit: '1000' },
    ]);
  });

  it('V2.8 тянет дневной контекст: каталожный 1D приводится к 1d на границе провайдера', async () => {
    const { fetcher, requests } = makeHttpFetcher();
    await runStrategyScan({ strategyId: V28, symbols: ['BTC/USDT'], fetcher: fetcher as any, persist: false });

    expect(requests).toEqual([
      { symbol: 'BTCUSDT', interval: '1h', limit: '1000' },
      { symbol: 'BTCUSDT', interval: '4h', limit: '1000' },
      // Литерал '1D' из каталога не доходит до URL: Binance ответил бы 400.
      { symbol: 'BTCUSDT', interval: '1d', limit: '400' },
    ]);
    expect(requests.map((r) => r.interval)).not.toContain('1D');
  });

  it('движок запрашивает у фетчера именно серии каталога (исполнение + контекст)', async () => {
    const fetcher = makeFetcher();
    const result = await runStrategyScan({ strategyId: V28, symbols: ['BTCUSDT'], fetcher: fetcher as any, persist: false });
    expect(result.scan.timeframes).toEqual(['1h', '4h', '1D']);
    expect(fetcher.calls.map((c) => c.timeframe)).toEqual(['1h', '4h', '1D']);
    expect(fetcher.calls.map((c) => c.limit)).toEqual([1000, 1000, 400]);
  });

  it('символы приводятся к биржевой форме: пара и биржевой символ не дают двойной скан', async () => {
    expect(normalizeScanSymbols(['BTC/USDT', 'btcusdt', 'ETH'])).toEqual({
      symbols: ['BTCUSDT', 'ETHUSDT'],
      invalid: [],
    });
    expect(normalizeScanSymbols(['BTC USD', '', null])).toEqual({
      symbols: [],
      invalid: ['BTC USD', '', 'null'],
    });

    const fetcher = makeFetcher();
    const result = await runStrategyScan({
      strategyId: V30,
      symbols: ['BTC/USDT', 'BTCUSDT'],
      fetcher: fetcher as any,
      persist: false,
    });
    expect(result.symbolsScanned, 'один инструмент — один скан').toBe(1);
    expect(h.state.instanceConfig.symbols).toEqual(['BTCUSDT']);
  });

  it('без единого валидного символа скан падает явно, а не сканирует пустоту', async () => {
    await expect(
      runStrategyScan({ strategyId: V30, symbols: ['!!!'], fetcher: makeFetcher() as any, persist: false })
    ).rejects.toMatchObject({ code: 'NO_SCANNABLE_SYMBOLS' });
    expect(h.state.scanNowCalls).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* F-05 / F-06: перенос сетапа в БД                                            */
/* -------------------------------------------------------------------------- */

describe('Перенос сетапа в signalRepository', () => {
  it('сохраняет ВСЮ лестницу целей: TP3 не теряется (F-06)', async () => {
    h.state.pendingSetups = [makeSetup()];

    const result = await runStrategyScan({
      strategyId: V30,
      symbols: ['BTCUSDT'],
      fetcher: makeFetcher() as any,
      persist: true,
    });

    expect(h.repo.insertCalls).toHaveLength(1);
    const record = h.repo.insertCalls[0];
    expect(record.targets, 'лестница целей обязана уйти целиком').toEqual([
      116_900.5, 118_400.25, 121_050.0,
    ]);
    // tp1/tp2 движок НЕ заполняет: их выводит репозиторий из лестницы.
    expect('tp1' in record, 'движок не должен дублировать уровни вне targets').toBe(false);
    expect('tp2' in record).toBe(false);
    expect(record).toMatchObject({
      strategyId: V30,
      strategyVersion: '3.0',
      symbol: 'BTC/USDT',
      timeframe: '1h',
      direction: 'LONG',
      entryType: 'LIMIT_CORRIDOR',
      validForBars: 3,
      entryMin: 115_200.5,
      entryMax: 115_480.25,
      stopLoss: 114_310.75,
      status: 'ACTIVE',
    });
    expect(record.signalCandleTs).toBeInstanceOf(Date);
    expect(record.signalCandleTs.getTime()).toBe(SETUP_BAR);
    expect(record.metadata.riskRewardRatio).toBe(1.94);
    expect(result.inserted).toBe(1);
    expect(result.duplicates).toBe(0);
    expect(h.settings.recordSignalCalls).toEqual([V30]);
  });

  it('повторный скан того же бара даёт тот же ключ: дубль не создаётся (F-05)', async () => {
    h.state.pendingSetups = [makeSetup()];
    const fetcher = makeFetcher();

    const first = await runStrategyScan({ strategyId: V30, symbols: ['BTCUSDT'], fetcher: fetcher as any, persist: true });
    expect(first.inserted).toBe(1);

    // Рестарт процесса/повторный тик: ledger сброшен, ядро публикует тот же
    // сетап того же закрытого бара; UNIQUE(strategy, symbol, tf, свеча) решает.
    h.state.pendingSetups = [makeSetup()];
    h.repo.insertResults = [{ inserted: false }];
    const second = await runStrategyScan({ strategyId: V30, symbols: ['BTCUSDT'], fetcher: fetcher as any, persist: true });

    expect(h.repo.insertCalls).toHaveLength(2);
    expect(h.repo.insertCalls[1].signalCandleTs.getTime()).toBe(h.repo.insertCalls[0].signalCandleTs.getTime());
    expect(h.repo.insertCalls[1].symbol).toBe(h.repo.insertCalls[0].symbol);
    expect(h.repo.insertCalls[1].timeframe).toBe(h.repo.insertCalls[0].timeframe);
    expect(second.inserted).toBe(0);
    expect(second.duplicates).toBe(1);
    expect(h.settings.recordSignalCalls, 'эмиссия не фиксируется повторно').toEqual([V30]);
  });

  it('действительно НОВЫЙ бар — это новый сигнал, а не дубль', async () => {
    const fetcher = makeFetcher();
    h.state.pendingSetups = [makeSetup()];
    await runStrategyScan({ strategyId: V30, symbols: ['BTCUSDT'], fetcher: fetcher as any, persist: true });

    const nextBar = SETUP_BAR + 3_600_000;
    h.state.pendingSetups = [makeSetup({ setupOpenTime: nextBar, id: `V3_0-BTCUSDT-${nextBar}` })];
    const second = await runStrategyScan({ strategyId: V30, symbols: ['BTCUSDT'], fetcher: fetcher as any, persist: true });

    expect(second.inserted, 'следующий закрытый бар обязан сохраниться').toBe(1);
    expect(second.duplicates).toBe(0);
    expect(h.repo.insertCalls[1].signalCandleTs.getTime()).toBe(nextBar);
  });

  it('сетап без валидного setupOpenTime НЕ сохраняется и виден в сводке', async () => {
    h.state.pendingSetups = [makeSetup({ setupOpenTime: NaN }), makeSetup({ setupOpenTime: undefined, id: 'x-2' })];

    const result = await runStrategyScan({
      strategyId: V30,
      symbols: ['BTCUSDT'],
      fetcher: makeFetcher() as any,
      persist: true,
    });

    expect(h.repo.insertCalls, 'без ключа дедупликации строка не пишется').toEqual([]);
    expect(result.skippedNoKey).toBe(2);
    expect(result.setupsFound).toBe(2);
  });

  it('buildSignalRecord — чистое отображение: ничего не пересчитывается', () => {
    const built = buildSignalRecord({
      setup: makeSetup({ targets: [10, 20, 30, 40] }),
      strategyId: V28,
      fallbackVersion: '2.8',
      engineKey: 'V2.8',
      execTf: '1h',
    });
    expect(built).not.toBeNull();
    expect(built!.record.targets).toEqual([10, 20, 30, 40]);
    expect(built!.setupOpenTime).toBe(SETUP_BAR);

    // Лестница копируется: последующая мутация сетапа не меняет сохранённое.
    const setup = makeSetup();
    const copy = buildSignalRecord({ setup, strategyId: V30, fallbackVersion: '3.0', engineKey: 'V3.0', execTf: '1h' })!;
    setup.targets.push(999);
    expect(copy.record.targets).toEqual([116_900.5, 118_400.25, 121_050.0]);

    expect(buildSignalRecord({ setup: makeSetup({ setupOpenTime: Infinity }), strategyId: V30, fallbackVersion: '3.0', engineKey: 'V3.0', execTf: '1h' })).toBeNull();
    expect(buildSignalRecord({ setup: makeSetup({ setupOpenTime: '1758283200000' }), strategyId: V30, fallbackVersion: '3.0', engineKey: 'V3.0', execTf: '1h' })!.setupOpenTime).toBe(1758283200000);
  });
});

/* -------------------------------------------------------------------------- */
/* F-08: жизненный цикл — только то, что ядро УЖЕ определило                    */
/* -------------------------------------------------------------------------- */

describe('Синхронизация жизненного цикла из ретроспективы ядра', () => {
  const openRow = (over: Record<string, unknown> = {}) => ({
    id: 7,
    strategyId: V30,
    symbol: 'BTC/USDT',
    timeframe: '1h',
    signalCandleTs: new Date(SETUP_BAR),
    status: 'ACTIVE',
    ...over,
  });

  it('исполнение и исход переносятся как есть, включая R ядра', async () => {
    h.repo.openRows = [openRow()];
    h.state.records = [
      makeRecord({
        fill: {
          price: 115_300.5,
          at: '2026-09-19T11:00:00Z',
          barOpenTime: SETUP_BAR + 3_600_000,
          stop: 114_310.75,
          targets: [116_900.5, 118_400.25, 121_050.0],
        },
        outcome: {
          status: 'TARGET_REACHED',
          exitReason: 'TP3',
          exitPrice: 121_050.0,
          grossR: 3.02,
          netR: 2.98,
          pnlPct: 4.94,
          barsHeld: 9,
          barOpenTime: SETUP_BAR + 9 * 3_600_000,
        },
      }),
    ];

    const result = await runStrategyScan({
      strategyId: V30,
      symbols: ['BTCUSDT'],
      fetcher: makeFetcher() as any,
      persist: true,
    });

    expect(h.repo.syncCalls).toHaveLength(1);
    const payload = h.repo.syncCalls[0];
    expect(payload).toMatchObject({
      strategyId: V30,
      symbol: 'BTC/USDT',
      timeframe: '1h',
    });
    expect(payload.signalCandleTs).toBe(SETUP_BAR);
    expect(payload.fill.price).toBe(115_300.5);
    expect(payload.outcome).toMatchObject({
      status: 'TARGET_REACHED',
      exitReason: 'TP3',
      exitPrice: 121_050.0,
      resultR: 3.02,
      netResultR: 2.98,
      barsHeld: 9,
    });
    // closed_at — время ЗАКРЫТИЯ бара исхода: barOpenTime + длительность бара.
    expect(payload.outcome.closedAt).toBeInstanceOf(Date);
    expect(payload.outcome.closedAt.getTime()).toBe(SETUP_BAR + 10 * 3_600_000);
    expect(result.lifecycle.synced).toBe(1);
    expect(h.state.retrospectiveFilter).toEqual({ strategyId: V30 });
  });

  it('без исхода статус не меняется: «ещё не известно» не превращается в «закрыто»', async () => {
    h.repo.openRows = [openRow()];
    h.state.records = [makeRecord({ fill: null, outcome: null })];

    const result = await runStrategyScan({
      strategyId: V30,
      symbols: ['BTCUSDT'],
      fetcher: makeFetcher() as any,
      persist: true,
    });

    expect(h.repo.syncCalls, 'запись без fill и outcome не трогается').toEqual([]);
    expect(result.lifecycle).toEqual({ synced: 0, unchanged: 0, notFound: 0 });
  });

  it('запись окна, которой нет в БД, не выдумывается в строку', async () => {
    // В БД есть открытая строка ДРУГОГО бара (стратегия была выключена, когда
    // сформировался сетап из окна): сопоставления нет, строка не создаётся.
    h.repo.openRows = [openRow({ id: 8, signalCandleTs: new Date(SETUP_BAR + 86_400_000) })];
    h.state.records = [
      makeRecord({ outcome: { status: 'INVALIDATED', exitReason: 'SL', exitPrice: 114_310, grossR: -1, netR: -1, pnlPct: -0.8, barsHeld: 2, barOpenTime: SETUP_BAR + 7_200_000 } }),
    ];

    const result = await runStrategyScan({
      strategyId: V30,
      symbols: ['BTCUSDT'],
      fetcher: makeFetcher() as any,
      persist: true,
    });

    expect(h.repo.syncCalls).toEqual([]);
    expect(result.lifecycle.notFound).toBe(1);
    expect(result.lifecycle.synced).toBe(0);
  });

  it('строка, которую репозиторий не изменил, считается unchanged', async () => {
    h.repo.openRows = [openRow({ status: 'TARGET_REACHED' })];
    h.repo.syncResults = [{ changed: false }];
    h.state.records = [
      makeRecord({ outcome: { status: 'TARGET_REACHED', exitReason: 'TP2', exitPrice: 118_400, grossR: 2, netR: 2, pnlPct: 2.6, barsHeld: 4, barOpenTime: SETUP_BAR + 14_400_000 } }),
    ];

    const result = await runStrategyScan({
      strategyId: V30,
      symbols: ['BTCUSDT'],
      fetcher: makeFetcher() as any,
      persist: true,
    });

    expect(result.lifecycle).toEqual({ synced: 0, unchanged: 1, notFound: 0 });
  });

  it('рабочий набор — открытые строки одним SELECT с границей, а не вся таблица', async () => {
    h.repo.openRows = [openRow()];
    await runStrategyScan({
      strategyId: V30,
      symbols: ['BTCUSDT'],
      fetcher: makeFetcher() as any,
      persist: true,
    });
    expect(h.repo.listOpenCalls).toEqual([{ strategyId: V30, limit: MAX_LIFECYCLE_SYNC_PER_SCAN }]);
    expect(MAX_LIFECYCLE_SYNC_PER_SCAN).toBe(500);
  });

  it('без открытых строк ретроспектива не опрашивается вовсе', async () => {
    h.repo.openRows = [];
    await runStrategyScan({
      strategyId: V30,
      symbols: ['BTCUSDT'],
      fetcher: makeFetcher() as any,
      persist: true,
    });
    expect(h.repo.listOpenCalls).toHaveLength(1);
    expect(h.state.retrospectiveFilter, 'getRetrospective не вызывается без кандидатов').toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Каталог и ключи                                                             */
/* -------------------------------------------------------------------------- */

describe('Каталог стратегий и ключи ядра', () => {
  it('EXEC_TIMEFRAME движка = таймфрейм исполнения каталога (1h, не 15m)', () => {
    expect(EXEC_TIMEFRAME).toEqual({
      V3_0_HTF_LIQUIDATION_TRAP: '1h',
      V3_3_HTF_ZONE_MITIGATION: '1h',
      V2_8_ZERO_FEE_SNIPER_TRAILING: '1h',
    });
  });

  it('ENGINE_STRATEGY_KEY покрывает все три продуктовые стратегии', () => {
    expect(Object.values(ENGINE_STRATEGY_KEY).sort()).toEqual(['V2.8', 'V3.0', 'V3.3']);
    expect(Object.keys(EXEC_TIMEFRAME).sort()).toEqual(Object.keys(ENGINE_STRATEGY_KEY).sort());
  });
});

/** @vitest-environment node */
/**
 * CRYPTORA — ИНВАРИАНТ PROVENANCE СИГНАЛА (инцидент 2026-09-24).
 *
 * Суть инцидента: на проде три РАЗНЫХ strategy_id (V3.0 / V3.3 / V2.8) получили
 * на одном символе и одном signal_candle_ts полностью одинаковый payload
 * (direction, entry_min, entry_max, stop_loss, targets). Математика стратегий
 * frozen и трогать её нельзя — значит, уровни кто-то переименовал.
 *
 * Что здесь доказывается:
 *
 *  1. Замороженные реализации стратегий САМИ возвращают РАЗНЫЕ payload: V3.0 и
 *     V3.3 на одной фикстуре дают одинаковый коридор/стоп (обе считают коридор
 *     как close ± 0.10 ATR), но РАЗНЫЕ цели (V3.0 — равновесие 4H-диапазона,
 *     V3.3 — середина displacement-ноги). V2.8 на этой фикстуре не публикует
 *     ничего (sniper-фильтр), а его вход — точка [x, x], а не коридор.
 *  2. Конкурентный запуск трёх стратегий (ровно так их запускает
 *     StrategyScheduler.tick()) обязан публиковать КАЖДЫЙ СВОЙ payload.
 *  3. У published-строки provenance доказуем: `engine_setup_id` начинается с
 *     её `strategy_id`, версия совпадает, уровни равны собственному raw output
 *     этой стратегии.
 *  4. Включена одна стратегия — публикует только она.
 *
 * Ядро НАСТОЯЩЕЕ (esbuild-бандл из src/) — то же, что исполняется на сервере.
 * Подменяются только сеть (Binance klines) и запись в БД: математика стратегий
 * не изменяется, production не затрагивается.
 *
 * Окружение node обязательно: сборка бандла esbuild в jsdom падает на
 * собственном инварианте TextEncoder (см. strategyEngineCore.test.ts, F-03).
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';

/* -------------------------------------------------------------------------- */
/* Подмена ТОЛЬКО записи в БД и учёта сканов. Читающий SQL не подменяется.      */
/* -------------------------------------------------------------------------- */

const h = vi.hoisted(() => ({
  /** Все попытки записи сигнала — в том порядке, в котором их делал движок. */
  inserts: [] as any[],
}));

vi.mock('../../server/services/signalRepository.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    insertSignal: async (signal: any) => {
      h.inserts.push(signal);
      return { inserted: true, signal: null };
    },
    countActiveSignals: async () => 0,
    listOpenSignals: async () => [],
    syncSignalLifecycle: async () => ({ changed: false }),
  };
});

vi.mock('../../server/services/strategySettings.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    recordScanResult: async () => undefined,
    recordSignalEmitted: async () => undefined,
  };
});

import { loadStrategyCore } from '../../server/services/strategyEngine/strategyCoreBundle.js';
import { MarketDataFetcher } from '../../server/services/strategyEngine/marketDataFetcher.js';
import {
  runStrategyScan,
  scanStrategySafely,
  ENGINE_STRATEGY_KEY,
} from '../../server/services/strategyEngine/strategyEngine.js';
import { StrategyScheduler } from '../../server/services/strategyEngine/strategyScheduler.js';
import { buildProvenanceFixture } from '../helpers/strategyFixture';

const V30 = 'V3_0_HTF_LIQUIDATION_TRAP';
const V33 = 'V3_3_HTF_ZONE_MITIGATION';
const V28 = 'V2_8_ZERO_FEE_SNIPER_TRAILING';
/**
 * Порядок, в котором `getEnabledStrategies()` отдаёт строки:
 * `ORDER BY strategy_id` ⇒ V2.8, V3.0, V3.3. Именно в нём планировщик
 * запускает сканы, и именно от него зависит, ЧЕЙ ledger станет общим.
 */
const DB_ORDER = [V28, V30, V33] as const;
/** Повернутый порядок — чтобы регрессия не зависела от удачного совпадения. */
const ROTATED_ORDER = [V30, V33, V28] as const;
const ALL_IDS = DB_ORDER;

/** Версия, которую несёт сама запись реплея (V30/V33/V28_STRATEGY_VERSION). */
const VERSION_BY_ID: Record<string, string> = {
  [V30]: '3.0',
  [V33]: '3.3',
  [V28]: '2.8',
};

/** Ключ стратегии внутри ядра → registry id. */
const ID_BY_ENGINE_KEY: Record<string, string> = Object.fromEntries(
  Object.entries(ENGINE_STRATEGY_KEY).map(([id, key]) => [key, id]),
);

let core: any = null;
let loadError: string | null = null;

beforeAll(async () => {
  try {
    core = await loadStrategyCore();
  } catch (e) {
    loadError = e instanceof Error ? e.message : String(e);
  }
}, 180_000);

beforeEach(() => {
  h.inserts.length = 0;
  // Движок берёт время из Date.now() — фиксируем его, чтобы «последний
  // закрытый бар» фикстуры не зависел от момента запуска теста.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW_MS);
});

afterEach(() => {
  vi.useRealTimers();
});

const withCore = (name: string, fn: () => Promise<void>, timeout = 180_000) =>
  it(
    name,
    async (ctx) => {
      if (!core) {
        ctx.skip();
        return;
      }
      await fn();
    },
    timeout,
  );

/* -------------------------------------------------------------------------- */
/* Фикстура: детерминированные свечи, на которых стратегии реально срабатывают  */
/* -------------------------------------------------------------------------- */

/**
 * Опорный момент «сейчас» для фикстуры.
 *
 * ⚠️ Он ОБЯЗАН быть тем же `Date.now()`, который видит движок: `runStrategyScan`
 * не принимает источник времени, а `LiveSignalEngine` по умолчанию берёт
 * `Date.now()` и по нему решает, какие бары закрыты. Если оставить реальное
 * время, фикстура «поедет»: её последний бар перестанет быть формирующимся, и
 * сетап на предыдущем баре перестанет публиковаться — тест начнёт зависеть от
 * часа, в котором его запустили. Поэтому время фиксируется через fake timers
 * (только `Date`: `setTimeout` движка остаётся настоящим).
 */
const NOW_MS = Date.parse('2026-09-24T15:30:00.000Z');

const makeFetcher = () => {
  const fx = buildProvenanceFixture({ nowMs: NOW_MS });
  const fetchFn = (async (url: string) => {
    const q = new URL(url).searchParams;
    const interval = q.get('interval') as '1h' | '4h' | '1d';
    const limit = Number(q.get('limit'));
    const rows = interval === '1h' ? fx.h1 : interval === '4h' ? fx.h4 : fx.h1d;
    // Биржа отдаёт последние `limit` свечей; формирующаяся свеча остаётся в
    // ответе — ядро обязано отсечь её само (иначе look-ahead).
    return { ok: true, status: 200, json: async () => rows.slice(-limit) };
  }) as any;
  return { fetcher: new MarketDataFetcher({ fetchFn, nowMs: () => NOW_MS }), fx };
};

/**
 * RAW OUTPUT стратегии ДО persistence: ровно то, что вернул её frozen-реплей на
 * последнем закрытом баре. Ни БД, ни `buildSignalRecord` здесь нет.
 */
async function rawStrategyOutput(strategyId: string): Promise<any[]> {
  const { fetcher, fx } = makeFetcher();
  const engineKey = ENGINE_STRATEGY_KEY[strategyId];
  core.SignalsAuditLedger.resetInstance?.();
  core.LiveSignalEngine.resetInstance();
  const engine = core.LiveSignalEngine.getInstance({
    provider: fetcher.asProvider(),
    symbols: ['BTCUSDT'],
    strategies: [engineKey],
    now: () => NOW_MS,
    yieldBetweenSymbols: false,
  });
  if (!engine) throw new Error('ядро не создало движок');
  await engine.scanNow();
  core.LiveSignalEngine.resetInstance();
  core.SignalsAuditLedger.resetInstance?.();
  return engine
    .getRetrospective({ symbol: 'BTCUSDT' })
    .filter((r: any) => r.setupOpenTime === fx.lastClosed1hOpenTime && r.publishable);
}

/** Уровни в форме строки БД — из raw-записи реплея. */
const levelsOfRaw = (r: any) => ({
  direction: r.direction,
  entryMin: r.entryZone[0],
  entryMax: r.entryZone[1],
  stopLoss: r.stop,
  targets: r.targets,
});

/** Уровни в форме строки БД — из того, что ушло в insertSignal. */
const levelsOfRecord = (r: any) => ({
  direction: r.direction,
  entryMin: r.entryMin,
  entryMax: r.entryMax,
  stopLoss: r.stopLoss,
  targets: r.targets,
});

const grouped = () => {
  const byStrategy = new Map<string, any[]>();
  for (const rec of h.inserts) {
    const list = byStrategy.get(rec.strategyId) ?? [];
    list.push(rec);
    byStrategy.set(rec.strategyId, list);
  }
  return byStrategy;
};

/* -------------------------------------------------------------------------- */
/* 1. Замороженные стратегии сами возвращают РАЗНЫЕ payload                     */
/* -------------------------------------------------------------------------- */

describe('Инцидент: raw output замороженных стратегий (до persistence)', () => {
  it('ядро загружено — иначе provenance непроверяем', () => {
    if (loadError) throw new Error(`Ядро стратегий не загрузилось: ${loadError}`);
    expect(core).toBeTruthy();
  });

  withCore('каждая стратегия возвращает записи со СВОИМ strategyId', async () => {
    for (const id of ALL_IDS) {
      const raw = await rawStrategyOutput(id);
      for (const r of raw) {
        expect(r.strategyId, `${id}: реплей обязан клеймить свою стратегию`).toBe(id);
        expect(r.strategyVersion).toBe(VERSION_BY_ID[id]);
      }
    }
  });

  withCore('V3.0 и V3.3 дают РАЗНЫЕ цели на одном и том же баре и символе', async () => {
    const r30 = await rawStrategyOutput(V30);
    const r33 = await rawStrategyOutput(V33);

    // Фикстура обязана доводить обе стратегии до публикуемого сетапа: иначе
    // тест вырождается в «обе молчат → provenance неотличим».
    expect(r30, 'V3.0 должен опубликовать сетап на этой фикстуре').toHaveLength(1);
    expect(r33, 'V3.3 должен опубликовать сетап на этой фикстуре').toHaveLength(1);

    expect(r30[0].setupOpenTime).toBe(r33[0].setupOpenTime);
    // Коридор у обеих close ± 0.10 ATR — совпадение входа НЕ является ошибкой.
    expect(r30[0].entryZone).toEqual(r33[0].entryZone);
    // А вот TP1 считается по разным формулам — значит payload различим.
    expect(r30[0].targets).not.toEqual(r33[0].targets);
    expect(r33[0].targets[1], 'TP2 = противоположный подтверждённый 4H-свинг — общий').toBe(r30[0].targets[1]);
  });

  withCore('V2.8 на этой фикстуре не публикует ничего, а его вход — точка, не коридор', async () => {
    const r28 = await rawStrategyOutput(V28);
    expect(r28, 'V2.8 не должен публиковать сетап на этой фикстуре').toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------- */
/* 2. Конкурентный скан: payload не переезжает между strategy_id                */
/* -------------------------------------------------------------------------- */

describe('Инцидент: конкурентный запуск трёх стратегий', () => {
  /**
   * Планировщик запускает стратегии КОНКУРЕНТНО: tick() не дожидается конца
   * скана (in-flight замок — только на ту же стратегию). Порядок — тот же, что
   * у `getEnabledStrategies()`: ORDER BY strategy_id ⇒ V2.8, V3.0, V3.3.
   */
  const rowsFor = (ids: readonly string[]) =>
    ids.map((strategyId) => ({ strategyId, symbols: null, scanIntervalSeconds: 60 }));

  const runScheduler = async (ids: readonly string[]) => {
    const { fetcher } = makeFetcher();
    const results: any[] = [];
    const scheduler = new StrategyScheduler({
      getEnabled: async () => rowsFor(ids) as any,
      resolveSymbols: async () => ['BTCUSDT'],
      scan: async (p: any) => {
        const r = await scanStrategySafely({ ...p, fetcher, persist: true });
        results.push(r);
        return r;
      },
    });
    await scheduler.tick();
    // tick() только запускает сканы — дожидаемся их завершения.
    await Promise.allSettled([...(scheduler as any).inFlight.values()]);
    return results;
  };

  withCore('планировщик запускает все три стратегии, ни одна не падает', async () => {
    const results = await runScheduler(ALL_IDS);
    expect(results).toHaveLength(3);
    for (const r of results) {
      expect(r.ok, `скан ${r.strategyId} не должен падать: ${r.error ?? ''}`).toBe(true);
    }
  });

  withCore('КАЖДАЯ published-строка обязана происходить от своей стратегии', async () => {
    await runScheduler(ALL_IDS);

    // (а) provenance по идентификатору сетапа: его mint'ит сам реплей стратегии.
    for (const rec of h.inserts) {
      expect(rec.strategyId, 'strategyId строки обязан быть из реестра').toBe(ID_BY_ENGINE_KEY[rec.metadata?.engineVersion] ?? rec.strategyId);
      expect(
        String(rec.engineSetupId).startsWith(`${rec.strategyId}-`),
        `engine_setup_id=${rec.engineSetupId} не принадлежит strategy_id=${rec.strategyId}`,
      ).toBe(true);
      expect(rec.strategyVersion, 'версия несётся самим реплеем, а не вызывающим').toBe(VERSION_BY_ID[rec.strategyId]);
    }

    // (б) provenance по уровням: строка равна СОБСТВЕННОМУ raw output стратегии.
    const byStrategy = grouped();
    for (const id of ALL_IDS) {
      const raw = await rawStrategyOutput(id);
      const records = byStrategy.get(id) ?? [];
      expect(records.length, `${id}: строк в БД столько же, сколько raw-сетапов`).toBe(raw.length);
      for (let i = 0; i < records.length; i++) {
        expect(levelsOfRecord(records[i]), `${id}: уровни строки = raw output`).toEqual(levelsOfRaw(raw[i]));
      }
    }
  });

  withCore('V2.8 не публикует ничего: у него на этой фикстуре нет сетапов', async () => {
    await runScheduler(DB_ORDER);
    const byStrategy = grouped();
    // Корень инцидента: до фикса V2.8 получал в БД чужой payload (V3.3),
    // хотя его frozen-реплей на этом баре не дал ни одного сетапа.
    expect(byStrategy.get(V28) ?? [], 'V2.8 обязан остаться без записей').toHaveLength(0);
  });

  withCore('порядок запуска не влияет на provenance: каждый пишет только своё', async () => {
    for (const order of [ROTATED_ORDER, DB_ORDER]) {
      h.inserts.length = 0;
      await runScheduler(order);
      const byStrategy = grouped();
      for (const id of ALL_IDS) {
        const raw = await rawStrategyOutput(id);
        const records = byStrategy.get(id) ?? [];
        expect(
          records.length,
          `порядок ${order.join('→')}: ${id} записал ${records.length} строк при ${raw.length} raw-сетапах`,
        ).toBe(raw.length);
        for (const rec of records) {
          expect(String(rec.engineSetupId).startsWith(`${id}-`), `порядок ${order.join('→')}: ${rec.engineSetupId} ≠ ${id}`).toBe(true);
        }
      }
    }
  });

  withCore('payload V3.0 и V3.3 в БД различаются целями, как и их raw output', async () => {
    await runScheduler(ALL_IDS);
    const byStrategy = grouped();
    const r30 = (byStrategy.get(V30) ?? [])[0];
    const r33 = (byStrategy.get(V33) ?? [])[0];
    expect(r30, 'V3.0 обязан записать сетап').toBeTruthy();
    expect(r33, 'V3.3 обязан записать сетап').toBeTruthy();
    // Вход/стоп у них совпадают (обе close ± 0.10 ATR) — это НЕ нарушение.
    expect([r30.entryMin, r30.entryMax, r30.stopLoss]).toEqual([r33.entryMin, r33.entryMax, r33.stopLoss]);
    // Цели — разные: именно по ним видна подмена авторства.
    expect(r30.targets).not.toEqual(r33.targets);
  });

  withCore('нет двух strategy_id с одинаковыми levels, которых нет в их raw output', async () => {
    await runScheduler(ALL_IDS);
    const seen = new Map<string, string>();
    for (const rec of h.inserts) {
      const key = JSON.stringify(levelsOfRecord(rec));
      const prev = seen.get(key);
      if (prev) {
        // Одинаковые уровни допустимы ТОЛЬКО если обе стратегии их реально
        // посчитали. Проверяем это собственными raw output.
        const rawPrev = await rawStrategyOutput(prev);
        const rawCur = await rawStrategyOutput(rec.strategyId);
        const sameAsOwnPrev = rawPrev.some((r) => JSON.stringify(levelsOfRaw(r)) === key);
        const sameAsOwnCur = rawCur.some((r) => JSON.stringify(levelsOfRaw(r)) === key);
        expect(sameAsOwnPrev && sameAsOwnCur, `одинаковый payload у ${prev} и ${rec.strategyId} не подтверждён их raw output`).toBe(true);
      }
      seen.set(key, rec.strategyId);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* 3. Включена одна стратегия — публикует только она                            */
/* -------------------------------------------------------------------------- */

describe('Инцидент: изоляция по включённой стратегии', () => {
  const cases: Array<[string, string]> = [
    ['V3.0', 'V3_0_HTF_LIQUIDATION_TRAP'],
    ['V3.3', 'V3_3_HTF_ZONE_MITIGATION'],
    ['V2.8', 'V2_8_ZERO_FEE_SNIPER_TRAILING'],
  ];

  for (const [label, id] of cases) {
    withCore(`включён только ${label} — в БД уходит только ${id}`, async () => {
      const { fetcher } = makeFetcher();
      const result = await runStrategyScan({ strategyId: id, symbols: ['BTCUSDT'], fetcher, persist: true });

      for (const rec of h.inserts) {
        expect(rec.strategyId, `включён ${id}, а записан ${rec.strategyId}`).toBe(id);
        expect(String(rec.engineSetupId).startsWith(`${id}-`)).toBe(true);
        expect(rec.strategyVersion).toBe(VERSION_BY_ID[id]);
      }
      const raw = await rawStrategyOutput(id);
      expect(h.inserts.length, `${id}: число записей = числу raw-сетапов`).toBe(raw.length);
      expect(result.provenanceMismatch, 'provenance-наружений быть не должно').toBe(0);
    });
  }
});

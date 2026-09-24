/** @vitest-environment node */
/**
 * CRYPTORA — Гонка за общий статический ledger ядра (инцидент 2026-09-24).
 *
 * Здесь воспроизводится МЕХАНИЗМ инцидента без настоящего ядра и без сети,
 * поэтому тест быстрый и полностью детерминированный. Подставное ядро
 * повторяет форму настоящего бандла (server/services/strategyEngine/entry.ts)
 * и — что критично — его СТАТИЧЕСКУЮ природу:
 *
 *   • `LiveSignalEngine` / `SignalsAuditLedger` — синглтоны со статическим
 *     `instance` и `resetInstance()`;
 *   • конструктор движка берёт журнал через `SignalsAuditLedger.getInstance()`;
 *   • `scanNow()` — долгий асинхронный проход (в проде: десятки символов,
 *     между ними `setTimeout(0)`), во время которого сетапы публикуются в
 *     СОБСТВЕННЫЙ журнал движка.
 *
 * Планировщик запускает стратегии конкурентно (StrategyScheduler.tick() не
 * дожидается конца скана), поэтому три `runStrategyScan` пересекаются по
 * этим статическим синглтонам — ровно как на проде.
 *
 * До фикса `runStrategyScan` читал `SignalsAuditLedger.getInstance()` ПОСЛЕ
 * `await` предзагрузки свечей, то есть брал уже ЧУЖОЙ журнал (того движка,
 * который создали последним), а `buildSignalRecord` ставил в строку
 * `strategyId` вызывающего. Итог на проде: один payload под тремя разными
 * `strategy_id`, плюс потеря сетапов двух других стратегий.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

/* -------------------------------------------------------------------------- */
/* Состояние подставного ядра                                                  */
/* -------------------------------------------------------------------------- */

const h = vi.hoisted(() => ({
  /** Все созданные журналы — чтобы видеть, куда что публиковалось. */
  ledgers: [] as Array<{ id: number; setups: any[] }>,
  /** Все попытки записи в БД. */
  inserts: [] as any[],
  /** Сколько раз движок читал статический синглтон журнала. */
  ledgerGets: 0,

  /* ── Инструментация для состязательного теста (§1) ───────────────────── */

  /** Сколько сканов прямо сейчас ВНУТРИ `scanNow()` замороженного ядра. */
  insideScan: 0,
  /** Максимум `insideScan` за прогон: >1 означает, что мьютекс не работает. */
  maxInsideScan: 0,
  /** Порядок, в котором сканы реально входили в ядро. */
  scanOrder: [] as string[],
  /**
   * Враждебное вмешательство: прямо посередине `scanNow()` обнулить оба
   * статических синглтона — имитация «пока А сканирует, B и C делают
   * resetInstance()». С scan-scoped движком это уже невозможно по построению
   * (мьютекс не пустит B и C в ядро), но ссылка обязана выжить и в этом
   * случае: защита не должна опираться только на блокировку.
   */
  resetDuringScan: false,
  /** Сколько раз кто-то вызывал `LiveSignalEngine.resetInstance()`. */
  engineResets: 0,
  /** registry id скана, который должен УПАСТЬ уже внутри критической секции. */
  failScanFor: null as string | null,

  /** Барьер предзагрузки: сколько сканов село ждать и в каком порядке. */
  gate: [] as Array<{ key: string; release: () => void }>,
  /** Барьер записи в БД (вставки идут ВНЕ мьютекса — там гонка разрешена). */
  insertGate: [] as Array<{ key: string; release: () => void }>,
  insertGateEnabled: false,
}));

const V30 = 'V3_0_HTF_LIQUIDATION_TRAP';
const V33 = 'V3_3_HTF_ZONE_MITIGATION';
const V28 = 'V2_8_ZERO_FEE_SNIPER_TRAILING';
const SETUP_BAR = Date.parse('2026-09-24T14:00:00.000Z');

/** Разные уровни для каждой стратегии — подмена авторства видна сразу. */
const SHAPE_BY_ID: Record<string, { strategyVersion: string; entryZone: [number, number]; stop: number; targets: number[] }> = {
  [V30]: { strategyVersion: '3.0', entryZone: [83612.89, 83734.64], stop: 83297.56, targets: [85389.275, 87278.54] },
  [V33]: { strategyVersion: '3.3', entryZone: [83612.89, 83734.64], stop: 83297.56, targets: [84001.125, 87278.54] },
  [V28]: { strategyVersion: '2.8', entryZone: [83734.64, 83734.64], stop: 83102.11, targets: [84210.5, 85002.75] },
};

const ENGINE_KEY: Record<string, string> = {
  [V30]: 'V3.0',
  [V33]: 'V3.3',
  [V28]: 'V2.8',
};

/** Макротакс: то же, что `setTimeout(0)` между символами в настоящем движке. */
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

vi.mock('../../server/services/strategyEngine/strategyCoreBundle.js', () => {
  /** Статический синглтон, как в src/services/signals/SignalsAuditLedger.ts. */
  class FakeLedger {
    static instance: any = null;
    setups: any[] = [];

    constructor() {
      h.ledgers.push({ id: h.ledgers.length, setups: this.setups });
    }

    static getInstance() {
      h.ledgerGets++;
      if (!FakeLedger.instance) FakeLedger.instance = new FakeLedger();
      return FakeLedger.instance;
    }

    static resetInstance() {
      FakeLedger.instance = null;
    }

    getSetups() {
      return this.setups;
    }
  }

  /** Статический синглтон, как в src/services/signals/live/LiveSignalEngine.ts. */
  class FakeEngine {
    static instance: any = null;
    ledger: any;
    strategies: string[];

    constructor(config: any) {
      // ВАЖНО: журнал берётся в конструкторе — как в настоящем ядре.
      this.ledger = FakeLedger.getInstance();
      this.strategies = [...(config?.strategies ?? [])];
    }

    static getInstance(config?: any) {
      if (!FakeEngine.instance && config) FakeEngine.instance = new FakeEngine(config);
      return FakeEngine.instance;
    }

    /**
     * Как в настоящем ядре: `stop()` для запущенного движка, затем обнуление.
     * Серверный скан этот метод больше НЕ вызывает — движок создаётся через
     * `new`, поэтому чужой скан не может ни остановить, ни обнулить наш.
     * Счётчик нужен, чтобы тест мог доказать это утверждением.
     */
    static resetInstance() {
      h.engineResets += 1;
      if (FakeEngine.instance?.running) FakeEngine.instance.stop();
      FakeEngine.instance = null;
    }

    /** Долгий проход: публикация в СВОЙ журнал — как у настоящего scanNow(). */
    async scanNow() {
      const registryId = Object.keys(ENGINE_KEY).find((id) => ENGINE_KEY[id] === this.strategies[0]);

      h.insideScan += 1;
      h.maxInsideScan = Math.max(h.maxInsideScan, h.insideScan);
      if (registryId) h.scanOrder.push(registryId);
      try {
        await this.runScanBody(registryId);
      } finally {
        h.insideScan -= 1;
      }
    }

    /** Тело скана: именно здесь «долгая» работа и враждебные вмешательства. */
    private async runScanBody(registryId: string | undefined) {
      await tick();
      // ВРАЖДЕБНОЕ ВМЕШАТЕЛЬСТВО: чужой скан делает resetInstance() обоих
      // синглтонов, пока этот скан на середине. Ссылка на журнал уже захвачена
      // и обязана пережить обнуление статики.
      if (h.resetDuringScan) {
        FakeLedger.resetInstance();
        FakeEngine.resetInstance();
      }
      if (registryId && h.failScanFor === registryId) {
        // Падение ВНУТРИ критической секции: блокировка обязана освободиться.
        throw new Error(`scan failed for ${registryId}`);
      }
      if (registryId) {
        const shape = SHAPE_BY_ID[registryId]!;
        this.ledger.setups.push({
          id: `${registryId}-BTCUSDT-${SETUP_BAR}`,
          strategyId: registryId,
          strategyVersion: shape.strategyVersion,
          symbol: 'BTC/USDT',
          direction: 'LONG',
          timeframe: '1h',
          setupOpenTime: SETUP_BAR,
          entryType: 'LIMIT_CORRIDOR',
          entryZone: [...shape.entryZone],
          invalidationLevel: shape.stop,
          targets: [...shape.targets],
          riskRewardRatio: 1.5,
          confirmingFactors: [],
          invalidationFactors: [],
          exitRule: 'x',
          validForBars: 3,
          createdAt: new Date(SETUP_BAR).toISOString(),
          latencyBars: 0,
          status: 'ACTIVE',
        });
      }
      // Скан продолжается: в проде это обход десятков символов.
      await tick();
      await tick();
    }

    getStatus() {
      return { perSymbol: {}, scanCount: 1, scanning: false, lastError: null };
    }

    getRetrospective() {
      return [];
    }
  }

  return {
    loadStrategyCore: async () => ({
      LiveSignalEngine: FakeEngine,
      SignalsAuditLedger: FakeLedger,
      ARCHIVE_TF_MS: { '1h': 3_600_000, '4h': 14_400_000, '1d': 86_400_000 },
      EXEC_TIMEFRAME: '1h',
      CANDLE_LIMIT_1H: 1000,
      CANDLE_LIMIT_4H: 1000,
      CANDLE_LIMIT_1D: 400,
    }),
  };
});

vi.mock('../../server/services/signalRepository.js', () => ({
  insertSignal: async (record: any) => {
    if (h.insertGateEnabled) {
      await new Promise<void>((resolve) => {
        h.insertGate.push({ key: record.strategyId, release: resolve });
      });
    }
    h.inserts.push(record);
    return { inserted: true, signal: null };
  },
  countActiveSignals: async () => 0,
  listOpenSignals: async () => [],
  syncSignalLifecycle: async () => ({ changed: false }),
}));

vi.mock('../../server/services/strategySettings.js', () => ({
  recordScanResult: async () => undefined,
  recordSignalEmitted: async () => undefined,
}));

import {
  runStrategyScan,
  buildSignalRecord,
} from '../../server/services/strategyEngine/strategyEngine.js';

/** Подставной загрузчик свечей: серии уже «предзагружены». */
const fakeFetcher = {
  getCandles: async () => [],
  asProvider: () => ({ isDemo: false, getCandles: async () => [] }),
};

const levelsOf = (rec: any) => ({
  direction: rec.direction,
  entryMin: rec.entryMin,
  entryMax: rec.entryMax,
  stopLoss: rec.stopLoss,
  targets: rec.targets,
});

const expectedLevelsFor = (id: string) => {
  const shape = SHAPE_BY_ID[id]!;
  return {
    direction: 'LONG',
    entryMin: shape.entryZone[0],
    entryMax: shape.entryZone[1],
    stopLoss: shape.stop,
    targets: shape.targets,
  };
};

beforeEach(() => {
  h.inserts.length = 0;
  h.ledgers.length = 0;
  h.ledgerGets = 0;
  h.insideScan = 0;
  h.maxInsideScan = 0;
  h.scanOrder.length = 0;
  h.resetDuringScan = false;
  h.gate.length = 0;
  h.insertGate.length = 0;
  h.insertGateEnabled = false;
  h.engineResets = 0;
  h.failScanFor = null;
});

describe('Инцидент: конкурентные сканы и общий статический ledger', () => {
  it('три скана, запущенные планировщиком, пишут КАЖДЫЙ СВОЙ payload', async () => {
    // Порядок — как у getEnabledStrategies(): ORDER BY strategy_id.
    const results = await Promise.all(
      [V28, V30, V33].map((strategyId) =>
        runStrategyScan({ strategyId, symbols: ['BTCUSDT'], fetcher: fakeFetcher as any, persist: true }),
      ),
    );

    for (const r of results) {
      expect(r.provenanceMismatch, `${r.strategyId}: чужих сетапов быть не должно`).toBe(0);
      expect(r.inserted, `${r.strategyId}: сетап стратегии обязан быть записан`).toBe(1);
    }

    expect(h.inserts, 'каждая из трёх стратегий публикует ровно свой один сетап').toHaveLength(3);

    const byStrategy = new Map<string, any>();
    for (const rec of h.inserts) {
      byStrategy.set(rec.strategyId, rec);
      // Provenance-инвариант: идентификатор сетапа mint'ит САМА стратегия.
      expect(
        String(rec.engineSetupId).startsWith(`${rec.strategyId}-`),
        `engine_setup_id=${rec.engineSetupId} не принадлежит strategy_id=${rec.strategyId}`,
      ).toBe(true);
    }

    expect(byStrategy.size, 'три стратегии — три разные записи, без переименования').toBe(3);
    for (const [id, rec] of byStrategy) {
      expect(levelsOf(rec), `${id}: уровни строки = уровни raw сетапа этой стратегии`).toEqual(expectedLevelsFor(id));
      expect(rec.strategyVersion).toBe(SHAPE_BY_ID[id]!.strategyVersion);
    }
  });

  it('payload V3.0 и V3.3 различается целями — подмена авторства видна', async () => {
    await Promise.all(
      [V28, V30, V33].map((strategyId) =>
        runStrategyScan({ strategyId, symbols: ['BTCUSDT'], fetcher: fakeFetcher as any, persist: true }),
      ),
    );
    const targets = new Map(h.inserts.map((r: any) => [r.strategyId, r.targets]));
    expect(targets.get(V30)).not.toEqual(targets.get(V33));
  });
});

describe('Инцидент: buildSignalRecord не переименовывает чужой сетап', () => {
  const setupOf = (id: string) => {
    const shape = SHAPE_BY_ID[id]!;
    return {
      id: `${id}-BTCUSDT-${SETUP_BAR}`,
      strategyId: id,
      strategyVersion: shape.strategyVersion,
      symbol: 'BTC/USDT',
      direction: 'LONG' as const,
      timeframe: '1h',
      setupOpenTime: SETUP_BAR,
      entryZone: [...shape.entryZone] as [number, number],
      invalidationLevel: shape.stop,
      targets: [...shape.targets],
      createdAt: new Date(SETUP_BAR).toISOString(),
    };
  };

  it('чужой сетап НЕ публикуется под strategy_id вызывающего', () => {
    const built = buildSignalRecord({
      setup: setupOf(V33),
      strategyId: V28,
      fallbackVersion: '2.8',
      engineKey: 'V2.8',
      execTf: '1h',
    });

    expect(built, 'ключ дедупликации есть — null быть не должно').not.toBeNull();
    expect(built!.record, 'relabel запрещён: строки под чужим strategy_id не должно быть').toBeNull();
    expect(built!.provenanceMismatch, 'источник подмены обязан быть назван').toBe(V33);
  });

  it('свой сетап публикуется без изменений уровней', () => {
    const built = buildSignalRecord({
      setup: setupOf(V28),
      strategyId: V28,
      fallbackVersion: '2.8',
      engineKey: 'V2.8',
      execTf: '1h',
    });

    expect(built!.record).not.toBeNull();
    expect(built!.provenanceMismatch).toBeUndefined();
    expect(built!.record!.strategyId).toBe(V28);
    expect(levelsOf(built!.record)).toEqual(expectedLevelsFor(V28));
  });

  it('свой сетап после фикса получает provenance_status = VERIFIED', () => {
    const built = buildSignalRecord({
      setup: setupOf(V30),
      strategyId: V30,
      fallbackVersion: '3.0',
      engineKey: 'V3.0',
      execTf: '1h',
    });
    // Доказательство происхождения ставится ДО записи: сетап помнит, какая
    // стратегия его создала, и это запрошенная стратегия.
    expect(built!.record!.provenanceStatus).toBe('VERIFIED');
  });

  it('сетап без strategyId пишется как UNKNOWN, а не VERIFIED (fail-closed)', () => {
    const setup: any = setupOf(V30);
    delete setup.strategyId;
    const built = buildSignalRecord({
      setup,
      strategyId: V30,
      fallbackVersion: '3.0',
      engineKey: 'V3.0',
      execTf: '1h',
    });
    // Нет поля — нет доказательства. «Наверное, это наша стратегия» запрещено:
    // такая строка сохраняется, но не мониторится и не идёт в статистику.
    expect(built!.record!.provenanceStatus).toBe('UNKNOWN');
  });

  it('сетап без strategyId не проходит проверку молча: relabel запрещён и здесь', () => {
    const setup: any = setupOf(V30);
    delete setup.strategyId;
    const built = buildSignalRecord({
      setup,
      strategyId: V30,
      fallbackVersion: '3.0',
      engineKey: 'V3.0',
      execTf: '1h',
    });
    // Провенанс неизвестен ⇒ запись допустима (прежнее поведение), но levels
    // обязаны остаться уровнями сетапа, а не «улучшенными» вызывающим.
    expect(levelsOf(built!.record)).toEqual(expectedLevelsFor(V30));
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * СОСТЯЗАТЕЛЬНАЯ ИЗОЛЯЦИЯ (§1): барьерное перемешивание трёх сканов.
 *
 * Задача — доказать, что никакая перестановка interleaving'а не даст чужой
 * payload под чужим `strategy_id`, и что в замороженном ядре в каждый момент
 * находится РОВНО ОДИН скан.
 *
 * Как устроено:
 *   • барьер в предзагрузке свечей (она ВНЕ мьютекса) — три скана гарантированно
 *     «зависают» до входа в критическую секцию, а тест выпускает их в выбранном
 *     порядке. Никаких `sleep` и таймингов: управление только явным release;
 *   • барьер в `insertSignal` (тоже ВНЕ мьютекса) — записи перемешиваются уже
 *     после скана, то есть гонка моделируется и там, где она разрешена;
 *   • счётчик `insideScan` — прямая проверка «в ядре один скан»;
 *   • флаг `resetDuringScan` — враждебное «пока А сканирует, B и C делают
 *     `resetInstance()` обоих синглтонов». Защита обязана выстоять и без
 *     мьютекса: ссылка на журнал захвачена, обнуление статики её не трогает.
 *
 * Прогон повторяется для прямого и обратного порядка выпуска: если бы корректность
 * зависела от порядка, один из двух прогонов упал бы.
 * ═════════════════════════════════════════════════════════════════════════ */

/** Фетчер, который на ПЕРВОМ запросе садится на барьер и ждёт явного release. */
function gatedFetcher(key: string): any {
  let used = false;
  return {
    getCandles: async () => {
      if (!used) {
        used = true;
        await new Promise<void>((resolve) => {
          h.gate.push({ key, release: resolve });
        });
      }
      return [];
    },
    asProvider: () => ({ isDemo: false, getCandles: async () => [] }),
  };
}

/** Ждать, пока на барьере не соберутся все `n` сканов. */
async function waitOnGate(n: number): Promise<void> {
  for (let i = 0; i < 500 && h.gate.length < n; i += 1) {
    await tick();
  }
  if (h.gate.length < n) {
    throw new Error(`на барьере ${h.gate.length} из ${n}: сканы не сошлись`);
  }
}

/** Выпустить сканов с барьера в заданном порядке, по одному. */
async function releaseInOrder(order: string[]): Promise<void> {
  for (const key of order) {
    const entry = h.gate.find((g) => g.key === key);
    if (!entry) throw new Error(`скан ${key} не стоит на барьере`);
    entry.release();
    // Дать выпущенному скану дойти до конца критической секции, прежде чем
    // выпускать следующий: порядок входа в ядро должен бытьDeterministic.
    await tick();
    await tick();
    await tick();
  }
}

/** Единая проверка «каждая стратегия получила ровно свой payload». */
function expectOwnPayloads(): void {
  expect(h.inserts, 'три стратегии — три записи').toHaveLength(3);
  const byStrategy = new Map<string, any>();
  for (const rec of h.inserts) {
    byStrategy.set(rec.strategyId, rec);
    expect(
      String(rec.engineSetupId).startsWith(`${rec.strategyId}-`),
      `engine_setup_id=${rec.engineSetupId} не принадлежит strategy_id=${rec.strategyId}`,
    ).toBe(true);
    expect(rec.provenanceStatus, 'происхождение доказано ДО записи').toBe('VERIFIED');
  }
  expect(byStrategy.size, 'три разные записи, без переименования').toBe(3);
  for (const [id, rec] of byStrategy) {
    expect(levelsOf(rec), `${id}: уровни = уровни raw сетапа этой стратегии`).toEqual(expectedLevelsFor(id));
    expect(rec.strategyVersion).toBe(SHAPE_BY_ID[id]!.strategyVersion);
  }
}

describe('Состязательная изоляция: барьерное перемешивание A/B/C', () => {
  for (const [label, order] of [
    ['прямой порядок A→B→C', [V28, V30, V33]],
    ['обратный порядок C→B→A', [V33, V30, V28]],
    ['перемешанный порядок B→C→A', [V30, V33, V28]],
  ] as Array<[string, string[]]>) {
    it(`${label}: каждый скан публикует СВОЙ payload`, async () => {
      const scans = order.map((strategyId) =>
        runStrategyScan({
          strategyId,
          symbols: ['BTCUSDT'],
          fetcher: gatedFetcher(strategyId) as any,
          persist: true,
        }),
      );

      await waitOnGate(3);
      await releaseInOrder(order);
      const results = await Promise.all(scans);

      for (const r of results) {
        expect(r.provenanceMismatch, `${r.strategyId}: чужих сетапов быть не должно`).toBe(0);
        expect(r.inserted, `${r.strategyId}: сетап стратегии обязан быть записан`).toBe(1);
      }

      expectOwnPayloads();
      // Порядок входа в ядро = порядку выпуска: мьютекс FIFO, а не «кто успел».
      expect(h.scanOrder).toEqual(order);
    });
  }

  it('в замороженном ядре никогда нет двух сканов одновременно', async () => {
    // Шесть сканов (каждая стратегия дважды) — заведомо больше, чем ядро должно
    // пускать внутрь. Барьер держит их всех до входа в критическую секцию.
    const ids = [V28, V30, V33, V28, V30, V33];
    const fetchers = new Map<string, any>();
    const scans = ids.map((strategyId, i) => {
      const f = gatedFetcher(`${strategyId}#${i}`);
      fetchers.set(`${strategyId}#${i}`, f);
      return runStrategyScan({ strategyId, symbols: ['BTCUSDT'], fetcher: f as any, persist: true });
    });

    await waitOnGate(ids.length);
    // Выпускаем ВСЕ разом — худший случай: все хотят в ядро одновременно.
    const waiting = [...h.gate];
    for (const g of waiting) g.release();

    await Promise.all(scans);

    expect(h.maxInsideScan, 'мьютекс обязан не пускать в ядро больше одного скана').toBe(1);
    expect(h.insideScan, 'после завершения внутри никого не осталось').toBe(0);
  });

  it('чужой resetInstance() посреди скана не уводит сетап в чужой журнал', async () => {
    // ВРАЖДЕБНЫЙ СЦЕНАРИЙ: пока скан на середине scanNow(), кто-то обнуляет
    // ОБА статических синглтона. С scan-scoped движком и мьютексом это
    // невозможно по построению, но защита обязана держаться не только на
    // блокировке: ссылка на журнал захвачена синхронно, и никакое обнуление
    // статики её не трогает.
    h.resetDuringScan = true;

    const scans = [V28, V30, V33].map((strategyId) =>
      runStrategyScan({
        strategyId,
        symbols: ['BTCUSDT'],
        fetcher: gatedFetcher(strategyId) as any,
        persist: true,
      }),
    );

    await waitOnGate(3);
    await releaseInOrder([V28, V30, V33]);
    const results = await Promise.all(scans);

    for (const r of results) {
      expect(r.provenanceMismatch).toBe(0);
      expect(r.inserted).toBe(1);
    }
    expectOwnPayloads();
    expect(h.engineResets, 'вмешательство действительно произошло').toBeGreaterThanOrEqual(3);
  });

  it('гонка при записи в БД (вне мьютекса) не подменяет уровни стратегий', async () => {
    // Запись идёт ВНЕ критической секции — там параллелизм разрешён и обязан
    // быть безопасным: уровни к этому моменту уже зафиксированы в своих
    // записях, перемешивание INSERT'ов ничего не переименовывает.
    h.insertGateEnabled = true;

    const scans = [V28, V30, V33].map((strategyId) =>
      runStrategyScan({
        strategyId,
        symbols: ['BTCUSDT'],
        fetcher: gatedFetcher(strategyId) as any,
        persist: true,
      }),
    );

    await waitOnGate(3);
    await releaseInOrder([V28, V30, V33]);

    // Все три скана дошли до вставки и встали на второй барьер.
    for (let i = 0; i < 500 && h.insertGate.length < 3; i += 1) await tick();
    expect(h.insertGate.length, 'все три вставки сели на барьер').toBe(3);

    // Выпускаем вставки в ОБРАТНОМ порядке относительно сканов.
    for (const key of [V33, V30, V28]) {
      const entry = h.insertGate.find((g) => g.key === key);
      expect(entry, `вставка ${key} должна стоять на барьере`).toBeTruthy();
      entry!.release();
      await tick();
    }

    await Promise.all(scans);
    expectOwnPayloads();
  });

  it('упавший скан не роняет мьютекс: очередь продолжается', async () => {
    // Критическая секция освобождается в `finally`. Если бы упавший скан
    // удерживал блокировку, следующие сканы висели бы вечно — и это был бы
    // отказ всего планировщика, а не одной стратегии.
    h.failScanFor = V30; // средний скан падает УЖЕ ВНУТРИ критической секции

    const order = [V28, V30, V33];
    const scans = order.map((strategyId) =>
      runStrategyScan({
        strategyId,
        symbols: ['BTCUSDT'],
        fetcher: gatedFetcher(strategyId) as any,
        persist: true,
      }).then(
        (r) => ({ ok: true as const, strategyId, r }),
        (e: Error) => ({ ok: false as const, strategyId, message: e.message }),
      ),
    );

    await waitOnGate(3);
    for (const g of [...h.gate]) g.release();
    const results = await Promise.all(scans);

    // Никто не завис: все три промиса завершились, а не висят на блокировке.
    expect(results).toHaveLength(3);

    const failed = results.filter((r: any) => !r.ok);
    expect(failed, 'ровно один скан упал').toHaveLength(1);
    expect(failed[0].strategyId).toBe(V30);

    const ok = results.filter((r: any) => r.ok);
    expect(ok.map((r: any) => r.strategyId).sort()).toEqual([V28, V33].sort());
    for (const r of ok) {
      expect((r as any).r.inserted, `${(r as any).strategyId}: скан после упавшего должен пройти`).toBe(1);
    }

    // Две записи — двух выживших стратегий, каждая со своим payload.
    expect(h.inserts).toHaveLength(2);
    for (const rec of h.inserts) {
      expect(String(rec.engineSetupId).startsWith(`${rec.strategyId}-`)).toBe(true);
      expect(levelsOf(rec)).toEqual(expectedLevelsFor(rec.strategyId));
    }
    expect(h.insideScan, 'после падения внутри никого не осталось').toBe(0);
  });
});

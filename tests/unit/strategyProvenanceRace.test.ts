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

    static resetInstance() {
      FakeEngine.instance = null;
    }

    /** Долгий проход: публикация в СВОЙ журнал — как у настоящего scanNow(). */
    async scanNow() {
      const registryId = Object.keys(ENGINE_KEY).find((id) => ENGINE_KEY[id] === this.strategies[0]);
      await tick();
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

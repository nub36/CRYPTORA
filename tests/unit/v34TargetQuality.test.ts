/**
 * V3.4 — фильтр качества структурных целей.
 *
 * Тесты детерминированные и работают на синтетических фикстурах: сеть, БД и
 * реальные свечи не нужны. Блоки A–F соответствуют требуемому набору проверок.
 *
 * Главное, что здесь доказывается:
 *   A — V3.3 НЕ изменилась: геометрия, которую она принимала, принимается и
 *       сейчас; запись V3.3 не мутируется обёрткой V3.4;
 *   B — порог TP1 = 0.50 R (LONG и SHORT), граница включительная;
 *   C — порог TP2 = 1.00 R (LONG и SHORT) при заведомо проходящем TP1;
 *   D — BTC-подобный сетап: V3.3 принимает, V3.4 отклоняет TARGET_QUALITY_TP1;
 *   E — V3.4 нигде не включена по умолчанию;
 *   F — точность: низкоценовой актив (PEPE-подобный) не ломается и точность
 *       расчёта не срезается до точности отображения.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  canonicalEntryReference, evaluateTargetQuality, V34_TP1_MIN_R, V34_TP2_MIN_R,
} from '@/services/signals/live/targetQuality';
import {
  applyTargetQualityGate, V34_STRATEGY_ID, V34_STRATEGY_VERSION,
} from '@/services/signals/live/replays/v34LiveReplay';
import { V33_STRATEGY_ID, V33_STRATEGY_VERSION } from '@/services/signals/live/replays/v33LiveReplay';
import { corridorGeometryOk, rrFrom } from '@/services/signals/live/replays/shared';
import { V33_CONSTANTS } from '@/services/strategyArchive/definitions/v3_3-htf-zone-mitigation/v33Core';
import type { ReplayRecord } from '@/services/signals/live/replays/types';
import { LiveSignalEngine, STRATEGY_IDS } from '@/services/signals/live/LiveSignalEngine';
import { PRODUCT_STRATEGIES, getStrategy, isKnownStrategyId } from '../../server/services/strategyCatalog.js';

const ROOT = path.resolve(__dirname, '../..');

/** Минимальная валидная запись реплея — ровно те поля, что читает фильтр. */
function record(p: {
  direction: 'LONG' | 'SHORT'; entryZone: [number, number]; stop: number; targets: [number, number];
}): ReplayRecord {
  return {
    strategyId: V33_STRATEGY_ID,
    strategyVersion: V33_STRATEGY_VERSION,
    symbol: 'BTC',
    direction: p.direction,
    setupOpenTime: 1_700_000_000_000,
    setupCloseTime: 1_700_003_599_999,
    setupClose: (p.entryZone[0] + p.entryZone[1]) / 2,
    entryType: 'LIMIT_CORRIDOR',
    entryZone: p.entryZone,
    stop: p.stop,
    targets: [...p.targets],
    riskRewardRatio: rrFrom(p.direction, (p.entryZone[0] + p.entryZone[1]) / 2, p.stop, p.targets[1]),
    validForBars: V33_CONSTANTS.CORRIDOR_EXPIRY_BARS,
    exitRule: 'V3.3',
    confirmingFactors: ['зона'],
    invalidationFactors: ['стоп'],
    fill: null,
    outcome: null,
    publishable: true,
    publishNote: null,
    meta: { zoneType: 'OB' },
  };
}

/* ═════════════════════════════════════ A ═════════════════════════════════ */

describe('A · V3.3 не изменилась', () => {
  it('константы V3.3 остались прежними (фильтр V3.4 не трогает математику базы)', () => {
    expect(V33_CONSTANTS.MIN_RVOL).toBe(1.25);
    expect(V33_CONSTANTS.CORRIDOR_ATR_FRAC).toBe(0.10);
    expect(V33_CONSTANTS.CORRIDOR_EXPIRY_BARS).toBe(3);
    expect(V33_CONSTANTS.STOP_BUFFER_ATR).toBe(0.15);
    expect(V33_CONSTANTS.TIMEOUT_BARS).toBe(48);
    expect(V33_CONSTANTS.MAKER_BPS).toBe(2);
    expect(V33_CONSTANTS.TAKER_BPS).toBe(5);
  });

  it('геометрия R1≈0.134 / R2≈2.30 по-прежнему ПРИНИМАЕТСЯ V3.3', () => {
    // Фикстура из аудита 2026-09-30 (BTC SHORT), середина коридора — та точка,
    // от которой считает витрина V3.3.
    const ok = corridorGeometryOk('SHORT', 84154.2, 84245.9, 84911.8, 84104.5, 82563.0);
    expect(ok).toBe(true);

    const mid = (84154.2 + 84245.9) / 2;
    const riskMid = 84911.8 - mid;
    expect((mid - 84104.5) / riskMid).toBeCloseTo(0.1342, 4);
    expect((mid - 82563.0) / riskMid).toBeCloseTo(2.3000, 4);
    // Ровно то число, которое V3.3 кладёт в riskRewardRatio.
    expect(rrFrom('SHORT', mid, 84911.8, 82563.0)).toBeCloseTo(2.3, 3);
  });

  it('обёртка V3.4 не мутирует исходную запись V3.3', () => {
    const src = record({ direction: 'SHORT', entryZone: [84154.2, 84245.9], stop: 84911.8, targets: [84104.5, 82563.0] });
    const snapshot = JSON.parse(JSON.stringify(src));
    const out = applyTargetQualityGate(src);

    expect(JSON.parse(JSON.stringify(src))).toEqual(snapshot);
    expect(src.strategyId).toBe(V33_STRATEGY_ID);
    expect(out.strategyId).toBe(V34_STRATEGY_ID);
    expect(out.strategyVersion).toBe(V34_STRATEGY_VERSION);
    // Массивы не разделяются по ссылке.
    expect(out.entryZone).not.toBe(src.entryZone);
    expect(out.targets).not.toBe(src.targets);
    // Уровни НЕ сдвинуты: V3.4 не двигает цели, а отклоняет сетап.
    expect(out.entryZone).toEqual(src.entryZone);
    expect(out.stop).toBe(src.stop);
    expect(out.targets).toEqual(src.targets);
  });
});

/* ═════════════════════════════════════ B ═════════════════════════════════ */

describe('B · порог TP1 = 0.50 R', () => {
  // LONG: худшая граница коридора = верхняя (100), стоп 90 ⇒ риск ровно 10.
  const long = (tp1: number) => evaluateTargetQuality({
    direction: 'LONG', entryLow: 99, entryHigh: 100, stop: 90, tp1, tp2: 120,
  });
  // SHORT: худшая граница = нижняя (100), стоп 110 ⇒ риск ровно 10.
  const short = (tp1: number) => evaluateTargetQuality({
    direction: 'SHORT', entryLow: 100, entryHigh: 101, stop: 110, tp1, tp2: 80,
  });

  it('LONG: 0.49 R отклоняется с TARGET_QUALITY_TP1', () => {
    const r = long(104.9);
    expect(r.accepted).toBe(false);
    expect(r.reason).toBe('TARGET_QUALITY_TP1');
    expect(r.entryReference).toBe(100);
    expect(r.initialRisk).toBe(10);
    expect(r.tp1R!).toBeLessThan(V34_TP1_MIN_R);
  });

  it('LONG: ровно 0.50 R ПРИНИМАЕТСЯ (граница включительная)', () => {
    const r = long(105);
    expect(r.tp1R).toBe(0.5);
    expect(r.accepted).toBe(true);
    expect(r.reason).toBeNull();
  });

  it('LONG: 0.51 R принимается', () => {
    expect(long(105.1).accepted).toBe(true);
  });

  it('SHORT: 0.49 R отклоняется с TARGET_QUALITY_TP1', () => {
    const r = short(95.1);
    expect(r.accepted).toBe(false);
    expect(r.reason).toBe('TARGET_QUALITY_TP1');
    expect(r.entryReference).toBe(100);
  });

  it('SHORT: ровно 0.50 R ПРИНИМАЕТСЯ', () => {
    const r = short(95);
    expect(r.tp1R).toBe(0.5);
    expect(r.accepted).toBe(true);
  });

  it('SHORT: 0.51 R принимается', () => {
    expect(short(94.9).accepted).toBe(true);
  });

  it('канонический вход — ХУДШАЯ граница коридора (фактический фил раннера)', () => {
    expect(canonicalEntryReference('LONG', 99, 100)).toBe(100);
    expect(canonicalEntryReference('SHORT', 100, 101)).toBe(100);
  });
});

/* ═════════════════════════════════════ C ═════════════════════════════════ */

describe('C · порог TP2 = 1.00 R (при заведомо проходящем TP1)', () => {
  // TP1 = 0.8 R — выше порога, поэтому причина отказа может быть только TP2.
  const long = (tp2: number) => evaluateTargetQuality({
    direction: 'LONG', entryLow: 99, entryHigh: 100, stop: 90, tp1: 108, tp2,
  });
  const short = (tp2: number) => evaluateTargetQuality({
    direction: 'SHORT', entryLow: 100, entryHigh: 101, stop: 110, tp1: 92, tp2,
  });

  it('LONG: 0.99 R отклоняется именно по TP2', () => {
    const r = long(109.9);
    expect(r.tp1R!).toBeGreaterThanOrEqual(V34_TP1_MIN_R);
    expect(r.accepted).toBe(false);
    expect(r.reason).toBe('TARGET_QUALITY_TP2');
  });

  it('LONG: ровно 1.00 R ПРИНИМАЕТСЯ', () => {
    const r = long(110);
    expect(r.tp2R).toBe(1);
    expect(r.accepted).toBe(true);
    expect(r.reason).toBeNull();
  });

  it('SHORT: 0.99 R отклоняется именно по TP2', () => {
    const r = short(90.1);
    expect(r.tp1R!).toBeGreaterThanOrEqual(V34_TP1_MIN_R);
    expect(r.accepted).toBe(false);
    expect(r.reason).toBe('TARGET_QUALITY_TP2');
  });

  it('SHORT: ровно 1.00 R ПРИНИМАЕТСЯ', () => {
    const r = short(90);
    expect(r.tp2R).toBe(1);
    expect(r.accepted).toBe(true);
  });

  it('порог TP2 равен 1.00, порог TP1 — 0.50 (значения не «уехали»)', () => {
    expect(V34_TP1_MIN_R).toBe(0.5);
    expect(V34_TP2_MIN_R).toBe(1.0);
  });
});

/* ═════════════════════════════════════ D ═════════════════════════════════ */

describe('D · BTC-подобная фикстура: V3.3 принимает, V3.4 отклоняет', () => {
  const src = () => record({
    direction: 'SHORT', entryZone: [84154.2, 84245.9], stop: 84911.8, targets: [84104.5, 82563.0],
  });

  it('V3.3 принимает сетап (единственный её фильтр — геометрия)', () => {
    const r = src();
    expect(corridorGeometryOk(r.direction, r.entryZone[0], r.entryZone[1], r.stop, r.targets[0]!, r.targets[1]!)).toBe(true);
    expect(r.publishable).toBe(true);
  });

  it('V3.4 отклоняет его с TARGET_QUALITY_TP1 и НЕ трогает уровни', () => {
    const out = applyTargetQualityGate(src());
    expect(out.publishable).toBe(false);
    expect(out.meta!.targetQualityRejectReason).toBe('TARGET_QUALITY_TP1');
    expect(out.outcome!.exitReason).toBe('TARGET_QUALITY_TP1');
    expect(out.outcome!.status).toBe('CANCELLED');
    expect(out.fill).toBeNull();
    expect(out.targets).toEqual([84104.5, 82563.0]);
  });

  it('TP2 у этой фикстуры порог проходит — причина отказа однозначна', () => {
    const q = evaluateTargetQuality({
      direction: 'SHORT', entryLow: 84154.2, entryHigh: 84245.9, stop: 84911.8, tp1: 84104.5, tp2: 82563.0,
    });
    expect(q.entryReference).toBe(84154.2);
    expect(q.initialRisk).toBeCloseTo(757.6, 6);
    expect(q.tp1R).toBeCloseTo(0.0656, 4);
    expect(q.tp2R).toBeCloseTo(2.1003, 4);
    expect(q.tp2R!).toBeGreaterThanOrEqual(V34_TP2_MIN_R);
    expect(q.reason).toBe('TARGET_QUALITY_TP1');
  });

  it('под ЛЮБЫМ якорем входа (худшая граница или середина) отказ остаётся по TP1', () => {
    // Середина коридора даёт R1 = 0.134 — тоже ниже 0.50. Вывод устойчив к
    // выбору якоря, поэтому фикстура годится как эталон регрессии.
    const mid = (84154.2 + 84245.9) / 2;
    expect((mid - 84104.5) / (84911.8 - mid)).toBeLessThan(V34_TP1_MIN_R);
    expect((84154.2 - 84104.5) / (84911.8 - 84154.2)).toBeLessThan(V34_TP1_MIN_R);
  });
});

/* ═════════════════════════════════════ E ═════════════════════════════════ */

describe('E · V3.4 зарегистрирована, но НИГДЕ не включена по умолчанию', () => {
  it('каталог сервера знает V3.4 и отдаёт её как производную без бэктеста', () => {
    expect(isKnownStrategyId('V3_4_HTF_ZONE_MITIGATION_QUALITY')).toBe(true);
    const s = getStrategy('V3_4_HTF_ZONE_MITIGATION_QUALITY');
    expect(s).not.toBeNull();
    expect(s!.version).toBe('3.4');
    expect(s!.execTimeframe).toBe('1h');
    expect(s!.timeframes).toEqual(['1h', '4h']);
    expect(s!.badge).toBe('DERIVED_NO_BACKTEST');
  });

  it('в каталоге НЕТ поля, которое включало бы стратегию', () => {
    for (const s of PRODUCT_STRATEGIES) {
      expect(Object.prototype.hasOwnProperty.call(s, 'enabled'), `${s.id}`).toBe(false);
    }
  });

  it('движок по умолчанию не запускает V3.4', () => {
    const provider = { getCandles: async () => [], isDemo: true } as any;
    const e = new LiveSignalEngine({ provider });
    expect(e.getStatus().strategies).toEqual(['V3.0', 'V3.3', 'V2.8']);
    expect(e.getStatus().strategies).not.toContain('V3.4');
    // Но ключ существует и указывает на правильный registry id.
    expect(STRATEGY_IDS['V3.4']).toBe('V3_4_HTF_ZONE_MITIGATION_QUALITY');
  });

  it('миграция 014 регистрирует V3.4 строго ВЫКЛЮЧЕННОЙ и не включает ничего другого', () => {
    const sql = fs.readFileSync(path.join(ROOT, 'server/db/migrations/014_strategy_settings_v3_4.sql'), 'utf8');
    expect(sql).toContain('V3_4_HTF_ZONE_MITIGATION_QUALITY');
    expect(sql).toMatch(/VALUES \('V3_4_HTF_ZONE_MITIGATION_QUALITY', FALSE/);
    expect(sql).toContain('ON CONFLICT (strategy_id) DO NOTHING');
    // Ни одного UPDATE в ИСПОЛНЯЕМОМ SQL: существующие переключатели миграция
    // не трогает. Комментарии отбрасываем — они обсуждают то, чего нет.
    const executable = sql.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n');
    expect(executable).not.toMatch(/\bUPDATE\b/i);
    expect(executable).not.toMatch(/enabled\s*=\s*TRUE/i);
    expect(executable).toMatch(/VALUES \('V3_4_HTF_ZONE_MITIGATION_QUALITY', FALSE/);
  });

  it('серверный слой настроек читает только enabled = TRUE (отсутствие строки ≠ включено)', async () => {
    const src = fs.readFileSync(path.join(ROOT, 'server/services/strategySettings.js'), 'utf8');
    expect(src).toMatch(/WHERE\s+enabled\s*=\s*TRUE/i);
  });
});

/* ═════════════════════════════════════ F ═════════════════════════════════ */

describe('F · точность: низкоценовой актив (PEPE-подобный)', () => {
  // Цены порядка 1e-5: любая попытка привести их к «точности отображения»
  // (2 знака) обнуляет и вход, и стоп.
  const input = {
    direction: 'LONG' as const,
    entryLow: 0.00001230, entryHigh: 0.00001234,
    stop: 0.00001200, tp1: 0.00001251, tp2: 0.00001275,
  };

  it('полная точность: TP1 ровно на пороге 0.50 R ⇒ ПРИНЯТО', () => {
    const q = evaluateTargetQuality(input);
    expect(q.entryReference).toBe(0.00001234);
    expect(q.initialRisk).toBeCloseTo(3.4e-7, 15);
    expect(q.tp1R).toBeCloseTo(0.5, 12);
    expect(q.tp2R).toBeCloseTo(1.2058823529, 8);
    expect(q.accepted).toBe(true);
    expect(q.reason).toBeNull();
  });

  it('если бы цены округлили до точности отображения, сетап развалился бы — значит округления в расчёте нет', () => {
    const r2 = (x: number) => Math.round(x * 100) / 100;
    const broken = evaluateTargetQuality({
      direction: 'LONG',
      entryLow: r2(input.entryLow), entryHigh: r2(input.entryHigh),
      stop: r2(input.stop), tp1: r2(input.tp1), tp2: r2(input.tp2),
    });
    expect(broken.accepted).toBe(false);
    expect(broken.reason).toBe('GEOMETRY_INVALID');
  });

  it('метаданные V3.4 хранят вход и риск БЕЗ округления', () => {
    const out = applyTargetQualityGate(record({
      direction: 'LONG', entryZone: [input.entryLow, input.entryHigh], stop: input.stop,
      targets: [input.tp1, input.tp2],
    }));
    expect(out.meta!.entryReference).toBe(0.00001234);
    expect(out.meta!.entryReferenceRule).toBe('WORST_CORRIDOR_EDGE_ACTUAL_FILL');
    expect(out.meta!.initialRisk).toBeCloseTo(3.4e-7, 15);
    expect(out.meta!.targetQualityRejectReason).toBeNull();
    expect(out.publishable).toBe(true);
    // Провенанс базы сохранён в данных.
    expect(out.meta!.baseStrategyId).toBe(V33_STRATEGY_ID);
    expect(out.meta!.baseStrategyVersion).toBe(V33_STRATEGY_VERSION);
  });
});

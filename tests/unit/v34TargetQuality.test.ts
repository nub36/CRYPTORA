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
  canonicalEntryReference, evaluateTargetQuality, expandEntryZone,
  V34_ENTRY_ZONE_ATR_PAD, V34_TP1_MIN_R, V34_TP2_MIN_R,
} from '@/services/signals/live/targetQuality';
import {
  applyTargetQualityGate, atrFromV33Corridor, V34_STRATEGY_ID, V34_STRATEGY_VERSION,
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
    // Стоп и цели НЕ сдвинуты. Единственный изменённый уровень — границы входа.
    expect(out.stop).toBe(src.stop);
    expect(out.targets).toEqual(src.targets);
    expect(out.meta!.baseEntryZoneLow).toBe(src.entryZone[0]);
    expect(out.meta!.baseEntryZoneHigh).toBe(src.entryZone[1]);
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

  it('V3.4 отклоняет его и НЕ трогает ни стоп, ни цели', () => {
    // TP1 (84104.5) лежит всего в 49.7 пунктах от нижней границы V3.3, а
    // расширение опускает границу на 114.6 — цель оказывается ВНУТРИ зоны
    // входа. Это невалидная геометрия, и правильный ответ — отклонить сетап.
    const out = applyTargetQualityGate(src());
    expect(out.publishable).toBe(false);
    expect(out.meta!.targetQualityRejectReason).toBe('GEOMETRY_INVALID');
    expect(out.outcome!.exitReason).toBe('GEOMETRY_INVALID');
    expect(out.outcome!.status).toBe('CANCELLED');
    expect(out.fill).toBeNull();
    // Стоп и цели остались ровно теми, что нашла структура V3.3.
    expect(out.stop).toBe(84911.8);
    expect(out.targets).toEqual([84104.5, 82563.0]);
  });

  it('без расширения зоны причиной был бы именно TARGET_QUALITY_TP1', () => {
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

  it('метаданные V3.4 хранят базовую зону и провенанс без округления', () => {
    const out = applyTargetQualityGate(record({
      direction: 'LONG', entryZone: [input.entryLow, input.entryHigh], stop: input.stop,
      targets: [input.tp1, input.tp2],
    }));
    expect(out.meta!.baseEntryZoneLow).toBe(input.entryLow);
    expect(out.meta!.baseEntryZoneHigh).toBe(input.entryHigh);
    expect(out.meta!.entryReferenceRule).toBe('WORST_CORRIDOR_EDGE_ACTUAL_FILL');
    expect(out.meta!.entryZoneRule).toBe('V33_CORRIDOR_EXPANDED_BY_0_25_ATR_EACH_SIDE');
    // Провенанс базы сохранён в данных.
    expect(out.meta!.baseStrategyId).toBe(V33_STRATEGY_ID);
    expect(out.meta!.baseStrategyVersion).toBe(V33_STRATEGY_VERSION);
  });
});

/* ═════════════════════════════════════ G ═════════════════════════════════ */
/**
 * G · Расширение коридора входа V3.4 (0.25 ATR в каждую сторону).
 *
 * Фикстуры подобраны так, чтобы арифметика была точной в двоичной плавающей
 * точке: base = close ± 0.10·ATR при close = 1000 и ATR = 100 даёт коридор
 * [990, 1010], восстановленный ATR ровно 100 и отступ ровно 25.
 */
describe('G · расширение Entry Zone', () => {
  const BASE_LOW = 990;
  const BASE_HIGH = 1010;
  const ATR = 100;
  const PAD = 25;

  /** LONG, который V3.4 ПРИНИМАЕТ после расширения. */
  const longOk = () => record({
    direction: 'LONG', entryZone: [BASE_LOW, BASE_HIGH], stop: 900, targets: [1110, 1250],
  });
  /** SHORT, который V3.4 ПРИНИМАЕТ после расширения (зеркало longOk). */
  const shortOk = () => record({
    direction: 'SHORT', entryZone: [BASE_LOW, BASE_HIGH], stop: 1100, targets: [890, 750],
  });

  /* ── 1. V3.3 Entry Zone не изменилась ─────────────────────────────────── */
  it('1 · зона V3.3 не меняется: источник не мутируется, база сохранена в meta', () => {
    for (const src of [longOk(), shortOk()]) {
      const snapshot = JSON.parse(JSON.stringify(src));
      const out = applyTargetQualityGate(src);

      expect(src.entryZone).toEqual([BASE_LOW, BASE_HIGH]);
      expect(JSON.parse(JSON.stringify(src))).toEqual(snapshot);
      expect(out.meta!.baseEntryZoneLow).toBe(BASE_LOW);
      expect(out.meta!.baseEntryZoneHigh).toBe(BASE_HIGH);
    }
  });

  it('1b · формула коридора V3.3 в коде не тронута (close ± 0.10 ATR)', () => {
    expect(V33_CONSTANTS.CORRIDOR_ATR_FRAC).toBe(0.10);
    const v33 = fs.readFileSync(
      path.join(ROOT, 'src/services/signals/live/replays/v33LiveReplay.ts'), 'utf8',
    );
    expect(v33).toContain('const half = CORRIDOR_ATR_FRAC * atr;');
    expect(v33).toContain('zoneLow: c.close - half, zoneHigh: c.close + half');
    // V3.3 ничего не знает ни о расширении, ни о фильтре качества.
    expect(v33).not.toMatch(/targetQuality|expandEntryZone|V34_/);
  });

  /* ── 2. Зона V3.4 шире ────────────────────────────────────────────────── */
  it('2 · зона V3.4 строго шире зоны V3.3 — с обеих сторон', () => {
    for (const [src, dir] of [[longOk(), 'LONG'], [shortOk(), 'SHORT']] as const) {
      const out = applyTargetQualityGate(src);
      const [low, high] = out.entryZone;
      expect(low, dir).toBeLessThan(BASE_LOW);
      expect(high, dir).toBeGreaterThan(BASE_HIGH);
      expect(high - low, dir).toBeGreaterThan(BASE_HIGH - BASE_LOW);
      expect(high - low, dir).toBe(70); // 20 + 2×25
    }
  });

  /* ── 3. База целиком внутри расширенной зоны ──────────────────────────── */
  it('3 · структурная зона V3.3 целиком содержится в зоне V3.4', () => {
    for (const [src, dir] of [[longOk(), 'LONG'], [shortOk(), 'SHORT']] as const) {
      const [low, high] = applyTargetQualityGate(src).entryZone;
      expect(low <= BASE_LOW && BASE_HIGH <= high, `${dir}: база внутри`).toBe(true);
      // Строгое вложение: ни одна граница не совпадает.
      expect(low, dir).not.toBe(BASE_LOW);
      expect(high, dir).not.toBe(BASE_HIGH);
    }
  });

  /* ── 4. Расширение = ровно 0.25 ATR с каждой стороны ──────────────────── */
  it('4 · отступ равен 0.25 ATR с каждой стороны, ATR — тот же 1H-ATR V3.3', () => {
    expect(V34_ENTRY_ZONE_ATR_PAD).toBe(0.25);
    // ATR восстанавливается из коридора теми же константами, что его создали.
    expect(atrFromV33Corridor(BASE_LOW, BASE_HIGH)).toBe(ATR);

    const out = applyTargetQualityGate(longOk());
    expect(out.meta!.atr1h).toBe(ATR);
    expect(out.meta!.entryZonePad).toBe(PAD);
    expect(out.meta!.entryZonePadAtrFraction).toBe(0.25);
    expect(out.meta!.entryZonePad).toBe(V34_ENTRY_ZONE_ATR_PAD * ATR);

    expect(out.entryZone[0]).toBe(BASE_LOW - 0.25 * ATR);
    expect(out.entryZone[1]).toBe(BASE_HIGH + 0.25 * ATR);
    // Симметрия: отступ вниз равен отступу вверх.
    expect(BASE_LOW - out.entryZone[0]).toBe(out.entryZone[1] - BASE_HIGH);
  });

  it('4b · отступ пропорционален ATR, а не фиксированной сумме в долларах', () => {
    // Тот же процентный сетап на цене в 1000 раз меньше даёт отступ в 1000 раз
    // меньше. Фиксированная сумма так себя вести не может.
    const big = expandEntryZone(990, 1010, 100);
    const small = expandEntryZone(0.990, 1.010, 0.100);
    expect(big.pad).toBe(25);
    expect(small.pad).toBeCloseTo(0.025, 12);
    expect(big.pad / small.pad).toBeCloseTo(1000, 6);
  });

  /* ── 5. Стоп не двигается ─────────────────────────────────────────────── */
  it('5 · стоп остаётся структурным стопом V3.3 и от расширения не сдвигается', () => {
    const l = longOk(); const outL = applyTargetQualityGate(l);
    expect(outL.stop).toBe(900);
    expect(outL.stop).toBe(l.stop);

    const sh = shortOk(); const outS = applyTargetQualityGate(sh);
    expect(outS.stop).toBe(1100);
    expect(outS.stop).toBe(sh.stop);

    // Расстояние стоп→база не изменилось, изменился только вход.
    expect(BASE_LOW - outL.stop).toBe(90);
    expect(outS.stop - BASE_HIGH).toBe(90);
  });

  /* ── 6. Цели не двигаются ─────────────────────────────────────────────── */
  it('6 · TP1 и TP2 остаются исходными структурными целями V3.3', () => {
    expect(applyTargetQualityGate(longOk()).targets).toEqual([1110, 1250]);
    expect(applyTargetQualityGate(shortOk()).targets).toEqual([890, 750]);
  });

  /* ── 7. Quality считается по расширенной семантике ────────────────────── */
  it('7 · качество целей считается от худшей границы РАСШИРЕННОЙ зоны', () => {
    const outL = applyTargetQualityGate(longOk());
    expect(outL.meta!.entryReference).toBe(1035);          // baseHigh + pad
    expect(outL.meta!.initialRisk).toBe(135);              // 1035 − 900, а не 110
    expect(outL.meta!.targetQualityTp1R).toBeCloseTo(0.5556, 4);
    expect(outL.meta!.targetQualityTp2R).toBeCloseTo(1.5926, 4);
    expect(outL.publishable).toBe(true);

    const outS = applyTargetQualityGate(shortOk());
    expect(outS.meta!.entryReference).toBe(965);           // baseLow − pad
    expect(outS.meta!.initialRisk).toBe(135);
    expect(outS.meta!.targetQualityTp1R).toBeCloseTo(0.5556, 4);
    expect(outS.meta!.targetQualityTp2R).toBeCloseTo(1.5926, 4);
    expect(outS.publishable).toBe(true);
  });

  it('7b · сетап, проходящий порог по зоне V3.3, отклоняется по расширенной зоне', () => {
    // TP1 = 1080: от базовой границы 1010 это 0.636 R (прошло бы), от
    // расширенной 1035 — всего 0.333 R. Порог не смягчается под расширение.
    const long = applyTargetQualityGate(record({
      direction: 'LONG', entryZone: [BASE_LOW, BASE_HIGH], stop: 900, targets: [1080, 1300],
    }));
    expect((1080 - BASE_HIGH) / (BASE_HIGH - 900)).toBeGreaterThanOrEqual(V34_TP1_MIN_R);
    expect(long.meta!.targetQualityTp1R).toBeCloseTo(0.3333, 4);
    expect(long.meta!.targetQualityRejectReason).toBe('TARGET_QUALITY_TP1');
    expect(long.meta!.targetQualityTp2R!).toBeGreaterThanOrEqual(V34_TP2_MIN_R);
    expect(long.publishable).toBe(false);
    // Цели и стоп при отказе не тронуты.
    expect(long.targets).toEqual([1080, 1300]);
    expect(long.stop).toBe(900);

    const short = applyTargetQualityGate(record({
      direction: 'SHORT', entryZone: [BASE_LOW, BASE_HIGH], stop: 1100, targets: [920, 700],
    }));
    expect((BASE_LOW - 920) / (1100 - BASE_LOW)).toBeGreaterThanOrEqual(V34_TP1_MIN_R);
    expect(short.meta!.targetQualityTp1R).toBeCloseTo(0.3333, 4);
    expect(short.meta!.targetQualityRejectReason).toBe('TARGET_QUALITY_TP1');
    expect(short.targets).toEqual([920, 700]);
    expect(short.stop).toBe(1100);
  });

  /* ── 8. Невалидная геометрия после расширения → REJECT ────────────────── */
  it('8 · расширенная зона пересекает стоп → REJECT, стоп НЕ переносится', () => {
    // LONG: стоп 975 лежит ниже базовой зоны (V3.3 такой сетап приняла бы),
    // но выше расширенной границы 965 — значит часть зоны за инвалидацией.
    const l = record({ direction: 'LONG', entryZone: [BASE_LOW, BASE_HIGH], stop: 975, targets: [1200, 1400] });
    expect(corridorGeometryOk('LONG', BASE_LOW, BASE_HIGH, 975, 1200, 1400)).toBe(true);
    const outL = applyTargetQualityGate(l);
    expect(outL.meta!.targetQualityRejectReason).toBe('ENTRY_ZONE_CROSSES_STOP');
    expect(outL.publishable).toBe(false);
    expect(outL.stop).toBe(975);          // стоп не сдвинут вниз «под зону»
    expect(outL.targets).toEqual([1200, 1400]);

    const sh = record({ direction: 'SHORT', entryZone: [BASE_LOW, BASE_HIGH], stop: 1025, targets: [800, 600] });
    expect(corridorGeometryOk('SHORT', BASE_LOW, BASE_HIGH, 1025, 800, 600)).toBe(true);
    const outS = applyTargetQualityGate(sh);
    expect(outS.meta!.targetQualityRejectReason).toBe('ENTRY_ZONE_CROSSES_STOP');
    expect(outS.stop).toBe(1025);
    expect(outS.targets).toEqual([800, 600]);
  });

  it('8b · цель, оказавшаяся внутри расширенной зоны → GEOMETRY_INVALID', () => {
    // TP1 = 1020 впереди базовой границы 1010, но позади расширенной 1035.
    const outL = applyTargetQualityGate(record({
      direction: 'LONG', entryZone: [BASE_LOW, BASE_HIGH], stop: 900, targets: [1020, 1400],
    }));
    expect(corridorGeometryOk('LONG', BASE_LOW, BASE_HIGH, 900, 1020, 1400)).toBe(true);
    expect(outL.meta!.targetQualityRejectReason).toBe('GEOMETRY_INVALID');
    expect(outL.targets).toEqual([1020, 1400]);
    expect(outL.stop).toBe(900);

    const outS = applyTargetQualityGate(record({
      direction: 'SHORT', entryZone: [BASE_LOW, BASE_HIGH], stop: 1100, targets: [980, 600],
    }));
    expect(outS.meta!.targetQualityRejectReason).toBe('GEOMETRY_INVALID');
    expect(outS.stop).toBe(1100);
  });

  /* ── 9. Точность на низкоценовом активе ───────────────────────────────── */
  it('9 · низкоценовой актив (PEPE-подобный): расширение и качество без потери точности', () => {
    // close = 0.00001234, 1H-ATR = 4e-7 ⇒ коридор V3.3 = close ± 4e-8.
    const base: [number, number] = [0.00001230, 0.00001238];
    const src = record({ direction: 'LONG', entryZone: base, stop: 0.00001150, targets: [0.00001297, 0.00001400] });
    const out = applyTargetQualityGate(src);

    expect(out.meta!.atr1h as number).toBeCloseTo(4e-7, 15);
    expect(out.meta!.entryZonePad as number).toBeCloseTo(1e-7, 15);
    expect(out.entryZone[0]).toBeCloseTo(0.0000122, 15);
    expect(out.entryZone[1]).toBeCloseTo(0.00001248, 15);
    // База по-прежнему внутри расширенной зоны.
    expect(out.entryZone[0]).toBeLessThan(base[0]);
    expect(out.entryZone[1]).toBeGreaterThan(base[1]);
    // Качество посчитано по расширенной границе и порог пройден ровно.
    expect(out.meta!.initialRisk as number).toBeCloseTo(9.8e-7, 15);
    expect(out.meta!.targetQualityTp1R as number).toBeCloseTo(0.5, 9);
    expect(out.meta!.targetQualityRejectReason).toBeNull();
    expect(out.publishable).toBe(true);

    // Ни одна граница не «схлопнулась» в ноль и не потеряла значащие цифры.
    for (const v of [out.entryZone[0], out.entryZone[1], out.meta!.entryZonePad as number]) {
      expect(v).toBeGreaterThan(0);
      expect(Number.isFinite(v)).toBe(true);
    }
    // Те же цены, округлённые до точности отображения, расчёт уничтожают.
    const r2 = (x: number) => Math.round(x * 100) / 100;
    expect(atrFromV33Corridor(r2(base[0]), r2(base[1]))).toBe(0);
  });
});

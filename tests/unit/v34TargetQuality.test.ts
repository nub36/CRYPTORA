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
import fixture from './strategyArchive/fixtures/v30-synthetic-parity.json';
import type { ArchiveCandle } from '@/services/strategyArchive/types';
import {
  canonicalEntryReference, evaluateTargetQuality, expandEntryZone,
  V34_ENTRY_ZONE_ATR_PAD, V34_TP1_MIN_R, V34_TP2_MIN_R,
} from '@/services/signals/live/targetQuality';
import {
  atrFromV33Corridor, runV34LiveReplay, v34CorridorHook,
  V34_STRATEGY_ID, V34_STRATEGY_VERSION,
} from '@/services/signals/live/replays/v34LiveReplay';
import {
  runV33LiveReplay, V33_IDENTITY_CORRIDOR, V33_STRATEGY_ID,
  type V33CorridorCtx,
} from '@/services/signals/live/replays/v33LiveReplay';
import { corridorGeometryOk, rrFrom } from '@/services/signals/live/replays/shared';
import { V33_CONSTANTS } from '@/services/strategyArchive/definitions/v3_3-htf-zone-mitigation/v33Core';
import { LiveSignalEngine, STRATEGY_IDS } from '@/services/signals/live/LiveSignalEngine';
import { PRODUCT_STRATEGIES, getStrategy, isKnownStrategyId } from '../../server/services/strategyCatalog.js';

const ROOT = path.resolve(__dirname, '../..');

/**
 * Вызов настоящего hook'а V3.4 ровно с тем контекстом, который передаёт ему
 * реплей в момент создания сетапа. ATR по умолчанию восстанавливается из
 * коридора V3.3 теми же константами, что его породили.
 */
function plan(p: {
  direction: 'LONG' | 'SHORT'; baseLow: number; baseHigh: number;
  stop: number; tp1: number; tp2: number; atr?: number;
}) {
  const ctx: V33CorridorCtx = {
    direction: p.direction,
    baseLow: p.baseLow,
    baseHigh: p.baseHigh,
    atr: p.atr ?? atrFromV33Corridor(p.baseLow, p.baseHigh),
    close: (p.baseLow + p.baseHigh) / 2,
    stop: p.stop,
    tp1: p.tp1,
    tp2: p.tp2,
  };
  return v34CorridorHook(ctx);
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


/* ═════════════════════════════════════ D ═════════════════════════════════ */

describe('D · BTC-подобная фикстура: V3.3 принимает, V3.4 отклоняет', () => {
  const BASE: [number, number] = [84154.2, 84245.9];
  const STOP = 84911.8;
  const TPS: [number, number] = [84104.5, 82563.0];

  it('V3.3 принимает сетап (единственный её фильтр — геометрия)', () => {
    expect(corridorGeometryOk('SHORT', BASE[0], BASE[1], STOP, TPS[0], TPS[1])).toBe(true);
  });

  it('V3.4 отклоняет его и НЕ трогает ни стоп, ни цели', () => {
    // TP1 (84104.5) лежит всего в 49.7 пунктах от нижней границы V3.3, а
    // расширение опускает её на 114.6 — цель оказывается ВНУТРИ зоны входа.
    // Правильный ответ — отклонить сетап, а не «починить» уровни.
    const p = plan({ direction: 'SHORT', baseLow: BASE[0], baseHigh: BASE[1], stop: STOP, tp1: TPS[0], tp2: TPS[1] });
    expect(p.rejectReason).toBe('GEOMETRY_INVALID');
    expect(p.meta!.baseEntryZoneLow).toBe(BASE[0]);
    expect(p.meta!.baseEntryZoneHigh).toBe(BASE[1]);
    // Hook физически не может вернуть стоп или цели — он их не отдаёт.
    expect(Object.prototype.hasOwnProperty.call(p, 'stop')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(p, 'targets')).toBe(false);
  });

  it('без расширения зоны причиной был бы именно TARGET_QUALITY_TP1', () => {
    const q = evaluateTargetQuality({
      direction: 'SHORT', entryLow: BASE[0], entryHigh: BASE[1], stop: STOP, tp1: TPS[0], tp2: TPS[1],
    });
    expect(q.entryReference).toBe(84154.2);
    expect(q.initialRisk).toBeCloseTo(757.6, 6);
    expect(q.tp1R).toBeCloseTo(0.0656, 4);
    expect(q.tp2R).toBeCloseTo(2.1003, 4);
    expect(q.tp2R!).toBeGreaterThanOrEqual(V34_TP2_MIN_R);
    expect(q.reason).toBe('TARGET_QUALITY_TP1');
  });

  it('под ЛЮБЫМ якорем входа отказ по TP1 сохраняется', () => {
    const mid = (BASE[0] + BASE[1]) / 2;
    expect((mid - TPS[0]) / (STOP - mid)).toBeLessThan(V34_TP1_MIN_R);
    expect((BASE[0] - TPS[0]) / (STOP - BASE[0])).toBeLessThan(V34_TP1_MIN_R);
  });
});

/* ═════════════════════════════════════ F ═════════════════════════════════ */

describe('F · точность: низкоценовой актив (PEPE-подобный)', () => {
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

  it('если бы цены округлили до точности отображения, сетап развалился бы', () => {
    const r2 = (x: number) => Math.round(x * 100) / 100;
    const broken = evaluateTargetQuality({
      direction: 'LONG',
      entryLow: r2(input.entryLow), entryHigh: r2(input.entryHigh),
      stop: r2(input.stop), tp1: r2(input.tp1), tp2: r2(input.tp2),
    });
    expect(broken.accepted).toBe(false);
    expect(broken.reason).toBe('GEOMETRY_INVALID');
  });

  it('10 · расширение и качество на PEPE-подобной цене без округления', () => {
    // close = 0.00001234, 1H-ATR = 4e-7 ⇒ коридор V3.3 = close ± 4e-8.
    const base: [number, number] = [0.00001230, 0.00001238];
    const p = plan({
      direction: 'LONG', baseLow: base[0], baseHigh: base[1],
      stop: 0.00001150, tp1: 0.00001297, tp2: 0.00001400,
    });
    expect(p.meta!.atr1h as number).toBeCloseTo(4e-7, 15);
    expect(p.meta!.entryZonePad as number).toBeCloseTo(1e-7, 15);
    expect(p.low).toBeCloseTo(0.0000122, 15);
    expect(p.high).toBeCloseTo(0.00001248, 15);
    expect(p.low).toBeLessThan(base[0]);
    expect(p.high).toBeGreaterThan(base[1]);
    expect(p.meta!.initialRisk as number).toBeCloseTo(9.8e-7, 15);
    expect(p.meta!.targetQualityTp1R as number).toBeCloseTo(0.5, 9);
    expect(p.rejectReason).toBeUndefined();

    for (const v of [p.low, p.high, p.meta!.entryZonePad as number]) {
      expect(v).toBeGreaterThan(0);
      expect(Number.isFinite(v)).toBe(true);
    }
    // Те же цены, округлённые до точности отображения, расчёт уничтожают.
    const r2 = (x: number) => Math.round(x * 100) / 100;
    expect(atrFromV33Corridor(r2(base[0]), r2(base[1]))).toBe(0);
  });

  it('провенанс базы сохраняется в записи V3.4', () => {
    const p = plan({
      direction: 'LONG', baseLow: 0.00001230, baseHigh: 0.00001238,
      stop: 0.00001150, tp1: 0.00001297, tp2: 0.00001400,
    });
    expect(p.meta!.entryReferenceRule).toBe('WORST_CORRIDOR_EDGE_ACTUAL_FILL');
    expect(p.meta!.entryZoneRule).toBe('V33_CORRIDOR_EXPANDED_BY_0_25_ATR_EACH_SIDE');
  });
});

/* ═════════════════════════════════════ G ═════════════════════════════════ */
/**
 * G · Расширение коридора входа (0.25 ATR в каждую сторону) — на настоящем
 * hook'е V3.4, том самом, который реплей вызывает при создании сетапа.
 *
 * Фикстура подобрана так, чтобы арифметика была точной в двоичной плавающей
 * точке: base = close ± 0.10·ATR при close = 1000 и ATR = 100 даёт коридор
 * [990, 1010], отступ ровно 25.
 */
describe('G · расширение Entry Zone', () => {
  const BASE_LOW = 990;
  const BASE_HIGH = 1010;
  const ATR = 100;
  const PAD = 25;

  const longOk = () => plan({ direction: 'LONG', baseLow: BASE_LOW, baseHigh: BASE_HIGH, stop: 900, tp1: 1110, tp2: 1250 });
  const shortOk = () => plan({ direction: 'SHORT', baseLow: BASE_LOW, baseHigh: BASE_HIGH, stop: 1100, tp1: 890, tp2: 750 });

  it('1 · LONG: v34.low = v33.low − 0.25 ATR, v34.high = v33.high + 0.25 ATR', () => {
    const p = longOk();
    expect(p.low).toBe(BASE_LOW - 0.25 * ATR);
    expect(p.high).toBe(BASE_HIGH + 0.25 * ATR);
    expect(p.low).toBe(965);
    expect(p.high).toBe(1035);
  });

  it('2 · SHORT: то же расширение', () => {
    const p = shortOk();
    expect(p.low).toBe(BASE_LOW - 0.25 * ATR);
    expect(p.high).toBe(BASE_HIGH + 0.25 * ATR);
  });

  it('3 · containment: v34.low < v33.low и v34.high > v33.high', () => {
    for (const [p, dir] of [[longOk(), 'LONG'], [shortOk(), 'SHORT']] as const) {
      expect(p.low, dir).toBeLessThan(BASE_LOW);
      expect(p.high, dir).toBeGreaterThan(BASE_HIGH);
      expect(p.low <= BASE_LOW && BASE_HIGH <= p.high, `${dir}: база внутри`).toBe(true);
      expect(p.high - p.low, dir).toBe(70); // 20 + 2×25
    }
  });

  it('4 · отступ = 0.25 ATR, симметричен, ATR — тот же 1H-ATR сетапа V3.3', () => {
    expect(V34_ENTRY_ZONE_ATR_PAD).toBe(0.25);
    expect(atrFromV33Corridor(BASE_LOW, BASE_HIGH)).toBe(ATR);
    const p = longOk();
    expect(p.meta!.atr1h).toBe(ATR);
    expect(p.meta!.entryZonePad).toBe(PAD);
    expect(p.meta!.entryZonePad).toBe(V34_ENTRY_ZONE_ATR_PAD * ATR);
    expect(BASE_LOW - p.low).toBe(p.high - BASE_HIGH);
  });

  it('4b · отступ пропорционален ATR, а не фиксированной сумме', () => {
    const big = expandEntryZone(990, 1010, 100);
    const small = expandEntryZone(0.990, 1.010, 0.100);
    expect(big.pad).toBe(25);
    expect(small.pad).toBeCloseTo(0.025, 12);
    expect(big.pad / small.pad).toBeCloseTo(1000, 6);
  });

  it('7 · quality использует расширенную худшую границу, а не старую', () => {
    const l = longOk();
    expect(l.meta!.entryReference).toBe(1035);   // baseHigh + pad, не 1010
    expect(l.meta!.initialRisk).toBe(135);       // 1035 − 900, не 110
    expect(l.meta!.targetQualityTp1R).toBeCloseTo(0.5556, 4);
    expect(l.meta!.targetQualityTp2R).toBeCloseTo(1.5926, 4);
    expect(l.rejectReason).toBeUndefined();

    const sh = shortOk();
    expect(sh.meta!.entryReference).toBe(965);   // baseLow − pad, не 990
    expect(sh.meta!.initialRisk).toBe(135);
    expect(sh.meta!.targetQualityTp1R).toBeCloseTo(0.5556, 4);
    expect(sh.rejectReason).toBeUndefined();
  });

  it('7b · сетап, проходящий порог по зоне V3.3, отклоняется по расширенной', () => {
    // TP1 = 1080: от базовой границы 1010 это 0.636 R (прошло бы), от
    // расширенной 1035 — всего 0.333 R. Порог не смягчается под расширение.
    const l = plan({ direction: 'LONG', baseLow: BASE_LOW, baseHigh: BASE_HIGH, stop: 900, tp1: 1080, tp2: 1300 });
    expect((1080 - BASE_HIGH) / (BASE_HIGH - 900)).toBeGreaterThanOrEqual(V34_TP1_MIN_R);
    expect(l.meta!.targetQualityTp1R).toBeCloseTo(0.3333, 4);
    expect(l.rejectReason).toBe('TARGET_QUALITY_TP1');
    expect(l.meta!.targetQualityTp2R as number).toBeGreaterThanOrEqual(V34_TP2_MIN_R);

    const sh = plan({ direction: 'SHORT', baseLow: BASE_LOW, baseHigh: BASE_HIGH, stop: 1100, tp1: 920, tp2: 700 });
    expect((BASE_LOW - 920) / (1100 - BASE_LOW)).toBeGreaterThanOrEqual(V34_TP1_MIN_R);
    expect(sh.meta!.targetQualityTp1R).toBeCloseTo(0.3333, 4);
    expect(sh.rejectReason).toBe('TARGET_QUALITY_TP1');
  });

  it('8 · расширенная зона пересекает стоп → REJECT, стоп не переносится', () => {
    // Стоп 975 ниже базовой зоны (V3.3 такой сетап приняла бы), но выше
    // расширенной границы 965 — часть зоны оказалась бы за инвалидацией.
    expect(corridorGeometryOk('LONG', BASE_LOW, BASE_HIGH, 975, 1200, 1400)).toBe(true);
    const l = plan({ direction: 'LONG', baseLow: BASE_LOW, baseHigh: BASE_HIGH, stop: 975, tp1: 1200, tp2: 1400 });
    expect(l.rejectReason).toBe('ENTRY_ZONE_CROSSES_STOP');

    expect(corridorGeometryOk('SHORT', BASE_LOW, BASE_HIGH, 1025, 800, 600)).toBe(true);
    const sh = plan({ direction: 'SHORT', baseLow: BASE_LOW, baseHigh: BASE_HIGH, stop: 1025, tp1: 800, tp2: 600 });
    expect(sh.rejectReason).toBe('ENTRY_ZONE_CROSSES_STOP');
  });

  it('8b · цель внутри расширенной зоны → GEOMETRY_INVALID', () => {
    expect(corridorGeometryOk('LONG', BASE_LOW, BASE_HIGH, 900, 1020, 1400)).toBe(true);
    expect(plan({ direction: 'LONG', baseLow: BASE_LOW, baseHigh: BASE_HIGH, stop: 900, tp1: 1020, tp2: 1400 }).rejectReason)
      .toBe('GEOMETRY_INVALID');
    expect(plan({ direction: 'SHORT', baseLow: BASE_LOW, baseHigh: BASE_HIGH, stop: 1100, tp1: 980, tp2: 600 }).rejectReason)
      .toBe('GEOMETRY_INVALID');
  });
});

/* ═════════════════════════════════════ H ═════════════════════════════════ */
/**
 * H · Расширенный коридор в НАСТОЯЩЕМ реплее.
 *
 * Здесь проверяется не арифметика hook'а, а то, что расширенные границы
 * реально участвуют в механике сделки: обнаружение касания, цена фила, риск,
 * ведение и исход. Данные — та же синтетическая фикстура, на которой
 * `liveReplays.test.ts` сверяет V3.3 с архивным раннером бар в бар.
 */
describe('H · расширенный коридор участвует в реальном обнаружении входа', () => {
  const H_MS = 3_600_000;
  type Row = [number, number, number, number, number, number];
  const toCandles = (rows: Row[], span: number): ArchiveCandle[] =>
    rows.map(([openTime, open, high, low, close, volume]) => ({
      openTime, open, high, low, close, volume, closeTime: openTime + span - 1, isClosed: true,
    }));
  const h1 = toCandles(fixture.candles1h as Row[], H_MS);
  const h4 = toCandles(fixture.candles4h as Row[], 4 * H_MS);

  const v33 = runV33LiveReplay({ symbol: 'SYNTH', h1, h4 });
  const v34 = runV34LiveReplay({ symbol: 'SYNTH', h1, h4 });
  const byTime33 = new Map(v33.records.map((r) => [r.setupOpenTime, r]));

  it('9 · V3.3 не изменилась: hook по умолчанию тождественен', () => {
    // Идентичный hook обязан дать побайтово тот же результат, что и его отсутствие.
    const explicit = runV33LiveReplay({ symbol: 'SYNTH', h1, h4, corridor: V33_IDENTITY_CORRIDOR });
    expect(explicit.records.length).toBe(v33.records.length);
    expect(JSON.stringify(explicit.records)).toBe(JSON.stringify(v33.records));
    expect(v33.records.length).toBeGreaterThan(100);
    // Прогон V3.4 на тех же данных не трогает результат V3.3.
    expect(v33.records.every((r) => r.strategyId === V33_STRATEGY_ID)).toBe(true);
  });

  it('V3.4 видит ровно те же сетапы, но со своим коридором', () => {
    expect(v34.records.length).toBe(v33.records.length);
    expect(v34.records.every((r) => r.strategyId === V34_STRATEGY_ID)).toBe(true);
    expect(v34.records.every((r) => r.strategyVersion === V34_STRATEGY_VERSION)).toBe(true);
  });

  it('4/5 · инварианты на ВСЕХ сетапах окна: stop и цели не сдвинуты, зона шире ровно на 0.25 ATR', () => {
    let checked = 0;
    for (const b of v34.records) {
      const a = byTime33.get(b.setupOpenTime);
      expect(a, `нет пары V3.3 для ${b.setupOpenTime}`).toBeDefined();
      const atr = b.meta!.atr1h as number;

      // stop / targets invariants
      expect(b.stop, 'stop').toBe(a!.stop);
      expect(b.targets[0], 'tp1').toBe(a!.targets[0]);
      expect(b.targets[1], 'tp2').toBe(a!.targets[1]);

      // base сохранена и зона расширена ровно на 0.25 ATR
      expect(b.meta!.baseEntryZoneLow).toBe(a!.entryZone[0]);
      expect(b.meta!.baseEntryZoneHigh).toBe(a!.entryZone[1]);
      expect(b.entryZone[0]).toBeCloseTo(a!.entryZone[0] - V34_ENTRY_ZONE_ATR_PAD * atr, 12);
      expect(b.entryZone[1]).toBeCloseTo(a!.entryZone[1] + V34_ENTRY_ZONE_ATR_PAD * atr, 12);
      expect(b.entryZone[0]).toBeLessThan(a!.entryZone[0]);
      expect(b.entryZone[1]).toBeGreaterThan(a!.entryZone[1]);
      checked++;
    }
    expect(checked).toBe(v34.records.length);
    expect(checked).toBeGreaterThan(100);
  });

  it('исполнение V3.4 происходит по ЕЁ границе коридора, а не по границе V3.3', () => {
    const filled = v34.records.filter((r) => r.fill !== null);
    expect(filled.length).toBeGreaterThan(0);
    for (const r of filled) {
      const worst = r.direction === 'LONG' ? r.entryZone[1] : r.entryZone[0];
      // Фил не может быть хуже расширенной границы (Math.min/max с open).
      if (r.direction === 'LONG') expect(r.fill!.price).toBeLessThanOrEqual(worst);
      else expect(r.fill!.price).toBeGreaterThanOrEqual(worst);
      // Риск сделки посчитан от фактического фила и структурного стопа.
      expect(Math.abs(r.fill!.price - r.stop)).toBeGreaterThan(0);
      expect(r.fill!.stop).toBe(r.stop);
      expect(r.fill!.targets).toEqual(r.targets);
    }
  });

  /* ── 6 · fill только в добавленной полосе ──────────────────────────────── */
  /**
   * Сетап #2401 фикстуры — LONG, коридор V3.3 [101.99989, 102.21666],
   * коридор V3.4 [101.72892, 102.48763]. Бары после сетапа переписаны так,
   * чтобы их минимум лежал СТРОГО МЕЖДУ верхней границей V3.3 и верхней
   * границей V3.4: цена заходит только в добавленную полосу 0.25 ATR.
   */
  describe('6 · цена входит только в добавленную полосу 0.25 ATR', () => {
    const IDX = 2401;
    const TOUCH_LOW = 102.35;   // > 102.21666 (V3.3) и < 102.48763 (V3.4)

    const window = (() => {
      const w = h1.slice(0, IDX + 5).map((c) => ({ ...c }));
      for (let k = IDX + 1; k <= IDX + 4; k++) {
        w[k] = { ...w[k]!, open: 102.60, high: 102.70, low: TOUCH_LOW, close: 102.65 };
      }
      return w;
    })();

    const a = runV33LiveReplay({ symbol: 'SYNTH', h1: window, h4 })
      .records.find((r) => r.setupOpenTime === h1[IDX]!.openTime);
    const b = runV34LiveReplay({ symbol: 'SYNTH', h1: window, h4 })
      .records.find((r) => r.setupOpenTime === h1[IDX]!.openTime);

    it('сетап существует у обеих версий и принят фильтром V3.4', () => {
      expect(a, 'V3.3 сетап').toBeDefined();
      expect(b, 'V3.4 сетап').toBeDefined();
      expect(a!.direction).toBe('LONG');
      expect(b!.meta!.targetQualityRejectReason).toBeNull();
    });

    it('минимум бара лежит ВНЕ коридора V3.3 и ВНУТРИ коридора V3.4', () => {
      expect(TOUCH_LOW).toBeGreaterThan(a!.entryZone[1]);
      expect(TOUCH_LOW).toBeLessThanOrEqual(b!.entryZone[1]);
    });

    it('V3.3: НЕТ исполнения — коридор истекает', () => {
      expect(a!.fill).toBeNull();
      expect(a!.outcome!.status).toBe('EXPIRED');
    });

    it('V3.4: ЕСТЬ исполнение — по верхней границе расширенного коридора', () => {
      expect(b!.fill).not.toBeNull();
      expect(b!.fill!.barOpenTime).toBe(window[IDX + 1]!.openTime);
      // fill = min(open 102.60, zoneHigh) = zoneHigh расширенного коридора.
      expect(b!.fill!.price).toBe(b!.entryZone[1]);
      expect(b!.fill!.price).toBeGreaterThan(a!.entryZone[1]);
    });

    it('и при этом стоп и цели у обеих версий совпадают', () => {
      expect(b!.stop).toBe(a!.stop);
      expect(b!.targets).toEqual(a!.targets);
    });
  });
});

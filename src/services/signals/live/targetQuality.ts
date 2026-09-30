/**
 * V3.4 — фильтр качества структурных целей (target quality gate).
 *
 * ⚠️ ЭТО НЕ НОВАЯ МАТЕМАТИКА ЦЕЛЕЙ. Модуль НЕ считает и НЕ двигает уровни.
 * Он принимает УЖЕ ПОСЧИТАННЫЕ V3.3 структурные уровни (зона входа, стоп,
 * TP1, TP2) и отвечает на один вопрос: «достаточно ли далеко структурная цель
 * от входа относительно первоначального риска». Если нет — отклоняется ВЕСЬ
 * сетап. Цель не подтягивается к минимальному R и не заменяется на
 * `entry ± k·R`: это превратило бы структурную цель в искусственную и сломало
 * бы саму идею V3.3.
 *
 * ── CANONICAL ENTRY REFERENCE ───────────────────────────────────────────────
 *
 * Аудит 2026-09-30 (docs/STRATEGY_TP_SL_AUDIT_2026-09-30.md) зафиксировал
 * расхождение: витрина считает R от середины зоны входа, а замороженный раннер
 * — от ФАКТИЧЕСКОЙ цены исполнения, которой всегда является ХУДШАЯ граница
 * коридора:
 *
 *   v30Core.ts:220-221   const fill = long ? Math.min(c.open, p.zoneHigh) : Math.max(c.open, p.zoneLow);
 *                        const risk = Math.abs(fill - p.stop);
 *   v33LiveReplay.ts:154-155  — та же пара строк
 *   v33Core.ts:245       manageTrade: const risk = Math.abs(entry - stop0);   // entry = fill
 *
 * Хуже фила коридор дать не может: для LONG это верхняя граница, для SHORT —
 * нижняя (`Math.min/Math.max` с `open` только улучшают цену). Поэтому
 * КАНОНИЧЕСКИЙ ЯКОРЬ V3.4 — худшая граница зоны входа: это и есть worst-case
 * фактический фил раннера, то самое значение, от которого стратегия считает
 * свой R и свою статистику.
 *
 * Выбор консервативен осознанно: R от худшей границы всегда ≤ R от середины,
 * значит порог 0.50 R нельзя «пройти» за счёт оптимистичного якоря.
 *
 * ── ПОРОГИ ──────────────────────────────────────────────────────────────────
 *
 *   TP1 ≥ 0.50 · initialRisk   иначе TARGET_QUALITY_TP1
 *   TP2 ≥ 1.00 · initialRisk   иначе TARGET_QUALITY_TP2
 *
 * Границы ВКЛЮЧИТЕЛЬНЫЕ: ровно 0.50 и ровно 1.00 принимаются (сравнение `>=`,
 * без эпсилон-допуска — допуск сделал бы порог нечётким).
 *
 * Модуль чистый, без состояния и без обращений к сети/БД.
 */

import type { ArchiveDirection } from '@/services/strategyArchive/types';

/** Минимальное качество TP1 в долях первоначального риска (включительно). */
export const V34_TP1_MIN_R = 0.5;

/** Минимальное качество TP2 в долях первоначального риска (включительно). */
export const V34_TP2_MIN_R = 1.0;

export type TargetQualityReason =
  /** Геометрия сетапа невалидна сама по себе (цель/стоп не с той стороны, TP2 не дальше TP1, риск ≤ 0). */
  | 'GEOMETRY_INVALID'
  /**
   * Коридор входа пересекает стоп (или касается его). Для V3.4 это отдельная
   * причина, потому что она возникает именно от РАСШИРЕНИЯ зоны: часть зоны
   * оказывается по ту сторону инвалидации, где сделки уже нет. Стоп при этом
   * НЕ двигается — отклоняется сетап.
   */
  | 'ENTRY_ZONE_CROSSES_STOP'
  /** TP1 ближе минимального качества. */
  | 'TARGET_QUALITY_TP1'
  /** TP2 ближе минимального качества. */
  | 'TARGET_QUALITY_TP2';

/**
 * Доля ATR, на которую V3.4 расширяет КАЖДУЮ сторону коридора V3.3.
 *
 * ATR — тот же, что уже использует V3.3: ATR(risk.atr_period) по 1H-ряду
 * (`atrSeriesV2(h1, atrPeriod)` в v33LiveReplay.ts:97). Новый таймфрейм и новый
 * расчёт ATR не вводятся.
 */
export const V34_ENTRY_ZONE_ATR_PAD = 0.25;

/**
 * Расширение коридора входа V3.4.
 *
 * Симметрично и строго наружу, поэтому базовая структурная зона V3.3 всегда
 * целиком лежит внутри зоны V3.4 (при atr > 0 — строго внутри). Никакого
 * фиксированного долларового отступа: величина отступа пропорциональна ATR,
 * то есть масштабируется вместе с ценой актива.
 *
 * Округления нет намеренно: границы уходят в расчёт качества целей как есть.
 */
export function expandEntryZone(
  baseLow: number, baseHigh: number, atr: number,
): { low: number; high: number; pad: number } {
  const pad = V34_ENTRY_ZONE_ATR_PAD * atr;
  return { low: baseLow - pad, high: baseHigh + pad, pad };
}

export interface TargetQualityInput {
  direction: ArchiveDirection;
  /** Нижняя граница коридора входа (как посчитала V3.3). */
  entryLow: number;
  /** Верхняя граница коридора входа. */
  entryHigh: number;
  stop: number;
  tp1: number;
  tp2: number;
}

export interface TargetQualityResult {
  accepted: boolean;
  /** null, если сетап принят. */
  reason: TargetQualityReason | null;
  /** Канонический якорь входа (худшая граница коридора = worst-case фил раннера). */
  entryReference: number | null;
  /** |entryReference − stop|. null, если посчитать нельзя. */
  initialRisk: number | null;
  /** Качество TP1 в долях первоначального риска. */
  tp1R: number | null;
  /** Качество TP2 в долях первоначального риска. */
  tp2R: number | null;
  /** Пороги, по которым принято решение (попадают в metadata сигнала). */
  floors: { tp1: number; tp2: number };
}

/**
 * Канонический якорь входа V3.4 — ХУДШАЯ граница коридора.
 *
 * LONG исполняется не выше `entryHigh`, SHORT — не ниже `entryLow`
 * (`Math.min(open, zoneHigh)` / `Math.max(open, zoneLow)` в corridorStep).
 * Значит худший возможный фил и есть соответствующая граница.
 */
export function canonicalEntryReference(
  direction: ArchiveDirection, entryLow: number, entryHigh: number,
): number {
  return direction === 'LONG' ? entryHigh : entryLow;
}

/** Расстояние по ходу сделки (положительное = цель впереди входа). */
function forwardDistance(direction: ArchiveDirection, from: number, to: number): number {
  return direction === 'LONG' ? to - from : from - to;
}

/**
 * Проверка качества целей. Порядок проверок фиксирован и важен для
 * однозначности причины отказа:
 *
 *   1. конечность чисел и геометрия (иначе R не имеет смысла);
 *   2. TP1 — ближняя цель проверяется первой;
 *   3. TP2.
 *
 * Возвращается ПЕРВАЯ нарушенная причина.
 */
export function evaluateTargetQuality(input: TargetQualityInput): TargetQualityResult {
  const { direction, entryLow, entryHigh, stop, tp1, tp2 } = input;
  const floors = { tp1: V34_TP1_MIN_R, tp2: V34_TP2_MIN_R };
  const empty: TargetQualityResult = {
    accepted: false, reason: 'GEOMETRY_INVALID', entryReference: null,
    initialRisk: null, tp1R: null, tp2R: null, floors,
  };

  if (![entryLow, entryHigh, stop, tp1, tp2].every((n) => Number.isFinite(n))) return empty;
  if (!(entryHigh >= entryLow)) return empty;

  const entryReference = canonicalEntryReference(direction, entryLow, entryHigh);
  const long = direction === 'LONG';

  // Стоп обязан быть по «нерабочую» сторону от ФАКТИЧЕСКОГО входа — та же
  // проверка, что делает раннер на баре исполнения (v33LiveReplay.ts:156-158).
  const initialRisk = long ? entryReference - stop : stop - entryReference;
  if (!(initialRisk > 0)) return { ...empty, entryReference };

  // ВЕСЬ коридор обязан лежать по рабочую сторону от стопа, а не только
  // худшая граница. У V3.3 этой проверки нет и быть не должно (её коридор
  // узкий и её математика заморожена), но для расширенной зоны V3.4 она
  // обязательна: иначе часть зоны оказалась бы за инвалидацией. Стоп при
  // отказе НЕ переносится — отклоняется сетап.
  const zoneClearOfStop = long ? stop < entryLow : stop > entryHigh;
  if (!zoneClearOfStop) {
    return {
      accepted: false, reason: 'ENTRY_ZONE_CROSSES_STOP', entryReference,
      initialRisk, tp1R: null, tp2R: null, floors,
    };
  }

  const d1 = forwardDistance(direction, entryReference, tp1);
  const d2 = forwardDistance(direction, entryReference, tp2);
  const tp1R = d1 / initialRisk;
  const tp2R = d2 / initialRisk;

  const base = { entryReference, initialRisk, tp1R, tp2R, floors };

  // Инвариант порядка целей — тот же, что у V3.3: TP1 впереди фила, TP2 дальше TP1.
  const orderOk = long ? tp1 > entryReference && tp2 > tp1 : tp1 < entryReference && tp2 < tp1;
  if (!orderOk) return { ...base, accepted: false, reason: 'GEOMETRY_INVALID' };

  if (!(tp1R >= V34_TP1_MIN_R)) return { ...base, accepted: false, reason: 'TARGET_QUALITY_TP1' };
  if (!(tp2R >= V34_TP2_MIN_R)) return { ...base, accepted: false, reason: 'TARGET_QUALITY_TP2' };

  return { ...base, accepted: true, reason: null };
}

/** Человекочитаемая причина отказа для журнала и UI. */
export const TARGET_QUALITY_REASON_RU: Readonly<Record<TargetQualityReason, string>> = Object.freeze({
  GEOMETRY_INVALID: 'Геометрия сетапа невалидна: цель или стоп не с той стороны от входа.',
  ENTRY_ZONE_CROSSES_STOP:
    'Расширенный коридор входа пересекает стоп — часть зоны оказалась бы за уровнем инвалидации. '
    + 'Стоп остаётся структурным и не переносится: отклоняется сетап.',
  TARGET_QUALITY_TP1: `Цель 1 ближе минимального качества ${V34_TP1_MIN_R} первоначального риска — сетап отклонён целиком, цель не сдвигается.`,
  TARGET_QUALITY_TP2: `Цель 2 ближе минимального качества ${V34_TP2_MIN_R} первоначального риска — сетап отклонён целиком, цель не сдвигается.`,
});

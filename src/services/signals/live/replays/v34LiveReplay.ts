/**
 * V3.4 — HTF Zone Mitigation + Target Quality — LIVE-реплей.
 *
 * ЧТО ЭТО ТАКОЕ
 * -------------
 * V3.4 — консервативная надстройка над V3.3. Обнаружение сетапа, коридор входа,
 * стоп, структурный TP1 и структурный TP2 считает ТА ЖЕ функция, что и в
 * продуктовой V3.3 (`runV33LiveReplay`), без единой изменённой строки
 * математики. V3.4 добавляет ровно один шаг — фильтр качества целей
 * (`evaluateTargetQuality`):
 *
 *   TP1 ≥ 0.50 · initialRisk     иначе весь сетап отклоняется (TARGET_QUALITY_TP1)
 *   TP2 ≥ 1.00 · initialRisk     иначе весь сетап отклоняется (TARGET_QUALITY_TP2)
 *
 * Отклоняется ИМЕННО СЕТАП. Цели не двигаются, не «подтягиваются» к 0.5 R и не
 * заменяются на `entry ± k·R`: структурная цель либо есть там, где её нашла
 * структура, либо сделки нет.
 *
 * ПОЧЕМУ ОБЁРТКА, А НЕ КОПИЯ ЦИКЛА
 * --------------------------------
 * Копия ~200 строк цикла V3.3 — это гарантированный math drift при любой
 * будущей правке. Вызов замороженной функции исключает расхождение по
 * построению: V3.4 физически не может посчитать уровни иначе, чем V3.3.
 *
 * СЛЕДСТВИЕ, КОТОРОЕ НАДО ЗНАТЬ ЧЕСТНО
 * ------------------------------------
 * Занятость «pending»-слота наследуется от V3.3: пока коридор V3.3 ждёт
 * исполнения, новый сетап не создаётся. Поэтому если V3.4 отклонил сетап по
 * качеству целей, он НЕ начинает искать следующий сетап раньше, чем это сделала
 * бы V3.3. Это осознанный компромисс в пользу отсутствия math drift, а не
 * недосмотр. На публикацию LIVE-сигнала (движок публикует только сетап
 * последнего закрытого бара) это не влияет.
 *
 * CRYPTORA не исполняет сделки.
 */
import type { ReplayOutput, ReplayRecord } from './types';
import { round } from './shared';
import {
  runV33LiveReplay, V33_EXIT_RULE_RU, type V33ReplayArgs,
} from './v33LiveReplay';
import {
  evaluateTargetQuality, TARGET_QUALITY_REASON_RU, V34_TP1_MIN_R, V34_TP2_MIN_R,
} from '../targetQuality';

export const V34_STRATEGY_ID = 'V3_4_HTF_ZONE_MITIGATION_QUALITY';
export const V34_STRATEGY_VERSION = '3.4';
export const V34_LIVE_VARIANT_ID = 'while-protective-displacement+target-quality';

export const V34_EXIT_RULE_RU =
  V33_EXIT_RULE_RU
  + ` Дополнительно (V3.4): сетап допускается только если TP1 ≥ ${V34_TP1_MIN_R} и TP2 ≥ ${V34_TP2_MIN_R} `
  + 'первоначального риска, считая от худшей границы коридора входа (фактический вход раннера). '
  + 'Цели при этом никогда не сдвигаются — не проходит качество, отклоняется весь сетап.';

export type V34ReplayArgs = V33ReplayArgs;

/**
 * Применяет фильтр качества к ОДНОЙ записи V3.3 и возвращает НОВУЮ запись V3.4.
 * Вход не мутируется (это проверяется тестом): V3.3 и V3.4 обязаны оставаться
 * независимыми наблюдениями одного и того же окна.
 */
export function applyTargetQualityGate(source: ReplayRecord): ReplayRecord {
  const q = evaluateTargetQuality({
    direction: source.direction,
    entryLow: source.entryZone[0],
    entryHigh: source.entryZone[1],
    stop: source.stop,
    tp1: source.targets[0]!,
    tp2: source.targets[1] ?? source.targets[0]!,
  });

  const meta: Record<string, number | string | null> = {
    ...(source.meta ?? {}),
    // Канонический якорь V3.4 — худшая граница коридора = фактический фил раннера.
    // Полная точность расчёта: округления до точности отображения здесь нет.
    entryReference: q.entryReference,
    entryReferenceRule: 'WORST_CORRIDOR_EDGE_ACTUAL_FILL',
    initialRisk: q.initialRisk,
    targetQualityTp1R: q.tp1R,
    targetQualityTp2R: q.tp2R,
    targetQualityFloorTp1: V34_TP1_MIN_R,
    targetQualityFloorTp2: V34_TP2_MIN_R,
    targetQualityRejectReason: q.reason,
    baseStrategyId: source.strategyId,
    baseStrategyVersion: source.strategyVersion,
  };

  const record: ReplayRecord = {
    ...source,
    strategyId: V34_STRATEGY_ID,
    strategyVersion: V34_STRATEGY_VERSION,
    // Копии массивов: запись V3.3 не должна разделять ссылки с записью V3.4.
    entryZone: [source.entryZone[0], source.entryZone[1]],
    targets: [...source.targets],
    confirmingFactors: [...source.confirmingFactors],
    invalidationFactors: [...source.invalidationFactors],
    exitRule: V34_EXIT_RULE_RU,
    // R/R витрины V3.4 считается от КАНОНИЧЕСКОГО якоря, а не от середины
    // коридора, — чтобы проценты в UI и число, по которому принят сетап, совпадали.
    riskRewardRatio: q.tp2R === null ? source.riskRewardRatio : round(q.tp2R, 4),
    fill: source.fill,
    outcome: source.outcome,
    publishable: source.publishable,
    publishNote: source.publishNote,
    meta,
  };

  if (q.accepted) {
    record.confirmingFactors = [
      ...record.confirmingFactors,
      `Фильтр качества целей V3.4 пройден: TP1 = ${round(q.tp1R!, 3)} R, TP2 = ${round(q.tp2R!, 3)} R `
      + `(пороги ${V34_TP1_MIN_R} / ${V34_TP2_MIN_R}) от входа ${q.entryReference} — худшей границы коридора.`,
    ];
    return record;
  }

  // Отклонено. Сделки в V3.4 нет вовсе: исполнение и исход V3.3 не наследуются,
  // иначе ретроспектива V3.4 показывала бы сделки, которых стратегия не берёт.
  const reasonRu = TARGET_QUALITY_REASON_RU[q.reason!];
  record.publishable = false;
  record.publishNote = `V3.4: ${reasonRu}`;
  record.invalidationFactors = [...record.invalidationFactors, `V3.4 · ${q.reason}: ${reasonRu}`];
  record.fill = null;
  record.outcome = {
    status: 'CANCELLED',
    barOpenTime: source.setupOpenTime,
    exitReason: q.reason!,
    exitPrice: null,
    grossR: null,
    netR: null,
    barsHeld: null,
  };
  return record;
}

export function runV34LiveReplay(args: V34ReplayArgs): ReplayOutput {
  const base = runV33LiveReplay(args);
  const records = base.records.map(applyTargetQualityGate);
  const rejected = records.filter((r) => r.outcome?.exitReason.startsWith('TARGET_QUALITY_')).length;
  const notes = base.notes.map((n) => n.replace(/^V3\.3:/, 'V3.4 (база V3.3):'));
  if (rejected > 0) {
    notes.push(
      `V3.4: ${rejected} из ${records.length} сетапов V3.3 отклонено фильтром качества целей `
      + `(TP1 < ${V34_TP1_MIN_R} R или TP2 < ${V34_TP2_MIN_R} R от худшей границы коридора). Цели не сдвигались.`,
    );
  }
  return { ...base, records, notes };
}

/** Диагностика воронки V3.4: сколько сетапов V3.3 отсеял фильтр качества. */
export function v34GateCounts(out: ReplayOutput): {
  total: number; accepted: number; rejectedTp1: number; rejectedTp2: number; rejectedGeometry: number;
} {
  let accepted = 0, rejectedTp1 = 0, rejectedTp2 = 0, rejectedGeometry = 0;
  for (const r of out.records) {
    const reason = r.meta?.targetQualityRejectReason ?? null;
    if (reason === null) accepted++;
    else if (reason === 'TARGET_QUALITY_TP1') rejectedTp1++;
    else if (reason === 'TARGET_QUALITY_TP2') rejectedTp2++;
    else rejectedGeometry++;
  }
  return { total: out.records.length, accepted, rejectedTp1, rejectedTp2, rejectedGeometry };
}

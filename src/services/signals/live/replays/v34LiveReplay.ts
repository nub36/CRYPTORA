/**
 * V3.4 — HTF Zone Mitigation + Target Quality — LIVE-реплей.
 *
 * ЧТО ЭТО ТАКОЕ
 * -------------
 * V3.4 — консервативная надстройка над V3.3. Обнаружение зоны, митигация,
 * абсорбция, стоп, структурный TP1 и структурный TP2 считает ТА ЖЕ функция,
 * что и продуктовая V3.3 (`runV33LiveReplay`), без единой изменённой строки
 * математики.
 *
 * V3.4 отличается ровно двумя вещами:
 *
 *   1. КОРИДОР ВХОДА ШИРЕ на 0.25 ATR в каждую сторону (тот же 1H-ATR, которым
 *      V3.3 строит и коридор, и стоп — нового ряда и новой формулы нет).
 *   2. ФИЛЬТР КАЧЕСТВА ЦЕЛЕЙ по расширенному коридору: TP1 ≥ 0.50 · risk и
 *      TP2 ≥ 1.00 · risk, иначе сетап отклоняется целиком.
 *
 * Стоп и обе цели остаются структурными уровнями V3.3 и не двигаются никогда.
 *
 * КАК ЭТО ПОДКЛЮЧЕНО — БЕЗ ПОСТ-ОБРАБОТКИ СДЕЛКИ
 * ----------------------------------------------
 * Расширенный коридор НЕ дорисовывается к готовому результату V3.3. Он
 * передаётся в реплей через hook `V33ReplayArgs.corridor`, который вызывается
 * В МОМЕНТ создания сетапа — до того, как коридор начнёт ловить исполнение.
 * Поэтому расширенные границы участвуют в настоящей механике сделки:
 *
 *   • `touches` — обнаружение касания коридора;
 *   • цена фила `Math.min(open, zoneHigh)` / `Math.max(open, zoneLow)`;
 *   • `risk = |fill − stop|`;
 *   • `manageTrade` и итоговый исход;
 *   • опубликованная зона входа, по которой сигнал ведёт `lifecycle.ts`.
 *
 * Следствие, которое и требовалось: бар, который лишь заходит в добавленную
 * полосу 0.25 ATR, для V3.3 исполнением не является, а для V3.4 — является.
 *
 * Отказ фильтра тоже происходит ДО создания pending: сделки не возникает
 * вовсе, а слот коридора остаётся свободным для следующего бара.
 *
 * ПОЧЕМУ HOOK, А НЕ КОПИЯ ЦИКЛА
 * -----------------------------
 * Копия ~200 строк цикла V3.3 — это гарантированный math drift при любой
 * будущей правке. Hook добавляет одну точку расширения и оставляет поведение
 * по умолчанию тождественным: parity-тест V3.3 против архивного раннера
 * `runV33Series` продолжает проходить бар в бар.
 *
 * CRYPTORA не исполняет сделки.
 */
import type { ReplayOutput, ReplayRecord } from './types';
import { fmtPx, round } from './shared';
import { V33_CONSTANTS } from '@/services/strategyArchive/definitions/v3_3-htf-zone-mitigation/v33Core';
import {
  runV33LiveReplay, V33_EXIT_RULE_RU, V33_STRATEGY_ID, V33_STRATEGY_VERSION,
  type V33CorridorHook, type V33CorridorPlan, type V33ReplayArgs,
} from './v33LiveReplay';
import {
  evaluateTargetQuality, expandEntryZone, TARGET_QUALITY_REASON_RU,
  V34_ENTRY_ZONE_ATR_PAD, V34_TP1_MIN_R, V34_TP2_MIN_R,
} from '../targetQuality';

/**
 * Восстановление 1H-ATR сетапа из коридора V3.3 — без нового расчёта ATR и без
 * нового таймфрейма.
 *
 * V3.3 строит коридор как `close ± CORRIDOR_ATR_FRAC · ATR` (v33LiveReplay.ts:
 * 207, 218), то есть полная ширина коридора = `2 · 0.10 · ATR`. Отсюда ATR
 * восстанавливается точно теми же константами, что его и породили:
 *
 *     ATR = (zoneHigh − zoneLow) / (2 · CORRIDOR_ATR_FRAC)
 *
 * Практическое следствие, важное для точности: отступ V3.4
 * `0.25 · ATR` тождественно равен `1.25 · (zoneHigh − zoneLow)`, поэтому он
 * считается из чисел самого сетапа и не зависит ни от какого внешнего ряда.
 */
export function atrFromV33Corridor(baseLow: number, baseHigh: number): number {
  return (baseHigh - baseLow) / (2 * V33_CONSTANTS.CORRIDOR_ATR_FRAC);
}

export const V34_STRATEGY_ID = 'V3_4_HTF_ZONE_MITIGATION_QUALITY';
export const V34_STRATEGY_VERSION = '3.4';
export const V34_LIVE_VARIANT_ID = 'while-protective-displacement+target-quality';

export const V34_EXIT_RULE_RU =
  V33_EXIT_RULE_RU
  + ` Отличия V3.4: коридор входа расширен на ${V34_ENTRY_ZONE_ATR_PAD} ATR в каждую сторону `
  + '(тот же 1H-ATR, что у V3.3; структурная зона V3.3 целиком внутри расширенной). '
  + 'Стоп и обе цели остаются структурными уровнями V3.3 и от расширения не двигаются. '
  + `Сетап допускается, только если TP1 ≥ ${V34_TP1_MIN_R} и TP2 ≥ ${V34_TP2_MIN_R} первоначального риска, `
  + 'считая от худшей границы УЖЕ РАСШИРЕННОГО коридора (фактический вход раннера). '
  + 'Не проходит качество или расширенная зона пересекает стоп — отклоняется весь сетап.';

export type V34ReplayArgs = V33ReplayArgs;

/**
 * Применяет фильтр качества к ОДНОЙ записи V3.3 и возвращает НОВУЮ запись V3.4.
 * Вход не мутируется (это проверяется тестом): V3.3 и V3.4 обязаны оставаться
 * независимыми наблюдениями одного и того же окна.
 */
/**
 * Hook коридора V3.4 — единственное место, где V3.4 отличается от V3.3.
 *
 * Вызывается реплеем в момент создания сетапа. Расширяет коридор и сразу же
 * решает, берётся ли сетап вообще: качество целей считается по УЖЕ
 * расширенной зоне, от её худшей границы.
 *
 * Ни стоп, ни цели сюда на запись не передаются — сдвинуть их физически
 * нельзя, можно только отказаться от сетапа.
 */
export const v34CorridorHook: V33CorridorHook = (ctx): V33CorridorPlan => {
  const { low, high, pad } = expandEntryZone(ctx.baseLow, ctx.baseHigh, ctx.atr);

  // Качество целей — по расширенной зоне. Именно здесь расширение
  // «оплачивается»: худшая граница ушла дальше от целей и ближе к стопу,
  // поэтому R1/R2 падают, а пороги не смягчаются.
  const q = evaluateTargetQuality({
    direction: ctx.direction, entryLow: low, entryHigh: high,
    stop: ctx.stop, tp1: ctx.tp1, tp2: ctx.tp2,
  });

  const meta: Record<string, number | string | null> = {
    // Структурная зона V3.3 сохраняется как есть — она целиком внутри V3.4.
    baseEntryZoneLow: ctx.baseLow,
    baseEntryZoneHigh: ctx.baseHigh,
    entryZoneRule: 'V33_CORRIDOR_EXPANDED_BY_0_25_ATR_EACH_SIDE',
    entryZonePad: pad,
    entryZonePadAtrFraction: V34_ENTRY_ZONE_ATR_PAD,
    // Тот же 1H-ATR сетапа, которым V3.3 построила коридор и стоп.
    atr1h: ctx.atr,
    entryReference: q.entryReference,
    entryReferenceRule: 'WORST_CORRIDOR_EDGE_ACTUAL_FILL',
    initialRisk: q.initialRisk,
    targetQualityTp1R: q.tp1R,
    targetQualityTp2R: q.tp2R,
    targetQualityFloorTp1: V34_TP1_MIN_R,
    targetQualityFloorTp2: V34_TP2_MIN_R,
    targetQualityRejectReason: q.reason,
  };

  if (!q.accepted) {
    const reasonRu = TARGET_QUALITY_REASON_RU[q.reason!];
    return {
      low, high, meta,
      rejectReason: q.reason!,
      rejectNote: `V3.4: ${reasonRu}`,
      invalidation: [`V3.4 · ${q.reason}: ${reasonRu}`],
    };
  }

  return {
    low, high, meta,
    confirming: [
      `Коридор входа V3.4 расширен на ${V34_ENTRY_ZONE_ATR_PAD} ATR в каждую сторону: `
      + `${fmtPx(ctx.baseLow)}–${fmtPx(ctx.baseHigh)} → ${fmtPx(low)}–${fmtPx(high)} `
      + `(1H-ATR ${fmtPx(ctx.atr)}, отступ ${fmtPx(pad)}). Стоп ${fmtPx(ctx.stop)} и цели не сдвинуты.`,
      `Фильтр качества целей V3.4 пройден по расширенной зоне: TP1 = ${round(q.tp1R!, 3)} R, `
      + `TP2 = ${round(q.tp2R!, 3)} R (пороги ${V34_TP1_MIN_R} / ${V34_TP2_MIN_R}) от входа `
      + `${q.entryReference} — худшей границы расширенного коридора.`,
    ],
    invalidation: [
      'Расширенный коридор входа увеличивает шанс исполнения, но и первоначальный риск: '
      + 'худшая цена входа дальше от цели и ближе к стопу, чем у V3.3.',
    ],
  };
};

/**
 * Переклейка шильдика записи: идентификатор, версия, текст правил выхода и
 * R/R витрины. Уровни, исполнение и исход НЕ трогаются — они уже посчитаны
 * реплеем по расширенному коридору.
 */
function relabel(rec: ReplayRecord): ReplayRecord {
  const tp2R = rec.meta?.targetQualityTp2R;
  return {
    ...rec,
    strategyId: V34_STRATEGY_ID,
    strategyVersion: V34_STRATEGY_VERSION,
    exitRule: V34_EXIT_RULE_RU,
    // R/R витрины считается от канонического якоря, а не от середины коридора,
    // чтобы проценты в UI и число, по которому принят сетап, совпадали.
    riskRewardRatio: typeof tp2R === 'number' ? round(tp2R, 4) : rec.riskRewardRatio,
    meta: {
      ...(rec.meta ?? {}),
      baseStrategyId: V33_STRATEGY_ID,
      baseStrategyVersion: V33_STRATEGY_VERSION,
    },
  };
}

export function runV34LiveReplay(args: V34ReplayArgs): ReplayOutput {
  // Расширенный коридор уходит В САМ реплей: он участвует в обнаружении
  // касания, цене фила, риске и ведении сделки — а не дорисовывается потом.
  const base = runV33LiveReplay({ ...args, corridor: v34CorridorHook });
  const records = base.records.map(relabel);
  const rejected = records.filter((r) => r.meta?.targetQualityRejectReason != null).length;
  const notes = base.notes.map((n) => n.replace(/^V3\.3:/, 'V3.4 (база V3.3):'));
  if (rejected > 0) {
    notes.push(
      `V3.4: ${rejected} из ${records.length} сетапов отклонено после расширения коридора на `
      + `${V34_ENTRY_ZONE_ATR_PAD} ATR (пересечение стопа, TP1 < ${V34_TP1_MIN_R} R или TP2 < ${V34_TP2_MIN_R} R `
      + 'от худшей границы расширенного коридора). Ни стоп, ни цели при этом не сдвигались.',
    );
  }
  return { ...base, records, notes };
}

/** Диагностика воронки V3.4: сколько сетапов V3.3 отсеял фильтр качества. */
export function v34GateCounts(out: ReplayOutput): {
  total: number; accepted: number; rejectedTp1: number; rejectedTp2: number;
  rejectedStopOverlap: number; rejectedGeometry: number;
} {
  let accepted = 0, rejectedTp1 = 0, rejectedTp2 = 0, rejectedStopOverlap = 0, rejectedGeometry = 0;
  for (const r of out.records) {
    const reason = r.meta?.targetQualityRejectReason ?? null;
    if (reason === null) accepted++;
    else if (reason === 'TARGET_QUALITY_TP1') rejectedTp1++;
    else if (reason === 'TARGET_QUALITY_TP2') rejectedTp2++;
    else if (reason === 'ENTRY_ZONE_CROSSES_STOP') rejectedStopOverlap++;
    else rejectedGeometry++;
  }
  return { total: out.records.length, accepted, rejectedTp1, rejectedTp2, rejectedStopOverlap, rejectedGeometry };
}

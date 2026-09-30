/**
 * V3.4 — HTF Zone Mitigation + Target Quality — LIVE-реплей.
 *
 * ЧТО ЭТО ТАКОЕ
 * -------------
 * V3.4 — консервативная надстройка над V3.3. Обнаружение сетапа, стоп,
 * структурный TP1 и структурный TP2 считает ТА ЖЕ функция, что и в продуктовой
 * V3.3 (`runV33LiveReplay`), без единой изменённой строки математики.
 *
 * V3.4 добавляет ровно два шага, в этом порядке:
 *
 *   1. РАСШИРЕНИЕ КОРИДОРА ВХОДА на 0.25 ATR в каждую сторону (тот же 1H-ATR,
 *      которым V3.3 уже строила коридор — нового ряда и нового расчёта нет).
 *      Стоп и обе цели при этом не двигаются ни на тик. Структурная зона V3.3
 *      целиком лежит внутри расширенной.
 *
 *   2. ФИЛЬТР КАЧЕСТВА ЦЕЛЕЙ (`evaluateTargetQuality`) — считается заново и
 *      УЖЕ ПО РАСШИРЕННОЙ зоне:
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
import { fmtPx, round } from './shared';
import { V33_CONSTANTS } from '@/services/strategyArchive/definitions/v3_3-htf-zone-mitigation/v33Core';
import {
  runV33LiveReplay, V33_EXIT_RULE_RU, type V33ReplayArgs,
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
export function applyTargetQualityGate(source: ReplayRecord): ReplayRecord {
  const baseLow = source.entryZone[0];
  const baseHigh = source.entryZone[1];

  // ── 1. Расширение коридора входа ──────────────────────────────────────────
  // Стоп и цели в этом шаге НЕ участвуют: расширяется только зона входа.
  const atr = atrFromV33Corridor(baseLow, baseHigh);
  const { low: entryLow, high: entryHigh, pad } = expandEntryZone(baseLow, baseHigh, atr);

  // ── 2. Качество целей — уже по РАСШИРЕННОЙ зоне ───────────────────────────
  // Именно здесь расширение «оплачивается»: худшая граница ушла дальше от
  // целей и ближе к стопу, поэтому R1/R2 падают, а порог не смягчается.
  const q = evaluateTargetQuality({
    direction: source.direction,
    entryLow,
    entryHigh,
    stop: source.stop,
    tp1: source.targets[0]!,
    tp2: source.targets[1] ?? source.targets[0]!,
  });

  const meta: Record<string, number | string | null> = {
    ...(source.meta ?? {}),
    // Структурная зона V3.3 сохраняется как есть — она целиком внутри зоны V3.4.
    baseEntryZoneLow: baseLow,
    baseEntryZoneHigh: baseHigh,
    entryZoneRule: 'V33_CORRIDOR_EXPANDED_BY_0_25_ATR_EACH_SIDE',
    entryZonePad: pad,
    entryZonePadAtrFraction: V34_ENTRY_ZONE_ATR_PAD,
    // 1H-ATR сетапа, восстановленный из коридора V3.3 (нового расчёта нет).
    atr1h: atr,
    // Канонический якорь V3.4 — худшая граница РАСШИРЕННОГО коридора =
    // фактический фил раннера. Округления до точности отображения здесь нет.
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
    // Единственный сдвинутый уровень — границы входа. Стоп и цели ниже
    // копируются из V3.3 без изменений.
    entryZone: [entryLow, entryHigh],
    targets: [...source.targets],
    confirmingFactors: [...source.confirmingFactors],
    invalidationFactors: [...source.invalidationFactors],
    exitRule: V34_EXIT_RULE_RU,
    // R/R витрины V3.4 считается от КАНОНИЧЕСКОГО якоря, а не от середины
    // коридора, — чтобы проценты в UI и число, по которому принят сетап, совпадали.
    riskRewardRatio: q.tp2R === null ? source.riskRewardRatio : round(q.tp2R, 4),
    /**
     * Ретроспективное исполнение НЕ наследуется от V3.3.
     *
     * V3.3 прогоняла коридор `close ± 0.10 ATR`, а у V3.4 коридор шире, и
     * бар исполнения, цена фила и исход у него другие. Скопировать сюда
     * исход V3.3 значило бы показать сделку, которой у V3.4 не было. Поэтому
     * здесь честный null: ретроспектива по окну для V3.4 НЕДОСТУПНА.
     * На продукт это не влияет — опубликованный сигнал V3.4 ведётся
     * `lifecycle.ts` по СВОИМ опубликованным уровням теми же frozen-функциями.
     */
    fill: null,
    outcome: null,
    // Публикуется, только если И база V3.3 была геометрически валидна, И
    // фильтр V3.4 принял расширенную зону. Проверка V3.4 строго сильнее.
    publishable: source.publishable && q.accepted,
    publishNote: source.publishNote,
    meta,
  };

  if (q.accepted) {
    record.confirmingFactors = [
      ...record.confirmingFactors,
      `Коридор входа V3.4 расширен на ${V34_ENTRY_ZONE_ATR_PAD} ATR в каждую сторону: `
      + `${fmtPx(baseLow)}–${fmtPx(baseHigh)} → ${fmtPx(entryLow)}–${fmtPx(entryHigh)} `
      + `(1H-ATR ${fmtPx(atr)}, отступ ${fmtPx(pad)}). Стоп ${fmtPx(source.stop)} и цели не сдвинуты.`,
      `Фильтр качества целей V3.4 пройден по расширенной зоне: TP1 = ${round(q.tp1R!, 3)} R, `
      + `TP2 = ${round(q.tp2R!, 3)} R (пороги ${V34_TP1_MIN_R} / ${V34_TP2_MIN_R}) от входа `
      + `${q.entryReference} — худшей границы расширенного коридора.`,
    ];
    record.invalidationFactors = [
      ...record.invalidationFactors,
      'Расширенный коридор входа увеличивает шанс исполнения, но и первоначальный риск: '
      + 'худшая цена входа дальше от цели и ближе к стопу, чем у V3.3.',
    ];
    return record;
  }

  // Отклонено. Сделки в V3.4 нет вовсе: исполнение и исход V3.3 не наследуются,
  // иначе ретроспектива V3.4 показывала бы сделки, которых стратегия не берёт.
  const reasonRu = TARGET_QUALITY_REASON_RU[q.reason!];
  record.publishable = false;
  record.publishNote = `V3.4: ${reasonRu}`;
  record.invalidationFactors = [...record.invalidationFactors, `V3.4 · ${q.reason}: ${reasonRu}`];
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
  const rejected = records.filter((r) => r.meta?.targetQualityRejectReason !== null).length;
  const notes = base.notes.map((n) => n.replace(/^V3\.3:/, 'V3.4 (база V3.3):'));
  notes.push(
    'V3.4: ретроспективные исходы по окну НЕДОСТУПНЫ — коридор входа шире, чем у V3.3, '
    + 'поэтому исполнение и исход V3.3 к этим сетапам неприменимы и не копируются.',
  );
  if (rejected > 0) {
    notes.push(
      `V3.4: ${rejected} из ${records.length} сетапов V3.3 отклонено после расширения коридора на `
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

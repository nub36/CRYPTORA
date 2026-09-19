/**
 * V3.3 — HTF Zone Mitigation — LIVE-реплей архивного раннера (headline-вариант
 * `while-protective-displacement`, pre-registered isPrimary в источнике).
 *
 * Повторяет цикл `definitions/v3_3-htf-zone-mitigation/v33Runner.ts` на окне
 * ЗАКРЫТЫХ свечей без TRAIN-среза:
 *
 *   • 4H-зоны строятся один раз на окно (`buildZones`: order block последней
 *     противоположной свечи перед displacement-движением ≥ 0.6 ATR и FVG,
 *     созданный этим движением, ≥ 0.2 ATR; FVG известен на баре i+1);
 *   • указатель закрытых 4H-баров на каждый 1H-бар (`closed4hAt`) — зона
 *     видна только после закрытия 4H-бара, на котором она стала известна;
 *   • окно митигации/смерти зоны по 1H (`trackZone`: OB — первое касание
 *     митигирует, закрытие за дальней гранью убивает; FVG — заполнение ≥ 50 %
 *     митигирует, полное заполнение убивает);
 *   • зоны, чей первый пригодный 1H-бар попадает в прогрев (< 60), пропускаются
 *     целиком (как в источнике — `zonesSkippedByWarmup`);
 *   • триггер: RVOL ≥ 1.25 (включительно), 1H-бар пересекает активную зону в
 *     окне «while» (с бара митигации до смерти зоны) и показывает абсорбцию
 *     (тень ≥ 35 % ИЛИ реклейм: тело ≥ 0.40 и закрытие в крайних 30 %);
 *     при нескольких зонах — Amendment-1: самая свежая, OB раньше FVG;
 *   • стоп «protective» = min(климакс, грань зоны) − 0.15 ATR (зеркально для
 *     шорта); TP1 = середина displacement-ноги; TP2 = противоположный
 *     подтверждённый 4H-свинг; коридор close ± 0.10 ATR, 3 бара, худшая граница;
 *   • ведение позиции `manageTrade` V3.3 (таймаут 48 баров, TP1 → BE со
 *     следующего бара); после исполнения сканирование продолжается на том же баре.
 *
 * Все функции — из архива, без изменений. Окно данных конечно: зоны, известные
 * до начала 1H-окна, отбрасываются правилом прогрева (первый пригодный 1H-бар —
 * нулевой), как `zonesSkippedByWarmup` в источнике при старте среза. Реплей
 * чистый и детерминированный.
 * CRYPTORA не исполняет сделки.
 */
import type { ArchiveCandle } from '@/services/strategyArchive/types';
import { FROZEN_ENGINE } from '@/services/strategyArchive/shared/frozenSettings';
import { atrSeriesV2, findSwingsV2, rvolAt } from '@/services/strategyArchive/shared/primitives';
import {
  V33_CONSTANTS, absorption, buildZones, confirmedSwingLevels, intersects, manageTrade, trackZone,
  type V33AbsorptionKind, type ZoneWindow,
} from '@/services/strategyArchive/definitions/v3_3-htf-zone-mitigation/v33Core';
import type { ReplayOutput, ReplayRecord } from './types';
import { corridorGeometryOk, fmtPx, outcomeFromManagedTrade, round, rrFrom } from './shared';

export const V33_STRATEGY_ID = 'V3_3_HTF_ZONE_MITIGATION';
export const V33_STRATEGY_VERSION = '3.3';
export const V33_LIVE_VARIANT_ID = 'while-protective-displacement';

export const V33_EXIT_RULE_RU =
  'Лимитный коридор close ± 0.10 ATR действует 3 бара (N+1…N+3); исполнение по худшей границе. '
  + 'TP1 = середина displacement-ноги 4H (50 % позиции), после TP1 стоп в безубыток со следующего бара; '
  + 'TP2 = противоположный подтверждённый 4H-свинг; стоп = min(климакс, грань зоны) ∓ 0.15 ATR; таймаут 48 баров.';

export interface V33ReplayArgs {
  symbol: string;
  h1: readonly ArchiveCandle[];
  h4: readonly ArchiveCandle[];
}

interface Pending {
  dir: 'LONG' | 'SHORT'; zoneLow: number; zoneHigh: number; stop: number;
  tp1: number; tp2: number; setupIndex: number; zoneType: string; kind: V33AbsorptionKind;
}

interface PendingCtx { record: ReplayRecord; pending: Pending }

const ABSORPTION_RU: Record<V33AbsorptionKind, string> = {
  WICK: 'тень отторжения ≥ 35 % диапазона',
  RECLAIM: 'реклейм (тело ≥ 0.40 диапазона, закрытие в крайних 30 %)',
  'WICK+RECLAIM': 'тень отторжения ≥ 35 % и реклейм (тело ≥ 0.40, закрытие в крайних 30 %)',
};

export function runV33LiveReplay(args: V33ReplayArgs): ReplayOutput {
  const {
    MIN_RVOL, CORRIDOR_ATR_FRAC, CORRIDOR_EXPIRY_BARS, STOP_BUFFER_ATR, TIMEOUT_BARS, MAKER_BPS, TAKER_BPS,
    FVG_FILL_MIN, WARMUP_BARS,
  } = V33_CONSTANTS;
  const strength = FROZEN_ENGINE.swingLookback;
  const atrPeriod = FROZEN_ENGINE.atrPeriod;
  const volPeriod = FROZEN_ENGINE.volumePeriod;

  const h1 = args.h1.filter((c) => c.isClosed);
  const out: ReplayOutput = { records: [], evaluatedBars: 0, firstEvaluatedOpenTime: null, lastEvaluatedOpenTime: null, notes: [] };
  if (h1.length <= WARMUP_BARS) {
    out.notes.push(`V3.3: недостаточно закрытых 1H-баров (${h1.length} ≤ прогрев ${WARMUP_BARS}).`);
    return out;
  }
  // 4H-ряд НЕ обрезается по началу 1H-окна (в раннере у h4 тоже нет нижней границы): ATR/RVOL/свинги 4H и
  // противоположный подтверждённый свинг (TP2) должны считаться по максимально длинной истории. Зоны,
  // известные до начала 1H-окна, получают startIndex = 0 и отбрасываются правилом прогрева (< 60) —
  // ровно как `zonesSkippedByWarmup` в источнике при старте среза; «воскрешения» умерших зон не происходит.
  const h4 = args.h4.filter((c) => c.isClosed);
  if (h4.length < atrPeriod + 2) {
    out.notes.push(`V3.3: недостаточно закрытых 4H-баров (${h4.length}) для ATR и зон.`);
    return out;
  }

  const atr1 = atrSeriesV2(h1, atrPeriod);
  const atr4 = atrSeriesV2(h4, atrPeriod);
  const rvol4: (number | null)[] = h4.map((_, i) => rvolAt(h4, i, volPeriod));
  const swings4 = findSwingsV2(h4, strength);
  const levels = confirmedSwingLevels(h4, swings4);

  const zones = buildZones({
    h4, atr4, rvol4, swings4,
    displacementMinBodyAtr: FROZEN_ENGINE.displacementMinBodyAtr, fvgMinSizeAtr: FROZEN_ENGINE.fvgMinSizeAtr, levels,
  });

  const span4h = 4 * 3_600_000;
  const closed4hAt = new Int32Array(h1.length);
  {
    let k = 0;
    for (let i = 0; i < h1.length; i++) {
      while (k < h4.length && h4[k]!.openTime + span4h <= h1[i]!.closeTime) k++;
      closed4hAt[i] = k;
    }
  }

  const windows: ZoneWindow[] = [];
  for (const z of zones) {
    const w = trackZone(h1, z, closed4hAt, FVG_FILL_MIN);
    if (w) windows.push(w);
  }
  const startsAt = new Map<number, ZoneWindow[]>();
  let skippedByWarmup = 0;
  for (const w of windows) {
    if (w.startIndex < WARMUP_BARS) { skippedByWarmup++; continue; }
    const list = startsAt.get(w.startIndex) ?? [];
    list.push(w);
    startsAt.set(w.startIndex, list);
  }
  if (skippedByWarmup > 0) {
    out.notes.push(`V3.3: ${skippedByWarmup} митигированных зон пропущено прогревом окна (первый пригодный 1H-бар < ${WARMUP_BARS}) — как в исследовании при старте среза.`);
  }

  let pend: PendingCtx | null = null;
  let active: ZoneWindow[] = [];

  for (let i = WARMUP_BARS; i < h1.length; i++) {
    const c = h1[i]!;
    out.evaluatedBars++;
    if (out.firstEvaluatedOpenTime === null) out.firstEvaluatedOpenTime = c.openTime;
    out.lastEvaluatedOpenTime = c.openTime;

    if (pend) {
      const { record, pending: p } = pend;
      const long = p.dir === 'LONG';
      const waited = i - p.setupIndex;
      const touches = long ? c.low <= p.zoneHigh : c.high >= p.zoneLow;
      const hitStop = long ? c.low <= p.stop : c.high >= p.stop;
      if (touches && hitStop) {
        record.outcome = { status: 'CANCELLED', barOpenTime: c.openTime, exitReason: 'CANCELLED', exitPrice: null, grossR: null, netR: null, barsHeld: null };
        pend = null;
      } else if (touches) {
        const fill = long ? Math.min(c.open, p.zoneHigh) : Math.max(c.open, p.zoneLow);
        const risk = Math.abs(fill - p.stop);
        const geomOk = risk > 0
          && (long ? p.stop < fill : p.stop > fill)
          && (long ? p.tp1 > fill && p.tp2 > p.tp1 : p.tp1 < fill && p.tp2 < p.tp1);
        if (!geomOk) {
          record.outcome = { status: 'CANCELLED', barOpenTime: c.openTime, exitReason: 'REJECTED_GEOMETRY', exitPrice: null, grossR: null, netR: null, barsHeld: null };
          pend = null;
        } else {
          record.fill = { barOpenTime: c.openTime, price: fill, stop: p.stop, targets: [p.tp1, p.tp2] };
          const bars = h1.slice(i, Math.min(h1.length, i + TIMEOUT_BARS + 2));
          const r = manageTrade(p.dir, fill, p.stop, p.tp1, p.tp2, bars);
          if (r) {
            record.outcome = outcomeFromManagedTrade({ r, bars, entry: fill, stop0: p.stop, tp2: p.tp2, makerBps: MAKER_BPS, takerBps: TAKER_BPS });
          }
          pend = null;
        }
      } else if (hitStop) {
        record.outcome = { status: 'CANCELLED', barOpenTime: c.openTime, exitReason: 'CANCELLED', exitPrice: null, grossR: null, netR: null, barsHeld: null };
        pend = null;
      } else if (waited >= CORRIDOR_EXPIRY_BARS) {
        record.outcome = { status: 'EXPIRED', barOpenTime: c.openTime, exitReason: 'EXPIRED', exitPrice: null, grossR: null, netR: null, barsHeld: null };
        pend = null;
      }
    }

    const starting = startsAt.get(i);
    if (starting) active = active.concat(starting);
    if (active.length > 0) active = active.filter((w) => i < w.deathIndex);

    if (pend === null && active.length > 0) {
      const atr = atr1[i] ?? null;
      if (atr !== null && atr > 0) {
        const rvol = rvolAt(h1, i, volPeriod);
        if (rvol !== null && rvol >= MIN_RVOL) {
          const candidates: { w: ZoneWindow; kind: V33AbsorptionKind }[] = [];
          for (const w of active) {
            if (w.mitigationIndex > i) continue;
            const z = w.zone;
            if (!intersects(c, z.zoneLow, z.zoneHigh)) continue;
            const kind = absorption(c, z.dir);
            if (!kind) continue;
            candidates.push({ w, kind });
          }
          if (candidates.length > 0) {
            candidates.sort((x, y) => {
              const kd = y.w.zone.knownAt4h - x.w.zone.knownAt4h;
              if (kd !== 0) return kd;
              return (x.w.zone.type === 'OB' ? 0 : 1) - (y.w.zone.type === 'OB' ? 0 : 1);
            });
            const { w, kind } = candidates[0]!;
            const z = w.zone;
            const long = z.dir === 'LONG';
            const half = CORRIDOR_ATR_FRAC * atr;
            const zoneEdge = long ? z.zoneLow : z.zoneHigh;
            const climax = long ? c.low : c.high;
            const stop = long
              ? Math.min(climax, zoneEdge) - STOP_BUFFER_ATR * atr
              : Math.max(climax, zoneEdge) + STOP_BUFFER_ATR * atr;
            const closed4h = closed4hAt[i]!;
            const opposing = long ? levels.high[closed4h] : levels.low[closed4h];
            if (opposing === null || opposing === undefined) continue;
            const tp1 = (z.legLow + z.legHigh) / 2;
            const pending: Pending = {
              dir: z.dir, zoneLow: c.close - half, zoneHigh: c.close + half, stop, tp1, tp2: opposing,
              setupIndex: i, zoneType: z.type, kind,
            };
            const mid = c.close;
            const zoneKnownBar = h4[z.knownAt4h];
            const geometryOk = corridorGeometryOk(z.dir, pending.zoneLow, pending.zoneHigh, stop, tp1, opposing);
            const record: ReplayRecord = {
              strategyId: V33_STRATEGY_ID,
              strategyVersion: V33_STRATEGY_VERSION,
              symbol: args.symbol,
              direction: z.dir,
              setupOpenTime: c.openTime,
              setupCloseTime: c.closeTime,
              setupClose: c.close,
              entryType: 'LIMIT_CORRIDOR',
              entryZone: [pending.zoneLow, pending.zoneHigh],
              stop,
              targets: [tp1, opposing],
              riskRewardRatio: rrFrom(z.dir, mid, stop, opposing),
              validForBars: CORRIDOR_EXPIRY_BARS,
              exitRule: V33_EXIT_RULE_RU,
              confirmingFactors: [
                `4H-зона ${z.type === 'OB' ? 'order block' : 'FVG'} ${fmtPx(z.zoneLow)}–${fmtPx(z.zoneHigh)} (${z.origin}, известна с 4H-бара ${zoneKnownBar ? new Date(zoneKnownBar.openTime).toISOString().slice(0, 16).replace('T', ' ') : '#' + z.knownAt4h} UTC), митигирована по 1H на баре ${new Date(h1[w.mitigationIndex]!.openTime).toISOString().slice(0, 16).replace('T', ' ')} UTC.`,
                `Абсорбция на 1H-баре: ${ABSORPTION_RU[kind]}; бар пересекает зону.`,
                `RVOL ${round(rvol, 2)} к среднему за ${volPeriod} баров (порог ≥ ${MIN_RVOL}).`,
                `Displacement-нога ${fmtPx(z.legLow)}–${fmtPx(z.legHigh)}: середина ${fmtPx(tp1)} = TP1; противоположный подтверждённый 4H-свинг ${fmtPx(opposing)} = TP2.`,
                `ATR(${atrPeriod}) 1H = ${fmtPx(atr)}; коридор ${fmtPx(pending.zoneLow)}–${fmtPx(pending.zoneHigh)}, стоп ${fmtPx(stop)} (${long ? 'min' : 'max'}(климакс ${fmtPx(climax)}, грань зоны ${fmtPx(zoneEdge)}) ${long ? '−' : '+'} ${STOP_BUFFER_ATR} ATR).`,
                ...(candidates.length > 1 ? [`Пересечено зон: ${candidates.length}; выбрана самая свежая (Amendment 1, OB раньше FVG).`] : []),
              ],
              invalidationFactors: [
                `Касание стопа ${fmtPx(stop)} до исполнения отменяет коридор; коридор и стоп на одном баре — отмена.`,
                `Коридор не исполнен за ${CORRIDOR_EXPIRY_BARS} бара → сетап истекает без сделки.`,
                'Исследование V3.3: только TRAIN (не валидировано на отложенной выборке); результат хрупок к хвосту (без топ-1 % сделок ниже комиссии).',
                'Зона умирает при закрытии за дальней гранью (OB) или полном заполнении (FVG) — после этого новые триггеры по ней не рассматриваются.',
                ...(long ? !(tp1 > c.close) : !(tp1 < c.close)) ? ['TP1 находится позади закрытия триггерного бара — геометрия будет проверена при исполнении.'] : [],
              ],
              fill: null,
              outcome: null,
              publishable: geometryOk,
              publishNote: geometryOk ? null : 'TP1 позади коридора (или TP2 не дальше TP1) — раннер отклонит на баре исполнения (REJECTED_GEOMETRY); в журнал не публикуется.',
              meta: {
                zoneType: z.type,
                zoneOrigin: z.origin,
                zoneKnownAt4hOpenTime: zoneKnownBar ? zoneKnownBar.openTime : null,
                zoneFirstTrackedOpenTime: h1[w.startIndex]!.openTime,
                zoneMitigatedAtOpenTime: h1[w.mitigationIndex]!.openTime,
                absorption: kind,
                rvol: round(rvol, 4),
              },
            };
            out.records.push(record);
            pend = { record, pending };
          }
        }
      }
    }
  }
  return out;
}

/** Диагностика доли пропущенных прогревом зон (для тестов и статуса). */
export function v33ReplayCounts(out: ReplayOutput): { records: number; filled: number; closed: number } {
  const filled = out.records.filter((r) => r.fill !== null).length;
  const closed = out.records.filter((r) => r.outcome !== null && r.fill !== null).length;
  return { records: out.records.length, filled, closed };
}

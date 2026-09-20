/**
 * V3.0 — HTF Liquidation Trap — LIVE-реплей архивного раннера.
 *
 * Повторяет цикл `definitions/v3_0-htf-liquidation-trap/v30Runner.ts` на окне
 * ЗАКРЫТЫХ свечей без исследовательских срезов (TRAIN/VALIDATION):
 *
 *   • прогрев 60 баров 1H (как `for (let i = 60; …)` в источнике);
 *   • на каждом баре сначала продвигается ожидающий коридор (`corridorStep`,
 *     N+1 и позже: исполнение по худшей границе, отмена при касании стопа,
 *     истечение через 3 бара, отклонение геометрии);
 *   • при исполнении позиция ведётся `manageTrade` (стоп раньше целей, TP1 →
 *     безубыток со следующего бара, таймаут 50 баров, вход считается баром 1);
 *   • после исполнения сканирование продолжается на том же баре (исследовательская
 *     семантика перекрывающихся позиций, D-V30-001);
 *   • новый сетап: подтверждённые 4H-свинги (`confirmedLevels`) → `detectTrap`
 *     (тело ≥ 0.35, RVOL > 1.25, прокол уровня с закрытием обратно) →
 *     `buildPending` (коридор close ± 0.10 ATR, стоп за экстремумом ± 0.15 ATR,
 *     TP1 = равновесие 4H-диапазона, TP2 = противоположный свинг).
 *
 * Все функции — из архива, без изменений. Отличие от исследовательского прогона
 * только в окне данных (последние N закрытых баров вместо многолетнего среза);
 * ATR Уайлдера сидируется в начале окна, к 200-му бару различие исчезает.
 *
 * Реплей чистый и детерминированный. CRYPTORA не исполняет сделки.
 */
import type { ArchiveCandle } from '@/services/strategyArchive/types';
import { FROZEN_ENGINE } from '@/services/strategyArchive/shared/frozenSettings';
import { atrSeriesV2, rvolAt } from '@/services/strategyArchive/shared/primitives';
import {
  V30_CONSTANTS, buildPending, confirmedLevels, corridorStep, detectTrap, manageTrade,
  type V30Pending,
} from '@/services/strategyArchive/definitions/v3_0-htf-liquidation-trap/v30Core';
import type { ReplayOutput, ReplayRecord } from './types';
import { corridorGeometryOk, fmtPx, outcomeFromManagedTrade, pct, round, rrFrom } from './shared';

export const V30_STRATEGY_ID = 'V3_0_HTF_LIQUIDATION_TRAP';
export const V30_STRATEGY_VERSION = '3.0';

export const V30_EXIT_RULE_RU =
  'Лимитный коридор close ± 0.10 ATR действует 3 бара (N+1…N+3); исполнение по худшей границе. '
  + 'TP1 = равновесие 4H-диапазона (50 % позиции), после TP1 стоп в безубыток со следующего бара; '
  + 'TP2 = противоположный подтверждённый 4H-свинг; стоп за экстремумом свипа ± 0.15 ATR; таймаут 50 баров.';

export interface V30ReplayArgs {
  symbol: string;
  /** 1H-свечи (закрытые; незакрытые отбрасываются). */
  h1: readonly ArchiveCandle[];
  /** 4H-свечи (закрытые; каузальность обеспечивает `confirmedLevels`). */
  h4: readonly ArchiveCandle[];
}

interface TrapRecordCtx {
  record: ReplayRecord;
  pending: V30Pending;
}

export function runV30LiveReplay(args: V30ReplayArgs): ReplayOutput {
  const { WARMUP_BARS, TIMEOUT_BARS, MAKER_BPS, TAKER_BPS, CORRIDOR_EXPIRY_BARS, MIN_BODY_RATIO, MIN_RVOL } = V30_CONSTANTS;
  const strength = FROZEN_ENGINE.swingLookback;
  const atrPeriod = FROZEN_ENGINE.atrPeriod;
  const volPeriod = FROZEN_ENGINE.volumePeriod;

  const h1 = args.h1.filter((c) => c.isClosed);
  const h4 = args.h4.filter((c) => c.isClosed);
  const out: ReplayOutput = { records: [], evaluatedBars: 0, firstEvaluatedOpenTime: null, lastEvaluatedOpenTime: null, notes: [] };
  if (h1.length <= WARMUP_BARS) {
    out.notes.push(`V3.0: недостаточно закрытых 1H-баров (${h1.length} ≤ прогрев ${WARMUP_BARS}).`);
    return out;
  }
  if (h4.length < strength * 2 + 2) {
    out.notes.push(`V3.0: недостаточно закрытых 4H-баров (${h4.length}) для подтверждённых свингов.`);
    return out;
  }

  // Каузальная серия ATR: значение в i зависит только от баров 0..i (эквивалент atrAt(h1.slice(0,i+1), i)).
  const atr1 = atrSeriesV2(h1, atrPeriod);

  let pend: TrapRecordCtx | null = null;

  for (let i = WARMUP_BARS; i < h1.length; i++) {
    const c = h1[i]!;
    out.evaluatedBars++;
    if (out.firstEvaluatedOpenTime === null) out.firstEvaluatedOpenTime = c.openTime;
    out.lastEvaluatedOpenTime = c.openTime;

    if (pend) {
      const { record, pending: p } = pend;
      const step = corridorStep(p, c, i);
      if (step.kind === 'CANCELLED') {
        record.outcome = { status: 'CANCELLED', barOpenTime: c.openTime, exitReason: 'CANCELLED', exitPrice: null, grossR: null, netR: null, barsHeld: null };
        pend = null;
      } else if (step.kind === 'EXPIRED') {
        record.outcome = { status: 'EXPIRED', barOpenTime: c.openTime, exitReason: 'EXPIRED', exitPrice: null, grossR: null, netR: null, barsHeld: null };
        pend = null;
      } else if (step.kind === 'REJECTED_GEOMETRY') {
        record.outcome = { status: 'CANCELLED', barOpenTime: c.openTime, exitReason: 'REJECTED_GEOMETRY', exitPrice: null, grossR: null, netR: null, barsHeld: null };
        pend = null;
      } else if (step.kind === 'FILLED') {
        record.fill = { barOpenTime: c.openTime, price: step.fill, stop: p.stop, targets: [p.tp1, p.tp2] };
        const bars = h1.slice(i, Math.min(h1.length, i + TIMEOUT_BARS + 2));
        const r = manageTrade(p.dir, step.fill, p.stop, p.tp1, p.tp2, bars);
        if (r) {
          record.outcome = outcomeFromManagedTrade({ r, bars, entry: step.fill, stop0: p.stop, tp2: p.tp2, makerBps: MAKER_BPS, takerBps: TAKER_BPS });
        }
        // r === null → позиция ещё открыта на конец окна (fill без outcome).
        pend = null;   // исследовательская семантика: сканирование продолжается на этом же баре
      }
    }

    if (pend === null) {
      const levels = confirmedLevels(h4, c.closeTime, strength);
      if (levels.swingHigh === null && levels.swingLow === null) continue;
      const rvol = rvolAt(h1, i, volPeriod);
      const sig = detectTrap(c, levels, rvol);
      if (!sig) continue;
      const atr = atr1[i] ?? null;
      if (atr === null || !(atr > 0)) continue;
      if (levels.swingHigh === null || levels.swingLow === null) continue;

      const pending = buildPending(sig, c, { swingHigh: levels.swingHigh, swingLow: levels.swingLow }, atr, i);
      const mid = (pending.zoneLow + pending.zoneHigh) / 2;
      const long = sig.direction === 'LONG';
      const geometryOk = corridorGeometryOk(sig.direction, pending.zoneLow, pending.zoneHigh, pending.stop, pending.tp1, pending.tp2);
      const record: ReplayRecord = {
        strategyId: V30_STRATEGY_ID,
        strategyVersion: V30_STRATEGY_VERSION,
        symbol: args.symbol,
        direction: sig.direction,
        setupOpenTime: c.openTime,
        setupCloseTime: c.closeTime,
        setupClose: c.close,
        entryType: 'LIMIT_CORRIDOR',
        entryZone: [pending.zoneLow, pending.zoneHigh],
        stop: pending.stop,
        targets: [pending.tp1, pending.tp2],
        riskRewardRatio: rrFrom(sig.direction, mid, pending.stop, pending.tp2),
        validForBars: CORRIDOR_EXPIRY_BARS,
        exitRule: V30_EXIT_RULE_RU,
        confirmingFactors: [
          long
            ? `Ловушка ликвидности: 1H-бар проколол подтверждённый 4H swing low ${fmtPx(sig.level)} (минимум ${fmtPx(sig.sweepExtreme)}) и закрылся выше — ${fmtPx(c.close)}.`
            : `Ловушка ликвидности: 1H-бар проколол подтверждённый 4H swing high ${fmtPx(sig.level)} (максимум ${fmtPx(sig.sweepExtreme)}) и закрылся ниже — ${fmtPx(c.close)}.`,
          `Тело бара ${pct(sig.bodyRatio)} диапазона (порог ≥ ${pct(MIN_BODY_RATIO)}).`,
          `RVOL ${round(sig.rvol, 2)} к среднему за ${volPeriod} баров (порог > ${MIN_RVOL}).`,
          `4H-структура: swing high ${fmtPx(levels.swingHigh)}, swing low ${fmtPx(levels.swingLow)}; равновесие ${fmtPx(pending.tp1)} = TP1, противоположный свинг ${fmtPx(pending.tp2)} = TP2.`,
          `ATR(${atrPeriod}) 1H = ${fmtPx(atr)}; коридор ${fmtPx(pending.zoneLow)}–${fmtPx(pending.zoneHigh)}, стоп ${fmtPx(pending.stop)}.`,
        ],
        invalidationFactors: [
          `Касание стопа ${fmtPx(pending.stop)} до исполнения коридора отменяет сетап; одновременное касание коридора и стопа на одном баре — отмена.`,
          `Коридор не исполнен за ${CORRIDOR_EXPIRY_BARS} бара → сетап истекает без сделки.`,
          'Исследование: положительный результат на VALIDATION получен на 3 из 6 символов; топ-5 сделок определяют знак; позиции перекрываются (D-V30-001).',
          'Комиссии 2/5 bps съедают заметную часть среднего R; прошлое не гарантирует будущего.',
        ],
        fill: null,
        outcome: null,
        publishable: geometryOk,
        publishNote: geometryOk ? null : 'TP1/TP2 не впереди коридора или стоп не с той стороны — раннер отклонит на баре исполнения (REJECTED_GEOMETRY); в журнал не публикуется.',
      };
      out.records.push(record);
      pend = { record, pending };
    }
  }
  return out;
}

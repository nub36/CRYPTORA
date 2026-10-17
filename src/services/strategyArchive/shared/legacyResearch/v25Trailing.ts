/**
 * V2.5 DYNAMIC TRAILING STOP + BREAKEVEN — research exit simulator (frozen).
 *
 * Verbatim port of svechnoy-suslik-v2 `scripts/real-data/v25-trailing.ts`
 *   sha256 fe6c307ee53273edcc155e16643bfecade61a6bf3a60296325ef8491460f50fa (identical at 1d4d575 and 2d8a3dd).
 * Used by V2.5, V2.6 and V2.8 (Trail arm). Lives outside the frozen tracker on purpose (see source header).
 * DO NOT EDIT — historical semantics. Gross R only; fees are applied by the caller.
 */

import type { ArchiveCandle, ArchiveDirection } from '../../types';

export const BREAKEVEN_R = 1.0;
export const TRAIL_DISTANCE_R = 1.0;
export const TRAIL_STEP_R = 0.25;
export const TIMEOUT_BARS = 10;

export type V25ExitReason = 'TRAIL' | 'BE' | 'SL' | 'TIMEOUT';

export interface V25Input {
  direction: ArchiveDirection;
  entryPrice: number;
  stopLoss: number;
  bars: readonly ArchiveCandle[];
}

export interface V25Outcome {
  reason: V25ExitReason;
  exitPrice: number;
  barsHeld: number;
  grossR: number;
  mfeR: number;
  mfeAtExitR: number;
  maeR: number;
  reachedBreakeven: boolean;
  finalStop: number;
}

export function simulateTrailing(input: V25Input): V25Outcome | null {
  return runV25(input).outcome;
}

/**
 * Прогресс ОТКРЫТОЙ позиции по frozen-трейлингу (2026-10-05, PR #56, §6
 * docs/SIGNAL_LIFECYCLE_PROGRESS_EVENTS_2026-10-05.md). Экспорт внутреннего
 * состояния `simulateTrailing` тем же степпером — НЕ вторая реализация:
 *   • beArmed — стоп РЕАЛЬНО переведён на уровень входа (или выше, в трейлинг)
 *     по правилу `peakMfe >= BREAKEVEN_R`; это само состояние `armed`
 *     frozen-алгоритма, вычисленное на закрытых барах.
 * У V2.5/V2.8 нет TP-лестницы в сопровождении, поэтому tp1Booked для них
 * всегда false (TP1-событие не выдумывается).
 */
export interface V25Progress {
  beArmed: boolean;
  /** closeTime бара, на котором armed вступил в силу; null = ещё не вооружён. */
  beArmedAt: number | null;
}

/** Прогресс ОТКРЫТОЙ позиции теми же правилами (экспорт состояния, не копия логики). */
export function inspectTrailing(input: V25Input): V25Progress | null {
  return runV25(input).progress;
}

/**
 * ВНУТРЕННИЙ СТЕППЕР ТРЕЙЛИНГА (единая реализация).
 *
 * Рефакторинг 2026-10-05: тело цикла `simulateTrailing` извлечено в один
 * степпер БЕЗ изменения порядка вычислений (проверка стопа — ДО арминга на
 * каждом баре, прежний intrabar порядок). Терминальный исход и прогресс
 * считаются одним набором правил. Паритет с прежней реализацией доказан
 * тестом `tests/unit/frozenCoreRefactorParity.test.ts` (дословная копия
 * ДО-рефакторинга) и golden-тестами `tests/unit/strategyArchive/v27v28.test.ts`.
 */

interface V25State {
  stop: number;
  stopR: number;
  peakMfe: number;
  lastUpdateMfe: number;
  armed: boolean;
  armedBar: number;
  maxFav: number;
  maxAdv: number;
}

interface V25Ctx {
  long: boolean;
  entryPrice: number;
  rOf: (p: number) => number;
  priceAtR: (r: number) => number;
}

type V25Step =
  | { kind: 'WAIT' }
  | { kind: 'EXIT'; reason: 'SL' | 'BE' | 'TRAIL'; exitPrice: number; finalStop: number }
  | { kind: 'TIMEOUT_EXIT'; exitPrice: number; finalStop: number };

function v25Step(s: V25State, ctx: V25Ctx, c: ArchiveCandle, i: number): V25Step {
  const favPrice = ctx.long ? c.high : c.low;
  const advPrice = ctx.long ? c.low : c.high;
  const favR = ctx.rOf(favPrice);
  const advR = ctx.rOf(advPrice);
  if (favR > s.maxFav) s.maxFav = favR;
  if (advR < s.maxAdv) s.maxAdv = advR;

  const hitStop = ctx.long ? c.low <= s.stop : c.high >= s.stop;
  if (hitStop) {
    const reason: V25ExitReason = !s.armed ? 'SL' : (Math.abs(s.stopR) < 1e-9 ? 'BE' : 'TRAIL');
    return { kind: 'EXIT', reason, exitPrice: s.stop, finalStop: s.stop };
  }

  if (favR > s.peakMfe) s.peakMfe = favR;

  if (!s.armed && s.peakMfe >= BREAKEVEN_R) {
    s.armed = true;
    s.armedBar = i;
    s.stop = ctx.entryPrice;
    s.stopR = 0;
    s.lastUpdateMfe = s.peakMfe;
    const trailR = s.peakMfe - TRAIL_DISTANCE_R;
    if (trailR > s.stopR) {
      s.stopR = trailR;
      s.stop = ctx.priceAtR(trailR);
      s.lastUpdateMfe = s.peakMfe;
    }
  } else if (s.armed && s.peakMfe - s.lastUpdateMfe >= TRAIL_STEP_R) {
    const trailR = s.peakMfe - TRAIL_DISTANCE_R;
    if (trailR > s.stopR) {
      s.stopR = trailR;
      s.stop = ctx.priceAtR(trailR);
    }
    s.lastUpdateMfe = s.peakMfe;
  }

  if (!s.armed && i + 1 >= TIMEOUT_BARS) {
    return { kind: 'TIMEOUT_EXIT', exitPrice: c.close, finalStop: s.stop };
  }
  return { kind: 'WAIT' };
}

function runV25(input: V25Input): { outcome: V25Outcome | null; progress: V25Progress | null } {
  const { direction, entryPrice, stopLoss, bars } = input;
  const risk = Math.abs(entryPrice - stopLoss);
  if (!(risk > 0) || bars.length === 0) return { outcome: null, progress: null };

  const long = direction === 'LONG';
  const ctx: V25Ctx = {
    long,
    entryPrice,
    rOf: (p: number): number => (long ? p - entryPrice : entryPrice - p) / risk,
    priceAtR: (r: number): number => (long ? entryPrice + r * risk : entryPrice - r * risk),
  };
  const s: V25State = {
    stop: stopLoss,
    stopR: ctx.rOf(stopLoss),
    peakMfe: 0,
    lastUpdateMfe: 0,
    armed: false,
    armedBar: -1,
    maxFav: -Infinity,
    maxAdv: Infinity,
  };

  for (let i = 0; i < bars.length; i++) {
    const step = v25Step(s, ctx, bars[i]!, i);
    if (step.kind === 'EXIT') {
      return {
        outcome: {
          reason: step.reason, exitPrice: step.exitPrice, barsHeld: i + 1, grossR: ctx.rOf(step.exitPrice),
          mfeR: Math.max(0, s.maxFav), mfeAtExitR: Math.max(0, s.maxFav),
          maeR: Number.isFinite(s.maxAdv) ? s.maxAdv : 0, reachedBreakeven: s.armed, finalStop: step.finalStop,
        },
        progress: v25ProgressOf(s, bars),
      };
    }
    if (step.kind === 'TIMEOUT_EXIT') {
      return {
        outcome: {
          reason: 'TIMEOUT', exitPrice: step.exitPrice, barsHeld: i + 1, grossR: ctx.rOf(step.exitPrice),
          mfeR: Math.max(0, s.maxFav), mfeAtExitR: Math.max(0, s.maxFav),
          maeR: Number.isFinite(s.maxAdv) ? s.maxAdv : 0, reachedBreakeven: false, finalStop: step.finalStop,
        },
        progress: v25ProgressOf(s, bars),
      };
    }
  }
  return { outcome: null, progress: v25ProgressOf(s, bars) };
}

function v25ProgressOf(s: V25State, bars: readonly ArchiveCandle[]): V25Progress {
  const armedBar = s.armedBar >= 0 ? bars[s.armedBar] : undefined;
  return {
    beArmed: s.armed,
    beArmedAt: armedBar ? armedBar.closeTime : null,
  };
}

/** Per-leg fee in R: maker on entry, taker on exit. No rebate. */
export function feeR(entryPrice: number, exitPrice: number, riskPerUnit: number, makerBps: number, takerBps: number): number {
  if (!(riskPerUnit > 0)) return 0;
  return ((makerBps / 10000) * entryPrice + (takerBps / 10000) * Math.abs(exitPrice)) / riskPerUnit;
}

export interface FeeEnv { label: string; makerBps: number; takerBps: number }
/** Headline 2/5 was labelled FUT_4 (earlier reports: FUT_7) — same arithmetic. */
export const V25_FEE_ENVS: readonly FeeEnv[] = Object.freeze([
  { label: 'GROSS', makerBps: 0, takerBps: 0 },
  { label: 'FUT_4', makerBps: 2, takerBps: 5 },
  { label: 'SPOT', makerBps: 5, takerBps: 5 },
]);

/**
 * V3.0 — HTF LIQUIDATION TRAP — pure strategy core.
 *
 * Ported from svechnoy-suslik-v2 @ 292050c6c3f32807a85548e037f674d42a2efb18
 *   research/v30_htf_trap.ts  sha256 a821757ff0319a100a8a9087da1bdd137abb1df0785493d644ad4d87f05dc4cd
 *   research/v30_validate.ts  sha256 b6d582eca49dd5a1e8a09c5c1c899b45548329776cdd29f2abc1827a6704a28b
 * Pre-registration commit 6c2bf9e · TRAIN 5674e65 · freeze 21feabe · VALIDATION 3278087.
 *
 * DO NOT EDIT the rules. This file reproduces the ACTUAL research runner,
 * including its documented divergence from the spec (overlapping positions —
 * see `V30_DISCREPANCIES` in definition.ts). Fixing that here would falsify the
 * historical record; a corrected variant must be a NEW definition.
 *
 * Constants below are the frozen, pre-registered candidate (never swept).
 */

import type { ArchiveCandle, ArchiveDirection, ArchiveTimeframe } from '../../types';
import { closedHtfCandles, findSwingsV2 } from '../../shared/primitives';

export const V30_CONSTANTS = Object.freeze({
  MIN_BODY_RATIO: 0.35,
  MIN_RVOL: 1.25,            // strict `>`; deliberately different from V2.x's 1.2
  CORRIDOR_ATR_FRAC: 0.10,
  CORRIDOR_EXPIRY_BARS: 3,
  STOP_BUFFER_ATR: 0.15,
  TIMEOUT_BARS: 50,
  MAKER_BPS: 2,
  TAKER_BPS: 5,
  STRESS_MAKER_BPS: 5,
  STRESS_TAKER_BPS: 5,
  EXEC_TF: '1h' as ArchiveTimeframe,
  STRUCT_TF: '4h' as ArchiveTimeframe,
  /** research runner: `for (let i = 60; ...)` */
  WARMUP_BARS: 60,
  SYMBOLS: ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT'] as readonly string[],
});

export type V30ExitReason =
  | 'SL' | 'TP2' | 'TP1_THEN_BE' | 'TP1_THEN_SL' | 'TP1_THEN_TIMEOUT' | 'TIMEOUT';

export interface TrapLevels {
  swingHigh: number | null;
  swingLow: number | null;
}

/**
 * Most recent CONFIRMED 4H swing high/low as of `asOfCloseTime`.
 * Two causality filters: only 4H bars closed by the 1H bar's close time, and
 * within those a pivot counts only from `confirmedIndex` onward.
 */
export function confirmedLevels(
  htf4h: readonly ArchiveCandle[], asOfCloseTime: number, strength: number,
): TrapLevels {
  const usable = closedHtfCandles(htf4h, V30_CONSTANTS.STRUCT_TF, asOfCloseTime);
  if (usable.length < strength * 2 + 2) return { swingHigh: null, swingLow: null };
  const swings = findSwingsV2(usable, strength);
  const lastIdx = usable.length - 1;
  let swingHigh: number | null = null;
  let swingLow: number | null = null;
  for (const s of swings) {
    if (s.confirmedIndex > lastIdx) continue;   // right-bars not yet printed
    if (s.kind === 'HIGH') swingHigh = s.price;
    else swingLow = s.price;
  }
  return { swingHigh, swingLow };
}

export interface TrapSignal {
  direction: ArchiveDirection;
  level: number;
  sweepExtreme: number;
  bodyRatio: number;
  rvol: number;
}

export function bodyRatio(c: ArchiveCandle): number {
  const range = c.high - c.low;
  if (!(range > 0)) return 0;
  return Math.abs(c.close - c.open) / range;
}

/** SHORT: pierces a 4H swing HIGH and closes back below. LONG: mirror. Same bar. */
export function detectTrap(
  c: ArchiveCandle, levels: TrapLevels, rvol: number | null,
): TrapSignal | null {
  const br = bodyRatio(c);
  if (br < V30_CONSTANTS.MIN_BODY_RATIO) return null;
  if (rvol === null || !(rvol > V30_CONSTANTS.MIN_RVOL)) return null;

  if (levels.swingHigh !== null
    && c.high > levels.swingHigh && c.close < levels.swingHigh) {
    return { direction: 'SHORT', level: levels.swingHigh, sweepExtreme: c.high, bodyRatio: br, rvol };
  }
  if (levels.swingLow !== null
    && c.low < levels.swingLow && c.close > levels.swingLow) {
    return { direction: 'LONG', level: levels.swingLow, sweepExtreme: c.low, bodyRatio: br, rvol };
  }
  return null;
}

/** Per-leg fee in R, charged on that leg's own notional. No rebate. */
export function legFeeR(price: number, weight: number, bps: number, risk: number): number {
  if (!(risk > 0)) return 0;
  return (bps / 10000) * price * weight / risk;
}

export interface V30TradeResult {
  exit: V30ExitReason;
  grossR: number;
  feeR: (makerBps: number, takerBps: number) => number;
  barsHeld: number;
  hitTp1: boolean;
  hitTp2: boolean;
}

/**
 * Прогресс ОТКРЫТОЙ позиции (2026-10-05, экспорт внутреннего состояния
 * `manageTrade` для уведомлений; торговая семантика не менялась):
 *   • tp1Booked — TP1 забронирован по правилу R2 (включая ветку TP2-на-баре-TP1);
 *   • beArmed — armed-стоп УЖЕ ДЕЙСТВОВАЛ при обработке хотя бы одного бара
 *     (правило R3 «строго после бара TP1»): не «будет вооружён», а реально
 *     применён к закрытому бару. При booked-TP1 без последующего бара
 *     beArmed = false — BE из TP1 не выводится.
 * Времена — closeTime подтверждающего бара (lifecycle видит только закрытые
 * свечи); null = факт не произошёл.
 */
export interface V30TradeProgress {
  tp1Booked: boolean;
  tp1At: number | null;
  beArmed: boolean;
  beArmedAt: number | null;
}

/**
 * ВНУТРЕННИЙ СТЕППЕР ВЕДЕНИЯ СДЕЛКИ (единая реализация правил).
 *
 * Intrabar rules (pre-registered, unchanged):
 *   R1 stop checked BEFORE targets on every bar;
 *   R2 TP1 books before TP2 when both land on one bar;
 *   R3 breakeven arms only on bars strictly AFTER the TP1 bar;
 *   R4 the stop never moves backwards;
 *   R5 timeout counts the entry bar as bar 1.
 *
 * Рефакторинг 2026-10-05 (PR #56, решение владельца по §6
 * docs/SIGNAL_LIFECYCLE_PROGRESS_EVENTS_2026-10-05.md): тело цикла
 * `manageTrade` извлечено в один степпер БЕЗ изменения порядка вычислений,
 * чтобы терминальный исход (`manageTrade`) и прогресс открытой позиции
 * (`inspectTrade`) считались ОДНИМ набором правил R1–R5. Паритет
 * байт-в-байт с прежней реализацией доказывается тестом
 * `tests/unit/frozenCoreRefactorParity.test.ts` (дословная копия
 * ДО-рефакторинга как reference) и существующими golden-тестами
 * `tests/unit/strategyArchive/v30Core.test.ts`.
 *
 * Прогресс — ЭКСПОРТ уже существующего внутреннего состояния
 * (hitTp1/tp1Bar/beArmed), а не новая торговая логика.
 */

/** Внутреннее состояние цикла ведения сделки. */
interface V30TradeState {
  hitTp1: boolean;
  tp1Bar: number;
  realised: number;
  legs: { price: number; weight: number; taker: boolean }[];
  /** BE-стоп уже действовал при обработке хотя бы одного бара (R3: строго после бара TP1). */
  sawArmedStop: boolean;
  /** Индекс первого бара, обработанного с armed-стопом (-1 = ещё не было). */
  armedStopBar: number;
}

/** Неизменяемый контекст сделки (уровни/направление/константы). */
interface V30TradeCtx {
  long: boolean;
  entry: number;
  stop: number;
  tp1: number;
  tp2: number;
  timeoutBars: number;
  risk: number;
  rOf: (p: number) => number;
}

type V30Step =
  | { kind: 'WAIT' }
  | { kind: 'FINISH'; exit: V30ExitReason; exitPrice: number; weight: number };

/** Один бар ведения сделки: ровно прежние проверки в прежнем порядке. */
function v30Step(s: V30TradeState, ctx: V30TradeCtx, c: ArchiveCandle, i: number): V30Step {
  const beArmed = s.hitTp1 && s.tp1Bar >= 0 && i > s.tp1Bar;   // R3
  if (beArmed && !s.sawArmedStop) { s.sawArmedStop = true; s.armedStopBar = i; }
  const stopNow = beArmed ? ctx.entry : ctx.stop;                // R4: BE is never worse than stop0

  const hitStop = ctx.long ? c.low <= stopNow : c.high >= stopNow;
  const hitT1 = !s.hitTp1 && (ctx.long ? c.high >= ctx.tp1 : c.low <= ctx.tp1);
  const hitT2 = ctx.long ? c.high >= ctx.tp2 : c.low <= ctx.tp2;

  // R1: stop first, always.
  if (hitStop) {
    if (!s.hitTp1) return { kind: 'FINISH', exit: 'SL', exitPrice: stopNow, weight: 1 };
    return { kind: 'FINISH', exit: beArmed ? 'TP1_THEN_BE' : 'TP1_THEN_SL', exitPrice: stopNow, weight: 0.5 };
  }

  if (hitT1) {
    s.hitTp1 = true; s.tp1Bar = i;
    s.realised += 0.5 * ctx.rOf(ctx.tp1);
    s.legs.push({ price: ctx.tp1, weight: 0.5, taker: true });
    // R2: TP1 books first, then TP2 may close the remainder on the same bar.
    if (hitT2) return { kind: 'FINISH', exit: 'TP2', exitPrice: ctx.tp2, weight: 0.5 };
    if (i + 1 >= ctx.timeoutBars) return { kind: 'FINISH', exit: 'TP1_THEN_TIMEOUT', exitPrice: c.close, weight: 0.5 };
    return { kind: 'WAIT' };
  }

  if (s.hitTp1 && hitT2) return { kind: 'FINISH', exit: 'TP2', exitPrice: ctx.tp2, weight: 0.5 };
  if (!s.hitTp1 && hitT2) {
    s.hitTp1 = true;
    s.realised += 0.5 * ctx.rOf(ctx.tp1);
    s.legs.push({ price: ctx.tp1, weight: 0.5, taker: true });
    return { kind: 'FINISH', exit: 'TP2', exitPrice: ctx.tp2, weight: 0.5 };
  }

  if (i + 1 >= ctx.timeoutBars) {
    return { kind: 'FINISH', exit: s.hitTp1 ? 'TP1_THEN_TIMEOUT' : 'TIMEOUT', exitPrice: c.close, weight: s.hitTp1 ? 0.5 : 1 };
  }
  return { kind: 'WAIT' };
}

/** Терминальный результат — ровно прежний `finish` (те же ноги, тот же порядок). */
function v30Finish(s: V30TradeState, ctx: V30TradeCtx, step: Extract<V30Step, { kind: 'FINISH' }>, i: number): V30TradeResult {
  s.legs.push({ price: step.exitPrice, weight: step.weight, taker: true });
  const gross = s.realised + step.weight * ctx.rOf(step.exitPrice);
  return {
    exit: step.exit, grossR: gross, barsHeld: i + 1, hitTp1: s.hitTp1, hitTp2: step.exit === 'TP2',
    feeR: (mk, tk) => s.legs.reduce((acc, l) => acc + legFeeR(l.price, l.weight, l.taker ? tk : mk, ctx.risk), 0),
  };
}

/** Прогресс открытой позиции из фактического состояния степпера. */
function v30ProgressOf(s: V30TradeState, bars: readonly ArchiveCandle[]): V30TradeProgress {
  const tp1Bar = s.tp1Bar >= 0 ? bars[s.tp1Bar] : undefined;
  const armedBar = s.armedStopBar >= 0 ? bars[s.armedStopBar] : undefined;
  return {
    tp1Booked: s.hitTp1,
    tp1At: tp1Bar ? tp1Bar.closeTime : null,
    beArmed: s.sawArmedStop,
    beArmedAt: armedBar ? armedBar.closeTime : null,
  };
}

/** ЕДИНЫЙ прогон: терминальный исход и прогресс одним степпером. */
function runV30Trade(
  direction: ArchiveDirection, entry: number, stop0: number,
  tp1: number, tp2: number, bars: readonly ArchiveCandle[],
): { result: V30TradeResult | null; progress: V30TradeProgress | null } {
  const { TIMEOUT_BARS } = V30_CONSTANTS;
  const risk = Math.abs(entry - stop0);
  if (!(risk > 0) || bars.length === 0) return { result: null, progress: null };
  const long = direction === 'LONG';
  const ctx: V30TradeCtx = {
    long, entry, stop: stop0, tp1, tp2, timeoutBars: TIMEOUT_BARS, risk,
    rOf: (p: number): number => (long ? p - entry : entry - p) / risk,
  };
  const s: V30TradeState = {
    hitTp1: false, tp1Bar: -1, realised: 0,
    legs: [{ price: entry, weight: 1, taker: false }],   // maker entry
    sawArmedStop: false, armedStopBar: -1,
  };

  for (let i = 0; i < bars.length && i < TIMEOUT_BARS; i++) {
    const step = v30Step(s, ctx, bars[i]!, i);
    if (step.kind === 'FINISH') return { result: v30Finish(s, ctx, step, i), progress: v30ProgressOf(s, bars) };
  }
  return { result: null, progress: v30ProgressOf(s, bars) };   // unresolved at the dataset boundary
}

/**
 * Manage one filled position (терминальный исход; правила R1–R5 — см. степпер).
 * null = позиция ещё открыта на границе датасета.
 */
export function manageTrade(
  direction: ArchiveDirection, entry: number, stop0: number,
  tp1: number, tp2: number, bars: readonly ArchiveCandle[],
): V30TradeResult | null {
  return runV30Trade(direction, entry, stop0, tp1, tp2, bars).result;
}

/**
 * Прогресс ОТКРЫТОЙ позиции теми же правилами R1–R5 (экспорт внутреннего
 * состояния, НЕ вторая реализация). null — сделка не могла быть оценена
 * (risk ≤ 0 / нет баров), ровно как manageTrade → null.
 */
export function inspectTrade(
  direction: ArchiveDirection, entry: number, stop0: number,
  tp1: number, tp2: number, bars: readonly ArchiveCandle[],
): V30TradeProgress | null {
  return runV30Trade(direction, entry, stop0, tp1, tp2, bars).progress;
}

export interface V30Pending {
  dir: ArchiveDirection;
  zoneLow: number;
  zoneHigh: number;
  stop: number;
  tp1: number;
  tp2: number;
  setupIndex: number;
}

export type CorridorStep =
  | { kind: 'WAIT' }
  | { kind: 'CANCELLED' }
  | { kind: 'EXPIRED' }
  | { kind: 'REJECTED_GEOMETRY' }
  | { kind: 'FILLED'; fill: number; risk: number };

/**
 * Advance a pending corridor on bar `c` (which must be at index setupIndex+1
 * or later — the runner never calls this on the reclaim bar itself).
 * Fill at the WORSE edge; ambiguous fill+stop → CANCELLED.
 */
export function corridorStep(p: V30Pending, c: ArchiveCandle, barIndex: number): CorridorStep {
  const long = p.dir === 'LONG';
  const waited = barIndex - p.setupIndex;
  const touches = long ? c.low <= p.zoneHigh : c.high >= p.zoneLow;
  const hitStop = long ? c.low <= p.stop : c.high >= p.stop;

  if (touches && hitStop) return { kind: 'CANCELLED' };
  if (touches) {
    const fill = long ? Math.min(c.open, p.zoneHigh) : Math.max(c.open, p.zoneLow);
    const risk = Math.abs(fill - p.stop);
    const geomOk = risk > 0
      && (long ? p.stop < fill : p.stop > fill)
      && (long ? p.tp1 > fill && p.tp2 > p.tp1 : p.tp1 < fill && p.tp2 < p.tp1);
    if (!geomOk) return { kind: 'REJECTED_GEOMETRY' };
    return { kind: 'FILLED', fill, risk };
  }
  if (hitStop) return { kind: 'CANCELLED' };
  if (waited >= V30_CONSTANTS.CORRIDOR_EXPIRY_BARS) return { kind: 'EXPIRED' };
  return { kind: 'WAIT' };
}

/** Build the pending corridor from a detected trap on closed 1H bar `c`. */
export function buildPending(
  sig: TrapSignal, c: ArchiveCandle, levels: { swingHigh: number; swingLow: number },
  atr: number, setupIndex: number,
): V30Pending {
  const long = sig.direction === 'LONG';
  const half = V30_CONSTANTS.CORRIDOR_ATR_FRAC * atr;
  const eq = (levels.swingHigh + levels.swingLow) / 2;   // 4H equilibrium
  const stop = long
    ? sig.sweepExtreme - V30_CONSTANTS.STOP_BUFFER_ATR * atr
    : sig.sweepExtreme + V30_CONSTANTS.STOP_BUFFER_ATR * atr;
  const tp2 = long ? levels.swingHigh : levels.swingLow;  // opposing swing
  return {
    dir: sig.direction,
    zoneLow: c.close - half, zoneHigh: c.close + half,
    stop, tp1: eq, tp2, setupIndex,
  };
}

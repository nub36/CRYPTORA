/**
 * PARITY-ТЕСТ РЕФАКТОРИНГА FROZEN-ЯДРА (2026-10-05, PR #56, §6
 * docs/SIGNAL_LIFECYCLE_PROGRESS_EVENTS_2026-10-05.md).
 *
 * ЧТО ЗДЕСЬ ДОКАЗЫВАЕТСЯ. Ради оперативных событий TP1/BREAKEVEN открытой
 * позиции тела `manageTrade` (V3.0/V3.3) и `simulateTrailing` (V2.5) были
 * извлечены во внутренние степперы, а их состояние стало экспортироваться
 * новыми инспекторами `inspectTrade`/`inspectTrailing`. ТОРГОВАЯ
 * МАТЕМАТИКА ОБЯЗАНА БЫТЬ БАЙТ-В-БАЙТ ПРЕЖНЕЙ: тот же порядок проверок
 * R1–R5, те же ноги, те же grossR/feeR, те же исходы.
 *
 * КАК ДОКАЗЫВАЕТСЯ. Ниже ДОСЛОВНО (git show HEAD до рефакторинга, изменено
 * только имя функции) встроены прежние реализации как REFERENCE. На
 * детерминированном наборе сценариев (seeded PRNG + рукописные краевые
 * случаи: ambiguous intrabar, TP1+SL одним баром, TP1+TP2 одним баром, BE
 * следующим баром, таймаут, трейлинг-шаги) каждый вызов сверяется по
 * ВСЕМ полям результата, включая feeR(2,5) в точной арифметике float.
 *
 * Дополнительно проверяется КОНСИСТЕНТНОСТЬ ПРОГРЕССА терминальному
 * результату: инспекторы читают состояние ТОГО ЖЕ степпера, поэтому
 * tp1Booked/beArmed обязаны сходиться с hitTp1/exit-причинами, а
 * tp1At/beArmedAt — closeTime подтверждающих баров (монотонность по
 * префиксам, без true→false).
 *
 * Golden-тесты (v30Core.test/v33.test/v27v28.test/v28Live.test) при этом
 * НЕ переписывались и продолжают проходить независимо.
 */
import { describe, expect, it } from 'vitest';
import type { ArchiveCandle, ArchiveDirection } from '@/services/strategyArchive/types';
import {
  inspectTrade as inspectTradeV30,
  legFeeR as legFeeRV30,
  manageTrade as manageTradeV30,
  V30_CONSTANTS,
  type V30ExitReason,
  type V30TradeResult,
} from '@/services/strategyArchive/definitions/v3_0-htf-liquidation-trap/v30Core';
import {
  inspectTrade as inspectTradeV33,
  manageTrade as manageTradeV33,
  V33_CONSTANTS,
  type V33ExitReason,
  type V33TradeResult,
} from '@/services/strategyArchive/definitions/v3_3-htf-zone-mitigation/v33Core';
import {
  inspectTrailing,
  simulateTrailing,
  BREAKEVEN_R,
  TRAIL_DISTANCE_R,
  TRAIL_STEP_R,
  TIMEOUT_BARS as V25_TIMEOUT_BARS,
  type V25ExitReason,
  type V25Input,
  type V25Outcome,
} from '@/services/strategyArchive/shared/legacyResearch/v25Trailing';

// Шимы имён для ДОСЛОВНЫХ тел ниже: оригинальные файлы импортировали эти
// имена так. Реализации legFeeR у V3.0/V3.3 идентичны (та же формула,
// подтверждена golden-тестами обоих ядер); TIMEOUT_BARS здесь — константа
// V2.5 (деструктуризации внутри manageTrade-тел дают свою теневую область).
const legFeeR = legFeeRV30;
const TIMEOUT_BARS = V25_TIMEOUT_BARS;

/* eslint-disable @typescript-eslint/no-unused-vars */
// ─── REFERENCE (ДОСЛОВНЫЕ КОПИИ ДО-РЕФАКТОРИНГА; git show HEAD) ──────────────

function refManageTradeV30(
  direction: ArchiveDirection, entry: number, stop0: number,
  tp1: number, tp2: number, bars: readonly ArchiveCandle[],
): V30TradeResult | null {
  const { TIMEOUT_BARS } = V30_CONSTANTS;
  const risk = Math.abs(entry - stop0);
  if (!(risk > 0) || bars.length === 0) return null;
  const long = direction === 'LONG';
  const rOf = (p: number): number => (long ? p - entry : entry - p) / risk;

  const stop = stop0;
  let hitTp1 = false;
  let tp1Bar = -1;
  let realised = 0;
  const legs: { price: number; weight: number; taker: boolean }[] = [];
  legs.push({ price: entry, weight: 1, taker: false });   // maker entry

  const finish = (exit: V30ExitReason, exitPrice: number, weight: number, i: number): V30TradeResult => {
    legs.push({ price: exitPrice, weight, taker: true });
    const gross = realised + weight * rOf(exitPrice);
    return {
      exit, grossR: gross, barsHeld: i + 1, hitTp1, hitTp2: exit === 'TP2',
      feeR: (mk, tk) => legs.reduce((s, l) => s + legFeeR(l.price, l.weight, l.taker ? tk : mk, risk), 0),
    };
  };

  for (let i = 0; i < bars.length && i < TIMEOUT_BARS; i++) {
    const c = bars[i]!;
    const beArmed = hitTp1 && tp1Bar >= 0 && i > tp1Bar;   // R3
    const stopNow = beArmed ? entry : stop;                 // R4: BE is never worse than stop0

    const hitStop = long ? c.low <= stopNow : c.high >= stopNow;
    const hitT1 = !hitTp1 && (long ? c.high >= tp1 : c.low <= tp1);
    const hitT2 = long ? c.high >= tp2 : c.low <= tp2;

    // R1: stop first, always.
    if (hitStop) {
      if (!hitTp1) return finish('SL', stopNow, 1, i);
      return finish(beArmed ? 'TP1_THEN_BE' : 'TP1_THEN_SL', stopNow, 0.5, i);
    }

    if (hitT1) {
      hitTp1 = true; tp1Bar = i;
      realised += 0.5 * rOf(tp1);
      legs.push({ price: tp1, weight: 0.5, taker: true });
      // R2: TP1 books first, then TP2 may close the remainder on the same bar.
      if (hitT2) return finish('TP2', tp2, 0.5, i);
      if (i + 1 >= TIMEOUT_BARS) return finish('TP1_THEN_TIMEOUT', c.close, 0.5, i);
      continue;
    }

    if (hitTp1 && hitT2) return finish('TP2', tp2, 0.5, i);
    if (!hitTp1 && hitT2) {
      hitTp1 = true;
      realised += 0.5 * rOf(tp1);
      legs.push({ price: tp1, weight: 0.5, taker: true });
      return finish('TP2', tp2, 0.5, i);
    }

    if (i + 1 >= TIMEOUT_BARS) {
      return finish(hitTp1 ? 'TP1_THEN_TIMEOUT' : 'TIMEOUT', c.close, hitTp1 ? 0.5 : 1, i);
    }
  }
  return null;   // unresolved at the dataset boundary
}

function refManageTradeV33(
  direction: ArchiveDirection, entry: number, stop0: number, tp1: number, tp2: number, bars: readonly ArchiveCandle[],
): V33TradeResult | null {
  const { TIMEOUT_BARS } = V33_CONSTANTS;
  const risk = Math.abs(entry - stop0);
  if (!(risk > 0) || bars.length === 0) return null;
  const long = direction === 'LONG';
  const rOf = (p: number): number => (long ? p - entry : entry - p) / risk;

  let hitTp1 = false;
  let tp1Bar = -1;
  let realised = 0;
  const legs: { price: number; weight: number; taker: boolean }[] = [];
  legs.push({ price: entry, weight: 1, taker: false });

  const finish = (exit: V33ExitReason, exitPrice: number, weight: number, i: number): V33TradeResult => {
    legs.push({ price: exitPrice, weight, taker: true });
    const gross = realised + weight * rOf(exitPrice);
    return {
      exit, grossR: gross, barsHeld: i + 1, hitTp1, hitTp2: exit === 'TP2',
      feeR: (mk, tk) => legs.reduce((s, l) => s + legFeeR(l.price, l.weight, l.taker ? tk : mk, risk), 0),
    };
  };

  for (let i = 0; i < bars.length && i < TIMEOUT_BARS; i++) {
    const c = bars[i]!;
    const beArmed = hitTp1 && tp1Bar >= 0 && i > tp1Bar;
    const stopNow = beArmed ? entry : stop0;
    const hitStop = long ? c.low <= stopNow : c.high >= stopNow;
    const hitT1 = !hitTp1 && (long ? c.high >= tp1 : c.low <= tp1);
    const hitT2 = long ? c.high >= tp2 : c.low <= tp2;

    if (hitStop) {
      if (!hitTp1) return finish('SL', stopNow, 1, i);
      return finish(beArmed ? 'TP1_THEN_BE' : 'TP1_THEN_SL', stopNow, 0.5, i);
    }
    if (hitT1) {
      hitTp1 = true; tp1Bar = i;
      realised += 0.5 * rOf(tp1);
      legs.push({ price: tp1, weight: 0.5, taker: true });
      if (hitT2) return finish('TP2', tp2, 0.5, i);
      if (i + 1 >= TIMEOUT_BARS) return finish('TP1_THEN_TIMEOUT', c.close, 0.5, i);
      continue;
    }
    if (hitTp1 && hitT2) return finish('TP2', tp2, 0.5, i);
    if (!hitTp1 && hitT2) {
      hitTp1 = true;
      realised += 0.5 * rOf(tp1);
      legs.push({ price: tp1, weight: 0.5, taker: true });
      return finish('TP2', tp2, 0.5, i);
    }
    if (i + 1 >= TIMEOUT_BARS) return finish(hitTp1 ? 'TP1_THEN_TIMEOUT' : 'TIMEOUT', c.close, hitTp1 ? 0.5 : 1, i);
  }
  return null;
}

function refSimulateTrailing(input: V25Input): V25Outcome | null {
  const { direction, entryPrice, stopLoss, bars } = input;
  const risk = Math.abs(entryPrice - stopLoss);
  if (!(risk > 0) || bars.length === 0) return null;

  const long = direction === 'LONG';
  const rOf = (p: number): number => (long ? p - entryPrice : entryPrice - p) / risk;
  const priceAtR = (r: number): number => (long ? entryPrice + r * risk : entryPrice - r * risk);

  let stop = stopLoss;
  let stopR = rOf(stopLoss);
  let peakMfe = 0;
  let lastUpdateMfe = 0;
  let armed = false;
  let maxFav = -Infinity;
  let maxAdv = Infinity;

  for (let i = 0; i < bars.length; i++) {
    const c = bars[i]!;
    const favPrice = long ? c.high : c.low;
    const advPrice = long ? c.low : c.high;
    const favR = rOf(favPrice);
    const advR = rOf(advPrice);
    if (favR > maxFav) maxFav = favR;
    if (advR < maxAdv) maxAdv = advR;

    const hitStop = long ? c.low <= stop : c.high >= stop;
    if (hitStop) {
      const reason: V25ExitReason = !armed ? 'SL' : (Math.abs(stopR) < 1e-9 ? 'BE' : 'TRAIL');
      return {
        reason, exitPrice: stop, barsHeld: i + 1, grossR: rOf(stop),
        mfeR: Math.max(0, maxFav), mfeAtExitR: Math.max(0, maxFav),
        maeR: Number.isFinite(maxAdv) ? maxAdv : 0, reachedBreakeven: armed, finalStop: stop,
      };
    }

    if (favR > peakMfe) peakMfe = favR;

    if (!armed && peakMfe >= BREAKEVEN_R) {
      armed = true;
      stop = entryPrice;
      stopR = 0;
      lastUpdateMfe = peakMfe;
      const trailR = peakMfe - TRAIL_DISTANCE_R;
      if (trailR > stopR) {
        stopR = trailR;
        stop = priceAtR(trailR);
        lastUpdateMfe = peakMfe;
      }
    } else if (armed && peakMfe - lastUpdateMfe >= TRAIL_STEP_R) {
      const trailR = peakMfe - TRAIL_DISTANCE_R;
      if (trailR > stopR) {
        stopR = trailR;
        stop = priceAtR(trailR);
      }
      lastUpdateMfe = peakMfe;
    }

    if (!armed && i + 1 >= TIMEOUT_BARS) {
      return {
        reason: 'TIMEOUT', exitPrice: c.close, barsHeld: i + 1, grossR: rOf(c.close),
        mfeR: Math.max(0, maxFav), mfeAtExitR: Math.max(0, maxFav),
        maeR: Number.isFinite(maxAdv) ? maxAdv : 0, reachedBreakeven: false, finalStop: stop,
      };
    }
  }
  return null;
}


// ─── СЦЕНАРИИ ────────────────────────────────────────────────────────────────

/** Детерминированный PRNG (mulberry32): прогоны воспроизводимы. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HOUR = 3_600_000;

function candle(i: number, open: number, high: number, low: number, close: number): ArchiveCandle {
  const openTime = 1_800_000_000_000 + i * HOUR;
  return {
    time: openTime, openTime, closeTime: openTime + HOUR,
    open, high, low, close, volume: 100,
    isClosed: true,
  } as ArchiveCandle;
}

interface TradeScenario {
  name: string;
  direction: ArchiveDirection;
  entry: number;
  stop: number;
  tp1: number;
  tp2: number;
  bars: ArchiveCandle[];
}

/** Рукописные краевые случаи (дословная семантика R1–R5 / трейлинга). */
function edgeScenarios(): TradeScenario[] {
  const e = 100, sl = 95, t1 = 105, t2 = 110; // риск 5, TP1 +1R, TP2 +2R
  return [
    {
      name: 'V3 LONG: SL без TP (R1 stop-first)',
      direction: 'LONG', entry: e, stop: sl, tp1: t1, tp2: t2,
      bars: [candle(0, 100.5, 101, 94.9, 96), candle(1, 96, 97, 95.5, 96.5)],
    },
    {
      name: 'V3 LONG: ambiguous intrabar — стоп и TP1 одним баром (R1 → SL)',
      direction: 'LONG', entry: e, stop: sl, tp1: t1, tp2: t2,
      bars: [candle(0, 100.5, 105.5, 94.5, 101)],
    },
    {
      name: 'V3 LONG: TP1 и TP2 одним баром (R2 → TP2)',
      direction: 'LONG', entry: e, stop: sl, tp1: t1, tp2: t2,
      bars: [candle(0, 100.5, 110.5, 100, 109)],
    },
    {
      name: 'V3 LONG: TP1, следующий бар бьёт BE-стоп (R3 → TP1_THEN_BE)',
      direction: 'LONG', entry: e, stop: sl, tp1: t1, tp2: t2,
      bars: [candle(0, 100.5, 105.2, 100, 104), candle(1, 104, 104.5, 99.9, 100.2)],
    },
    {
      name: 'V3 LONG: TP1 и возврат к стопу В ТОТ ЖЕ бар (R3 строго после → TP1_THEN_SL)',
      direction: 'LONG', entry: e, stop: sl, tp1: t1, tp2: t2,
      bars: [candle(0, 100.5, 105.2, 99.5, 100.2)],
    },
    {
      name: 'V3 LONG: TP1 затем TP2 через бар (beArmed между ними)',
      direction: 'LONG', entry: e, stop: sl, tp1: t1, tp2: t2,
      bars: [candle(0, 100.5, 105.2, 100, 104), candle(1, 104, 104.4, 100.4, 103), candle(2, 103, 110.6, 102.8, 110)],
    },
    {
      name: 'V3 LONG: таймаут без TP (R5)',
      direction: 'LONG', entry: e, stop: sl, tp1: 130, tp2: 140,
      bars: Array.from({ length: 52 }, (_, i) => candle(i, 100, 101, 99.6, 100.4)),
    },
    {
      name: 'V3 LONG: позиция открыта (null) — прогресс без терминала',
      direction: 'LONG', entry: e, stop: sl, tp1: t1, tp2: t2,
      bars: [candle(0, 100.5, 101, 99.8, 100.6), candle(1, 100.6, 105.1, 100.2, 104.8)],
    },
    {
      name: 'V3 SHORT: зеркальный TP1→BE',
      direction: 'SHORT', entry: e, stop: 105, tp1: 95, tp2: 90,
      bars: [candle(0, 99.5, 100, 94.8, 96), candle(1, 96, 100.1, 95.9, 99.8)],
    },
    {
      name: 'V3 SHORT: TP2 без TP1 касанием (R2 → TP2)',
      direction: 'SHORT', entry: e, stop: 105, tp1: 95, tp2: 90,
      bars: [candle(0, 99.5, 100, 89.9, 91)],
    },
  ];
}

/** Сгенерированные сценарии: уровни и свечи со случайными диапазонами. */
function randomScenarios(count: number, seed: number): TradeScenario[] {
  const rnd = prng(seed);
  const out: TradeScenario[] = [];
  for (let n = 0; n < count; n++) {
    const direction: ArchiveDirection = rnd() < 0.5 ? 'LONG' : 'SHORT';
    const entry = 50 + rnd() * 500;
    const risk = 1 + rnd() * 20;
    const stop = direction === 'LONG' ? entry - risk : entry + risk;
    const tp1 = direction === 'LONG' ? entry + risk * (0.4 + rnd() * 1.6) : entry - risk * (0.4 + rnd() * 1.6);
    const tp2 = direction === 'LONG' ? tp1 + risk * (0.3 + rnd() * 1.7) : tp1 - risk * (0.3 + rnd() * 1.7);
    const len = 1 + Math.floor(rnd() * 55);
    const bars: ArchiveCandle[] = [];
    let px = entry;
    for (let i = 0; i < len; i++) {
      const drift = (rnd() - 0.5) * risk * 0.9;
      const open = px;
      const close = open + drift;
      const wick = risk * (0.05 + rnd() * 0.8);
      const high = Math.max(open, close) + rnd() * wick;
      const low = Math.min(open, close) - rnd() * wick;
      bars.push(candle(i, open, high, low, close));
      px = close;
    }
    out.push({ name: `random#${n} ${direction}`, direction, entry, stop, tp1, tp2, bars });
  }
  return out;
}

interface TrailScenario {
  name: string;
  direction: ArchiveDirection;
  entry: number;
  stop: number;
  bars: ArchiveCandle[];
}

function edgeTrailScenarios(): TrailScenario[] {
  return [
    {
      name: 'V2.5 LONG: MFE ниже порога — BE не взводится, SL',
      direction: 'LONG', entry: 100, stop: 95,
      bars: [candle(0, 100.5, 104.9, 100, 103), candle(1, 103, 103.5, 94.9, 96)],
    },
    {
      name: 'V2.5 LONG: MFE ≥ 1R на баре — armed, выход BE следующим баром',
      direction: 'LONG', entry: 100, stop: 95,
      bars: [candle(0, 100.5, 105.1, 100, 104), candle(1, 104, 104.5, 99.9, 100.2)],
    },
    {
      name: 'V2.5 LONG: armed и трейлинг-шаг 0.25R (TRAIL)',
      direction: 'LONG', entry: 100, stop: 95,
      bars: [
        candle(0, 100.5, 105.5, 100, 105),
        candle(1, 105, 106.3, 104.8, 106),   // peakMfe 1.26R → trail 0.26R
        candle(2, 106, 106.4, 105.2, 105.5),
        candle(3, 105.5, 105.6, 105.25, 105.3), // стоп 0.26R ≈ 101.3 не задет… низ 105.25
        candle(4, 105.3, 105.4, 101.2, 101.5),  // задет трейлинг-стоп
      ],
    },
    {
      name: 'V2.5 LONG: таймаут без арминга',
      direction: 'LONG', entry: 100, stop: 95,
      bars: Array.from({ length: 11 }, (_, i) => candle(i, 100, 100.8, 99.7, 100.3)),
    },
    {
      name: 'V2.5 SHORT: зеркальный armed → BE',
      direction: 'SHORT', entry: 100, stop: 105,
      bars: [candle(0, 99.5, 100, 94.9, 96), candle(1, 96, 100.1, 95.9, 99.9)],
    },
  ];
}

function randomTrailScenarios(count: number, seed: number): TrailScenario[] {
  const rnd = prng(seed);
  const out: TrailScenario[] = [];
  for (let n = 0; n < count; n++) {
    const direction: ArchiveDirection = rnd() < 0.5 ? 'LONG' : 'SHORT';
    const entry = 50 + rnd() * 500;
    const risk = 1 + rnd() * 20;
    const stop = direction === 'LONG' ? entry - risk : entry + risk;
    const len = 1 + Math.floor(rnd() * 30);
    const bars: ArchiveCandle[] = [];
    let px = entry;
    for (let i = 0; i < len; i++) {
      const drift = (rnd() - 0.5) * risk * 1.4;
      const open = px;
      const close = open + drift;
      const wick = risk * (0.1 + rnd() * 1.2);
      const high = Math.max(open, close) + rnd() * wick;
      const low = Math.min(open, close) - rnd() * wick;
      bars.push(candle(i, open, high, low, close));
      px = close;
    }
    out.push({ name: `trail random#${n} ${direction}`, direction, entry, stop, bars });
  }
  return out;
}

// ─── ПАРИТЕТ manageTrade (V3.0 / V3.3) ───────────────────────────────────────

const TRADE_SCENARIOS: TradeScenario[] = [...edgeScenarios(), ...randomScenarios(300, 20261005)];

interface TradeResultView {
  exit: string;
  grossR: number;
  barsHeld: number;
  hitTp1: boolean;
  hitTp2: boolean;
  feeR: number;
  open: boolean;
}

function viewOf(r: V30TradeResult | V33TradeResult | null): TradeResultView {
  if (!r) return { exit: 'OPEN', grossR: NaN, barsHeld: NaN, hitTp1: false, hitTp2: false, feeR: NaN, open: true };
  return {
    exit: r.exit,
    grossR: r.grossR,
    barsHeld: r.barsHeld,
    hitTp1: r.hitTp1,
    hitTp2: r.hitTp2,
    feeR: r.feeR(2, 5),
    open: false,
  };
}

describe('frozenCoreRefactorParity: manageTrade V3.0 — дословный reference', () => {
  for (const sc of TRADE_SCENARIOS) {
    it(`${sc.name}`, () => {
      const ref = viewOf(refManageTradeV30(sc.direction, sc.entry, sc.stop, sc.tp1, sc.tp2, sc.bars));
      const now = viewOf(manageTradeV30(sc.direction, sc.entry, sc.stop, sc.tp1, sc.tp2, sc.bars));
      expect(now).toStrictEqual(ref);
    });
  }
});

describe('frozenCoreRefactorParity: manageTrade V3.3 — дословный reference', () => {
  for (const sc of TRADE_SCENARIOS) {
    it(`${sc.name}`, () => {
      const ref = viewOf(refManageTradeV33(sc.direction, sc.entry, sc.stop, sc.tp1, sc.tp2, sc.bars));
      const now = viewOf(manageTradeV33(sc.direction, sc.entry, sc.stop, sc.tp1, sc.tp2, sc.bars));
      expect(now).toStrictEqual(ref);
    });
  }
});

// ─── ПАРИТЕТ simulateTrailing (V2.5) ─────────────────────────────────────────

const TRAIL_SCENARIOS: TrailScenario[] = [...edgeTrailScenarios(), ...randomTrailScenarios(300, 20261006)];

function trailView(o: V25Outcome | null): Record<string, unknown> {
  if (!o) return { open: true };
  return {
    open: false, reason: o.reason, exitPrice: o.exitPrice, barsHeld: o.barsHeld,
    grossR: o.grossR, mfeR: o.mfeR, maeR: o.maeR,
    reachedBreakeven: o.reachedBreakeven, finalStop: o.finalStop,
  };
}

describe('frozenCoreRefactorParity: simulateTrailing V2.5 — дословный reference', () => {
  for (const sc of TRAIL_SCENARIOS) {
    it(`${sc.name}`, () => {
      const ref = trailView(refSimulateTrailing({ direction: sc.direction, entryPrice: sc.entry, stopLoss: sc.stop, bars: sc.bars }));
      const now = trailView(simulateTrailing({ direction: sc.direction, entryPrice: sc.entry, stopLoss: sc.stop, bars: sc.bars }));
      expect(now).toStrictEqual(ref);
    });
  }
});

// ─── КОНСИСТЕНТНОСТЬ ПРОГРЕССА ТЕРМИНАЛЬНОМУ РЕЗУЛЬТАТУ ──────────────────────

/**
 * Общие инварианты V3.x (R1–R5) для одного сценария:
 *   • терминальный hitTp1 ⇔ tp1Booked на полном ряду (бронирование одно);
 *   • exit SL / TIMEOUT-без-TP1 ⇒ beArmed=false (BE без TP1 не бывает);
 *   • exit TP1_THEN_SL ⇒ beArmed=false (стоп задет на самом баре TP1, R3);
 *   • exit TP1_THEN_BE ⇒ beArmed=true (выход был именно по armed-стопу);
 *   • beArmed ⇒ tp1Booked (R3 требует свершившегося TP1);
 *   • по префиксам tp1Booked/beArmed монотонны (true→false невозможно),
 *     время факта фиксировано баром первого подтверждения, а бар арминга —
 *     ровно следующий после бара TP1 (R3 «строго после»).
 * Для TP2/TP1_THEN_TIMEOUT beArmed на полном ряду может быть и true (TP1
 * был, следующий бар обработан с armed-стопом) — это корректная семантика
 * степпера, терминальный классификатор при этом BE не создаёт.
 */
function assertV3ProgressInvariants(
  name: string,
  terminal: { exit: string; hitTp1: boolean } | null,
  full: { tp1Booked: boolean; tp1At: number | null; beArmed: boolean; beArmedAt: number | null },
  inspectPrefix: (k: number) => { tp1Booked: boolean; tp1At: number | null; beArmed: boolean; beArmedAt: number | null },
  bars: readonly ArchiveCandle[],
) {
  if (terminal) {
    expect(full.tp1Booked).toBe(terminal.hitTp1);
    if (terminal.exit === 'SL' || terminal.exit === 'TIMEOUT') expect(full.beArmed).toBe(false);
    if (terminal.exit === 'TP1_THEN_SL') expect(full.beArmed).toBe(false);
    if (terminal.exit === 'TP1_THEN_BE') expect(full.beArmed).toBe(true);
    if (terminal.exit === 'TP2' && full.beArmed) expect(full.tp1Booked).toBe(true);
  }
  if (full.beArmed) expect(full.tp1Booked).toBe(true);

  let tp1Idx = -1;
  let beIdx = -1;
  for (let k = 1; k <= bars.length; k++) {
    const p = inspectPrefix(k);
    if (p.tp1Booked) {
      if (tp1Idx < 0) tp1Idx = k - 1;
      expect(p.tp1At).toBe(bars[tp1Idx]!.closeTime);
    } else {
      expect(tp1Idx).toBe(-1);
    }
    if (p.beArmed) {
      if (beIdx < 0) beIdx = k - 1;
      expect(p.beArmedAt).toBe(bars[beIdx]!.closeTime);
    } else {
      expect(beIdx).toBe(-1);
    }
  }
  // Бар арминга — первый бар СТРОГО после бара TP1 (R3).
  if (beIdx >= 0) {
    expect(tp1Idx).toBeGreaterThanOrEqual(0);
    expect(beIdx).toBe(tp1Idx + 1);
  }
  expect(full.tp1Booked).toBe(tp1Idx >= 0);
  expect(full.beArmed).toBe(beIdx >= 0);
  expect(full.tp1At).toBe(tp1Idx >= 0 ? bars[tp1Idx]!.closeTime : null);
  expect(full.beArmedAt).toBe(beIdx >= 0 ? bars[beIdx]!.closeTime : null);
  void name;
}

describe('frozenCoreRefactorParity: inspectTrade согласован с manageTrade (V3.0)', () => {
  for (const sc of TRADE_SCENARIOS) {
    it(`прогресс/терминал: ${sc.name}`, () => {
      const terminal = manageTradeV30(sc.direction, sc.entry, sc.stop, sc.tp1, sc.tp2, sc.bars);
      const full = inspectTradeV30(sc.direction, sc.entry, sc.stop, sc.tp1, sc.tp2, sc.bars);
      expect(full).not.toBeNull();
      assertV3ProgressInvariants(
        sc.name,
        terminal ? { exit: terminal.exit, hitTp1: terminal.hitTp1 } : null,
        full!,
        (k) => inspectTradeV30(sc.direction, sc.entry, sc.stop, sc.tp1, sc.tp2, sc.bars.slice(0, k))!,
        sc.bars,
      );
    });
  }
});

describe('frozenCoreRefactorParity: inspectTrade согласован с manageTrade (V3.3)', () => {
  for (const sc of TRADE_SCENARIOS) {
    it(`прогресс/терминал: ${sc.name}`, () => {
      const terminal = manageTradeV33(sc.direction, sc.entry, sc.stop, sc.tp1, sc.tp2, sc.bars);
      const full = inspectTradeV33(sc.direction, sc.entry, sc.stop, sc.tp1, sc.tp2, sc.bars);
      expect(full).not.toBeNull();
      assertV3ProgressInvariants(
        sc.name,
        terminal ? { exit: terminal.exit, hitTp1: terminal.hitTp1 } : null,
        full!,
        (k) => inspectTradeV33(sc.direction, sc.entry, sc.stop, sc.tp1, sc.tp2, sc.bars.slice(0, k))!,
        sc.bars,
      );
    });
  }
});

describe('frozenCoreRefactorParity: inspectTrailing согласован с simulateTrailing (V2.5)', () => {
  for (const sc of TRAIL_SCENARIOS) {
    it(`прогресс/терминал: ${sc.name}`, () => {
      const terminal = simulateTrailing({ direction: sc.direction, entryPrice: sc.entry, stopLoss: sc.stop, bars: sc.bars });
      const full = inspectTrailing({ direction: sc.direction, entryPrice: sc.entry, stopLoss: sc.stop, bars: sc.bars });
      expect(full).not.toBeNull();
      if (terminal) {
        // reachedBreakeven исхода = состояние armed на момент выхода; инспектор
        // читает тот же степпер — равенство обязано быть точным (включая
        // TIMEOUT: таймаут срабатывает только при !armed).
        expect(full!.beArmed).toBe(terminal.reachedBreakeven);
      }
      // Монотонность armed по префиксам, время = closeTime бара арминга,
      // сам бар — первый, где peakMfe достигла порога BE.
      let beIdx = -1;
      let beArmedAt: number | null = null;
      for (let k = 1; k <= sc.bars.length; k++) {
        const p = inspectTrailing({ direction: sc.direction, entryPrice: sc.entry, stopLoss: sc.stop, bars: sc.bars.slice(0, k) })!;
        if (p.beArmed) {
          if (beIdx < 0) { beIdx = k - 1; beArmedAt = p.beArmedAt; }
          expect(p.beArmedAt).toBe(beArmedAt);
        } else {
          expect(beIdx).toBe(-1);
        }
      }
      expect(full!.beArmed).toBe(beIdx >= 0);
      expect(full!.beArmedAt).toBe(beIdx >= 0 ? sc.bars[beIdx]!.closeTime : null);
      if (beIdx >= 0) {
        let peak = -Infinity;
        for (let i = 0; i <= beIdx; i++) {
          const b = sc.bars[i]!;
          const fav = sc.direction === 'LONG' ? b.high : b.low;
          const favR = (sc.direction === 'LONG' ? fav - sc.entry : sc.entry - fav) / Math.abs(sc.entry - sc.stop);
          peak = Math.max(peak, favR);
          if (i < beIdx) expect(peak).toBeLessThan(BREAKEVEN_R); // иначе armed случился бы раньше
        }
        expect(peak).toBeGreaterThanOrEqual(BREAKEVEN_R);
      }
    });
  }
});

describe('frozenCoreRefactorParity: константы не изменились', () => {
  it('V3.0/V3.3/V2.5 frozen-константы на месте', () => {
    expect(V30_CONSTANTS.TIMEOUT_BARS).toBe(50);
    expect(V33_CONSTANTS.TIMEOUT_BARS).toBe(48);
    expect(BREAKEVEN_R).toBe(1.0);
    expect(TRAIL_DISTANCE_R).toBe(1.0);
    expect(TRAIL_STEP_R).toBe(0.25);
    expect(V25_TIMEOUT_BARS).toBe(10);
  });
});

/**
 * R-based metrics — identical definitions to the Suslik research runners
 * (research/v30_htf_trap.ts accumulation block). Not a general backtester:
 * the only purpose is reproducing the archived programme's numbers.
 *
 * Every figure is in R (|entry − stop| = 1). No capital, no position size.
 * Max drawdown is a cumulative-R walk over trades in the order they were
 * produced (per symbol, sequential) — NOT a portfolio time-series drawdown.
 */

import type { ArchiveTrade, RMetrics } from '../types';
import { quantileSorted } from '../shared/primitives';

const r4 = (x: number): number => +x.toFixed(4);

function med(x: readonly number[]): number {
  return x.length ? quantileSorted([...x].sort((a, b) => a - b), 0.5) : NaN;
}
function qq(x: readonly number[], f: number): number {
  return x.length ? quantileSorted([...x].sort((a, b) => a - b), f) : NaN;
}
function maxDD(seq: readonly number[]): number {
  let peak = 0, eq = 0, dd = 0;
  for (const r of seq) {
    eq += r;
    if (eq > peak) peak = eq;
    if (eq - peak < dd) dd = eq - peak;
  }
  return dd;
}
function group(trades: readonly ArchiveTrade[], key: (t: ArchiveTrade) => string) {
  const m = new Map<string, { n: number; sum: number }>();
  for (const t of trades) {
    const e = m.get(key(t)) ?? { n: 0, sum: 0 };
    e.n++; e.sum += t.grossR; m.set(key(t), e);
  }
  return Object.fromEntries([...m].map(([k, v]) => [k, { n: v.n, grossExpectancy: r4(v.sum / v.n) }]));
}

export function computeRMetrics(trades: readonly ArchiveTrade[]): RMetrics {
  const n = trades.length;
  const gs = trades.map((t) => t.grossR);
  const sumG = gs.reduce((a, b) => a + b, 0);
  const sumFeeH = trades.reduce((a, t) => a + t.feeRHeadline, 0);
  const hasStress = trades.every((t) => t.feeRStress !== null) && n > 0;
  const sumFeeS = hasStress ? trades.reduce((a, t) => a + (t.feeRStress ?? 0), 0) : null;

  const wins = gs.filter((g) => g > 0);
  const losses = gs.filter((g) => !(g > 0));
  const pos = wins.reduce((a, b) => a + b, 0);
  const neg = losses.reduce((a, b) => a - b, 0);

  const sorted = [...gs].sort((a, b) => b - a);
  const drop = (k: number): number => {
    const rest = sorted.slice(Math.min(k, sorted.length));
    return rest.length ? rest.reduce((p, q) => p + q, 0) / rest.length : 0;
  };
  const k1 = Math.max(1, Math.ceil(sorted.length * 0.01));

  const exits: Record<string, number> = {};
  for (const t of trades) exits[t.exitReason] = (exits[t.exitReason] ?? 0) + 1;

  const gross = n ? sumG / n : 0;
  const stopPct = trades.map((t) => t.stopDistancePct);
  return {
    n,
    grossRPerTrade: r4(gross),
    feeDragRHeadline: r4(n ? sumFeeH / n : 0),
    netRPerTradeHeadline: r4(n ? (sumG - sumFeeH) / n : 0),
    feeDragRStress: sumFeeS === null ? null : r4(n ? sumFeeS / n : 0),
    netRPerTradeStress: sumFeeS === null ? null : r4(n ? (sumG - sumFeeS) / n : 0),
    profitFactor: neg > 0 ? r4(pos / neg) : null,
    maxDrawdownR: +maxDD(gs).toFixed(2),
    positiveRRatePct: n ? +((wins.length / n) * 100).toFixed(2) : 0,
    grossMedianR: r4(med(gs)),
    avgWinR: wins.length ? r4(pos / wins.length) : 0,
    avgLossR: losses.length ? r4(-neg / losses.length) : 0,
    medianBarsHeld: +med(trades.map((t) => t.barsHeld)).toFixed(2),
    stopDistancePct: {
      p25: r4(qq(stopPct, 0.25)),
      median: r4(med(stopPct)),
      p75: r4(qq(stopPct, 0.75)),
    },
    exits,
    outlierDependence: {
      grossExpectancy: r4(gross),
      exTop1: r4(drop(1)),
      exTop5: r4(drop(5)),
      exTop1Pct: r4(drop(k1)),
      removedForTop1Pct: k1,
    },
    byDirection: group(trades, (t) => t.direction),
    bySymbol: group(trades, (t) => t.symbol),
  };
}

/** Stable digest of a trade list (FNV-1a over a canonical string) — determinism checks. */
export function tradesDigest(trades: readonly ArchiveTrade[]): string {
  let h = 0x811c9dc5;
  const s = trades
    .map((t) => `${t.symbol}|${t.direction}|${t.setupOpenTime}|${t.fillOpenTime}|${t.entry}|${t.stop}|${t.exitReason}|${t.barsHeld}|${t.grossR.toFixed(6)}`)
    .join('\n');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `fnv1a32:${h.toString(16).padStart(8, '0')}:n${trades.length}`;
}

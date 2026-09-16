/**
 * Strategy Archive Reproduction Engine (R-based historical simulation).
 *
 * Purpose: ONLY to replay the imported Suslik strategy archive with its own
 * frozen semantics. It is NOT a replacement for `services/backtest/BacktestEngine`
 * (which is untouched) and is not a general-purpose backtester.
 *
 * Contract:  definition + normalized candles + frozen assumptions
 *            → historical trades → R metrics → reproducibility report.
 */

import type {
  ArchiveCandle, ArchiveTimeframe, FunnelCounts, ReproductionReport, SliceName,
  SplitWindow, StrategyDefinition,
} from '../types';
import { computeRMetrics, tradesDigest } from './rMetrics';
import splitsJson from '../results/v2-real-20260915-080338/splits.json' with { type: 'json' };

export interface SymbolSeries {
  symbol: string;
  bySeries: Partial<Record<ArchiveTimeframe, readonly ArchiveCandle[]>>;
}

interface SplitsFile { splits: SplitWindow[] }

/** Split bounds for a (symbol, exec timeframe) from the pinned splits.json. */
export function splitFor(symbol: string, timeframe: ArchiveTimeframe): SplitWindow | null {
  const s = (splitsJson as unknown as SplitsFile).splits.find(
    (x) => x.symbol === symbol && x.timeframe === timeframe,
  );
  return s ?? null;
}

function addFunnel(a: FunnelCounts, b: FunnelCounts): void {
  for (const k of Object.keys(a) as (keyof FunnelCounts)[]) a[k] += b[k];
}

/**
 * Replay `definition` over the given symbols and slice. Symbols are processed
 * in the order given (the source runners iterate splits.json order, which is
 * BTC, ETH, BNB, SOL, XRP, DOGE); trade order affects only maxDrawdownR.
 */
export function reproduce(
  definition: StrategyDefinition,
  series: readonly SymbolSeries[],
  slice: SliceName,
  splits?: Readonly<Record<string, SplitWindow>>,
): ReproductionReport {
  const funnel: FunnelCounts = {
    signals: 0, pendingCreated: 0, filled: 0, expired: 0, cancelled: 0, rejected: 0, unresolved: 0,
  };
  const trades: ReproductionReport['trades'] = [];
  let maxRead = 0;
  for (const s of series) {
    const split = splits?.[s.symbol] ?? splitFor(s.symbol, definition.execTimeframe);
    if (!split) continue;
    const out = definition.runSeries({ symbol: s.symbol, bySeries: s.bySeries, split }, slice);
    addFunnel(funnel, out.funnel);
    trades.push(...out.trades);
    if (out.maxCandleOpenTimeRead > maxRead) maxRead = out.maxCandleOpenTimeRead;
  }
  return {
    versionId: definition.id,
    slice,
    origin: 'DERIVED_BY_CRYPTORA',
    funnel,
    metrics: computeRMetrics(trades),
    trades,
    maxCandleOpenTimeRead: maxRead,
    deterministicDigest: tradesDigest(trades),
  };
}

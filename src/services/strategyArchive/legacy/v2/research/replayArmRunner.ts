/**
 * Shared TRAIN/VALIDATION driver semantics of scripts/real-data/v22-train.ts (5ce58db),
 * v23-train.ts (2ee06d1), v24-train.ts (8e07352) and v24-validate.ts (c52fda7):
 *
 *   • per (symbol, timeframe) series in SCOPE 15m/30m/1h/4h, each with its own window from splits.json;
 *   • HTF series = frozen HTF_MAP parents, passed raw (the replay bounds them causally);
 *   • the replay's `trades` stream is reduced exactly like the source `add()`:
 *       - only terminal === 'FILLED' trades with a resolved result (not 'OPEN') are CLOSED trades;
 *       - gross R = stored rMultiple + 0.1 % lump / risk  (recovers GROSS from the frozen tracker);
 *       - fee environments are per-leg (v22-engine `feeRPerLeg`): maker entry, taker exit.
 *
 * This file is archive-only glue: it converts the historical replay output to ArchiveTrade rows.
 * The replays themselves (`v22Replay`, `v23Replay`, `v24Replay`) are verbatim ports.
 */

import type { ArchiveCandle, ArchiveSeriesInput, ArchiveTimeframe, ArchiveTrade, FunnelCounts, SliceName } from '../../../types';
import { splitFor } from '../../../engine/reproductionEngine';
import { HTF_MAP } from '../htf';
import { Settings } from '../legacySettings';
import { toLegacyCandles } from '../sniperEntryLoop';
import type { Candle, Timeframe } from '../coreTypes';
import { feeRPerLeg, type FeeEnv } from './v22Engine';

/** What the frozen tracker already subtracted (lump 0.1 % of entry notional). */
export const FROZEN_FEE_PCT = 0.1;
export const V2X_SCOPE: readonly ArchiveTimeframe[] = Object.freeze(['15m', '30m', '1h', '4h']);

/** Minimal shape shared by V22Trade / V23Trade / V24Trade. */
export interface ReplayTradeLike {
  symbol: string; timeframe: Timeframe; direction: 'LONG' | 'SHORT';
  setupCandleTime: number; terminal: string; reason: string;
  entryCandleTime?: number; entryPrice?: number; stopLoss?: number;
  result?: string; exitPrice?: number | null; barsHeld?: number; rMultiple?: number; riskPerUnit?: number;
}

export interface ReplayLike { trades: ReplayTradeLike[]; actionableSetups: number; pendingCreated: number }

export interface ReplayArmArgs {
  input: ArchiveSeriesInput;
  slice: SliceName;
  headline: FeeEnv;
  stress: FeeEnv;
  armLabel: string;
  /** Extra per-trade tags copied from the replay row (e.g. tp1Basis, poolKind). */
  tagFields?: readonly string[];
  /** Fail loudly if a VALIDATION window would touch TEST (v24-validate.ts TEST-SAFETY guard). */
  testSafety?: boolean;
  /** Timeframe scope; defaults to V2X_SCOPE (15m/30m/1h/4h). V2.1a/b iterated ALL 42 frozen splits (1m…1d). */
  scope?: readonly ArchiveTimeframe[];
  /** Treat MISSED as its own funnel bucket instead of `cancelled` (V2.1 semantics: TP1 reached before fill). */
  terminalMap?: (terminal: string) => 'expired' | 'cancelled' | 'rejected' | 'filled';
  replay(args: {
    symbol: string; timeframe: Timeframe; candles: readonly Candle[]; settings: Settings;
    htfCandles: Partial<Record<Timeframe, readonly Candle[]>>; from: number; to: number;
  }): ReplayLike;
}

export function runReplayArm(a: ReplayArmArgs): { trades: ArchiveTrade[]; funnel: FunnelCounts; maxCandleOpenTimeRead: number } {
  const settings = Settings.fromFrozenSnapshot();
  const trades: ArchiveTrade[] = [];
  const funnel: FunnelCounts = { signals: 0, pendingCreated: 0, filled: 0, expired: 0, cancelled: 0, rejected: 0, unresolved: 0 };
  let maxRead = 0;

  for (const tf of a.scope ?? V2X_SCOPE) {
    const series = a.input.bySeries[tf];
    if (!series) continue;
    const split = splitFor(a.input.symbol, tf);
    if (!split) throw new Error(`${a.armLabel}: no split for ${a.input.symbol} ${tf}`);
    if (a.slice === 'validation' && a.testSafety && !(split.validToMs < split.testFromMs)) {
      throw new Error(`TEST-SAFETY: ${a.input.symbol} ${tf} validTo ${split.validToMs} >= testFrom ${split.testFromMs}`);
    }
    const from = a.slice === 'validation' ? split.validFromMs : split.trainFromMs;
    const to = a.slice === 'validation' ? split.validToMs : split.trainToMs;
    const htfCandles: Partial<Record<Timeframe, readonly Candle[]>> = {};
    for (const h of HTF_MAP[tf as Timeframe] ?? []) {
      const s = (a.input.bySeries as Partial<Record<string, readonly ArchiveCandle[]>>)[h];
      if (s) htfCandles[h] = toLegacyCandles(s);
    }
    const candles = toLegacyCandles(series);
    const r = a.replay({ symbol: a.input.symbol, timeframe: tf as Timeframe, candles, settings, htfCandles, from, to });
    funnel.signals += r.actionableSetups;
    funnel.pendingCreated += r.pendingCreated;
    // the last evaluated bar of the window (source loop breaks at openTime > to)
    for (let i = candles.length - 1; i >= 0; i--) {
      const c = candles[i]!;
      if (c.openTime <= to) { if (c.openTime > maxRead) maxRead = c.openTime; break; }
    }
    for (const t of r.trades) {
      const bucket = a.terminalMap ? a.terminalMap(t.terminal)
        : t.terminal === 'EXPIRED' ? 'expired' : (t.terminal === 'CANCELLED' || t.terminal === 'MISSED') ? 'cancelled' : t.terminal !== 'FILLED' ? 'rejected' : 'filled';
      if (bucket !== 'filled') { funnel[bucket]++; continue; }
      if (t.result === undefined || t.result === 'OPEN') { funnel.unresolved++; continue; }
      const e = t.entryPrice!, risk = t.riskPerUnit!, exit = t.exitPrice ?? e;
      const g = (t.rMultiple ?? 0) + (FROZEN_FEE_PCT / 100) * e / risk;
      funnel.filled++;
      const tags: Record<string, string | number | boolean> = { timeframe: tf, arm: a.armLabel, hitTp: t.result === 'TP' };
      for (const f of a.tagFields ?? []) {
        const v = (t as unknown as Record<string, unknown>)[f];
        if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') tags[f] = v;
      }
      trades.push({
        symbol: a.input.symbol, direction: t.direction,
        setupOpenTime: t.setupCandleTime, fillOpenTime: t.entryCandleTime ?? t.setupCandleTime,
        entry: e, stop: t.stopLoss ?? e, exitReason: t.result, barsHeld: t.barsHeld ?? 0, grossR: g,
        feeRHeadline: feeRPerLeg(e, exit, risk, a.headline),
        feeRStress: feeRPerLeg(e, exit, risk, a.stress),
        stopDistancePct: (risk / e) * 100,
        tags,
      });
    }
  }
  return { trades, funnel, maxCandleOpenTimeRead: maxRead };
}

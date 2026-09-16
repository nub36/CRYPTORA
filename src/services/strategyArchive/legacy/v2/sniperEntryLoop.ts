/**
 * The shared V2.5 / V2.6 / V2.7 / V2.8 research loop — verbatim structure of `main()` in
 * research/v27_rr_test.ts (965fb15) and research/v28_gross_only.ts (54243a7):
 *
 *   • per (symbol, timeframe) series of CLOSED candles; HTF series bounded causally via `htfUpperBound`
 *     (200 closed HTF bars ending at/before the evaluated bar's closeTime);
 *   • `minBars = max(80, swing*6 + 40)`, visible window `lookback + 60`;
 *   • ONE position slot governed by the frozen `trackOutcome` (the slot frees only when the frozen ladder
 *     resolves TP/SL/TIMEOUT) — regardless of which exit arm the study measures;
 *   • entry = OPEN of N+1 (`resolveEntry`), stop/targets shifted by the fill delta, `executableLadder`,
 *     validity: risk > 0, ≥1 executable target, rr1 ≥ risk.min_rr, stop on the correct side;
 *   • `sniper` = REVERSAL kind ∧ `baseSniper(setup, extremePoolKind(...)).ok`.
 *
 * The loop hands each RESOLVED sniper entry to a version-specific callback; it never decides exits itself.
 * ARCHIVE-ONLY. The engine files it calls are the frozen 4839074 port.
 */

import type { ArchiveCandle, ArchiveTimeframe } from '../../types';
import { evaluateV2 } from './engine';
import { HTF_MAP } from './htf';
import { trackOutcome, type TrackOutput } from './tracker';
import { resolveEntry } from './stateMachine';
import { executableLadder } from './v2Runner';
import { Settings } from './legacySettings';
import { baseSniper } from './v24Engine';
import { extremePoolKind, type PoolKind } from './corridorEntry';
import type { Candle, Timeframe } from './coreTypes';
import { TF_MS } from './coreTypes';
import type { V2Setup } from './types';

export const WINDOW_MARGIN = 60;

export interface OpenPosition {
  entryIndex: number; entryPrice: number; stop: number; tps: number[];
  entryCandleTime: number; direction: 'LONG' | 'SHORT'; sniper: boolean;
  setupCandleTime: number;
}

export interface ResolvedSlot {
  open: OpenPosition;
  /** Frozen tracker output that freed the slot (SMC arm). */
  out: TrackOutput;
  /** All closed candles of the series (for arm simulators to slice from `open.entryIndex`). */
  closed: readonly Candle[];
  /** Index of the bar on which the slot resolved. */
  resolvedAtIndex: number;
}

export interface LoopStats { actionable: number; sniperEntries: number; nonSniperResolved: number; unresolvedOpenAtEnd: number; maxOpenTimeRead: number }

export interface LoopArgs {
  symbol: string;
  timeframe: ArchiveTimeframe;
  candles: readonly ArchiveCandle[];
  htf: Partial<Record<ArchiveTimeframe, readonly ArchiveCandle[]>>;
  fromMs: number;
  toMs: number;
  /** Called for every resolved SNIPER slot. */
  onSniperResolved(slot: ResolvedSlot): void;
  /** Optional: called for EVERY resolved slot (V2.5 / V2.6 baseline arms A and V25 use the whole universe). */
  onAnyResolved?(slot: ResolvedSlot): void;
}

/** Suslik `Candle` has quoteVolume/trades; the archive shape does not — zero-filled exactly like the source loader. */
export function toLegacyCandles(c: readonly ArchiveCandle[]): Candle[] {
  return c.map((x) => ({ ...x, quoteVolume: 0, trades: 0 }));
}

function htfUpperBound(c: readonly Candle[], asOf: number, span: number): number {
  let lo = 0, hi = c.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (c[mid]!.openTime + span <= asOf) { ans = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  return ans;
}

export function runSniperEntryLoop(args: LoopArgs): LoopStats {
  const settings = Settings.fromFrozenSnapshot();
  const minRr = settings.num('risk.min_rr');
  const swing = Math.floor(settings.num('engine.swing_lookback'));
  const lookback = Math.floor(settings.num('engine.lookback_candles'));
  const minBars = Math.max(80, swing * 6 + 40);
  const winLen = lookback + WINDOW_MARGIN;
  const tf = args.timeframe as Timeframe;

  const closed = toLegacyCandles(args.candles.filter((c) => c.isClosed));
  const htf: Partial<Record<Timeframe, readonly Candle[]>> = {};
  for (const h of HTF_MAP[tf] ?? []) {
    const s = args.htf[h];
    if (s) htf[h] = toLegacyCandles(s);
  }
  const htfSpans = new Map<Timeframe, number>();
  for (const h of HTF_MAP[tf] ?? []) htfSpans.set(h, TF_MS[h]);
  const tfMs = TF_MS[tf];

  const stats: LoopStats = { actionable: 0, sniperEntries: 0, nonSniperResolved: 0, unresolvedOpenAtEnd: 0, maxOpenTimeRead: 0 };
  let open: OpenPosition | null = null;

  for (let i = minBars; i < closed.length; i++) {
    const candle = closed[i]!;
    if (candle.openTime < args.fromMs) continue;
    if (candle.openTime > args.toMs) break;
    if (candle.openTime > stats.maxOpenTimeRead) stats.maxOpenTimeRead = candle.openTime;

    if (open) {
      const slice = closed.slice(open.entryIndex, i + 1);
      const out = trackOutcome({
        direction: open.direction, entryPrice: open.entryPrice,
        stopLoss: open.stop, takeProfits: open.tps,
        entryCandleTime: open.entryCandleTime, candles: slice, settings, qty: 0,
      });
      if (out) {
        const slot: ResolvedSlot = { open, out, closed, resolvedAtIndex: i };
        args.onAnyResolved?.(slot);
        if (open.sniper) args.onSniperResolved(slot);
        else stats.nonSniperResolved++;
        open = null;
      }
    }

    if (open === null) {
      const start = Math.max(0, i - winLen + 1);
      const visible = closed.slice(start, i + 1);
      let htfArg: Partial<Record<Timeframe, readonly Candle[]>> | undefined;
      if (Object.keys(htf).length > 0) {
        const bounded: Partial<Record<Timeframe, readonly Candle[]>> = {};
        const asOf = candle.closeTime;
        for (const [h, span] of htfSpans) {
          const hc = htf[h]; if (!hc || hc.length === 0) continue;
          const ub = htfUpperBound(hc, asOf, span);
          if (ub < 0) continue;
          bounded[h] = hc.slice(Math.max(0, ub - 200 + 1), ub + 1);
        }
        htfArg = bounded;
      }
      const s: V2Setup | null = evaluateV2({ symbol: args.symbol, timeframe: tf, candles: visible, settings, htfCandles: htfArg });
      if (s !== null && s.direction !== 'WAIT' && s.stop !== null && s.entry !== null && s.targets.length > 0) {
        const next = closed[i + 1];
        const ent = resolveEntry(candle.openTime, tfMs, next);
        if (ent) {
          stats.actionable++;
          const shift = ent.entryPrice - s.entry;
          const stopPrice = s.stop.price + shift;
          const tps = s.targets.map((t) => t.price + shift);
          const lad = executableLadder(s.direction, ent.entryPrice, stopPrice, tps);
          const risk = Math.abs(ent.entryPrice - stopPrice);
          const valid = risk > 0 && lad.targets.length > 0 && lad.rr1 >= minRr
            && (s.direction === 'LONG' ? stopPrice < ent.entryPrice : stopPrice > ent.entryPrice);
          if (valid) {
            let sniper = false;
            if (s.kind === 'REVERSAL') {
              const pk: PoolKind = extremePoolKind(s, visible, settings);
              sniper = baseSniper(s, pk).ok;
            }
            if (sniper) stats.sniperEntries++;
            open = {
              entryIndex: i + 1, entryPrice: ent.entryPrice, stop: stopPrice, tps: lad.targets,
              entryCandleTime: ent.entryCandleTime, direction: s.direction, sniper, setupCandleTime: candle.openTime,
            };
          }
        }
      }
    }
  }
  if (open) stats.unresolvedOpenAtEnd++;
  return stats;
}

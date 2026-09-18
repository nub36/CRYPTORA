import { describe, it, expect } from 'vitest';
import fixture from './fixtures/v30-synthetic-parity.json';
import {
  V30_DEFINITION, V30_CONSTANTS, V30_DISCREPANCIES, reproduce, computeRMetrics,
  type ArchiveCandle, type SplitWindow,
} from '@/services/strategyArchive';
import { runV30Series } from '@/services/strategyArchive/definitions/v3_0-htf-liquidation-trap/v30Runner';

const H = 3_600_000;
type Row = [number, number, number, number, number, number];

function toCandles(rows: Row[], spanMs: number): ArchiveCandle[] {
  return rows.map(([openTime, open, high, low, close, volume]) => ({
    openTime, open, high, low, close, volume, closeTime: openTime + spanMs - 1, isClosed: true,
  }));
}

const h1 = toCandles(fixture.candles1h as Row[], H);
const h4 = toCandles(fixture.candles4h as Row[], 4 * H);
const split: SplitWindow = {
  symbol: 'SYNTH', timeframe: '1h',
  trainFromMs: fixture.trainFromMs, trainToMs: fixture.trainToMs,
  validFromMs: fixture.trainToMs + H, validToMs: fixture.trainToMs + 2 * H,
  testFromMs: fixture.trainToMs + 3 * H, testToMs: fixture.trainToMs + 4 * H,
};
const run = () => runV30Series({ symbol: 'SYNTH', bySeries: { '1h': h1, '4h': h4 }, split }, 'train');

describe('V3.0 synthetic parity against the ORIGINAL research module (suslik@292050c)', () => {
  it('fixture was produced by the original research code and contains overlapping trades', () => {
    expect(fixture.generator).toContain('research/v30_htf_trap.ts');
    expect(fixture.trades.length).toBe(50);
    expect(fixture.overlappingTrades).toBeGreaterThan(0);
  });

  it('funnel counts match exactly', () => {
    const out = run();
    expect(out.funnel).toEqual(fixture.funnel);
  });

  it('every trade matches: direction, setup/fill time, entry, stop, exit reason, bars held, gross R, fees', () => {
    const out = run();
    expect(out.trades.length).toBe(fixture.trades.length);
    for (let k = 0; k < out.trades.length; k++) {
      const a = out.trades[k]!;
      const b = fixture.trades[k]!;
      expect(a.direction).toBe(b.direction);
      expect(a.setupOpenTime).toBe(b.setupOpenTime);
      expect(a.fillOpenTime).toBe(b.fillOpenTime);
      expect(a.entry).toBeCloseTo(b.entry, 12);
      expect(a.stop).toBeCloseTo(b.stop, 12);
      expect(a.exitReason).toBe(b.exitReason);
      expect(a.barsHeld).toBe(b.barsHeld);
      expect(a.grossR).toBeCloseTo(b.grossR, 12);
      expect(a.feeRHeadline).toBeCloseTo(b.feeR25, 12);
      expect(a.feeRStress).toBeCloseTo(b.feeR55, 12);
      expect(a.stopDistancePct).toBeCloseTo(b.stopDistancePct, 12);
    }
    const sum = out.trades.reduce((s, t) => s + t.grossR, 0);
    expect(sum).toBeCloseTo(fixture.grossRSum, 10);
  });

  it('OVERLAP PARITY: overlapping positions are preserved, not "fixed" (D-V30-001)', () => {
    const out = run();
    let overlaps = 0;
    for (let k = 1; k < out.trades.length; k++) {
      const prev = out.trades[k - 1]!;
      const prevExit = prev.fillOpenTime + (prev.barsHeld - 1) * H;
      if (out.trades[k]!.fillOpenTime <= prevExit) overlaps++;
    }
    expect(overlaps).toBe(fixture.overlappingTrades);
    expect(V30_DISCREPANCIES.some((d) => d.id === 'D-V30-001'
      && d.reproductionPolicy === 'PRESERVE_RESEARCH_BEHAVIOUR')).toBe(true);
  });

  it('is deterministic: two runs give the same digest and metrics', () => {
    const series = [{ symbol: 'SYNTH', bySeries: { '1h': h1, '4h': h4 } as const }];
    const a = reproduce(V30_DEFINITION, series, 'train', { SYNTH: split });
    const b = reproduce(V30_DEFINITION, series, 'train', { SYNTH: split });
    expect(a.deterministicDigest).toBe(b.deterministicDigest);
    expect(a.metrics).toEqual(b.metrics);
    expect(a.origin).toBe('DERIVED_BY_CRYPTORA');
    expect(a.metrics.n).toBe(50);
    expect(a.metrics.exits).toEqual(fixture.exits);
  });

  it('never reads a candle beyond the slice end + resolution window and never touches VALIDATION/TEST in train', () => {
    const out = run();
    // last resolution bar can extend past trainToMs by at most TIMEOUT_BARS+1 bars (research semantics)
    expect(out.maxCandleOpenTimeRead).toBeLessThanOrEqual(split.trainToMs + (V30_CONSTANTS.TIMEOUT_BARS + 1) * H);
    // no setup is ever created from a bar outside [trainFromMs, trainToMs]
    for (const t of out.trades) {
      expect(t.setupOpenTime).toBeGreaterThanOrEqual(split.trainFromMs);
      expect(t.setupOpenTime).toBeLessThanOrEqual(split.trainToMs);
    }
  });

  it('VALIDATION clip: outcome bars never reach testFromMs', () => {
    const vSplit: SplitWindow = {
      ...split,
      validFromMs: fixture.trainFromMs, validToMs: fixture.trainToMs,
      testFromMs: fixture.trainToMs + 10 * H, testToMs: fixture.trainToMs + 20 * H,
    };
    const out = runV30Series({ symbol: 'SYNTH', bySeries: { '1h': h1, '4h': h4 }, split: vSplit }, 'validation');
    expect(out.maxCandleOpenTimeRead).toBeLessThan(vSplit.testFromMs);
    for (const t of out.trades) {
      expect(t.fillOpenTime + (t.barsHeld - 1) * H).toBeLessThan(vSplit.testFromMs);
    }
  });

  it('no future candle access: truncating the series AFTER a trade closes does not change earlier trades', () => {
    const full = run();
    const cut = full.trades[10]!;
    const cutIdx = h1.findIndex((c) => c.openTime === cut.fillOpenTime + (cut.barsHeld - 1) * H);
    const h1Short = h1.slice(0, cutIdx + 1);
    const h4Short = h4.filter((c) => c.closeTime <= h1Short[h1Short.length - 1]!.closeTime);
    const short = runV30Series({ symbol: 'SYNTH', bySeries: { '1h': h1Short, '4h': h4Short }, split }, 'train');
    // Overlapping trades (D-V30-001) may have been resolved with bars after the cut; compare
    // every trade whose resolution ended at or before the cut bar — they must be identical.
    const cutTime = h1Short[h1Short.length - 1]!.openTime;
    const closedBeforeCut = full.trades.filter((t) => t.fillOpenTime + (t.barsHeld - 1) * H <= cutTime);
    expect(closedBeforeCut.length).toBeGreaterThanOrEqual(10);
    for (const t of closedBeforeCut) {
      expect(short.trades.find((s) => s.setupOpenTime === t.setupOpenTime && s.fillOpenTime === t.fillOpenTime)).toEqual(t);
    }
  });

  it('metrics module reproduces the research aggregation (fee drag, PF, ex-top-1%)', () => {
    const out = run();
    const m = computeRMetrics(out.trades);
    const gross = out.trades.reduce((s, t) => s + t.grossR, 0) / out.trades.length;
    const fee = out.trades.reduce((s, t) => s + t.feeRHeadline, 0) / out.trades.length;
    expect(m.grossRPerTrade).toBeCloseTo(gross, 4);
    expect(m.netRPerTradeHeadline).toBeCloseTo(gross - fee, 4);
    expect(m.outlierDependence.removedForTop1Pct).toBe(1);
    expect(m.positiveRRatePct).toBeGreaterThan(0);
  });
});

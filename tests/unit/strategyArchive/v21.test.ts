/**
 * C7 — V2.1a Structural Limit Entry + V2.1b Confirmed-Extreme Corridor Entry (both REJECTED_ON_TRAIN, superseded).
 * The registry is now complete: 13 imported, 0 planned.
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  STRATEGY_ARCHIVE, STRATEGY_ARCHIVE_PLANNED, STRATEGY_ARCHIVE_TOTAL_ROWS, reproduce,
  V21A_DEFINITION, V21A_VARIANTS, V21A_SOURCE_RESULTS, V21A_CAVEATS_RU, V21A_COMMITS, V21A_DISCREPANCIES, V21A_CONSTANTS,
  V21B_DEFINITION, V21B_VARIANTS, V21B_SOURCE_RESULTS, V21B_CAVEATS_RU, V21B_COMMITS, V21B_DISCREPANCIES, V21B_CONSTANTS,
  LEGACY_V2_PROVENANCE,
  type ArchiveCandle,
} from '@/services/strategyArchive';
import { buildZone, structuralArea, replayLimitEntry, EXPIRY_BARS as LIMIT_EXPIRY } from '@/services/strategyArchive/legacy/v2/research/limitEntryReplay';
import { replayCorridor } from '@/services/strategyArchive/legacy/v2/research/corridorReplay';
import { buildCorridor, feeGuardPasses, EXPIRY_BARS as CORRIDOR_EXPIRY, CORRIDOR_MAX_PCT } from '@/services/strategyArchive/legacy/v2/corridorEntry';
import { LegacySettings } from '@/services/strategyArchive/legacy/v2';

const ROOT = resolve(__dirname, '../../..');
const sha = (p: string) => createHash('sha256').update(readFileSync(resolve(ROOT, p))).digest('hex');
const local = (p: string) => 'src/services/strategyArchive/results/' + p.replace(/^artifacts\/research\/limit-entry\//, 'v21a/').replace(/^artifacts\/research\/corridor\//, 'v21b/');
const M15 = 900_000;
const bar = (i: number, o: number, h: number, l: number, c: number): ArchiveCandle & { quoteVolume: number; trades: number } =>
  ({ openTime: i * M15, open: o, high: h, low: l, close: c, volume: 1, closeTime: i * M15 + M15 - 1, isClosed: true, quoteVolume: 0, trades: 0 });
const emptyInput = { symbol: 'BTCUSDT', bySeries: {}, split: { symbol: 'BTCUSDT', timeframe: '1m' as const, trainFromMs: 0, trainToMs: 1, validFromMs: 2, validToMs: 3, testFromMs: 4, testToMs: 5 } };

describe('V2.1a — structural limit entry: REJECTED_ON_TRAIN, no candidate, gross/net inversion preserved', () => {
  it('verdict, pins, dependency, no headline, TRAIN only, per-leg columns declared derived', () => {
    expect(V21A_DEFINITION.verdict).toBe('REJECTED_ON_TRAIN');
    expect(V21A_DEFINITION.reproducibility).toBe('SOURCE_CHAIN_VERIFIED_NOT_RERUN');
    expect(V21A_DEFINITION.reproductionBlockedReason).toMatch(/not executed/);
    expect(V21A_DEFINITION.headlineVariantId).toBeUndefined();               // source selected NO candidate
    expect(V21A_DEFINITION.slicesAvailable).toEqual(['train']);
    expect(V21A_DEFINITION.legacyEngineDependency).toBe('FROZEN_V2_ENGINE_4839074');
    expect(V21A_DEFINITION.scopeTimeframes).toEqual(['1m', '5m', '15m', '30m', '1h', '4h', '1d']);
    expect(V21A_COMMITS.historicalPin).toBe('4b25bbb'); expect(V21A_COMMITS.preregistration).toBe('e3750fc');
    expect(V21A_DISCREPANCIES.map((d) => d.id)).toContain('D-V21A-003');     // per-leg columns ≠ source lump fee
    expect(Object.isFrozen(V21A_DEFINITION)).toBe(true);
  });
  it('artifacts byte-pinned; variants A/B/C/D; numbers read from artifacts; ranking inversion visible', () => {
    for (const p of V21A_DEFINITION.sourcePins.filter((x) => x.role === 'ARTIFACT')) expect(sha(local(p.path)), p.path).toBe(p.sha256);
    expect(V21A_VARIANTS.map((v) => v.id)).toEqual(['A', 'B', 'C', 'D']);
    expect(V21A_VARIANTS[0]!.sourceRole).toMatch(/SOURCE_REPORTED, not rerun/);
    const g = V21A_SOURCE_RESULTS.trainGross as Record<string, { grossExp: number; netExpFrozen: number; medFeeR: number; n: number }>;
    expect(g.B!.grossExp).toBeGreaterThan(g.A!.grossExp);                     // best gross …
    expect(g.B!.netExpFrozen).toBeLessThan(g.A!.netExpFrozen);                // … worst net
    expect(g.B!.medFeeR).toBeGreaterThan(1.9); expect(g.A!.n).toBe(328872); expect(g.B!.n).toBe(121300);
    const m = V21A_SOURCE_RESULTS.train.models as Record<string, { grossExpectancyPerActionableSetup: number; fillRate: number; netExpectancyPerFilled: Record<string, number> }>;
    expect(m.B!.fillRate).toBeCloseTo(12.98, 2); expect(m.C!.fillRate).toBeCloseTo(25.49, 2); expect(m.D!.fillRate).toBeCloseTo(21.39, 2);
    for (const k of ['B', 'C', 'D']) expect(m[k]!.netExpectancyPerFilled['10bps']).toBeLessThan(0);
    expect(V21A_SOURCE_RESULTS.modelAFidelity.verdict).toBe('PASS');
    expect(V21A_SOURCE_RESULTS.modelAFidelity.datasetCommit).toBe('c3c1dcecfe2784a147f591f2b5b4526cbf99df9f');
  });
  it('D-V21A-006: metrics artifact "gross" fields are actually stored (net) R — gross artifact differs', () => {
    const m = V21A_SOURCE_RESULTS.train.models as Record<string, { grossExpectancyPerFilled: number }>;
    const g = V21A_SOURCE_RESULTS.trainGross as Record<string, { grossExp: number; netExpFrozen: number }>;
    expect(m.A!.grossExpectancyPerFilled).toBeCloseTo(g.A!.netExpFrozen, 4);
    expect(m.A!.grossExpectancyPerFilled).not.toBeCloseTo(g.A!.grossExp, 2);
  });
  it('runner refuses model A (baseline not ported), unknown models and non-TRAIN slices; empty input → zero trades', () => {
    expect(() => V21A_DEFINITION.runSeries(emptyInput, 'train', 'A')).toThrow(/SOURCE_REPORTED only/);
    expect(() => V21A_DEFINITION.runSeries(emptyInput, 'train', 'E')).toThrow(/unknown model/);
    expect(() => V21A_DEFINITION.runSeries(emptyInput, 'validation', 'B')).toThrow(/TRAIN/);
    expect(() => reproduce(V21A_DEFINITION, [], 'validation')).toThrow(/never run/);
    expect(V21A_DEFINITION.runSeries(emptyInput, 'train', 'D').trades).toEqual([]);
  });
  it('caveats: rejected first, denominator artifact, per-leg incomparability, no promise wording', () => {
    expect(V21A_CAVEATS_RU[0]).toMatch(/ОТКЛОНЕНО НА TRAIN/);
    const all = V21A_CAVEATS_RU.join(' ');
    expect(all).toMatch(/сжатого знаменателя/); expect(all).toMatch(/НЕ сопоставимый/); expect(all).toMatch(/не исполняет сделки/);
    expect(all).not.toMatch(/прибыльная стратегия|лучший сигнал|ожидаемая доходность/i);
  });
});

describe('V2.1b — corridor entry: REJECTED_ON_TRAIN on the pre-registered per-setup metric', () => {
  it('verdict, pins, 7 arms, FULL headline (rejected), TRAIN only', () => {
    expect(V21B_DEFINITION.verdict).toBe('REJECTED_ON_TRAIN');
    expect(V21B_DEFINITION.reproducibility).toBe('SOURCE_CHAIN_VERIFIED_NOT_RERUN');
    expect(V21B_DEFINITION.headlineVariantId).toBe('FULL');
    expect(V21B_VARIANTS.map((v) => v.id)).toEqual(['A', 'E', 'F', 'C', 'EF', 'EFC', 'FULL']);
    expect(V21B_VARIANTS.find((v) => v.id === 'FULL')!.sourceRole).toMatch(/rejected/);
    expect(V21B_COMMITS.historicalPin).toBe('374b335'); expect(V21B_COMMITS.preregistration).toBe('5ce3761'); expect(V21B_COMMITS.tfCostDiagnostic).toBe('dccf751');
    for (const p of V21B_DEFINITION.sourcePins.filter((x) => x.role === 'ARTIFACT')) expect(sha(local(p.path)), p.path).toBe(p.sha256);
    expect(LEGACY_V2_PROVENANCE.files['corridorEntry.ts'].sha256).toBe(V21B_DEFINITION.sourcePins.find((p) => p.path === 'scripts/real-data/corridor-entry.ts')!.sha256);
  });
  it('primary metric: no filtered arm beats baseline per setup; fee guard removed the edge; fill rate 24.09 %', () => {
    const arms = V21B_SOURCE_RESULTS.train.arms as Record<string, { grossExpectancyPerActionableSetup: number; closed: number; fillRateOfPending: number; netExpectancyPerFilled: Record<string, number>; byPoolKind: Record<string, { grossExpectancy: number }> }>;
    const base = arms.A!.grossExpectancyPerActionableSetup;
    for (const k of ['E', 'F', 'C', 'EF', 'EFC', 'FULL']) expect(arms[k]!.grossExpectancyPerActionableSetup, k).toBeLessThan(base);
    expect(arms.FULL!.closed).toBe(56486); expect(arms.FULL!.fillRateOfPending).toBe(24.09);
    expect(arms.FULL!.netExpectancyPerFilled['10bps']).toBe(-0.1167); expect(arms.A!.netExpectancyPerFilled['10bps']).toBe(-0.7289);
    expect(arms.FULL!.byPoolKind.EQUAL!.grossExpectancy).toBeLessThan(arms.FULL!.byPoolKind.CLUSTER!.grossExpectancy);   // premise contradicted
    expect(V21B_SOURCE_RESULTS.primaryMetricPerSetup.A).toBe(0.009); expect(V21B_SOURCE_RESULTS.primaryMetricPerSetup.FULL).toBe(0.0001);
  });
  it('timeframe×cost diagnostic stored as a diagnostic, not a verdict: A survives 10 bps only at 4h/1d, FULL from 1h', () => {
    const d = V21B_SOURCE_RESULTS.tfCostDiagnostic.arms as Record<string, Record<string, { survivesSpot10bps: boolean }>>;
    expect(Object.entries(d.A!).filter(([, v]) => v.survivesSpot10bps).map(([k]) => k)).toEqual(['4h', '1d']);
    expect(Object.entries(d.FULL!).filter(([, v]) => v.survivesSpot10bps).map(([k]) => k)).toEqual(['1h', '4h', '1d']);
    expect(V21B_DISCREPANCIES.find((x) => x.id === 'D-V21B-005')!.impact).toMatch(/must not be presented as a validated/);
  });
  it('runner refuses unknown arms and non-TRAIN; empty input → zero trades', () => {
    expect(() => V21B_DEFINITION.runSeries(emptyInput, 'train', 'X')).toThrow(/unknown arm/);
    expect(() => V21B_DEFINITION.runSeries(emptyInput, 'validation', 'FULL')).toThrow(/TRAIN/);
    expect(V21B_DEFINITION.runSeries(emptyInput, 'train', 'FULL').trades).toEqual([]);
  });
  it('caveats: rejected first, per-setup table, diagnostic ≠ validated strategy, no promise wording', () => {
    expect(V21B_CAVEATS_RU[0]).toMatch(/ОТКЛОНЕНО НА TRAIN/); expect(V21B_CAVEATS_RU[0]).toMatch(/A \+0\.0090/);
    const all = V21B_CAVEATS_RU.join(' ');
    expect(all).toMatch(/не валидированная стратегия/); expect(all).toMatch(/не исполняет сделки/);
    expect(all).not.toMatch(/прибыльная стратегия|лучший сигнал|ожидаемая доходность/i);
  });
});

describe('V2.1 verbatim primitives (frozen)', () => {
  it('limit zone: proximal edge for B/C, midpoint for D, whole zone on the retracement side, clipped to the area', () => {
    // LONG, area [98, 100], reference 101 → zone at the HIGH edge (price retraces DOWN)
    const zB = buildZone('B', 'LONG', [98, 100], 2, 0.01, 101)!;
    expect(zB.high).toBeLessThanOrEqual(100); expect(zB.high).toBeLessThan(101); expect(zB.high - zB.low).toBeCloseTo(0.2, 6);
    const zD = buildZone('D', 'LONG', [98, 100], 2, 0.01, 101)!;
    expect((zD.low + zD.high) / 2).toBeCloseTo(99, 6);
    expect(buildZone('B', 'LONG', [98, 100], 2, 0.01, 99)).toBeNull();          // zone not entirely below reference → no order
    expect(LIMIT_EXPIRY).toBe(12);
  });
  it('structuralArea: B needs a same-direction breakout; C an unfilled same-direction FVG; D overlap else OB', () => {
    const s = (o: object) => ({ direction: 'LONG', ...o }) as never;
    expect(structuralArea('B', s({ breakout: { direction: 'LONG', level: 100 } }), 2)).toEqual([99.5, 100.5]);
    expect(structuralArea('B', s({ breakout: { direction: 'SHORT', level: 100 } }), 2)).toBeNull();
    expect(structuralArea('C', s({ fvg: { direction: 'LONG', state: 'FRESH', bottom: 97, top: 98 } }), 2)).toEqual([97, 98]);
    expect(structuralArea('C', s({ fvg: { direction: 'LONG', state: 'FILLED', bottom: 97, top: 98 } }), 2)).toBeNull();
    expect(structuralArea('D', s({ orderBlock: { direction: 'LONG', state: 'FRESH', low: 96, high: 98 }, fvg: { direction: 'LONG', state: 'FRESH', bottom: 97, top: 99 } }), 2)).toEqual([97, 98]);
    expect(structuralArea('D', s({ orderBlock: { direction: 'LONG', state: 'FRESH', low: 96, high: 98 } }), 2)).toEqual([96, 98]);
  });
  it('corridor: ±0.10 ATR capped at 0.15 % of price, tick-quantised; 3-bar expiry; fee guard needs BOTH floors', () => {
    const c = buildCorridor(100, 1, 0.01)!;
    expect(c.halfWidth).toBeCloseTo(0.1, 9); expect(c.low).toBeCloseTo(99.9, 9); expect(c.high).toBeCloseTo(100.1, 9);
    const capped = buildCorridor(100, 10, 0.01)!;                                 // 0.10·ATR = 1 > 0.15 % = 0.15
    expect(capped.halfWidth).toBeCloseTo(100 * CORRIDOR_MAX_PCT, 9);
    expect(CORRIDOR_EXPIRY).toBe(3);
    expect(feeGuardPasses(100, 99.6, 0.5)).toBe(true);                            // 0.40 % ≥ 0.35 % and 0.8 ATR ≥ 0.5
    expect(feeGuardPasses(100, 99.7, 0.5)).toBe(false);                           // 0.30 % < 0.35 %
    expect(feeGuardPasses(100, 99.0, 3)).toBe(false);                             // 1 % ok but 0.33 ATR < 0.5
    expect(V21B_CONSTANTS.CORRIDOR_ATR_FRAC).toBe(0.1); expect(V21A_CONSTANTS.ZONE_ATR_FRACTION).toBe(0.05);
  });
  it('replays never read past `to`, emit no trades on a flat series, and honour the window (no look-ahead)', () => {
    const settings = LegacySettings.fromFrozenSnapshot();
    const flat = Array.from({ length: 900 }, (_, i) => bar(i, 100, 100.4, 99.6, 100 + (i % 5) * 0.05));
    const lim = replayLimitEntry({ symbol: 'BTCUSDT', timeframe: '15m', candles: flat, settings, htfCandles: {}, from: 300 * M15, to: 600 * M15, model: 'C' });
    const cor = replayCorridor({ symbol: 'BTCUSDT', timeframe: '15m', candles: flat, settings, htfCandles: {}, from: 300 * M15, to: 600 * M15, gates: V21B_CONSTANTS.ARMS.FULL! });
    for (const r of [lim, cor]) {
      expect(r.trades.filter((t) => t.terminal === 'FILLED').length).toBe(0);
      for (const t of r.trades) expect(t.setupCandleTime).toBeLessThanOrEqual(600 * M15);
      expect(r.evaluations).toBeLessThanOrEqual(301);
    }
  });
});

describe('registry after C7 — complete', () => {
  it('13 imported, 0 planned, all 13 source rows present exactly once, negatives visible, verdict ≠ reproducibility', () => {
    expect(STRATEGY_ARCHIVE.length).toBe(13); expect(STRATEGY_ARCHIVE_PLANNED.length).toBe(0); expect(STRATEGY_ARCHIVE_TOTAL_ROWS).toBe(13);
    const versions = STRATEGY_ARCHIVE.map((d) => d.version).sort();
    expect(versions).toEqual(['2.1a', '2.1b', '2.2', '2.3', '2.4', '2.5', '2.6', '2.7', '2.8', '3.0', '3.1', '3.2', '3.3'].sort());
    expect(new Set(STRATEGY_ARCHIVE.map((d) => d.id)).size).toBe(13);
    const rej = STRATEGY_ARCHIVE.filter((d) => ['REJECTED_ON_TRAIN', 'FALSIFIED_ON_TRAIN', 'FAILED_VALIDATION'].includes(d.verdict));
    expect(rej.length).toBe(9);                                                   // 2.1a 2.1b 2.2 2.3 2.4 2.6 2.7 3.1 3.2
    const repro = Object.fromEntries(STRATEGY_ARCHIVE.map((d) => [d.version, d.reproducibility]));
    expect(repro['2.1a']).toBe('SOURCE_CHAIN_VERIFIED_NOT_RERUN'); expect(repro['2.1b']).toBe('SOURCE_CHAIN_VERIFIED_NOT_RERUN');
    for (const d of STRATEGY_ARCHIVE) {
      if (d.reproducibility === 'REPRODUCED') expect(d.reproductionEvidence?.length, d.id).toBeGreaterThan(0);
      else expect(d.reproductionBlockedReason, d.id).toBeTruthy();
      expect(d.sourcePins.some((p) => p.role === 'ARTIFACT'), d.id).toBe(true);
      expect(d.discrepancies.length, d.id).toBeGreaterThan(0);
    }
  });
});

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  V27_DEFINITION, V27_VARIANTS, V27_SOURCE_RESULTS, V27_CAVEATS_RU, V27_RR_ARMS,
  V28_DEFINITION, V28_VARIANTS, V28_SOURCE_RESULTS, V28_CAVEATS_RU, V28_ARM_ORDER,
  STRATEGY_ARCHIVE, STRATEGY_ARCHIVE_PLANNED, STRATEGY_ARCHIVE_TOTAL_ROWS, reproduce, type ArchiveCandle,
} from '@/services/strategyArchive';
import { simulateFixedRr, feeR } from '@/services/strategyArchive/definitions/v2_7-rr-optimization/v27Core';
import { recoverGrossFromFrozenTracker } from '@/services/strategyArchive/definitions/v2_8-zero-fee-sniper-trailing/v28Core';
import { simulateTrailing, TIMEOUT_BARS } from '@/services/strategyArchive/shared/legacyResearch/v25Trailing';

const M15 = 900_000;
const sha = (p: string) => createHash('sha256').update(readFileSync(resolve(p))).digest('hex');
const bar = (i: number, o: number, h: number, l: number, c: number): ArchiveCandle =>
  ({ openTime: i * M15, open: o, high: h, low: l, close: c, volume: 1, closeTime: i * M15 + M15 - 1, isClosed: true });
const local = (p: string) => 'src/services/strategyArchive/results/' + p.replace(/^artifacts\/research\//, '');

describe('V2.7 — fixed-RR optimisation: REJECTED_ON_TRAIN, no headline, fee drag invariant', () => {
  it('verdict/reproducibility are separate; no headline variant; TRAIN only; legacy engine dependency declared', () => {
    expect(V27_DEFINITION.verdict).toBe('REJECTED_ON_TRAIN');
    expect(V27_DEFINITION.reproducibility).toBe('REPRODUCED');
    expect(V27_DEFINITION.reproductionEvidence?.length).toBe(5);
    expect(V27_DEFINITION.legacyEngineDependency).toBe('FROZEN_V2_ENGINE_4839074');
    expect(V27_DEFINITION.headlineVariantId).toBeUndefined();
    expect(V27_DEFINITION.slicesAvailable).toEqual(['train']);
    expect(V27_DEFINITION.scopeTimeframes).toEqual(['15m', '30m', '1h', '4h']);
    expect(V27_DEFINITION.assumptions.feeSemantics).toBe('NET_AT_FEES');
  });
  it('artifact byte-pinned; all five arms negative; identical fee drag; same-entry invariant', () => {
    const v = V27_VARIANTS[0]!;
    expect(sha(local(v.artifactPath))).toBe(v.artifactSha256);
    expect(V27_VARIANTS.map((x) => x.id)).toEqual(V27_RR_ARMS.map((a) => a.label));
    const t = V27_SOURCE_RESULTS.train;
    expect(t.arms.length).toBe(5);
    for (const a of t.arms) { expect(a.n).toBe(317); expect(a.netRPerTrade).toBeLessThan(0); expect(a.feeRPerTrade).toBe(0.1555); }
    expect(t.feeDragInvariance.spread).toBe(0);
    expect(t.sameEntryInvariant.identicalAcrossArms).toBe(true);
    expect(t.best.arm).toBe('RR40'); expect(t.best.positive).toBe(false);
    expect(V27_VARIANTS.find((x) => x.id === 'RR40')!.sourceRole).toMatch(/NOT an optimum/);
  });
  it('runner refuses unknown arms / non-existent slices; empty series yield zero trades (no fabrication)', () => {
    const input = { symbol: 'BTCUSDT', bySeries: {}, split: { symbol: 'BTCUSDT', timeframe: '15m' as const, trainFromMs: 0, trainToMs: 1, validFromMs: 2, validToMs: 3, testFromMs: 4, testToMs: 5 } };
    expect(() => V27_DEFINITION.runSeries(input, 'train')).toThrow(/no headline/);
    expect(V27_DEFINITION.runSeries(input, 'train', 'RR40').trades).toEqual([]);
    expect(() => reproduce(V27_DEFINITION, [], 'validation')).toThrow(/never run/);
    expect(() => reproduce(V27_DEFINITION, [], 'train', undefined, 'RR99')).toThrow(/unknown variant/);
  });
  it('caveats: rejected, fee-arithmetic explained, no promise wording', () => {
    const all = V27_CAVEATS_RU.join(' ');
    expect(all).toMatch(/ОТКЛОНЕНО НА TRAIN/); expect(all).toMatch(/0\.1555/); expect(all).toMatch(/не исполняет сделки/);
    expect(all).not.toMatch(/прибыльная стратегия|лучший сигнал|ожидаемая доходность/i);
  });
});

describe('V2.8 — zero-fee sniper + trailing: VALIDATED_GROSS_ONLY, never comparable with net@fees', () => {
  it('verdict VALIDATED_GROSS_ONLY; fee semantics GROSS_ONLY_ZERO_FEE; headline = frozen candidate Trail; both slices', () => {
    expect(V28_DEFINITION.verdict).toBe('VALIDATED_GROSS_ONLY');
    expect(V28_DEFINITION.reproducibility).toBe('REPRODUCED');
    expect(V28_DEFINITION.reproductionEvidence?.length).toBe(9);
    expect(V28_DEFINITION.assumptions.feeSemantics).toBe('GROSS_ONLY_ZERO_FEE');
    expect(V28_DEFINITION.assumptions.fees.makerBps).toBe(0); expect(V28_DEFINITION.assumptions.fees.takerBps).toBe(0);
    expect(V28_DEFINITION.headlineVariantId).toBe('Trail');
    expect(V28_DEFINITION.slicesAvailable).toEqual(['train', 'validation']);
    expect(V28_DEFINITION.legacyEngineDependency).toBe('FROZEN_V2_ENGINE_4839074');
  });
  it('artifacts byte-pinned; TRAIN 7 arms n=317, VALIDATION SMC+Trail n=98; pass by one trade preserved', () => {
    for (const v of V28_VARIANTS) expect(sha(local(v.artifactPath))).toBe(v.artifactSha256);
    expect(V28_VARIANTS.map((v) => v.id)).toEqual([...V28_ARM_ORDER]);
    const t = V28_SOURCE_RESULTS.train; const v = V28_SOURCE_RESULTS.validation;
    expect(t.feesDisabled).toBe(true); expect(v.feesDisabled).toBe(true);
    expect(t.arms.length).toBe(7); expect(t.arms.every((a) => a.n === 317)).toBe(true);
    expect(v.arms.map((a) => a.arm)).toEqual(['SMC', 'Trail']); expect(v.arms.every((a) => a.n === 98)).toBe(true);
    expect(v.freezeCommit).toBe('852167c');
    const trail = v.arms.find((a) => a.arm === 'Trail')!;
    expect(trail.grossRPerTrade).toBe(0.0488); expect(trail.profitFactor).toBe(1.1087);
    expect(trail.outlierDependence.exTop1Pct).toBeLessThan(0);        // one trade flips it
    expect(trail.outlierDependence.removedForTop1Pct).toBe(1);
    const smc = v.arms.find((a) => a.arm === 'SMC')!;
    expect(smc.grossRPerTrade).toBe(-0.1821);                           // anchor collapsed out of sample
    expect(V28_SOURCE_RESULTS.feeSemantics).toBe('GROSS_ONLY_ZERO_FEE');
  });
  it('runner: empty series yield zero trades; RR arms are rejected on the validation slice', () => {
    const input = { symbol: 'BTCUSDT', bySeries: {}, split: { symbol: 'BTCUSDT', timeframe: '15m' as const, trainFromMs: 0, trainToMs: 1, validFromMs: 2, validToMs: 3, testFromMs: 4, testToMs: 5 } };
    expect(V28_DEFINITION.runSeries(input, 'train').trades).toEqual([]);
    expect(() => V28_DEFINITION.runSeries(input, 'validation', 'RR25')).toThrow(/not run on slice validation/);
  });
  it('caveats: gross-only warning first, incomparability with V3.x, one-trade fragility, no promise wording', () => {
    expect(V28_CAVEATS_RU[0]).toMatch(/GROSS ПРИ НУЛЕВЫХ КОМИССИЯХ/);
    const all = V28_CAVEATS_RU.join(' ');
    expect(all).toMatch(/НЕ сопоставимо с net-результатами V3\.x/); expect(all).toMatch(/ОДНОЙ сделки/);
    expect(all).not.toMatch(/прибыльная стратегия|лучший сигнал|ожидаемая доходность/i);
  });
  it('registry: imported + planned = 13; V2.7/V2.8 no longer planned', () => {
    expect(STRATEGY_ARCHIVE.length + STRATEGY_ARCHIVE_PLANNED.length).toBe(13);
    expect(STRATEGY_ARCHIVE_TOTAL_ROWS).toBe(13);
    expect(STRATEGY_ARCHIVE_PLANNED.some((p) => p.version === '2.7' || p.version === '2.8')).toBe(false);
  });
});

describe('V2.7 / V2.8 / V2.5 exit simulators (frozen)', () => {
  it('simulateFixedRr: SL wins on ambiguous bar; TP at exactly mult·risk; timeout at 50 counts entry bar', () => {
    const both = simulateFixedRr('LONG', 100, 98, 2, [bar(0, 100, 105, 97, 101)]);
    expect(both?.exit).toBe('SL'); expect(both?.grossR).toBe(-1);
    const tp = simulateFixedRr('LONG', 100, 98, 2.5, [bar(0, 100, 101, 99, 100.5), bar(1, 100.5, 105.1, 100, 104)]);
    expect(tp?.exit).toBe('TP'); expect(tp?.grossR).toBe(2.5); expect(tp?.barsHeld).toBe(2);
    const flat = Array.from({ length: 80 }, (_, i) => bar(i, 100, 100.5, 99.5, 100.2));
    const to = simulateFixedRr('SHORT', 100, 102, 4, flat);
    expect(to?.exit).toBe('TIMEOUT'); expect(to?.barsHeld).toBe(50);
  });
  it('feeR is independent of the take-profit level (fee drag invariance)', () => {
    // same entry/stop, exits at SL vs far TP: fee in R differs only through |exit| price, not the RR multiple per se
    const r = 2;
    expect(feeR(100, 100, r)).toBeCloseTo((2e-4 * 100 + 5e-4 * 100) / r, 12);
    expect(feeR(100, 100, r, 5, 5)).toBeCloseTo((5e-4 * 100 + 5e-4 * 100) / r, 12);
    expect(feeR(100, 100, 0)).toBe(0);
  });
  it('recoverGrossFromFrozenTracker adds back the 0.1 % lump fee', () => {
    expect(recoverGrossFromFrozenTracker(-1.05, 100, 2)).toBeCloseTo(-1.05 + 0.001 * 100 / 2, 12);
  });
  it('simulateTrailing: breakeven at +1R, trail 1R behind peak in 0.25R steps, timeout 10 bars if never +1R, R1 stop-before-high', () => {
    // never reaches +1R → TIMEOUT at bar 10
    const flat = Array.from({ length: 20 }, (_, i) => bar(i, 100, 100.5, 99.5, 100.1));
    const to = simulateTrailing({ direction: 'LONG', entryPrice: 100, stopLoss: 98, bars: flat });
    expect(to?.reason).toBe('TIMEOUT'); expect(to?.barsHeld).toBe(TIMEOUT_BARS);
    // +1R reached on bar 0 (high 102) → stop = entry; bar 1 dips to 100 → BE exit at 0R
    const be = simulateTrailing({ direction: 'LONG', entryPrice: 100, stopLoss: 98, bars: [bar(0, 100, 102, 99.5, 101.5), bar(1, 101.5, 101.8, 99.9, 100.5)] });
    expect(be?.reason).toBe('BE'); expect(be?.grossR).toBe(0); expect(be?.reachedBreakeven).toBe(true);
    // peak +3R on bar 0 → trail to +2R immediately; bar 1 falls to +1.9R → TRAIL exit at +2R
    const tr = simulateTrailing({ direction: 'LONG', entryPrice: 100, stopLoss: 98, bars: [bar(0, 100, 106, 99.5, 105), bar(1, 105, 105.5, 103.8, 104)] });
    expect(tr?.reason).toBe('TRAIL'); expect(tr?.grossR).toBeCloseTo(2, 10);
    // R1: bar that makes a new high AND breaches the initial stop books as SL (stop from completed bars only)
    const r1 = simulateTrailing({ direction: 'LONG', entryPrice: 100, stopLoss: 98, bars: [bar(0, 100, 106, 97.9, 105)] });
    expect(r1?.reason).toBe('SL'); expect(r1?.grossR).toBe(-1);
  });
});

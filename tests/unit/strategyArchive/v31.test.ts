import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  STRATEGY_ARCHIVE, V31_DEFINITION, V31_VARIANTS, V31_SOURCE_RESULTS, V31_REPRODUCED_RESULTS, V31_CAVEATS_RU,
  V31_CONSTANTS, reproduce, type ArchiveCandle,
} from '@/services/strategyArchive';
import { buildHtfContext, liveGaps, manageTrade } from '@/services/strategyArchive/definitions/v3_1-htf-trend-pullback/v31Core';
import { emaSeries, detectStructureBreak, findSwingsV2 } from '@/services/strategyArchive/shared/primitives';

const H = 3_600_000;
const sha = (p: string) => createHash('sha256').update(readFileSync(resolve(p))).digest('hex');
const bar = (i: number, o: number, h: number, l: number, c: number, span = H): ArchiveCandle =>
  ({ openTime: i * span, open: o, high: h, low: l, close: c, volume: 1, closeTime: i * span + span - 1, isClosed: true });

describe('V3.1 — verdict and reproducibility are two separate axes', () => {
  it('research verdict stays FALSIFIED_ON_TRAIN even though reproducibility is REPRODUCED', () => {
    expect(V31_DEFINITION.verdict).toBe('FALSIFIED_ON_TRAIN');
    expect(V31_DEFINITION.reproducibility).toBe('REPRODUCED');
    expect(V31_DEFINITION.slicesAvailable).toEqual(['train']);
    expect(STRATEGY_ARCHIVE.map((d) => d.id)).toContain('V3_1_HTF_TREND_PULLBACK');
  });
  it('both archived variants are present with their own (negative) verdicts; primary = leg', () => {
    expect(V31_VARIANTS.map((v) => v.id).sort()).toEqual(['leg', 'same-bar']);
    expect(V31_DEFINITION.headlineVariantId).toBe('leg');
    expect(V31_VARIANTS.find((v) => v.id === 'leg')?.sourceRole).toBe('PRIMARY');
    for (const v of V31_VARIANTS) expect(v.sourceVerdict).toMatch(/FALSIFIED/);
  });
  it('source artifacts are byte-pinned (sha256) and report the negative numbers', () => {
    for (const v of V31_VARIANTS) {
      const local = 'src/services/strategyArchive/results/' + v.artifactPath.replace(/^artifacts\/research\//, '');
      expect(sha(local)).toBe(v.artifactSha256);
    }
    expect(V31_SOURCE_RESULTS.train.leg.n).toBe(158);
    expect(V31_SOURCE_RESULTS.train.leg.grossRPerTrade).toBe(-0.0838);
    expect(V31_SOURCE_RESULTS.train.leg.netRPerTrade.FUT_4).toBe(-0.1097);
    expect(V31_SOURCE_RESULTS.train.leg.criterion.F1_netPositive.passed).toBe(false);
    expect(V31_SOURCE_RESULTS.train['same-bar'].n).toBe(82);
    expect(V31_SOURCE_RESULTS.train['same-bar'].netRPerTrade.FUT_4).toBe(-0.2819);
  });
  it('REPRODUCED evidence exists for both variants and matched the source artifact exactly', () => {
    const ev = V31_DEFINITION.reproductionEvidence ?? [];
    expect(ev.length).toBe(2);
    for (const e of ev) {
      expect(e.allMatched).toBe(true);
      expect(e.firstMismatch).toBeNull();
      expect(e.datasetCommit).toBe('c3c1dcecfe2784a147f591f2b5b4526cbf99df9f');
      expect(V31_VARIANTS.find((v) => v.artifactPath === e.sourceArtifactPath)?.artifactSha256).toBe(e.sourceArtifactSha256);
    }
    expect(V31_REPRODUCED_RESULTS.train.leg.metrics.n).toBe(158);
    expect(V31_REPRODUCED_RESULTS.train.leg.metrics.netRPerTradeHeadline).toBe(-0.1097);
    expect(V31_REPRODUCED_RESULTS.train.leg.funnel).toEqual(V31_SOURCE_RESULTS.train.leg.funnel);
    expect(V31_REPRODUCED_RESULTS.train['same-bar'].metrics.n).toBe(82);
    expect(V31_REPRODUCED_RESULTS.train['same-bar'].metrics.netRPerTradeHeadline).toBe(-0.2819);
  });
  it('caveats state the falsification, the correction disclosure and no promise wording', () => {
    const all = V31_CAVEATS_RU.join(' ');
    expect(all).toMatch(/ФАЛЬСИФИЦИРОВАНО/);
    expect(all).toMatch(/двойного учёта/);
    expect(all).toMatch(/перекрывающ/);
    expect(all).not.toMatch(/прибыльная стратегия|лучший сигнал|ожидаемая доходность/i);
  });
  it('engine refuses to invent a VALIDATION slice for a TRAIN-only version', () => {
    expect(() => reproduce(V31_DEFINITION, [], 'validation')).toThrow(/never run/);
    expect(() => reproduce(V31_DEFINITION, [], 'train', undefined, 'nope')).toThrow(/unknown variant/);
  });
});

describe('V3.1 core semantics (frozen)', () => {
  it('constants are the pre-registered values (not swept)', () => {
    expect(V31_CONSTANTS.TIMEOUT_BARS).toBe(60);
    expect(V31_CONSTANTS.TP2_FIB_EXT).toBe(1.5);
    expect(V31_CONSTANTS.EMA_FAST).toBe(50);
    expect(V31_CONSTANTS.EMA_SLOW).toBe(200);
    expect(V31_CONSTANTS.CORRIDOR_EXPIRY_BARS).toBe(3);
  });
  it('emaSeries seeds with SMA and is null before the seed bar', () => {
    const e = emaSeries([1, 2, 3, 4, 5], 3);
    expect(e[0]).toBeNull(); expect(e[1]).toBeNull();
    expect(e[2]).toBe(2);
    expect(e[3]).toBeCloseTo(2 * 0.5 + 4 * 0.5, 10);
  });
  it('trendByClosed[k] uses only 4H bars < k (no future) and needs EMA200 warm-up', () => {
    const h4: ArchiveCandle[] = [];
    for (let i = 0; i < 260; i++) { const p = 100 + i; h4.push(bar(i, p, p + 1, p - 1, p + 0.5, 4 * H)); }
    const ctx = buildHtfContext({ h4, emaFast: emaSeries(h4.map((c) => c.close), 50), emaSlow: emaSeries(h4.map((c) => c.close), 200), swings: findSwingsV2(h4, 3) });
    expect(ctx.trendByClosed.length).toBe(261);
    for (let k = 0; k < 200; k++) expect(ctx.trendByClosed[k]).toBeNull();
  });
  it('FVG is known only after its 3rd candle closed and dies when traded into', () => {
    const h4 = [bar(0, 10, 11, 9, 10.5, 4 * H), bar(1, 11, 14, 11, 13.5, 4 * H), bar(2, 13.5, 15, 13, 14, 4 * H), bar(3, 14, 14.5, 13.8, 14.2, 4 * H), bar(4, 14, 14.2, 12, 12.5, 4 * H)];
    const ctx = buildHtfContext({ h4, emaFast: [], emaSlow: [], swings: [] });
    expect(ctx.gaps.length).toBe(1);
    const g = ctx.gaps[0]!;
    expect(g.dir).toBe('LONG'); expect(g.bottom).toBe(11); expect(g.top).toBe(13);
    expect(g.knownAt).toBe(3); expect(g.killAt).toBe(5);
    expect(liveGaps(ctx, 2, 'LONG').length).toBe(0);
    expect(liveGaps(ctx, 3, 'LONG').length).toBe(1);
    expect(liveGaps(ctx, 5, 'LONG').length).toBe(0);
  });
  it('detectStructureBreak needs a CLOSE beyond a swing confirmed BEFORE the bar; wick-only is not a break', () => {
    const c: ArchiveCandle[] = [];
    const px = [10, 11, 12, 13, 12, 11, 10, 11, 12, 12.5];
    px.forEach((p, i) => c.push(bar(i, p, p + 0.4, p - 0.4, p)));
    const sw = findSwingsV2(c, 3);
    expect(sw.find((s) => s.kind === 'HIGH')?.index).toBe(3);
    // bar 9 wick above 13.4 but close below → wickOnly
    c.push(bar(10, 12.5, 13.6, 12.4, 13.0));
    const w = detectStructureBreak(c, sw, 10, 1, 0);
    expect(w?.wickOnly).toBe(true);
    c[10] = bar(10, 12.5, 13.8, 12.4, 13.7);
    const b = detectStructureBreak(c, sw, 10, 1, 0);
    expect(b?.wickOnly).toBe(false);
    expect(b?.direction).toBe('LONG');
    expect(b?.levelIndex).toBe(3);
  });
  it('manageTrade: stop before target on one bar (R1); TP1 then BE only after TP1 bar (R3); timeout 60 counts entry bar', () => {
    const entry = 100, stop = 98, tp1 = 104, tp2 = 106;
    const both = manageTrade('LONG', entry, stop, tp1, tp2, [bar(0, 100, 105, 97, 101)]);
    expect(both?.exit).toBe('SL'); expect(both?.grossR).toBe(-1);
    const be = manageTrade('LONG', entry, stop, tp1, tp2, [bar(0, 100, 104.5, 99.5, 104), bar(1, 104, 104.5, 99.9, 100.5)]);
    expect(be?.exit).toBe('TP1_THEN_BE'); expect(be?.grossR).toBeCloseTo(1, 10);
    const flat = Array.from({ length: 70 }, (_, i) => bar(i, 100, 101, 99.5, 100.2));
    const to = manageTrade('LONG', entry, stop, tp1, tp2, flat);
    expect(to?.exit).toBe('TIMEOUT'); expect(to?.barsHeld).toBe(60);
    // fees: 2 bps maker entry + 5 bps taker exit(s) on each leg's own notional / risk
    const fee = be!.feeR(2, 5);
    expect(fee).toBeCloseTo((2 / 1e4 * 100 * 1 + 5 / 1e4 * 104 * 0.5 + 5 / 1e4 * 100 * 0.5) / 2, 10);
    expect(be!.feeR(0, 0)).toBe(0);
  });
});

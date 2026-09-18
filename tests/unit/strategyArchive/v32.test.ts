import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  V32_DEFINITION, V32_VARIANTS, V32_SOURCE_RESULTS, V32_REPRODUCED_RESULTS, V32_CAVEATS_RU, V32_CONSTANTS, reproduce,
  type ArchiveCandle,
} from '@/services/strategyArchive';
import { absorption, detectCascade, manageTrade } from '@/services/strategyArchive/definitions/v3_2-volume-climax/v32Core';

const H = 3_600_000;
const sha = (p: string) => createHash('sha256').update(readFileSync(resolve(p))).digest('hex');
const bar = (i: number, o: number, h: number, l: number, c: number, v = 1): ArchiveCandle =>
  ({ openTime: i * H, open: o, high: h, low: l, close: c, volume: v, closeTime: i * H + H - 1, isClosed: true });

describe('V3.2 — four archived variants, primary pre-declared, no cherry-picking', () => {
  it('verdict FALSIFIED_ON_TRAIN; reproducibility REPRODUCED; TRAIN only', () => {
    expect(V32_DEFINITION.verdict).toBe('FALSIFIED_ON_TRAIN');
    expect(V32_DEFINITION.reproducibility).toBe('REPRODUCED');
    expect(V32_DEFINITION.slicesAvailable).toEqual(['train']);
    expect(V32_DEFINITION.structuralTimeframe).toBeNull();
  });
  it('headline = union-cascade (isPrimary in the source artifact), EMA50 variants marked UNPROMOTED', () => {
    expect(V32_DEFINITION.headlineVariantId).toBe('union-cascade');
    expect(V32_SOURCE_RESULTS.train['union-cascade'].isPrimary).toBe(true);
    expect(V32_SOURCE_RESULTS.train['union-ema50'].isPrimary).toBe(false);
    for (const id of ['union-ema50', 'fast3-ema50']) {
      const v = V32_VARIANTS.find((x) => x.id === id)!;
      expect(v.sourceRole).toMatch(/UNPROMOTED/);
      expect(v.sourceVerdict).toMatch(/F3 FALSIFIED/);
    }
    expect(V32_VARIANTS.length).toBe(4);
  });
  it('artifacts byte-pinned; primary numbers are the negative ones', () => {
    for (const v of V32_VARIANTS) {
      expect(sha('src/services/strategyArchive/results/' + v.artifactPath.replace(/^artifacts\/research\//, ''))).toBe(v.artifactSha256);
    }
    const p = V32_SOURCE_RESULTS.train['union-cascade'];
    expect(p.n).toBe(307); expect(p.grossRPerTrade).toBe(-0.0082); expect(p.netRPerTrade.FUT_4).toBe(-0.062);
    expect(p.criterion.F1_netPositive.passed).toBe(false);
    expect(V32_SOURCE_RESULTS.train['union-ema50'].criterion.F3_tp1Rate.passed).toBe(false);
  });
  it('all four variants REPRODUCED with matching source artifact and exact metrics', () => {
    const ev = V32_DEFINITION.reproductionEvidence ?? [];
    expect(ev.length).toBe(4);
    for (const e of ev) {
      expect(e.allMatched).toBe(true); expect(e.firstMismatch).toBeNull();
      expect(V32_VARIANTS.find((v) => v.artifactPath === e.sourceArtifactPath)?.artifactSha256).toBe(e.sourceArtifactSha256);
    }
    for (const id of ['union-cascade', 'fast3-cascade', 'union-ema50', 'fast3-ema50'] as const) {
      const r = V32_REPRODUCED_RESULTS.train[id].metrics; const s = V32_SOURCE_RESULTS.train[id];
      expect(r.n).toBe(s.n); expect(r.grossRPerTrade).toBe(s.grossRPerTrade);
      expect(r.netRPerTradeHeadline).toBe(s.netRPerTrade.FUT_4); expect(r.exits).toEqual(s.exits);
    }
  });
  it('caveats: falsified, unpromoted variants explained, no promise wording', () => {
    const all = V32_CAVEATS_RU.join(' ');
    expect(all).toMatch(/ФАЛЬСИФИЦИРОВАНО/); expect(all).toMatch(/UNPROMOTED/); expect(all).toMatch(/постфактум/);
    expect(all).not.toMatch(/прибыльная стратегия|лучший сигнал|ожидаемая доходность/i);
  });
  it('engine refuses unknown variants and non-existent slices', () => {
    expect(() => reproduce(V32_DEFINITION, [], 'validation')).toThrow(/never run/);
    expect(() => reproduce(V32_DEFINITION, [], 'train', undefined, 'best')).toThrow(/unknown variant/);
  });
});

describe('V3.2 core semantics (frozen)', () => {
  it('constants: RVOL 2.2 inclusive, timeout 48, k in 3..6', () => {
    expect(V32_CONSTANTS.MIN_RVOL).toBe(2.2); expect(V32_CONSTANTS.TIMEOUT_BARS).toBe(48);
    expect(V32_CONSTANTS.CASCADE_K_MIN).toBe(3); expect(V32_CONSTANTS.CASCADE_K_MAX).toBe(6);
  });
  it('detectCascade: union picks the LARGEST qualifying k, fast3 only k=3; down-move → LONG fade; uses only bars ≤ index', () => {
    const c: ArchiveCandle[] = [];
    const px = [100, 100, 100, 100, 99, 98, 97, 96, 95];
    px.forEach((p, i) => c.push(bar(i, p, p + 0.5, p - 0.5, p)));
    const u = detectCascade(c, 8, 1, 'union');
    expect(u?.dir).toBe('LONG'); expect(u?.k).toBe(6); expect(u?.origin).toBe(100.5); expect(u?.terminal).toBe(94.5);
    const f = detectCascade(c, 8, 1, 'fast3');
    expect(f?.k).toBe(3); expect(f?.moveAtr).toBe(3);
    // future bar appended does not change the result at index 8
    c.push(bar(9, 50, 50, 50, 50));
    expect(detectCascade(c, 8, 1, 'union')).toEqual(u);
    expect(detectCascade(c, 8, 1.6, 'fast3')).toBeNull();   // 3 < 2*1.6
  });
  it('absorption: wick needs close with the fade; engulf needs body ≥ 0.40 and outer-30 % close', () => {
    // LONG fade: lower wick 50 %, bullish close
    expect(absorption(bar(1, 96, 100, 90, 98), undefined, 'LONG')).toBe('WICK');
    // same wick but bearish close → no
    expect(absorption(bar(1, 98, 100, 90, 96), undefined, 'LONG')).toBeNull();
    // engulfing: prev bearish 100→95, cur opens ≤95 closes ≥100, body big, closes in top 30 %
    expect(absorption(bar(2, 95, 101, 94, 100.5), bar(1, 100, 100.5, 94.5, 95), 'LONG')).toBe('ENGULF');
    // lower wick 5/12.5 = 40 %, body 5.5/12.5 = 44 %, close at 0.96 of range → both branches
    expect(absorption(bar(2, 95, 101, 90, 100.5), bar(1, 100, 100.5, 94.5, 95), 'LONG')).toBe('WICK+ENGULF');
  });
  it('manageTrade: SL before TP on one bar; timeout 48 counts entry bar; TP1→BE after TP1 bar', () => {
    const both = manageTrade('SHORT', 100, 102, 96, 94, [bar(0, 100, 103, 95, 99)]);
    expect(both?.exit).toBe('SL'); expect(both?.grossR).toBe(-1);
    const flat = Array.from({ length: 60 }, (_, i) => bar(i, 100, 100.5, 99.5, 100));
    expect(manageTrade('SHORT', 100, 102, 96, 94, flat)?.barsHeld).toBe(48);
    const be = manageTrade('SHORT', 100, 102, 96, 94, [bar(0, 100, 100.5, 95.9, 96.5), bar(1, 96.5, 100.1, 96, 99)]);
    expect(be?.exit).toBe('TP1_THEN_BE'); expect(be?.grossR).toBeCloseTo(1, 10);
    expect(be!.feeR(2, 5)).toBeCloseTo((2e-4 * 100 + 5e-4 * 96 * 0.5 + 5e-4 * 100 * 0.5) / 2, 10);
  });
});

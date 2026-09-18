import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  V33_DEFINITION, V33_VARIANTS, V33_VARIANT_IDS, V33_SOURCE_RESULTS, V33_REPRODUCED_RESULTS, V33_CAVEATS_RU, V33_CONSTANTS,
  V33_DISCREPANCIES, STRATEGY_ARCHIVE, STRATEGY_ARCHIVE_PLANNED, STRATEGY_ARCHIVE_TOTAL_ROWS, reproduce,
  type ArchiveCandle,
} from '@/services/strategyArchive';
import {
  absorption, advanceFill, buildZones, confirmedSwingLevels, manageTrade, trackZone,
} from '@/services/strategyArchive/definitions/v3_3-htf-zone-mitigation/v33Core';
import { detectDisplacement, buildOrderBlock, findFvg, findSwingsV2 } from '@/services/strategyArchive/shared/primitives';

const H = 3_600_000;
const sha = (p: string) => createHash('sha256').update(readFileSync(resolve(p))).digest('hex');
const bar = (i: number, o: number, h: number, l: number, c: number, v = 1, span = H): ArchiveCandle =>
  ({ openTime: i * span, open: o, high: h, low: l, close: c, volume: v, closeTime: i * span + span - 1, isClosed: true });

describe('V3.3 — eight archived runs, pre-registered headline, TRAIN only', () => {
  it('verdict TRAIN_ONLY_NOT_VALIDATED (not a positive result); reproducibility REPRODUCED; 1h/4h; TRAIN only', () => {
    expect(V33_DEFINITION.verdict).toBe('TRAIN_ONLY_NOT_VALIDATED');
    expect(V33_DEFINITION.reproducibility).toBe('REPRODUCED');
    expect(V33_DEFINITION.slicesAvailable).toEqual(['train']);
    expect(V33_DEFINITION.execTimeframe).toBe('1h'); expect(V33_DEFINITION.structuralTimeframe).toBe('4h');
    expect(V33_SOURCE_RESULTS.validation).toMatch(/NEVER RUN/);
  });
  it('registry total stays 13; V3.3 is imported and no longer in PLANNED', () => {
    expect(STRATEGY_ARCHIVE.length + STRATEGY_ARCHIVE_PLANNED.length).toBe(13);
    expect(STRATEGY_ARCHIVE_TOTAL_ROWS).toBe(13);
    expect(STRATEGY_ARCHIVE_PLANNED.find((p) => p.version === '3.3')).toBeUndefined();
    expect(STRATEGY_ARCHIVE.find((d) => d.version === '3.3')?.id).toBe('V3_3_HTF_ZONE_MITIGATION');
  });
  it('headline = while-protective-displacement (isPrimary in the source artifact); other 7 are sensitivity', () => {
    expect(V33_DEFINITION.headlineVariantId).toBe('while-protective-displacement');
    expect(V33_VARIANTS.length).toBe(8); expect(V33_VARIANT_IDS.length).toBe(8);
    for (const v of V33_VARIANTS) {
      const s = V33_SOURCE_RESULTS.train[v.id as keyof typeof V33_SOURCE_RESULTS.train];
      expect(s.isPrimary).toBe(v.id === 'while-protective-displacement');
      expect(v.sourceRole.startsWith(v.id === 'while-protective-displacement' ? 'PRIMARY' : 'SENSITIVITY')).toBe(true);
      const [w, st, lg] = v.id.split('-');
      expect(s.windowMode).toBe(w); expect(s.stopMode).toBe(st); expect(s.legMode).toBe(lg);
    }
  });
  it('artifacts byte-pinned; headline numbers and criterion outcomes as archived (incl. F1 failures of first/protective)', () => {
    for (const v of V33_VARIANTS) {
      expect(sha('src/services/strategyArchive/results/' + v.artifactPath.replace(/^artifacts\/research\//, ''))).toBe(v.artifactSha256);
    }
    const p = V33_SOURCE_RESULTS.train['while-protective-displacement'];
    expect(p.n).toBe(6957); expect(p.grossRPerTrade).toBe(0.0778); expect(p.netRPerTrade.FUT_4).toBe(0.0267);
    expect(p.feeDragR.FUT_4).toBe(0.0511); expect(p.tp1HitRatePct).toBe(65.24);
    expect(p.criterion.F1_netPositive.passed && p.criterion.F2_feeDrag.passed && p.criterion.F3_tp1Rate.passed).toBe(true);
    // tail fragility: ex-top-1 % gross below fee drag
    expect(p.outlierDependence.exTop1Pct).toBeLessThan(p.feeDragR.FUT_4);
    expect(V33_SOURCE_RESULTS.train['first-protective-displacement'].criterion.F1_netPositive.passed).toBe(false);
    expect(V33_SOURCE_RESULTS.train['first-protective-swing'].criterion.F1_netPositive.passed).toBe(false);
    expect(V33_SOURCE_RESULTS.train['while-climax-swing'].criterion.F3_tp1Rate.passed).toBe(false);
  });
  it('all eight variants REPRODUCED with matching source artifact and exact metrics', () => {
    const ev = V33_DEFINITION.reproductionEvidence ?? [];
    expect(ev.length).toBe(8);
    for (const e of ev) {
      expect(e.allMatched).toBe(true); expect(e.firstMismatch).toBeNull();
      expect(e.datasetCommit).toBe('c3c1dcecfe2784a147f591f2b5b4526cbf99df9f');
      expect(V33_VARIANTS.find((v) => v.artifactPath === e.sourceArtifactPath)?.artifactSha256).toBe(e.sourceArtifactSha256);
      expect(e.deterministicDigest).toMatch(/^fnv1a32:[0-9a-f]{8}:n\d+$/);
    }
    for (const id of V33_VARIANT_IDS) {
      const r = V33_REPRODUCED_RESULTS.train[id]; const s = V33_SOURCE_RESULTS.train[id];
      expect(r.metrics.n).toBe(s.n); expect(r.metrics.grossRPerTrade).toBe(s.grossRPerTrade);
      expect(r.metrics.netRPerTradeHeadline).toBe(s.netRPerTrade.FUT_4); expect(r.metrics.exits).toEqual(s.exits);
      expect(r.metrics.profitFactor).toBe(s.profitFactor); expect(r.metrics.maxDrawdownR).toBe(s.maxDrawdownR);
      expect(r.funnel.filled).toBe(s.funnel.filled); expect(r.funnel.signals).toBe(s.funnel.triggersInZone);
      // look-ahead guard: nothing beyond TRAIN end was read
      expect(r.maxCandleOpenTimeRead).toBeLessThanOrEqual(Date.parse('2024-05-26T13:00:00Z'));
    }
  });
  it('discrepancies: naming (Continuation→Mitigation), overlap, inherited corridor, 8-run selection risk, no validation', () => {
    const ids = V33_DISCREPANCIES.map((d) => d.id);
    expect(ids).toEqual(['D-V33-001', 'D-V33-002', 'D-V33-003', 'D-V33-004', 'D-V33-005']);
    expect(V33_DISCREPANCIES[0]!.specStatement).toMatch(/Continuation/);
    expect(V33_DISCREPANCIES[3]!.impact).toMatch(/post-hoc/);
    expect(V33_DISCREPANCIES.every((d) => d.reproductionPolicy === 'PRESERVE_RESEARCH_BEHAVIOUR')).toBe(true);
  });
  it('caveats: train-only, not validated, tail fragility, no promise wording', () => {
    const all = V33_CAVEATS_RU.join(' ');
    expect(all).toMatch(/ТОЛЬКО TRAIN/); expect(all).toMatch(/НЕ ВАЛИДИРОВАНО/); expect(all).toMatch(/хрупок/);
    expect(all).toMatch(/постфактум/);
    expect(all).not.toMatch(/прибыльная стратегия|лучший сигнал|ожидаемая доходность/i);
  });
  it('engine refuses unknown variants and non-existent slices', () => {
    expect(() => reproduce(V33_DEFINITION, [], 'validation')).toThrow(/slice "validation"/);
    expect(() => reproduce(V33_DEFINITION, [], 'train', undefined, 'while-protective')).toThrow(/unknown variant/);
  });
  it('definition is frozen', () => {
    expect(Object.isFrozen(V33_DEFINITION)).toBe(true); expect(Object.isFrozen(V33_CONSTANTS)).toBe(true);
    expect(Object.isFrozen(V33_VARIANTS)).toBe(true);
  });
});

describe('V3.3 core semantics (frozen)', () => {
  it('constants: RVOL 1.25 inclusive, wick 0.35, reclaim 0.40, corridor expiry 3 (V3.0), timeout 48, FVG fill 0.5', () => {
    expect(V33_CONSTANTS.MIN_RVOL).toBe(1.25); expect(V33_CONSTANTS.WICK_FRAC_MIN).toBe(0.35);
    expect(V33_CONSTANTS.RECLAIM_BODY_MIN).toBe(0.4); expect(V33_CONSTANTS.CORRIDOR_EXPIRY_BARS).toBe(3);
    expect(V33_CONSTANTS.TIMEOUT_BARS).toBe(48); expect(V33_CONSTANTS.FVG_FILL_MIN).toBe(0.5);
    expect(V33_CONSTANTS.WARMUP_BARS).toBe(60);
  });
  it('detectDisplacement/buildOrderBlock/findFvg (frozen structure.ts port): OB = last opposite candle, FVG known at i+1', () => {
    const c = [bar(0, 100, 101, 99, 100.5), bar(1, 100.5, 101, 99.5, 99.8) /* bearish origin */, bar(2, 99.8, 105, 99.7, 104.8), bar(3, 104.8, 108, 104, 107.5)];
    const d = detectDisplacement(c, 2, 1, 1.5, 0.6)!;
    expect(d.direction).toBe('LONG'); expect(d.bodyAtr).toBeCloseTo(5, 10); expect(d.consecutive).toBe(1);
    const ob = buildOrderBlock(c, d, 'SWEEP_REACTION', 2, '4h')!;
    expect(ob.index).toBe(1); expect(ob.low).toBe(99.5); expect(ob.high).toBe(101); expect(ob.knownAtIndex).toBe(2);
    expect(findFvg(c, 2, 1, 2, '4h', 0.15)).toBeNull();                 // bar i+1 not yet closed
    const g = findFvg(c, 2, 1, 3, '4h', 0.15)!;
    expect(g.direction).toBe('LONG'); expect(g.bottom).toBe(101); expect(g.top).toBe(104); expect(g.knownAtIndex).toBe(3);
    expect(detectDisplacement(c, 0, 1, null, 0.6)).toBeNull();          // body 0.5 < 0.6 ATR
  });
  it('buildZones: OB known at i, FVG at i+1; strength inherited; leg = displacement range', () => {
    const h4 = [bar(0, 100, 101, 99, 100.5, 1, 4 * H), bar(1, 100.5, 101, 99.5, 99.8, 1, 4 * H), bar(2, 99.8, 105, 99.7, 104.8, 1, 4 * H), bar(3, 104.8, 108, 104, 107.5, 1, 4 * H), bar(4, 107.5, 108, 107, 107.2, 1, 4 * H)];
    const swings = findSwingsV2(h4, 2);
    const levels = confirmedSwingLevels(h4, swings);
    const zones = buildZones({ h4, atr4: [1, 1, 1, 1, 1], rvol4: [1, 1, 1, 1, 1], swings4: swings, displacementMinBodyAtr: 0.6, fvgMinSizeAtr: 0.15, levels });
    const ob = zones.find((z) => z.type === 'OB' && z.knownAt4h === 2)!;
    const fvg = zones.find((z) => z.type === 'FVG' && z.knownAt4h === 3)!;
    expect(ob.zoneLow).toBe(99.5); expect(ob.legLow).toBe(99.5); expect(ob.legHigh).toBe(105);
    expect(fvg.zoneLow).toBe(101); expect(fvg.zoneHigh).toBe(104); expect(fvg.legLow).toBe(99.5); expect(fvg.legHigh).toBe(108);
    expect(ob.swingLegLow).toBeNull();                                  // no confirmed swings yet
  });
  it('trackZone: OB first touch mitigates, close beyond far edge kills; mitigate+kill same bar → null; FVG needs ≥50 % fill', () => {
    const zone = { id: 0, type: 'OB' as const, dir: 'LONG' as const, zoneLow: 99, zoneHigh: 100, knownAt4h: 0, legLow: 99, legHigh: 110, swingLegLow: null, swingLegHigh: null, strength: 0.5, origin: 'BOS' };
    const h1 = [bar(0, 105, 106, 104, 105), bar(1, 105, 106, 104, 105), bar(2, 105, 105, 99.5, 101), bar(3, 101, 102, 100, 101.5), bar(4, 101, 101, 97, 98)];
    const closed = Int32Array.from([0, 1, 1, 1, 1]);
    const w = trackZone(h1, zone, closed)!;
    expect(w.startIndex).toBe(1); expect(w.mitigationIndex).toBe(2); expect(w.deathIndex).toBe(4);
    const sameBar = [bar(0, 105, 106, 104, 105), bar(1, 105, 105, 97, 98)];
    expect(trackZone(sameBar, zone, Int32Array.from([1, 1]))).toBeNull();
    expect(advanceFill(bar(0, 103, 104, 102.5, 103), 'LONG', 101, 104, 0)).toBe(0.5);
    expect(advanceFill(bar(0, 103, 104, 100, 103), 'LONG', 101, 104, 0.2)).toBe(1);
  });
  it('absorption: wick ≥35 % OR reclaim (body ≥0.40, close in outer 30 %); closes direction does not gate wick', () => {
    expect(absorption(bar(1, 96, 100, 90, 98), 'LONG')).toBe('WICK');           // lower wick 60 %, body 20 %
    expect(absorption(bar(1, 98, 100, 90, 96), 'LONG')).toBe('WICK');           // bearish close still WICK (differs from V3.2)
    expect(absorption(bar(1, 92, 100.5, 91, 99.5), 'LONG')).toBe('RECLAIM');      // wick 10.5 % <35 %, body 79 %, close 89 %
    expect(absorption(bar(1, 94, 100, 90, 99.5), 'LONG')).toBe('WICK+RECLAIM'); // wick 40 %, body 55 %, close 95 %
    expect(absorption(bar(1, 95, 96, 94.8, 95.3), 'LONG')).toBeNull();      // wick 17 %, body 25 %
  });
  it('manageTrade: SL before TP on one bar; timeout 48 counts entry bar; TP1→BE after TP1 bar; TP1_THEN_SL same-bar', () => {
    const both = manageTrade('SHORT', 100, 102, 96, 94, [bar(0, 100, 103, 95, 99)]);
    expect(both?.exit).toBe('SL'); expect(both?.grossR).toBe(-1);
    const flat = Array.from({ length: 60 }, (_, i) => bar(i, 100, 100.5, 99.5, 100));
    expect(manageTrade('SHORT', 100, 102, 96, 94, flat)?.barsHeld).toBe(48);
    const be = manageTrade('SHORT', 100, 102, 96, 94, [bar(0, 100, 100.5, 95.9, 96.5), bar(1, 96.5, 100.1, 96, 99)]);
    expect(be?.exit).toBe('TP1_THEN_BE'); expect(be?.grossR).toBeCloseTo(1, 10);
    const tp1sl = manageTrade('SHORT', 100, 102, 96, 94, [bar(0, 100, 100.5, 95.9, 96.5), bar(1, 96.5, 100.1, 96, 99)]);
    expect(tp1sl?.exit).toBe('TP1_THEN_BE');
    const fee = be!.feeR(2, 5);
    expect(fee).toBeCloseTo((2e-4 * 100 + 5e-4 * 96 * 0.5 + 5e-4 * 100 * 0.5) / 2, 10);
  });
});

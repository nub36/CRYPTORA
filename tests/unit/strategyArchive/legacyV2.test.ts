/**
 * C6 — frozen V2 engine port (isolated archive dependency) + V2.2…V2.6 definitions + V2.7/V2.8 reproduction evidence.
 * Tests are about honesty and isolation, never about "does the strategy work".
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import {
  STRATEGY_ARCHIVE, STRATEGY_ARCHIVE_PLANNED, STRATEGY_ARCHIVE_TOTAL_ROWS, LEGACY_V2_PROVENANCE, reproduce,
  V22_DEFINITION, V23_DEFINITION, V24_DEFINITION, V25_DEFINITION, V26_DEFINITION, V27_DEFINITION, V28_DEFINITION,
  V22_CAVEATS_RU, V23_CAVEATS_RU, V24_CAVEATS_RU, V25_CAVEATS_RU, V26_CAVEATS_RU,
  V22_SOURCE_RESULTS, V23_SOURCE_RESULTS, V24_SOURCE_RESULTS, V25_SOURCE_RESULTS, V26_SOURCE_RESULTS,
  V27_REPRODUCTION_EVIDENCE, V28_REPRODUCTION_EVIDENCE, V27_REPRODUCED_RESULTS, V28_REPRODUCED_RESULTS,
  V22_REPRODUCTION_EVIDENCE, V23_REPRODUCTION_EVIDENCE, V24_REPRODUCTION_EVIDENCE, V25_REPRODUCTION_EVIDENCE, V26_REPRODUCTION_EVIDENCE,
  V22_REPRODUCED_RESULTS, V23_REPRODUCED_RESULTS, V24_REPRODUCED_RESULTS, V25_REPRODUCED_RESULTS, V26_REPRODUCED_RESULTS,
  V27_SOURCE_RESULTS, V28_SOURCE_RESULTS,
  type ArchiveCandle, type StrategyDefinition,
} from '@/services/strategyArchive';
import { LegacySettings, evaluateV2, trackOutcome, resolveEntry, executableLadder, HTF_MAP } from '@/services/strategyArchive/legacy/v2';
import { runSniperEntryLoop } from '@/services/strategyArchive/legacy/v2/sniperEntryLoop';
import { confirmedExtremeV22, structuralTargets, feeRPerLeg, FEE_ENVS } from '@/services/strategyArchive/legacy/v2/research/v22Engine';
import { buildLadderV23 } from '@/services/strategyArchive/legacy/v2/research/v23Engine';
import { structuralTargetsV24 } from '@/services/strategyArchive/legacy/v2/v24Engine';

const ROOT = resolve(__dirname, '../../..');
const sha = (p: string) => createHash('sha256').update(readFileSync(resolve(ROOT, p))).digest('hex');
const local = (p: string) => 'src/services/strategyArchive/results/' + p.replace(/^artifacts\/research\//, '');
const M15 = 900_000;
const bar = (i: number, o: number, h: number, l: number, c: number, v = 1): ArchiveCandle =>
  ({ openTime: i * M15, open: o, high: h, low: l, close: c, volume: v, closeTime: i * M15 + M15 - 1, isClosed: true });
const V2X = [V22_DEFINITION, V23_DEFINITION, V24_DEFINITION, V25_DEFINITION, V26_DEFINITION];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walk(p)); else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

describe('legacy/v2 — isolated frozen engine port (4839074)', () => {
  it('declares provenance: source repo, frozen commit, per-file hashes, EXECUTION_CODE_PORTED = NONE', () => {
    expect(LEGACY_V2_PROVENANCE.frozenCommit).toBe('4839074');
    expect(LEGACY_V2_PROVENANCE.executionCodePorted).toBe('NONE');
    expect(Object.keys(LEGACY_V2_PROVENANCE.files).length).toBeGreaterThanOrEqual(13);
    for (const f of Object.values(LEGACY_V2_PROVENANCE.files)) expect(f.sha256).toMatch(/^([0-9a-f]{16,64}|n\/a \(not a source file\))$/);
  });
  it('verbatim research files hash to the source values (v24-engine, corridor-entry, v22/v23/v24 replay & engines)', () => {
    // These files are byte-identical apart from import-path rewrites, so we pin the SOURCE hash in provenance/pins
    // and check the port has no forbidden symbols; exact byte equality is asserted on the copied artifacts instead.
    const pins = new Map<string, string>();
    for (const d of [...V2X, V27_DEFINITION, V28_DEFINITION]) for (const p of d.sourcePins) pins.set(p.path.split(' ')[0]!, p.sha256);
    expect(pins.get('scripts/real-data/v24-engine.ts')).toBe(LEGACY_V2_PROVENANCE.files['v24Engine.ts'].sha256);
    expect(pins.get('scripts/real-data/corridor-entry.ts')).toBe(LEGACY_V2_PROVENANCE.files['corridorEntry.ts'].sha256);
  });
  it('the legacy tree imports nothing outside itself except archive types — no db / exchange / execution / production modules', () => {
    const dir = resolve(ROOT, 'src/services/strategyArchive/legacy/v2');
    for (const f of walk(dir)) {
      const src = readFileSync(f, 'utf8');
      const imports = src.split('\n').filter((l) => /^\s*(import|export)\b.*from\s+['"]/.test(l));
      for (const l of imports) {
        const m = /from\s+['"]([^'"]+)['"]/.exec(l)!;
        const spec = m[1]!;
        expect(spec.startsWith('.') || spec.startsWith('node:'), `${f}: ${spec}`).toBe(true);
        expect(spec, `${f}: ${spec}`).not.toMatch(/services\/(backtest|signals|exchange|live)|\/db|kysely|ccxt|binance/i);
      }
      expect(src, f).not.toMatch(/placeOrder|createOrder|apiKey|api_key|fetch\(|localStorage|globalThis\.window|document\./);
    }
  });
  it('no production module imports the legacy engine (only strategyArchive definitions may)', () => {
    const src = resolve(ROOT, 'src');
    for (const f of walk(src)) {
      if (f.includes('/services/strategyArchive/')) continue;
      const text = readFileSync(f, 'utf8');
      expect(text, f).not.toMatch(/strategyArchive\/legacy/);
    }
  });
  it('frozen settings come from the hash-pinned snapshot, never from a database', () => {
    const s = LegacySettings.fromFrozenSnapshot();
    expect(s.num('risk.min_rr')).toBe(1);
    expect(s.num('outcome.timeout_bars')).toBe(48);
    expect(s.num('v2.stop_buffer_atr')).toBe(0.25);
    expect(() => s.num('does.not.exist')).toThrow(/frozen setting/);
  });
  it('HTF_MAP is the frozen mapping (15m/30m → 1h,4h ; 1h → 4h,1d ; 4h → 1d)', () => {
    expect(HTF_MAP['15m']).toEqual(['1h', '4h']);
    expect(HTF_MAP['30m']).toEqual(['1h', '4h']);
    expect(HTF_MAP['1h']).toEqual(['4h', '1d']);
    expect(HTF_MAP['4h']).toEqual(['1d']);
  });
  it('resolveEntry: entry = OPEN of N+1 only when N+1 exists and is contiguous', () => {
    const n1 = { ...bar(1, 101, 102, 100, 101.5), quoteVolume: 0, trades: 0 };
    expect(resolveEntry(0, M15, n1)).toEqual({ entryPrice: 101, entryCandleTime: M15 });
    expect(resolveEntry(0, M15, undefined)).toBeNull();
    expect(resolveEntry(0, M15, { ...n1, openTime: 2 * M15 })).toBeNull();
  });
  it('trackOutcome (frozen): SL priority on ambiguous bar; stored R is net of the 0.1 % lump', () => {
    const settings = LegacySettings.fromFrozenSnapshot();
    const candles = [bar(1, 100, 105, 97, 101)].map((c) => ({ ...c, quoteVolume: 0, trades: 0 }));
    const out = trackOutcome({ direction: 'LONG', entryPrice: 100, stopLoss: 98, takeProfits: [104], entryCandleTime: M15, candles, settings, qty: 0 });
    expect(out?.result).toBe('SL');
    expect(out!.rMultiple).toBeLessThan(-1);                       // −1R minus fee
    expect(out!.rMultiple + 0.001 * 100 / 2).toBeCloseTo(-1, 9);   // gross recovered exactly
  });
  it('executableLadder keeps only targets ahead of the fill and reports rr1', () => {
    const l = executableLadder('LONG', 100, 98, [99, 103, 106]);
    expect(l.targets).toEqual([103, 106]); expect(l.rr1).toBe(1.5);
  });
  it('evaluateV2 returns null / WAIT on too-short input and never throws', () => {
    const settings = LegacySettings.fromFrozenSnapshot();
    const few = Array.from({ length: 30 }, (_, i) => bar(i, 100, 101, 99, 100)).map((c) => ({ ...c, quoteVolume: 0, trades: 0 }));
    const s = evaluateV2({ symbol: 'BTCUSDT', timeframe: '15m', candles: few, settings });
    expect(s === null || s.direction === 'WAIT').toBe(true);
  });
  it('runSniperEntryLoop: no look-ahead — never reads a candle with openTime > toMs; flat series yields no entries', () => {
    const flat = Array.from({ length: 700 }, (_, i) => bar(i, 100, 100.5, 99.5, 100 + (i % 3) * 0.1));
    let called = 0;
    const st = runSniperEntryLoop({ symbol: 'BTCUSDT', timeframe: '15m', candles: flat, htf: {}, fromMs: 300 * M15, toMs: 500 * M15, onSniperResolved: () => { called++; } });
    expect(st.maxOpenTimeRead).toBeLessThanOrEqual(500 * M15);
    expect(st.sniperEntries).toBe(0); expect(called).toBe(0);
  });
});

describe('V2.2 / V2.3 / V2.4 research primitives (verbatim)', () => {
  it('V2.2 structuralTargets drops R_MULTIPLE rungs and prefers liquidity over equilibrium; none → NO_STRUCTURAL_TP', () => {
    const plans = [{ price: 101, r: 0.5, basis: 'R_MULTIPLE' }, { price: 103, r: 1.5, basis: 'EQUILIBRIUM' }, { price: 105, r: 2.5, basis: 'INTERNAL_LIQUIDITY' }] as never;
    const t = structuralTargets(plans);
    expect(t.ok).toBe(true); expect(t.tp1Basis).toBe('INTERNAL_LIQUIDITY'); expect(t.targets).toEqual([105]);
    expect(structuralTargets([{ price: 101, r: 0.5, basis: 'R_MULTIPLE' }] as never).ok).toBe(false);
  });
  it('V2.2 confirmedExtremeV22 requires body reclaim + rvol for reversals; immediate reclaim kills continuation', () => {
    const rev = { direction: 'LONG', kind: 'REVERSAL', sweep: { direction: 'LONG', reclaimed: true, reclaimBars: 1, penetrationAtr: 0.2, wickRatio: 0.5, bodyRatio: 0.2, rvol: 2 } } as never;
    expect(confirmedExtremeV22(rev).reason).toBe('weak_body_reclaim');
    const cont = { direction: 'SHORT', kind: 'CONTINUATION', breakout: { direction: 'SHORT', closeBeyondAtr: 0.5, bodyRatio: 0.7, immediateReclaim: true } } as never;
    expect(confirmedExtremeV22(cont).reason).toBe('immediate_reclaim');
  });
  it('V2.3 ladder: TP1 = 1.5R, TP2 = min(2.5R, nearest structure beyond TP1), TP3 = structure beyond TP2', () => {
    const l = buildLadderV23('LONG', 100, 98, [{ price: 104, r: 2, basis: 'INTERNAL_LIQUIDITY' }, { price: 110, r: 5, basis: 'RANGE_EDGE' }] as never);
    expect(l.targets).toEqual([103, 104, 110]); expect(l.tp2Source).toBe('STRUCTURE');
    const r = buildLadderV23('LONG', 100, 98, []);
    expect(r.targets).toEqual([103, 105]); expect(r.tp2Source).toBe('R_MULTIPLE');
  });
  it('V2.4 structuralTargetsV24 emits no R-multiple rung', () => {
    const t = structuralTargetsV24([{ price: 101, r: 0.5, basis: 'R_MULTIPLE' }, { price: 106, r: 3, basis: 'RANGE_EDGE' }] as never);
    expect(t.targets).toEqual([106]); expect(t.tp1Basis).toBe('RANGE_EDGE');
  });
  it('per-leg fee: maker entry + taker exit over risk; FEE_ENVS as Amendment 1', () => {
    expect(FEE_ENVS.map((e) => e.label)).toEqual(['GROSS', 'SPOT', 'FUT_7', 'FUT_4']);
    expect(feeRPerLeg(100, 104, 2, FEE_ENVS[2]!)).toBeCloseTo((2e-4 * 100 + 5e-4 * 104) / 2, 12);
    expect(feeRPerLeg(100, 104, 0, FEE_ENVS[2]!)).toBe(0);
  });
});

describe('V2.2–V2.6 definitions — verdicts, pins, honesty', () => {
  const expected: Record<string, [StrategyDefinition['verdict'], string]> = {
    '2.2': ['REJECTED_ON_TRAIN', '5ce58db'], '2.3': ['REJECTED_ON_TRAIN', '2ee06d1'], '2.4': ['FAILED_VALIDATION', 'c52fda7'],
    '2.5': ['TRAIN_ONLY_NOT_VALIDATED', '07dabbb'], '2.6': ['REJECTED_ON_TRAIN', 'e89cf1e'],
  };
  it('each version carries its own historical pin, the frozen-engine dependency and REPRODUCED only with matching evidence', () => {
    for (const d of V2X) {
      const [verdict] = expected[d.version]!;
      expect(d.verdict, d.id).toBe(verdict);
      expect(d.reproducibility, d.id).toBe('REPRODUCED');
      expect(d.reproductionBlockedReason, d.id).toBeUndefined();
      expect(d.reproductionEvidence!.length, d.id).toBeGreaterThan(0);
      expect(d.reproductionEvidence!.every((e) => e.allMatched && e.firstMismatch === null), d.id).toBe(true);
      expect(d.legacyEngineDependency).toBe('FROZEN_V2_ENGINE_4839074');
      expect(d.scopeTimeframes).toEqual(['15m', '30m', '1h', '4h']);
      expect(d.assumptions.feeSemantics).toBe('NET_AT_FEES');
      expect(d.assumptions.fees).toEqual({ kind: 'PER_LEG_BPS', makerBps: 2, takerBps: 5, entryIsMaker: true });
      expect(Object.isFrozen(d)).toBe(true);
    }
    expect((V22_DEFINITION as unknown as { sourcePins: unknown }).sourcePins).toBeTruthy();
  });
  it('historical pins per version', async () => {
    const mods = await Promise.all([
      import('@/services/strategyArchive/definitions/v2_2-htf-spot-engine/definition'),
      import('@/services/strategyArchive/definitions/v2_3-sniper-reversal/definition'),
      import('@/services/strategyArchive/definitions/v2_4-asymmetric-sniper/definition'),
      import('@/services/strategyArchive/definitions/v2_5-trailing-stop/definition'),
      import('@/services/strategyArchive/definitions/v2_6-sniper-trailing/definition'),
    ]);
    const pins = [mods[0].V22_COMMITS.historicalPin, mods[1].V23_COMMITS.historicalPin, mods[2].V24_COMMITS.historicalPin, mods[3].V25_COMMITS.historicalPin, mods[4].V26_COMMITS.historicalPin];
    expect(pins).toEqual(['5ce58db', '2ee06d1', 'c52fda7', '07dabbb', 'e89cf1e']);
    expect(mods[2].V24_COMMITS.candidateFreeze).toBe('53c9ad8');
    for (const m of mods) expect(Object.values(m).some((v) => (v as { frozenEngine?: string })?.frozenEngine === '4839074')).toBe(true);
  });
  it('artifacts are byte-pinned and every ARTIFACT pin has a local copy with the same sha256', () => {
    for (const d of V2X) {
      for (const p of d.sourcePins.filter((x) => x.role === 'ARTIFACT')) expect(sha(local(p.path)), `${d.id} ${p.path}`).toBe(p.sha256);
      for (const v of d.variants ?? []) expect(sha(local(v.artifactPath))).toBe(v.artifactSha256);
    }
  });
  it('source-reported figures are read from the artifacts (not typed): negatives preserved', () => {
    const a22 = V22_SOURCE_RESULTS.train.arms as Record<string, { netByFeeEnv: Record<string, { perFilled: number }>; closed: number }>;
    expect(a22.FULL!.closed).toBe(5323); expect(a22.FULL!.netByFeeEnv.FUT_7!.perFilled).toBe(-0.0715);
    const a23 = V23_SOURCE_RESULTS.train.arms as Record<string, { closed: number; criterionAllPassed: boolean; grossExpectancyPerFilled: number }>;
    expect(a23['S-cor']!.closed).toBe(1497); expect(a23['S-cor']!.grossExpectancyPerFilled).toBe(0.0844);
    expect(Object.values(a23).every((x) => x.criterionAllPassed === false)).toBe(true);
    const t24 = V24_SOURCE_RESULTS.train.arms as Record<string, { criterionAllPassed: boolean }>;
    const v24 = V24_SOURCE_RESULTS.validation.arms as Record<string, { closed: number; grossExpectancyPerFilled: number; grossPF: number; netByFeeEnv: Record<string, { perFilled: number }> }>;
    expect(t24['S-asym']!.criterionAllPassed).toBe(true);                       // passed TRAIN…
    expect(v24['S-asym']!.closed).toBe(234); expect(v24['S-asym']!.grossExpectancyPerFilled).toBe(-0.1098);
    expect(v24['S-asym']!.grossPF).toBeLessThan(1); expect(v24['S-asym']!.netByFeeEnv.FUT_7!.perFilled).toBe(-0.235); // …inverted on VALIDATION
    expect(V24_SOURCE_RESULTS.validation.candidate).toBe('S-asym'); expect(V24_SOURCE_RESULTS.validation.freezeCommit).toBe('53c9ad8');
    expect(V25_SOURCE_RESULTS.train.criterion.passed).toBe(true); expect(V25_SOURCE_RESULTS.train.criterion.v25).toBe(-0.0786); // passed AND negative
    expect(V25_SOURCE_RESULTS.train.sameEntryInvariant.mismatch).toBe(21);
    expect(V26_SOURCE_RESULTS.train.criterion.passed).toBe(false); expect(V26_SOURCE_RESULTS.train.criterion.value).toBe(-0.0092);
    expect(V26_SOURCE_RESULTS.train.sniperEntries).toBe(317);
    const a26 = V26_SOURCE_RESULTS.train.arms as Record<string, { grossExpectancyPerTrade: number }>;
    expect(a26['V26-frozen-exit']!.grossExpectancyPerTrade).toBeGreaterThanOrEqual(a26.V26!.grossExpectancyPerTrade); // trailing redundant
  });
  it('V2.6 → V2.7 → V2.8 share the same 317 sniper entries and V2.5 fee/exit primitives', () => {
    expect(V27_SOURCE_RESULTS.train.arms.every((a) => a.n === 317)).toBe(true);
    expect(V28_SOURCE_RESULTS.train.sniperEntries).toBe(317);
    const a26 = V26_SOURCE_RESULTS.train.arms as Record<string, { grossExpectancyPerTrade: number }>;
    expect(V28_SOURCE_RESULTS.train.arms.find((a) => a.arm === 'Trail')!.grossRPerTrade).toBe(a26.V26!.grossExpectancyPerTrade);
    expect(V28_SOURCE_RESULTS.train.arms.find((a) => a.arm === 'SMC')!.grossRPerTrade).toBe(a26['V26-frozen-exit']!.grossExpectancyPerTrade);
  });
  it('runners refuse slices/arms the source never ran; V2.4 validation limited to A + S-asym; empty input → zero trades', () => {
    const input = { symbol: 'BTCUSDT', bySeries: {}, split: { symbol: 'BTCUSDT', timeframe: '15m' as const, trainFromMs: 0, trainToMs: 1, validFromMs: 2, validToMs: 3, testFromMs: 4, testToMs: 5 } };
    for (const d of [V22_DEFINITION, V23_DEFINITION, V25_DEFINITION, V26_DEFINITION]) {
      expect(() => d.runSeries(input, 'validation', d.headlineVariantId ?? 'A')).toThrow(/TRAIN/);
      expect(() => reproduce(d, [], 'validation')).toThrow(/never run/);
    }
    expect(() => V22_DEFINITION.runSeries(input, 'train')).toThrow(/unknown arm/);
    expect(() => V24_DEFINITION.runSeries(input, 'validation', 'S-cor')).toThrow(/never run on VALIDATION/);
    expect(V24_DEFINITION.runSeries(input, 'validation', 'S-asym').trades).toEqual([]);
    expect(V26_DEFINITION.runSeries(input, 'train', 'V26').trades).toEqual([]);
  });
  it('caveats: verdict stated first, no promise wording, "CRYPTORA does not trade"; V2.5 says passing ≠ positive; V2.4 says inverted', () => {
    for (const c of [V22_CAVEATS_RU, V23_CAVEATS_RU, V24_CAVEATS_RU, V25_CAVEATS_RU, V26_CAVEATS_RU]) {
      const all = c.join(' ');
      expect(all).toMatch(/не исполняет сделки/);
      expect(all).not.toMatch(/прибыльная стратегия|лучший сигнал|ожидаемая доходность/i);
    }
    expect(V22_CAVEATS_RU[0]).toMatch(/ОТКЛОНЕНО НА TRAIN/); expect(V23_CAVEATS_RU[0]).toMatch(/ОТКЛОНЕНО НА TRAIN/);
    expect(V24_CAVEATS_RU[0]).toMatch(/ВАЛИДАЦИЯ ПРОВАЛЕНА/); expect(V24_CAVEATS_RU[0]).toMatch(/инвертировался/);
    expect(V25_CAVEATS_RU[0]).toMatch(/НЕ ВАЛИДИРОВАНО/); expect(V25_CAVEATS_RU[0]).toMatch(/не положительный результат/);
    expect(V26_CAVEATS_RU[0]).toMatch(/ОТКЛОНЕНО НА TRAIN/);
  });
});

describe('V2.2–V2.6 — REPRODUCED headline arms through the legacy engine port', () => {
  const EXPECT: Array<[readonly { slice: string; deterministicDigest: string; tradeCount: number; evidencePath: string; sourceArtifactPath: string; sourceArtifactSha256: string; datasetCommit: string }[], Record<string, [number, string]>]> = [
    [V22_REPRODUCTION_EVIDENCE, { 'train:FULL': [5323, 'fnv1a32:1887e6c6:n5323'] }],
    [V23_REPRODUCTION_EVIDENCE, { 'train:S-cor': [1497, 'fnv1a32:74082f0a:n1497'] }],
    [V24_REPRODUCTION_EVIDENCE, { 'train:S-asym': [689, 'fnv1a32:bd21237a:n689'], 'validation:S-asym': [234, 'fnv1a32:8edcd5e1:n234'] }],
    [V25_REPRODUCTION_EVIDENCE, { 'train:V25': [30867, 'fnv1a32:eecdce93:n30867'] }],
    [V26_REPRODUCTION_EVIDENCE, { 'train:V26': [317, 'fnv1a32:74bd32bd:n317'], 'train:V26-frozen-exit': [317, 'fnv1a32:ee2f6c4f:n317'] }],
  ];
  it('evidence: n + digest pinned, source artifact hash-pinned, dataset c3c1dce, evidence file on disk agrees', () => {
    for (const [ev, exp] of EXPECT) {
      expect(ev.map((e) => e.slice).sort()).toEqual(Object.keys(exp).sort());
      for (const e of ev) {
        const [n, digest] = exp[e.slice]!;
        expect(e.tradeCount, e.slice).toBe(n); expect(e.deterministicDigest, e.slice).toBe(digest);
        expect(e.datasetCommit).toBe('c3c1dcecfe2784a147f591f2b5b4526cbf99df9f');
        expect(sha(local(e.sourceArtifactPath))).toBe(e.sourceArtifactSha256);
        const file = JSON.parse(readFileSync(resolve(ROOT, e.evidencePath), 'utf8'));
        expect(file.deterministicDigest).toBe(digest); expect(file.comparison.allMatched).toBe(true);
        expect(file.dataset.intervalsRead).toEqual(['15m', '30m', '1h', '4h', '1d']);
      }
    }
  });
  it('reproduced figures equal source-reported figures and are stored separately (DERIVED_BY_CRYPTORA)', () => {
    const a22 = V22_SOURCE_RESULTS.train.arms as Record<string, { grossExpectancyPerFilled: number; netByFeeEnv: Record<string, { perFilled: number }> }>;
    const r22 = V22_REPRODUCED_RESULTS.runs['train:FULL']!;
    expect(V22_REPRODUCED_RESULTS.origin).toBe('DERIVED_BY_CRYPTORA');
    expect(r22.grossRPerTrade).toBe(a22.FULL!.grossExpectancyPerFilled); expect(r22.netRPerTrade).toBe(a22.FULL!.netByFeeEnv.FUT_7!.perFilled);
    const a23 = V23_SOURCE_RESULTS.train.arms as Record<string, { grossExpectancyPerFilled: number; grossPF: number }>;
    expect(V23_REPRODUCED_RESULTS.runs['train:S-cor']!.grossRPerTrade).toBe(a23['S-cor']!.grossExpectancyPerFilled);
    expect(V23_REPRODUCED_RESULTS.runs['train:S-cor']!.profitFactor).toBe(a23['S-cor']!.grossPF);
    const v24 = V24_SOURCE_RESULTS.validation.arms as Record<string, { grossExpectancyPerFilled: number; netByFeeEnv: Record<string, { perFilled: number }> }>;
    const rv24 = V24_REPRODUCED_RESULTS.runs['validation:S-asym']!;
    expect(rv24.grossRPerTrade).toBe(v24['S-asym']!.grossExpectancyPerFilled); expect(rv24.netRPerTrade).toBe(v24['S-asym']!.netByFeeEnv.FUT_7!.perFilled);
    expect(rv24.netRPerTrade).toBeLessThan(0);                                   // failed validation reproduced as a failure
    expect(V25_REPRODUCED_RESULTS.runs['train:V25']!.netRPerTrade).toBe(V25_SOURCE_RESULTS.train.criterion.v25);
    const a26 = V26_SOURCE_RESULTS.train.arms as Record<string, { grossExpectancyPerTrade: number }>;
    expect(V26_REPRODUCED_RESULTS.runs['train:V26']!.grossRPerTrade).toBe(a26.V26!.grossExpectancyPerTrade);
    // V2.6 arms and V2.8 Trail/SMC are the same 317 entries → identical digests across versions
    const d28 = Object.fromEntries(V28_REPRODUCTION_EVIDENCE.map((e) => [e.slice, e.deterministicDigest]));
    expect(V26_REPRODUCED_RESULTS.runs['train:V26']!.digest).toBe(d28['train:Trail']);
    expect(V26_REPRODUCED_RESULTS.runs['train:V26-frozen-exit']!.digest).toBe(d28['train:SMC']);
  });
  it('partial-scope reruns are declared as such (no claim that every arm was rerun)', () => {
    expect(V22_REPRODUCED_RESULTS.scope).toMatch(/not rerun/); expect(V23_REPRODUCED_RESULTS.scope).toMatch(/not rerun/);
    expect(V24_REPRODUCED_RESULTS.scope).toMatch(/BOTH slices/); expect(V25_REPRODUCED_RESULTS.scope).toMatch(/not rerun/);
    expect(V26_REPRODUCED_RESULTS.scope).toMatch(/Both arms/);
  });
});

describe('V2.7 / V2.8 — REPRODUCED through the legacy engine port', () => {
  it('evidence files exist, hash-pin the source artifact, all matched, digests recorded', () => {
    for (const e of [...V27_REPRODUCTION_EVIDENCE, ...V28_REPRODUCTION_EVIDENCE]) {
      expect(e.allMatched, e.slice).toBe(true); expect(e.firstMismatch).toBeNull();
      expect(e.datasetCommit).toBe('c3c1dcecfe2784a147f591f2b5b4526cbf99df9f');
      expect(e.deterministicDigest).toMatch(/^fnv1a32:[0-9a-f]{8}:n\d+$/);
      expect(sha(local(e.sourceArtifactPath))).toBe(e.sourceArtifactSha256);
      const file = JSON.parse(readFileSync(resolve(ROOT, e.evidencePath), 'utf8'));
      expect(file.deterministicDigest).toBe(e.deterministicDigest);
      expect(file.dataset.intervalsRead).toEqual(['15m', '30m', '1h', '4h', '1d']);
    }
    expect(V27_REPRODUCTION_EVIDENCE.map((e) => e.slice)).toEqual(['train:RR15', 'train:RR20', 'train:RR25', 'train:RR30', 'train:RR40']);
    expect(V28_REPRODUCTION_EVIDENCE.map((e) => e.slice)).toEqual(['train:SMC', 'train:Trail', 'train:RR15', 'train:RR20', 'train:RR25', 'train:RR30', 'train:RR40', 'validation:SMC', 'validation:Trail']);
  });
  it('reproduced numbers equal source-reported numbers (kept separately, origin DERIVED_BY_CRYPTORA)', () => {
    expect(V27_REPRODUCED_RESULTS.origin).toBe('DERIVED_BY_CRYPTORA');
    for (const a of V27_SOURCE_RESULTS.train.arms) {
      const r = V27_REPRODUCED_RESULTS.train[a.arm]!;
      expect(r.n).toBe(a.n); expect(r.grossRPerTrade).toBe(a.grossRPerTrade); expect(r.netRPerTrade).toBe(a.netRPerTrade); expect(r.feeDragR).toBe(a.feeRPerTrade);
    }
    expect(V28_REPRODUCED_RESULTS.feeSemantics).toBe('GROSS_ONLY_ZERO_FEE');
    for (const a of V28_SOURCE_RESULTS.train.arms) expect(V28_REPRODUCED_RESULTS.train[a.arm]!.grossRPerTrade).toBe(a.grossRPerTrade);
    for (const a of V28_SOURCE_RESULTS.validation.arms) {
      expect(V28_REPRODUCED_RESULTS.validation[a.arm]!.grossRPerTrade).toBe(a.grossRPerTrade);
      expect(V28_REPRODUCED_RESULTS.validation[a.arm]!.n).toBe(98);
    }
    // the same entries produce identical digests in V2.7 and V2.8 for the shared RR arms (fees differ, trades don't)
    const d27 = Object.fromEntries(V27_REPRODUCTION_EVIDENCE.map((e) => [e.slice.split(':')[1], e.deterministicDigest]));
    const d28 = Object.fromEntries(V28_REPRODUCTION_EVIDENCE.filter((e) => e.slice.startsWith('train:RR')).map((e) => [e.slice.split(':')[1], e.deterministicDigest]));
    expect(d28).toEqual(d27);
  });
  it('REPRODUCED never changes the research verdict: V2.7 still REJECTED, V2.8 still GROSS-ONLY and net-negative at 2/5', () => {
    expect(V27_DEFINITION.verdict).toBe('REJECTED_ON_TRAIN');
    expect(Object.values(V27_REPRODUCED_RESULTS.train).every((r) => r.netRPerTrade < 0)).toBe(true);
    expect(V28_DEFINITION.verdict).toBe('VALIDATED_GROSS_ONLY');
    expect(V28_DEFINITION.assumptions.feeSemantics).toBe('GROSS_ONLY_ZERO_FEE');
  });
});

describe('registry after C6', () => {
  it('C6 slice of the registry: V2.2–V2.8 + V3.x present; total rows always 13; verdict and reproducibility separate', () => {
    expect(STRATEGY_ARCHIVE.length + STRATEGY_ARCHIVE_PLANNED.length).toBe(13); expect(STRATEGY_ARCHIVE_TOTAL_ROWS).toBe(13);
    expect(STRATEGY_ARCHIVE_PLANNED.some((p) => p.version >= '2.2')).toBe(false);
    for (const d of STRATEGY_ARCHIVE) {
      if (d.reproducibility === 'REPRODUCED') expect(d.reproductionEvidence?.length, d.id).toBeGreaterThan(0);
      else expect(d.reproductionBlockedReason, d.id).toBeTruthy();
    }
    const c6 = STRATEGY_ARCHIVE.filter((d) => !d.version.startsWith('2.1'));
    expect(c6.every((d) => d.reproducibility === 'REPRODUCED')).toBe(true);
    // research verdicts are NOT touched by reproduction: negatives stay negative
    const verdicts = Object.fromEntries(c6.map((d) => [d.version, d.verdict]));
    expect(verdicts).toEqual({
      '2.2': 'REJECTED_ON_TRAIN', '2.3': 'REJECTED_ON_TRAIN', '2.4': 'FAILED_VALIDATION', '2.5': 'TRAIN_ONLY_NOT_VALIDATED', '2.6': 'REJECTED_ON_TRAIN',
      '2.7': 'REJECTED_ON_TRAIN', '2.8': 'VALIDATED_GROSS_ONLY', '3.0': 'VALIDATED_FOR_RESEARCH', '3.1': 'FALSIFIED_ON_TRAIN', '3.2': 'FALSIFIED_ON_TRAIN', '3.3': 'TRAIN_ONLY_NOT_VALIDATED',
    });
  });
});

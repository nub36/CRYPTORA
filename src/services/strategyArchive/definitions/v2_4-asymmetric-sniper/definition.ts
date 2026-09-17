/**
 * V2.4 — ASYMMETRIC SNIPER — archived strategy definition (immutable).
 *
 * Source: svechnoy-suslik-v2 TRAIN 8e07352 → candidate freeze 53c9ad8 → VALIDATION c52fda7 (pre-registration 072490e).
 * Frozen V2 engine 4839074.
 * RESEARCH VERDICT: FAILED_VALIDATION (source `V2_4_NOT_VALIDATED`) — S-asym passed ALL pre-registered TRAIN criteria
 * (net +0.0624 @2/5, n=689) and inverted completely out of sample: VALIDATION gross −0.1098, net −0.2350, PF 0.8559, n=234.
 * Every component (direction, HTF leg, timeframe, symbol) reversed sign. The only V2.x entry-side candidate ever validated.
 * ⚠️ Historical research only. CRYPTORA does not execute trades.
 */

import type {
  ReproductionEvidence, ResultOrigin, SourceFilePin, SpecResearchDiscrepancy, StrategyDefinition, StrategyVariant,
} from '../../types';
import { V24_ARMS } from '../../legacy/v2/research/v24Replay';
import { runV24Series, V24_ARM_IDS, V24_VALIDATION_ARMS } from './v24Runner';
import aTrain from '../../results/v24/v24-train-metrics.json' with { type: 'json' };
import aValid from '../../results/v24/v24-validation-metrics.json' with { type: 'json' };
import rV24_train_S_asym from '../../results/v24/cryptora-reproduction/v24-train-S-asym-reproduction.json' with { type: 'json' };
import rV24_validation_S_asym from '../../results/v24/cryptora-reproduction/v24-validation-S-asym-reproduction.json' with { type: 'json' };

const TRAIN_ART = 'artifacts/research/v24/v24-train-metrics.json';
const TRAIN_SHA = 'bbf3c08b333d2e58ba7aa202309e89179e911da72b9ecc26c04b863feda5bee8';
const VALID_ART = 'artifacts/research/v24/v24-validation-metrics.json';
const VALID_SHA = 'e132a9951048e804f469811bf60626671cc589c19c3a680a3cee2915a89d9c79';
const ARMS_RU: Record<string, string> = {
  'A': 'Baseline (frozen engine as-is)', 'S-base': 'Sniper-фильтр, frozen цели, вход N+1', 'S-struct': 'Sniper + структурные цели',
  'S-cor': 'Sniper + структурные цели + corridor', 'S-asym': 'S-cor + LONG HTF-асимметрия (кандидат)', 'S-noasym': 'S-cor без асимметрии (идентичен S-cor)',
};

export const V24_CONSTANTS = Object.freeze({
  SCOPE: ['15m', '30m', '1h', '4h'] as const,
  SYMBOLS: ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT'] as readonly string[],
  MAKER_BPS: 2, TAKER_BPS: 5, STRESS_MAKER_BPS: 5, STRESS_TAKER_BPS: 5,
  HTF_EMA_MIN_BARS: 200, MIN_BODY_RATIO: 0.35, MIN_RVOL: 1.2, RECLAIM_MAX_BARS: 3,
  CANDIDATE_ARM: 'S-asym' as const,
});

type Arm = { closed: number; grossExpectancyPerFilled: number; grossPF: number | null; maxDrawdownR: number;
  netByFeeEnv: Record<string, { perFilled: number; perSetup: number }>; criterionAllPassed: boolean; outlierDependence?: { exTop1Pct: number } };

export const V24_VARIANTS: readonly StrategyVariant[] = Object.freeze(
  V24_ARM_IDS.map((id) => {
    const t = (aTrain.arms as Record<string, Arm>)[id]!;
    const v = (aValid.arms as Record<string, Arm | undefined>)[id];
    const role = id === 'S-asym' ? 'CANDIDATE (frozen 53c9ad8 BEFORE validation; FAILED validation)'
      : id === 'A' ? 'BASELINE ANCHOR (also run on VALIDATION as comparison anchor)' : 'TRAIN ABLATION ARM';
    const verdict = `TRAIN closed ${t.closed}, gross ${t.grossExpectancyPerFilled}, net @2/5 ${t.netByFeeEnv.FUT_7!.perFilled}, criteria ${t.criterionAllPassed ? 'PASS' : 'FAIL'}`
      + (v ? `; VALIDATION closed ${v.closed}, gross ${v.grossExpectancyPerFilled}, net @2/5 ${v.netByFeeEnv.FUT_7!.perFilled}, PF ${v.grossPF}, ex-top-1 % ${v.outlierDependence?.exTop1Pct} → FAIL` : '; not validated');
    return { id, label: ARMS_RU[id] ?? id, sourceRole: role, sourceVerdict: verdict, artifactPath: v ? VALID_ART : TRAIN_ART, artifactSha256: v ? VALID_SHA : TRAIN_SHA };
  }),
);

export const V24_SOURCE_PINS: readonly SourceFilePin[] = Object.freeze([
  { role: 'PREREGISTRATION', path: 'docs/V2_4_ASYMMETRIC_SNIPER_PREREGISTRATION.md', sha256: 'f6b58645f9529c225897986da79985348dda2ad71ae0f52f415ddbdff9b1635e' },
  { role: 'PREREGISTRATION', path: 'docs/V2_4_CANDIDATE_FREEZE.md', sha256: 'a69eed8ab6f474c1c54cb0d3b966c84cc68bb037b643b0f293328c8201780273' },
  { role: 'RESULTS_DOC', path: 'docs/V2_4_TRAIN_RESULTS.md', sha256: '0601fd730de63039f023647d75de92416cceed1c5fc76ffc6e2ee8cdae2424be' },
  { role: 'RESULTS_DOC', path: 'docs/V2_4_VALIDATION_RESULTS.md', sha256: 'f56c5ccfa7fd9d7cee54ecae9b2ece7917e6cef031594fcc4be7a92e7dcb02a5' },
  { role: 'SPEC', path: 'docs/strategies/V2_4_ASYMMETRIC_SNIPER.md (retrospective archive spec, added at 1f3ae3a; hashed at 2d8a3dd)', sha256: 'efb4f6cd4ac291050c0da9191ad1ae8fb879ab6be4665635f1eb0ad3fcdf48f8' },
  { role: 'RESEARCH_IMPLEMENTATION', path: 'scripts/real-data/v24-engine.ts', sha256: '6f930e48998bdfbdafd5e7d3e1e07d79307febc3734fca7bc5e44655383edbe3' },
  { role: 'RESEARCH_IMPLEMENTATION', path: 'scripts/real-data/v24-replay.ts', sha256: 'b65258352e75718d97b3676b6bfcbe549c588632af6870c1c78053927b1c789f' },
  { role: 'RUNNER', path: 'scripts/real-data/v24-train.ts', sha256: '9b26bcd9379d388a80b36b3e447e1be202297cb420805bfe483c2f339eafdb18' },
  { role: 'RUNNER', path: 'scripts/real-data/v24-validate.ts', sha256: 'afc72b7f8935366bba9bd60fb85f4daf05c8bc56cd9cda4a11b024911827ab0b' },
  { role: 'SHARED_PRIMITIVE', path: 'scripts/real-data/v22-engine.ts (FEE_ENVS, feeRPerLeg)', sha256: 'e6eba37044a079fa694881c45afae16ad35472bb327482f959a89f6600fff3f8' },
  { role: 'SHARED_PRIMITIVE', path: 'scripts/real-data/corridor-entry.ts', sha256: 'c2eebef8af2dea3c92f4a221a6a5a6eb37ed00585385845b16ea83c74bfaf6bf' },
  { role: 'ARTIFACT', path: TRAIN_ART, sha256: TRAIN_SHA },
  { role: 'ARTIFACT', path: VALID_ART, sha256: VALID_SHA },
  { role: 'SETTINGS', path: 'artifacts/research/v2-real-20260915-080338/settings.json', sha256: '92311c4f9a96bc2e6922fc952aacc53ae473ffb22bcb6749b11c2a0cfa0cd3f9' },
  { role: 'SPLITS', path: 'artifacts/research/v2-real-20260915-080338/splits.json', sha256: 'a44eed9ae3ad036853f14845113e392c434081301b21647398a4a3af2ab84f0b' },
]);

export const V24_COMMITS = Object.freeze({
  preregistration: '072490e', trainResult: '8e07352', candidateFreeze: '53c9ad8', validationResult: 'c52fda7', historicalPin: 'c52fda7',
  frozenEngine: '4839074', dataset: 'c3c1dcecfe2784a147f591f2b5b4526cbf99df9f',
});

export const V24_DISCREPANCIES: readonly SpecResearchDiscrepancy[] = Object.freeze([
  {
    id: 'D-V24-001',
    specStatement: 'Fee label naming: the pre-registration calls the 2 maker / 5 taker headline "FUT_7"; V2.5+ relabel the same arithmetic "FUT_4".',
    researchBehaviour: 'v24 artifacts: `headlineEnv = "FUT_7 (2 maker / 5 taker)"`, `stressEnv = "SPOT (5 taker / 5 taker)"`; FUT_4 in v24 = 2/2 best case.',
    impact: 'Archive headline = FUT_7 key of the v24 artifacts (2/5). Do not read v24 `FUT_4` (2/2) as the V2.5–V2.8 `FUT_4` (2/5).',
    reproductionPolicy: 'PRESERVE_RESEARCH_BEHAVIOUR',
    evidence: ['artifacts/research/v24/v24-train-metrics.json arms.*.headlineEnv', 'scripts/real-data/v25-trailing.ts V25_FEE_ENVS comment'],
  },
  {
    id: 'D-V24-002',
    specStatement: 'TRAIN criteria: net > 0 per FILLED and per SETUP at headline; stress per FILLED > 0; outlier-robust (ex-top-1 % > 0); both direction legs non-negative.',
    researchBehaviour: 'S-asym passed all five on TRAIN (net +0.0624 / +0.0001 / stress +0.0025 / ex-top-1 % +0.1069 / LONG +0.0743, SHORT +0.2937). VALIDATION: gross −0.1098, net −0.2350, PF 0.8559, ex-top-1 % −0.2540, LONG −0.2668, SL rate 75.64 %.',
    impact: 'Complete out-of-sample inversion; the source recorded it as the strongest evidence that TRAIN-only V2.x results do not generalise.',
    reproductionPolicy: 'PRESERVE_RESEARCH_BEHAVIOUR',
    evidence: ['docs/V2_4_VALIDATION_RESULTS.md §1–§3'],
  },
  {
    id: 'D-V24-003',
    specStatement: 'Arm S-noasym is the asymmetry control.',
    researchBehaviour: 'S-noasym has the identical gate vector to S-cor and identical numbers (829 closed, +0.1419).',
    impact: 'Two arms, one result; kept for artifact fidelity.',
    reproductionPolicy: 'PRESERVE_RESEARCH_BEHAVIOUR',
    evidence: ['scripts/real-data/v24-replay.ts V24_ARMS'],
  },
  {
    id: 'D-V24-004',
    specStatement: 'VALIDATION runs the frozen candidate only.',
    researchBehaviour: 'v24-validate.ts default `--arms=A,S-asym` (baseline as comparison anchor) with a TEST-SAFETY guard (`validTo < testFrom` per series) — the HTF bound window was widened 200 → 400 bars in v24-replay for the EMA200 leg.',
    impact: 'The archive exposes only A and S-asym on the validation slice and enforces the same guard.',
    reproductionPolicy: 'PRESERVE_RESEARCH_BEHAVIOUR',
    evidence: ['scripts/real-data/v24-validate.ts', 'scripts/real-data/v24-replay.ts (`ub - 400 + 1`)'],
  },
  {
    id: 'D-V24-005',
    specStatement: 'Entries, stops and outcome resolution come from the frozen V2 engine `4839074`.',
    researchBehaviour: 'replayV24 wraps evaluateV2 / resolveEntry / executableLadder / trackOutcome; the EMA200 leg reuses the frozen buildEmaContext / closedHtfCandles.',
    impact: 'Reproduction inside CRYPTORA uses the isolated legacy engine port (`legacy/v2`).',
    reproductionPolicy: 'PRESERVE_RESEARCH_BEHAVIOUR',
    evidence: ['scripts/real-data/v24-engine.ts imports'],
  },
]);

const V24_REPRO = [rV24_train_S_asym, rV24_validation_S_asym];
export const V24_REPRODUCTION_EVIDENCE: readonly ReproductionEvidence[] = Object.freeze(
  V24_REPRO.map((e) => ({
    slice: `${e.slice}:${e.variantId}`,
    runAtUtc: e.runAtUtc,
    datasetCommit: e.dataset.commit,
    sourceArtifactPath: e.sourceArtifact.path,
    sourceArtifactSha256: e.sourceArtifact.sha256,
    deterministicDigest: e.deterministicDigest,
    tradeCount: e.tradeCount,
    allMatched: e.comparison.allMatched,
    firstMismatch: e.comparison.firstMismatch,
    evidencePath: `src/services/strategyArchive/results/v24/cryptora-reproduction/v24-${e.slice}-${e.variantId}-reproduction.json`,
  })),
);
/** Figures re-derived by CRYPTORA's rerun — stored separately from V24_SOURCE_RESULTS (never merged). */
export const V24_REPRODUCED_RESULTS = Object.freeze({
  origin: 'DERIVED_BY_CRYPTORA' as ResultOrigin,
  scope: 'Frozen candidate S-asym rerun on BOTH slices (TRAIN n=689, VALIDATION n=234); the other TRAIN arms (A, S-cor, A-asym) were not rerun.',
  runs: Object.fromEntries(V24_REPRO.map((e) => [`${e.slice}:${e.variantId}`, { n: e.metrics.n, grossRPerTrade: e.metrics.grossRPerTrade, feeDragR: e.metrics.feeDragRHeadline, netRPerTrade: e.metrics.netRPerTradeHeadline, netRPerTradeStress: e.metrics.netRPerTradeStress, profitFactor: e.metrics.profitFactor, maxDrawdownR: e.metrics.maxDrawdownR, digest: e.deterministicDigest }])),
});

export const V24_SOURCE_RESULTS = Object.freeze({
  origin: 'SOURCE_REPORTED' as ResultOrigin,
  train: aTrain,
  validation: aValid,
  windows: {
    train: { fromUtc: '2022-01-01T00:00:00Z', toUtc: '2024-05-26T13:00:00Z' },
    validation: { fromUtc: '2024-05-26T14:00:00Z', toUtc: '2025-03-14T18:00:00Z' },
  },
});

export const V24_CAVEATS_RU: readonly string[] = Object.freeze([
  'Исследование: ВАЛИДАЦИЯ ПРОВАЛЕНА. Кандидат S-asym прошёл все пять предзаявленных критериев на TRAIN (нетто @2/5 +0.0624 R/сделку, n=689, PF 1.30) и полностью инвертировался вне выборки: VALIDATION gross −0.1098, нетто −0.2350, PF 0.8559, n=234, доля SL 75.64 %.',
  'Инверсия не является артефактом комиссий: gross сам сменил знак; результат отрицателен и до, и после удаления топ-1 % (3 сделки). Инвертировались все компоненты: LONG +0.0743 → −0.2668, SHORT +0.2937 → +0.0033; все три HTF-ноги асимметрии стали отрицательными.',
  'Кандидат заморожен до валидации (53c9ad8); валидация проведена один раз; TEST не запускался и не просматривался.',
  'Метка FUT_7 в артефактах V2.4 = 2/5 bps (headline); FUT_4 в V2.4 = 2/2 (best case) — не путать с FUT_4 = 2/5 в V2.5–V2.8 (D-V24-001).',
  'Входы — замороженный движок V2 `4839074`; четыре таймфрейма в одном пуле. Не сопоставимо с V3.x.',
  'Воспроизводимость в CRYPTORA: REPRODUCED (замороженный кандидат S-asym, TRAIN и VALIDATION) — оба перезапуска на датасете c3c1dce через изолированный порт замороженного движка V2 (4839074) совпали с артефактами источника по всем сравниваемым полям: TRAIN n=689 gross +0.2023 (digest fnv1a32:bd21237a:n689); VALIDATION n=234 gross −0.1098, net −0.2350 @2/5, PF 0.8559 (digest fnv1a32:8edcd5e1:n234). Воспроизведён именно ПРОВАЛ валидации.',
  'CRYPTORA не исполняет сделки.',
]);

export const V24_RULES_RU = Object.freeze({
  entry: 'Замороженный движок V2 (4839074): ТОЛЬКО REVERSAL; базовый sniper-фильтр (8 условий, как V2.3); LONG требует ≥ 1 из трёх HTF-бычьих ног (close(N) > EMA200 первичного HTF по ≥ 200 закрытым барам / HTF-структура BULLISH / бычья RSI-дивергенция), SHORT проходит всегда; corridor entry close(N) ± 0.10 ATR (≤ 0.15 %), заполнение с N+1 по худшему краю, 3 бара.',
  stop: 'Структурный стоп frozen-движка (+0.25 ATR).',
  targets: 'Только структурные: ближайшая противоположная ликвидность (INTERNAL_LIQUIDITY / RANGE_EDGE) → EQUILIBRIUM → иначе SKIP; R-multiple не эмитируется.',
  timeout: 'Frozen trackOutcome: 48 баров; SL и TP в одном баре → SL.',
  fees: 'Headline 2 bps maker вход / 5 bps taker выход (ключ FUT_7 в артефакте); стресс SPOT 5/5.',
  scope: '15m/30m/1h/4h × 6 символов; TRAIN 6 веток; VALIDATION — A и S-asym.',
});

const definition: StrategyDefinition = {
  id: 'V2_4_ASYMMETRIC_SNIPER',
  version: '2.4',
  name: 'Asymmetric Sniper (reversal sniper + LONG HTF asymmetry + structural targets + corridor)',
  nameRu: 'Асимметричный Sniper',
  verdict: 'FAILED_VALIDATION',
  reproducibility: 'REPRODUCED',
  reproductionEvidence: V24_REPRODUCTION_EVIDENCE,
    legacyEngineDependency: 'FROZEN_V2_ENGINE_4839074',
  variants: V24_VARIANTS,
  headlineVariantId: V24_CONSTANTS.CANDIDATE_ARM,
  slicesAvailable: ['train', 'validation'],
  execTimeframe: '15m',
  scopeTimeframes: V24_CONSTANTS.SCOPE,
  structuralTimeframe: null,
  symbols: V24_CONSTANTS.SYMBOLS,
  assumptions: {
    fees: { kind: 'PER_LEG_BPS', makerBps: V24_CONSTANTS.MAKER_BPS, takerBps: V24_CONSTANTS.TAKER_BPS, entryIsMaker: true },
    stressFees: { kind: 'PER_LEG_BPS', makerBps: V24_CONSTANTS.STRESS_MAKER_BPS, takerBps: V24_CONSTANTS.STRESS_TAKER_BPS, entryIsMaker: true },
    feeSemantics: 'NET_AT_FEES',
    slippage: 'NOT_MODELLED', funding: 'NOT_MODELLED', spread: 'NOT_MODELLED',
    positionSizing: 'NONE_R_MULTIPLES_ONLY', marketData: 'BINANCE_SPOT_KLINES', feeVenueAssumed: 'BINANCE_USDT_FUTURES',
  },
  discrepancies: V24_DISCREPANCIES,
  sourcePins: V24_SOURCE_PINS,
  runSeries: runV24Series,
};
export const V24_DEFINITION: StrategyDefinition = Object.freeze(definition);
export { V24_ARMS, V24_VALIDATION_ARMS };

/**
 * V2.6 — SNIPER ENTRY × TRAILING EXIT — archived strategy definition (immutable).
 *
 * Source: svechnoy-suslik-v2 @ e89cf1e (TRAIN result; pre-registration 3e164ef). Frozen V2 engine 4839074.
 * RESEARCH VERDICT: REJECTED_ON_TRAIN — criterion "net @2/5 > 0" FAILED: gross +0.1462 (best gross of the V2.x programme,
 * n=317) minus fee drag 0.1555 = net −0.0092. The pre-registered overlap hypothesis was confirmed: the trailing exit is
 * redundant once the sniper filter is applied (V26-frozen-exit gross +0.1490 ≥ V26 +0.1462; additivity shortfall +0.0405
 * vs the naive +0.1057 projection). Edge collapses when five trades are removed.
 * ⚠️ Historical research only. CRYPTORA does not execute trades.
 */

import type {
  ReproductionEvidence, ResultOrigin, SourceFilePin, SpecResearchDiscrepancy, StrategyDefinition, StrategyVariant,
} from '../../types';
import { NAIVE_ADDITIVE_GROSS, runV26Series, V26_ARMS, V26_SCOPE, V26_SYMBOLS } from './v26Runner';
import aTrain from '../../results/v26/v26-train-metrics.json' with { type: 'json' };
import rV26_train_V26 from '../../results/v26/cryptora-reproduction/v26-train-V26-reproduction.json' with { type: 'json' };
import rV26_train_V26_frozen_exit from '../../results/v26/cryptora-reproduction/v26-train-V26-frozen-exit-reproduction.json' with { type: 'json' };

const ARTIFACT = 'artifacts/research/v26/v26-train-metrics.json';
const ARTIFACT_SHA = 'c546b8945d6916524943dbdd1bd6fbafa14de66f3cf3cb510d3e83fba6000d55';
const ARMS_RU: Record<string, string> = {
  'A': 'Все входы, frozen выходы', 'V25': 'Все входы, трейлинг V2.5', 'V26': 'Sniper-входы, трейлинг V2.5 (кандидат)', 'V26-frozen-exit': 'Sniper-входы, frozen выходы',
};

export const V26_CONSTANTS = Object.freeze({
  SCOPE: V26_SCOPE, SYMBOLS: V26_SYMBOLS,
  MAKER_BPS: 2, TAKER_BPS: 5, STRESS_MAKER_BPS: 5, STRESS_TAKER_BPS: 5,
  NAIVE_ADDITIVE_GROSS, CANDIDATE_ARM: 'V26' as const,
  CRITERION: 'V2.6 net expectancy per trade > 0, headline 2/5 bps',
});

type Arm = { closed: number; grossExpectancyPerTrade: number; grossPF: number | null; maxDrawdownR: number; winRate: number;
  netByFeeEnv: Record<string, { perFilled: number; meanFeeDragR: number }>; outlierDependence: { exTop1Pct: number; exTop5: number } };

export const V26_VARIANTS: readonly StrategyVariant[] = Object.freeze(
  V26_ARMS.map((id) => {
    const a = (aTrain.arms as Record<string, Arm>)[id]!;
    const role = id === 'V26' ? 'CANDIDATE (pre-registered; FAILED net > 0)'
      : id === 'V26-frozen-exit' ? 'ABLATION — sniper without trailing (shows trailing is redundant)'
        : id === 'V25' ? 'PROJECTION OF V2.5 ON THE SAME WALK' : 'BASELINE ANCHOR';
    return {
      id, label: ARMS_RU[id] ?? id, sourceRole: role,
      sourceVerdict: `closed ${a.closed}; gross ${a.grossExpectancyPerTrade} R; fee drag ${a.netByFeeEnv.FUT_4!.meanFeeDragR}; net @2/5 ${a.netByFeeEnv.FUT_4!.perFilled} R (SPOT ${a.netByFeeEnv.SPOT!.perFilled}); `
        + `PF ${a.grossPF}; DD ${a.maxDrawdownR}R; win ${a.winRate} %; ex-top-5 ${a.outlierDependence.exTop5}`,
      artifactPath: ARTIFACT, artifactSha256: ARTIFACT_SHA,
    };
  }),
);

export const V26_SOURCE_PINS: readonly SourceFilePin[] = Object.freeze([
  { role: 'PREREGISTRATION', path: 'docs/V2_6_SNIPER_TRAILING_PREREGISTRATION.md', sha256: '56c8540763803a552c3e64b7d9e9eb5eb201740d341521ceecd2ce96f0be5741' },
  { role: 'RESULTS_DOC', path: 'docs/V2_6_TRAIN_RESULTS.md', sha256: 'e3a9da60e8f3a17d2bc3280186e6b1c00c4b408da5811b7b75dfe22218a68e86' },
  { role: 'SPEC', path: 'docs/strategies/V2_6_SNIPER_TRAILING.md (retrospective archive spec, added at 1f3ae3a; hashed at 2d8a3dd)', sha256: '2c006b5b44e69a57cacf1aa916f5844fa339a321c390a89e94291f775b0e3525' },
  { role: 'RUNNER', path: 'scripts/real-data/v26-train.ts', sha256: 'e2f8fce21908eedd80effbaeccb85e74c4f003e909cd2ff26ee9d97f2d2e8aae' },
  { role: 'SHARED_PRIMITIVE', path: 'scripts/real-data/v25-trailing.ts', sha256: 'fe6c307ee53273edcc155e16643bfecade61a6bf3a60296325ef8491460f50fa' },
  { role: 'SHARED_PRIMITIVE', path: 'scripts/real-data/v24-engine.ts (baseSniper)', sha256: '6f930e48998bdfbdafd5e7d3e1e07d79307febc3734fca7bc5e44655383edbe3' },
  { role: 'SHARED_PRIMITIVE', path: 'scripts/real-data/corridor-entry.ts (extremePoolKind)', sha256: 'c2eebef8af2dea3c92f4a221a6a5a6eb37ed00585385845b16ea83c74bfaf6bf' },
  { role: 'ARTIFACT', path: ARTIFACT, sha256: ARTIFACT_SHA },
  { role: 'SETTINGS', path: 'artifacts/research/v2-real-20260915-080338/settings.json', sha256: '92311c4f9a96bc2e6922fc952aacc53ae473ffb22bcb6749b11c2a0cfa0cd3f9' },
  { role: 'SPLITS', path: 'artifacts/research/v2-real-20260915-080338/splits.json', sha256: 'a44eed9ae3ad036853f14845113e392c434081301b21647398a4a3af2ab84f0b' },
]);

export const V26_COMMITS = Object.freeze({
  preregistration: '3e164ef', trainResult: 'e89cf1e', historicalPin: 'e89cf1e',
  frozenEngine: '4839074', dataset: 'c3c1dcecfe2784a147f591f2b5b4526cbf99df9f',
});

export const V26_DISCREPANCIES: readonly SpecResearchDiscrepancy[] = Object.freeze([
  {
    id: 'D-V26-001',
    specStatement: 'Pre-registration §0: naive additive projection of sniper gain + trailing gain = +0.1057 gross.',
    researchBehaviour: 'Measured V26 gross +0.1462 (shortfall field = +0.0405, i.e. measured ABOVE the naive sum) while V26-frozen-exit = +0.1490 ≥ V26 → the trailing exit adds −0.0028 once the sniper filter is on. The source text reads the result as confirming the overlap hypothesis ("gains do not stack").',
    impact: 'The artifact `additivityTest.note` says "negative shortfall confirms overlap" although the recorded shortfall is +0.0405; the substantive finding (trailing redundant after sniper) is supported by V26 vs V26-frozen-exit. Recorded as-is.',
    reproductionPolicy: 'PRESERVE_RESEARCH_BEHAVIOUR',
    evidence: ['artifacts/research/v26/v26-train-metrics.json additivityTest', 'docs/V2_6_TRAIN_RESULTS.md §8'],
  },
  {
    id: 'D-V26-002',
    specStatement: 'Sniper entry set = V2.3/V2.4 base filter applied inside the SAME walk as the baseline.',
    researchBehaviour: 'Sniper is a FLAG on each baseline entry (one slot, frozen tracker); 317 of 30,888 entries qualify. Because the slot is shared, sniper entries that would have been taken while a non-sniper position was open are never seen — the population differs from a sniper-only walk (V2.3 S-base: 836).',
    impact: 'V2.6 (and V2.7/V2.8, which inherit the 317) measure a different, smaller sniper population than V2.3/V2.4. Not directly comparable across those versions.',
    reproductionPolicy: 'PRESERVE_RESEARCH_BEHAVIOUR',
    evidence: ['scripts/real-data/v26-train.ts header + main loop', 'artifacts/research/v26/v26-train-metrics.json sameUniverseInvariant'],
  },
  {
    id: 'D-V26-003',
    specStatement: 'Fee drag is a property of the fee model.',
    researchBehaviour: 'Sniper selection raises its own fee drag 0.1243 → 0.1555 R by selecting tighter stops; best gross of the programme (+0.1462) still nets −0.0092.',
    impact: 'The gap is structural per the source verdict; this is the basis for V2.7 (target sweep) and V2.8 (zero-fee question).',
    reproductionPolicy: 'PRESERVE_RESEARCH_BEHAVIOUR',
    evidence: ['docs/V2_6_TRAIN_RESULTS.md §8'],
  },
  {
    id: 'D-V26-004',
    specStatement: 'Same-universe invariant across four arms.',
    researchBehaviour: 'entriesA 30,888 / entriesV25 30,867 / entriesV26 317 / entriesV26F 317; 21 trailing entries unresolved at the TRAIN boundary (as in V2.5), none of them sniper.',
    impact: 'n(V25) = n(A) − 21 by construction.',
    reproductionPolicy: 'PRESERVE_RESEARCH_BEHAVIOUR',
    evidence: ['artifacts/research/v26/v26-train-metrics.json sameUniverseInvariant'],
  },
  {
    id: 'D-V26-005',
    specStatement: 'Entries, stops and the frozen exits come from the frozen V2 engine `4839074`.',
    researchBehaviour: 'evaluateV2 / resolveEntry / executableLadder / trackOutcome unchanged; sniper flag via baseSniper + extremePoolKind; trailing via v25-trailing.ts.',
    impact: 'Reproduction inside CRYPTORA uses the isolated legacy engine port (`legacy/v2`) — the same shared loop as V2.7/V2.8.',
    reproductionPolicy: 'PRESERVE_RESEARCH_BEHAVIOUR',
    evidence: ['scripts/real-data/v26-train.ts imports'],
  },
]);

const V26_REPRO = [rV26_train_V26, rV26_train_V26_frozen_exit];
export const V26_REPRODUCTION_EVIDENCE: readonly ReproductionEvidence[] = Object.freeze(
  V26_REPRO.map((e) => ({
    slice: `${e.slice}:${e.variantId}`,
    runAtUtc: e.runAtUtc,
    datasetCommit: e.dataset.commit,
    sourceArtifactPath: e.sourceArtifact.path,
    sourceArtifactSha256: e.sourceArtifact.sha256,
    deterministicDigest: e.deterministicDigest,
    tradeCount: e.tradeCount,
    allMatched: e.comparison.allMatched,
    firstMismatch: e.comparison.firstMismatch,
    evidencePath: `src/services/strategyArchive/results/v26/cryptora-reproduction/v26-${e.slice}-${e.variantId}-reproduction.json`,
  })),
);
/** Figures re-derived by CRYPTORA's rerun — stored separately from V26_SOURCE_RESULTS (never merged). */
export const V26_REPRODUCED_RESULTS = Object.freeze({
  origin: 'DERIVED_BY_CRYPTORA' as ResultOrigin,
  scope: 'Both arms rerun (V26 and V26-frozen-exit, n=317 each).',
  runs: Object.fromEntries(V26_REPRO.map((e) => [`${e.slice}:${e.variantId}`, { n: e.metrics.n, grossRPerTrade: e.metrics.grossRPerTrade, feeDragR: e.metrics.feeDragRHeadline, netRPerTrade: e.metrics.netRPerTradeHeadline, netRPerTradeStress: e.metrics.netRPerTradeStress, profitFactor: e.metrics.profitFactor, maxDrawdownR: e.metrics.maxDrawdownR, digest: e.deterministicDigest }])),
});

export const V26_SOURCE_RESULTS = Object.freeze({
  origin: 'SOURCE_REPORTED' as ResultOrigin,
  train: aTrain,
  windows: { train: { fromUtc: '2022-01-01T00:00:00Z', toUtc: '2024-05-26T13:00:00Z' } },
  validation: 'NEVER RUN — rejected on TRAIN.',
});

export const V26_CAVEATS_RU: readonly string[] = Object.freeze([
  'Исследование: ОТКЛОНЕНО НА TRAIN. Критерий «нетто @2/5 > 0» провален: gross +0.1462 R/сделку (лучший gross программы V2.x, n=317) минус комиссионное трение 0.1555 = нетто −0.0092.',
  'Гипотеза перекрытия подтверждена: после sniper-фильтра трейлинг избыточен (V26-frozen-exit gross +0.1490 ≥ V26 +0.1462); оба механизма собирают одну и ту же экскурсию (D-V26-001).',
  'Sniper-фильтр сам повышает комиссионное трение (0.1243 → 0.1555 R), выбирая более тесные стопы. Edge рушится при удалении пяти сделок (ex-top-5 +0.0394).',
  'Sniper — флаг на входах ОБЩЕГО прохода с одним слотом позиции: 317 из 30,888 входов; популяция отличается от sniper-only проходов V2.3/V2.4 (D-V26-002). Эти же 317 входов наследуют V2.7 и V2.8.',
  'Входы — замороженный движок V2 `4839074`; четыре таймфрейма в одном пуле. Валидация не проводилась. Не сопоставимо с V3.x.',
  'Воспроизводимость в CRYPTORA: REPRODUCED (обе ветки) — перезапуски на датасете c3c1dce через изолированный порт замороженного движка V2 (4839074) совпали с артефактом источника по всем сравниваемым полям: V26 n=317 gross +0.1462 net −0.0092 @2/5 PF 1.3508 (digest fnv1a32:74bd32bd:n317); V26-frozen-exit n=317 gross +0.1490 (digest fnv1a32:ee2f6c4f:n317). Те же 317 входов и те же digests, что у V2.8 Trail/SMC. Воспроизведён ОТКЛОНЁННЫЙ результат.',
  'CRYPTORA не исполняет сделки.',
]);

export const V26_RULES_RU = Object.freeze({
  entry: 'Замороженный движок V2 (4839074): один проход, один слот (frozen trackOutcome); вход по OPEN бара N+1; флаг sniper = REVERSAL ∧ базовый sniper-фильтр V2.4 (свип SWING/EQUAL/CLUSTER, реклейм ≤ 3 бара, penetration ≥ 0.10 ATR, тень ≥ 0.25, тело ≥ 0.35, RVOL > 1.2).',
  stop: 'Структурный стоп frozen-движка (+0.25 ATR).',
  exit: 'V26: трейлинг V2.5 (безубыток при MFE ≥ 1R, трейлинг 1R с шагом 0.25R, таймаут 10 баров). V26-frozen-exit / A: frozen лестница целей, 48 баров.',
  fees: 'Headline 2 bps maker вход / 5 bps taker выход (ключ FUT_4); стресс SPOT 5/5.',
  scope: '15m/30m/1h/4h × 6 символов, TRAIN; 4 проекции одного прохода: A / V25 / V26 / V26-frozen-exit.',
});

const definition: StrategyDefinition = {
  id: 'V2_6_SNIPER_TRAILING',
  version: '2.6',
  name: 'Sniper Entry × Trailing Exit (2×2 same-walk ablation)',
  nameRu: 'Sniper + трейлинг',
  verdict: 'REJECTED_ON_TRAIN',
  reproducibility: 'REPRODUCED',
  reproductionEvidence: V26_REPRODUCTION_EVIDENCE,
    legacyEngineDependency: 'FROZEN_V2_ENGINE_4839074',
  variants: V26_VARIANTS,
  headlineVariantId: V26_CONSTANTS.CANDIDATE_ARM,
  slicesAvailable: ['train'],
  execTimeframe: '15m',
  scopeTimeframes: V26_CONSTANTS.SCOPE,
  structuralTimeframe: null,
  symbols: V26_CONSTANTS.SYMBOLS,
  assumptions: {
    fees: { kind: 'PER_LEG_BPS', makerBps: V26_CONSTANTS.MAKER_BPS, takerBps: V26_CONSTANTS.TAKER_BPS, entryIsMaker: true },
    stressFees: { kind: 'PER_LEG_BPS', makerBps: V26_CONSTANTS.STRESS_MAKER_BPS, takerBps: V26_CONSTANTS.STRESS_TAKER_BPS, entryIsMaker: true },
    feeSemantics: 'NET_AT_FEES',
    slippage: 'NOT_MODELLED', funding: 'NOT_MODELLED', spread: 'NOT_MODELLED',
    positionSizing: 'NONE_R_MULTIPLES_ONLY', marketData: 'BINANCE_SPOT_KLINES', feeVenueAssumed: 'BINANCE_USDT_FUTURES',
  },
  discrepancies: V26_DISCREPANCIES,
  sourcePins: V26_SOURCE_PINS,
  runSeries: runV26Series,
};
export const V26_DEFINITION: StrategyDefinition = Object.freeze(definition);

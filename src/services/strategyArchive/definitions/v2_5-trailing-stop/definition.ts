/**
 * V2.5 — DYNAMIC TRAILING STOP + BREAKEVEN (exit module) — archived strategy definition (immutable).
 *
 * Source: svechnoy-suslik-v2 @ 07dabbb (TRAIN result; pre-registration aad5be5). Frozen V2 engine 4839074.
 * RESEARCH VERDICT: TRAIN_ONLY_NOT_VALIDATED (source `V2_5_PROMISING_PENDING_VALIDATION`) — the single pre-registered
 * criterion PASSED (net @2/5 −0.0786 vs baseline −0.1257 on the SAME 30,867 entries) but the result is STILL NET-NEGATIVE.
 * VALIDATION was never run: the programme moved to V2.6 (sniper × trailing) instead. Superseded as an exit module.
 * ⚠️ Historical research only. Passing a relative criterion is NOT a positive result. CRYPTORA does not execute trades.
 */

import type {
  ReproductionEvidence, ResultOrigin, SourceFilePin, SpecResearchDiscrepancy, StrategyDefinition, StrategyVariant,
} from '../../types';
import { BREAKEVEN_R, TIMEOUT_BARS, TRAIL_DISTANCE_R, TRAIL_STEP_R } from '../../shared/legacyResearch/v25Trailing';
import { runV25Series, V25_ARMS, V25_SCOPE, V25_SYMBOLS } from './v25Runner';
import aTrain from '../../results/v25/v25-train-metrics.json' with { type: 'json' };
import rV25_train_V25 from '../../results/v25/cryptora-reproduction/v25-train-V25-reproduction.json' with { type: 'json' };

const ARTIFACT = 'artifacts/research/v25/v25-train-metrics.json';
const ARTIFACT_SHA = '70d6276e17ad907636e63b9888932894d2327c1541e0e41fb931c609e0bd40c4';

export const V25_CONSTANTS = Object.freeze({
  SCOPE: V25_SCOPE, SYMBOLS: V25_SYMBOLS,
  MAKER_BPS: 2, TAKER_BPS: 5, STRESS_MAKER_BPS: 5, STRESS_TAKER_BPS: 5,
  BREAKEVEN_R, TRAIL_DISTANCE_R, TRAIL_STEP_R, TIMEOUT_BARS,
  CRITERION: 'V2.5 net expectancy per trade > baseline A, headline 2/5 bps',
});

type Arm = { closed: number; grossExpectancyPerTrade: number; grossPF: number | null; maxDrawdownR: number; winRate: number;
  netByFeeEnv: Record<string, { perFilled: number }>; outlierDependence: { exTop1Pct: number }; shareNeverReached1R: number };

export const V25_VARIANTS: readonly StrategyVariant[] = Object.freeze(
  V25_ARMS.map((id) => {
    const a = (aTrain.arms as Record<string, Arm>)[id]!;
    return {
      id,
      label: id === 'A' ? 'Все baseline-входы, frozen выходы' : 'Те же входы, трейлинг + безубыток V2.5',
      sourceRole: id === 'A' ? 'BASELINE ANCHOR (same entry set)' : 'PRE-REGISTERED EXIT MODULE (criterion passed, net-negative, NOT validated)',
      sourceVerdict: `closed ${a.closed}; gross ${a.grossExpectancyPerTrade} R; net @2/5 ${a.netByFeeEnv.FUT_4!.perFilled} R (SPOT ${a.netByFeeEnv.SPOT!.perFilled}); `
        + `PF ${a.grossPF}; DD ${a.maxDrawdownR}R; win ${a.winRate} %; ex-top-1 % ${a.outlierDependence.exTop1Pct}; never reached +1R ${a.shareNeverReached1R} %`,
      artifactPath: ARTIFACT,
      artifactSha256: ARTIFACT_SHA,
    };
  }),
);

export const V25_SOURCE_PINS: readonly SourceFilePin[] = Object.freeze([
  { role: 'PREREGISTRATION', path: 'docs/V2_5_TRAILING_STOP_PREREGISTRATION.md', sha256: '59d322641c3433c175c88b375e33ece728c76fc5eaf60bd8dc1569668790be3b' },
  { role: 'RESULTS_DOC', path: 'docs/V2_5_TRAIN_RESULTS.md', sha256: 'fef68057729ea79a6d345cd0a6f3200521cacf9a2b77cace530758db10996269' },
  { role: 'SPEC', path: 'docs/strategies/V2_5_TRAILING_STOP.md (retrospective archive spec, added at 1f3ae3a; hashed at 2d8a3dd)', sha256: 'b532797829ab2daa8a9e5156263f287b902b22f82e9447db54f24959df0c512e' },
  { role: 'RESEARCH_IMPLEMENTATION', path: 'scripts/real-data/v25-trailing.ts', sha256: 'fe6c307ee53273edcc155e16643bfecade61a6bf3a60296325ef8491460f50fa' },
  { role: 'RUNNER', path: 'scripts/real-data/v25-train.ts', sha256: '83f232cec89a068a7203b1a3807f8f0c00d6ff11f4f481e5f428b1246ac5c3ba' },
  { role: 'ARTIFACT', path: ARTIFACT, sha256: ARTIFACT_SHA },
  { role: 'SETTINGS', path: 'artifacts/research/v2-real-20260915-080338/settings.json', sha256: '92311c4f9a96bc2e6922fc952aacc53ae473ffb22bcb6749b11c2a0cfa0cd3f9' },
  { role: 'SPLITS', path: 'artifacts/research/v2-real-20260915-080338/splits.json', sha256: 'a44eed9ae3ad036853f14845113e392c434081301b21647398a4a3af2ab84f0b' },
]);

export const V25_COMMITS = Object.freeze({
  preregistration: 'aad5be5', trainResult: '07dabbb', historicalPin: '07dabbb',
  frozenEngine: '4839074', dataset: 'c3c1dcecfe2784a147f591f2b5b4526cbf99df9f',
});

export const V25_DISCREPANCIES: readonly SpecResearchDiscrepancy[] = Object.freeze([
  {
    id: 'D-V25-001',
    specStatement: 'Fee label: the task calls the 2 maker / 5 taker headline "FUT_4"; earlier reports (V2.2–V2.4) labelled the identical arithmetic "FUT_7".',
    researchBehaviour: 'V25_FEE_ENVS = GROSS / FUT_4 (2+5) / SPOT (5+5). "FUT_4" here is NOT the 2+2 best case of V2.2–V2.4.',
    impact: 'Archive headline key = FUT_4 of the v25 artifact = 2/5 bps.',
    reproductionPolicy: 'PRESERVE_RESEARCH_BEHAVIOUR',
    evidence: ['scripts/real-data/v25-trailing.ts V25_FEE_ENVS comment'],
  },
  {
    id: 'D-V25-002',
    specStatement: 'Same-entry invariant: arm V25 must be measured on exactly the entries of arm A.',
    researchBehaviour: 'entriesA 30,888 vs entriesV25 30,867 — 21 entries near the TRAIN boundary could not be resolved by the trailing simulator (timeout+64 bars unavailable) and are dropped from V25 only; the source recorded `mismatch = unresolvedV25AtBoundary = 21`, `ok = true`.',
    impact: 'n differs by 21 between arms by construction; not a leak.',
    reproductionPolicy: 'PRESERVE_RESEARCH_BEHAVIOUR',
    evidence: ['artifacts/research/v25/v25-train-metrics.json sameEntryInvariant'],
  },
  {
    id: 'D-V25-003',
    specStatement: 'The criterion is relative ("beats baseline"), not absolute.',
    researchBehaviour: 'PASSED: −0.0786 > −0.1257 net @2/5. Both negative. Gross +0.0457 does not survive removing the top 1 % (−0.0189); 63.61 % of trades never reach +1R and are untouched by the mechanism.',
    impact: 'Source status PROMISING_PENDING_VALIDATION; archive verdict TRAIN_ONLY_NOT_VALIDATED. Not a working strategy per the source verdict.',
    reproductionPolicy: 'PRESERVE_RESEARCH_BEHAVIOUR',
    evidence: ['docs/V2_5_TRAIN_RESULTS.md §1, §7'],
  },
  {
    id: 'D-V25-004',
    specStatement: 'Position slot semantics.',
    researchBehaviour: 'The slot is freed by the FROZEN tracker (48-bar ladder); the trailing arm re-simulates the same entry on a slice up to timeout+64 bars — an exit-only framing. A live trailing engine would free the slot earlier and trade a different set (source verdict).',
    impact: 'V2.5 numbers are an exit-only projection on the frozen entry set.',
    reproductionPolicy: 'PRESERVE_RESEARCH_BEHAVIOUR',
    evidence: ['scripts/real-data/v25-train.ts main loop', 'docs/V2_5_TRAIN_RESULTS.md §7'],
  },
  {
    id: 'D-V25-005',
    specStatement: 'Entries, stops and the baseline outcome come from the frozen V2 engine `4839074`.',
    researchBehaviour: 'evaluateV2 / resolveEntry / executableLadder / trackOutcome unchanged (`src/` byte-identical incl. outcome/tracker.ts).',
    impact: 'Reproduction inside CRYPTORA uses the isolated legacy engine port (`legacy/v2`) plus the verbatim v25 simulator.',
    reproductionPolicy: 'PRESERVE_RESEARCH_BEHAVIOUR',
    evidence: ['docs/V2_5_TRAIN_RESULTS.md pinned table'],
  },
]);

const V25_REPRO = [rV25_train_V25];
export const V25_REPRODUCTION_EVIDENCE: readonly ReproductionEvidence[] = Object.freeze(
  V25_REPRO.map((e) => ({
    slice: `${e.slice}:${e.variantId}`,
    runAtUtc: e.runAtUtc,
    datasetCommit: e.dataset.commit,
    sourceArtifactPath: e.sourceArtifact.path,
    sourceArtifactSha256: e.sourceArtifact.sha256,
    deterministicDigest: e.deterministicDigest,
    tradeCount: e.tradeCount,
    allMatched: e.comparison.allMatched,
    firstMismatch: e.comparison.firstMismatch,
    evidencePath: `src/services/strategyArchive/results/v25/cryptora-reproduction/v25-${e.slice}-${e.variantId}-reproduction.json`,
  })),
);
/** Figures re-derived by CRYPTORA's rerun — stored separately from V25_SOURCE_RESULTS (never merged). */
export const V25_REPRODUCED_RESULTS = Object.freeze({
  origin: 'DERIVED_BY_CRYPTORA' as ResultOrigin,
  scope: 'Headline arm V25 rerun over the full entry universe (n=30,867 closed, 21 boundary entries dropped as in the source); baseline arm A was not rerun separately.',
  runs: Object.fromEntries(V25_REPRO.map((e) => [`${e.slice}:${e.variantId}`, { n: e.metrics.n, grossRPerTrade: e.metrics.grossRPerTrade, feeDragR: e.metrics.feeDragRHeadline, netRPerTrade: e.metrics.netRPerTradeHeadline, netRPerTradeStress: e.metrics.netRPerTradeStress, profitFactor: e.metrics.profitFactor, maxDrawdownR: e.metrics.maxDrawdownR, digest: e.deterministicDigest }])),
});

export const V25_SOURCE_RESULTS = Object.freeze({
  origin: 'SOURCE_REPORTED' as ResultOrigin,
  train: aTrain,
  windows: { train: { fromUtc: '2022-01-01T00:00:00Z', toUtc: '2024-05-26T13:00:00Z' } },
  validation: 'NEVER RUN — programme moved to V2.6; V2.5 superseded as an exit module.',
});

export const V25_CAVEATS_RU: readonly string[] = Object.freeze([
  'Исследование: TRAIN ONLY, НЕ ВАЛИДИРОВАНО. Единственный предзаявленный критерий (нетто > baseline @2/5) ПРОЙДЕН: −0.0786 против −0.1257 R/сделку на тех же 30,867 входах — но результат ПО-ПРЕЖНЕМУ ОТРИЦАТЕЛЕН НЕТТО. Прохождение относительного критерия — не положительный результат.',
  'Gross +0.0457 не переживает удаления топ-1 % сделок (−0.0189); 63.61 % сделок никогда не достигают +1R и механизм их не касается.',
  'Это exit-модуль на замороженном наборе входов: слот позиции освобождает frozen tracker, трейлинг пересимулирован на тех же входах (D-V25-004). Живой трейлинг-движок торговал бы другой набор.',
  'Валидация не проводилась: программа перешла к V2.6 (sniper × trailing), где трейлинг оказался избыточным. Вытеснено.',
  'Входы — замороженный движок V2 `4839074`; четыре таймфрейма в одном пуле. Не сопоставимо с V3.x.',
  'Воспроизводимость в CRYPTORA: REPRODUCED (ветка V25) — перезапуск по всему пулу входов на датасете c3c1dce через изолированный порт замороженного движка V2 (4839074) совпал с артефактом источника по всем сравниваемым полям (n=30 867, gross +0.0457, net −0.0786 @2/5, PF 1.115; digest fnv1a32:eecdce93:n30867). Ветка A отдельно не перезапускалась. Воспроизведён результат, который прошёл критерий, но остался отрицательным нетто и НЕ ВАЛИДИРОВАН.',
  'CRYPTORA не исполняет сделки.',
]);

export const V25_RULES_RU = Object.freeze({
  entry: 'Замороженный движок V2 (4839074): ВСЕ baseline-входы (REVERSAL и CONTINUATION); вход по OPEN бара N+1; один слот позиции (frozen trackOutcome).',
  stop: 'Начальный — структурный стоп frozen-движка (+0.25 ATR).',
  exit: 'V2.5: при MFE ≥ 1.0R стоп переносится в безубыток; далее трейлинг на 1.0R от пика MFE с шагом 0.25R; целей нет; таймаут 10 баров, если +1R не достигнут (закрытие по close); SL приоритетен в неоднозначном баре.',
  fees: 'Headline 2 bps maker вход / 5 bps taker выход (ключ FUT_4 в артефакте V2.5); стресс SPOT 5/5.',
  scope: '15m/30m/1h/4h × 6 символов, TRAIN; 2 ветки A / V25 на одном проходе.',
});

const definition: StrategyDefinition = {
  id: 'V2_5_TRAILING_STOP',
  version: '2.5',
  name: 'Dynamic Trailing Stop + Breakeven (exit module on frozen entries)',
  nameRu: 'Трейлинг-стоп + безубыток',
  verdict: 'TRAIN_ONLY_NOT_VALIDATED',
  reproducibility: 'REPRODUCED',
  reproductionEvidence: V25_REPRODUCTION_EVIDENCE,
    legacyEngineDependency: 'FROZEN_V2_ENGINE_4839074',
  variants: V25_VARIANTS,
  headlineVariantId: 'V25',
  slicesAvailable: ['train'],
  execTimeframe: '15m',
  scopeTimeframes: V25_CONSTANTS.SCOPE,
  structuralTimeframe: null,
  symbols: V25_CONSTANTS.SYMBOLS,
  assumptions: {
    fees: { kind: 'PER_LEG_BPS', makerBps: V25_CONSTANTS.MAKER_BPS, takerBps: V25_CONSTANTS.TAKER_BPS, entryIsMaker: true },
    stressFees: { kind: 'PER_LEG_BPS', makerBps: V25_CONSTANTS.STRESS_MAKER_BPS, takerBps: V25_CONSTANTS.STRESS_TAKER_BPS, entryIsMaker: true },
    feeSemantics: 'NET_AT_FEES',
    slippage: 'NOT_MODELLED', funding: 'NOT_MODELLED', spread: 'NOT_MODELLED',
    positionSizing: 'NONE_R_MULTIPLES_ONLY', marketData: 'BINANCE_SPOT_KLINES', feeVenueAssumed: 'BINANCE_USDT_FUTURES',
  },
  discrepancies: V25_DISCREPANCIES,
  sourcePins: V25_SOURCE_PINS,
  runSeries: runV25Series,
};
export const V25_DEFINITION: StrategyDefinition = Object.freeze(definition);

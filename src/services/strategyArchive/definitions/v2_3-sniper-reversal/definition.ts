/**
 * V2.3 — SNIPER REVERSAL — archived strategy definition (immutable).
 *
 * Source: svechnoy-suslik-v2 @ 2ee06d1 (TRAIN result; pre-registration d78c3cc). Frozen V2 engine 4839074.
 * RESEARCH VERDICT: REJECTED_ON_TRAIN — no arm met the criteria (net > 0 per FILLED and per SETUP under BOTH FUT_4 and FUT_7).
 * Best arm S-cor/S-noguard is net-positive only at FUT_4 (2/2 best case) per trade, and 77 % of its edge sits in 1 % of trades.
 * The sniper filter itself was recorded as the strongest positive signal of the V2.x programme (DD −505.8R → −32.7R).
 * ⚠️ Historical research only. CRYPTORA does not execute trades.
 */

import type {
  ReproductionEvidence, ResultOrigin, SourceFilePin, SpecResearchDiscrepancy, StrategyDefinition, StrategyVariant,
} from '../../types';
import { V23_ARMS } from '../../legacy/v2/research/v23Replay';
import { runV23Series, V23_ARM_IDS } from './v23Runner';
import aTrain from '../../results/v23/v23-train-metrics.json' with { type: 'json' };
import rV23_train_S_cor from '../../results/v23/cryptora-reproduction/v23-train-S-cor-reproduction.json' with { type: 'json' };

const ARTIFACT = 'artifacts/research/v23/v23-train-metrics.json';
const ARTIFACT_SHA = 'd05516a02a0f5176a1c481322ed968154e2072ce8a05c889e63916568ca45f1f';
const ARMS_RU: Record<string, string> = {
  'A': 'Baseline (frozen engine as-is)', 'S-base': 'Sniper-фильтр, frozen цели, вход N+1', 'S-tgt': 'Sniper + лестница 1.5R/2.5R',
  'S-cor': 'Sniper + лестница + corridor entry', 'S-full': 'S-cor + Fee Drag Guard', 'S-noguard': 'S-cor без guard (идентичен S-cor)',
};

export const V23_CONSTANTS = Object.freeze({
  SCOPE: ['15m', '30m', '1h', '4h'] as const,
  SYMBOLS: ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT'] as readonly string[],
  MAKER_BPS: 2, TAKER_BPS: 5, STRESS_MAKER_BPS: 5, STRESS_TAKER_BPS: 5,
  TP1_R: 1.5, TP2_R: 2.5, MIN_BODY_RATIO: 0.35, MIN_RVOL: 1.2, RECLAIM_MAX_BARS: 3,
});

type Arm = { closed: number; grossExpectancyPerFilled: number; grossPF: number | null; maxDrawdownR: number;
  netByFeeEnv: Record<string, { perFilled: number; perSetup: number }>; criterionAllPassed: boolean };

export const V23_VARIANTS: readonly StrategyVariant[] = Object.freeze(
  V23_ARM_IDS.map((id) => {
    const a = (aTrain.arms as Record<string, Arm>)[id]!;
    return {
      id,
      label: ARMS_RU[id] ?? id,
      sourceRole: id === 'A' ? 'BASELINE ANCHOR' : id === 'S-cor' ? 'BEST ARM (still FAILED all four criteria jointly)' : 'ABLATION ARM',
      sourceVerdict: `closed ${a.closed}; gross ${a.grossExpectancyPerFilled} R; net FUT_7 ${a.netByFeeEnv.FUT_7!.perFilled} / FUT_4 ${a.netByFeeEnv.FUT_4!.perFilled} R per trade; `
        + `PF ${a.grossPF}; DD ${a.maxDrawdownR}R; criteria ${a.criterionAllPassed ? 'PASS' : 'FAIL'}`,
      artifactPath: ARTIFACT,
      artifactSha256: ARTIFACT_SHA,
    };
  }),
);

export const V23_SOURCE_PINS: readonly SourceFilePin[] = Object.freeze([
  { role: 'PREREGISTRATION', path: 'docs/V2_3_SNIPER_REVERSAL_PREREGISTRATION.md', sha256: 'f46c8c3e442e136450f2e52d9b335a6a62f9504ffee69abbd42f5a1eb926ad07' },
  { role: 'RESULTS_DOC', path: 'docs/V2_3_TRAIN_RESULTS.md', sha256: '40f37b272af8fe02c5a322cf07983e3bffa25d6fadf235f076150d5cde9148ee' },
  { role: 'SPEC', path: 'docs/strategies/V2_3_SNIPER_REVERSAL.md (retrospective archive spec, added at 1f3ae3a; hashed at 2d8a3dd)', sha256: '9a9d76a43817e245c598439ea123df263a6955fe771480b35585f832f88e63ff' },
  { role: 'RESEARCH_IMPLEMENTATION', path: 'scripts/real-data/v23-engine.ts', sha256: '1abc8f2c5157ce646d13f0a09d74e83ca1eb9e5b5a5fc56324a107fd6fd00564' },
  { role: 'RESEARCH_IMPLEMENTATION', path: 'scripts/real-data/v23-replay.ts', sha256: '2544e9d790424c89e321b91459464c599208bc4779c237dcf5e668b34786a6c8' },
  { role: 'RUNNER', path: 'scripts/real-data/v23-train.ts', sha256: '1e7344ab5bdb24fca97774852c137305124ac206fe3dae0e0817b1a90317960d' },
  { role: 'SHARED_PRIMITIVE', path: 'scripts/real-data/v22-engine.ts (FEE_ENVS, feeRPerLeg)', sha256: 'e6eba37044a079fa694881c45afae16ad35472bb327482f959a89f6600fff3f8' },
  { role: 'SHARED_PRIMITIVE', path: 'scripts/real-data/corridor-entry.ts', sha256: 'c2eebef8af2dea3c92f4a221a6a5a6eb37ed00585385845b16ea83c74bfaf6bf' },
  { role: 'ARTIFACT', path: ARTIFACT, sha256: ARTIFACT_SHA },
  { role: 'SETTINGS', path: 'artifacts/research/v2-real-20260915-080338/settings.json', sha256: '92311c4f9a96bc2e6922fc952aacc53ae473ffb22bcb6749b11c2a0cfa0cd3f9' },
  { role: 'SPLITS', path: 'artifacts/research/v2-real-20260915-080338/splits.json', sha256: 'a44eed9ae3ad036853f14845113e392c434081301b21647398a4a3af2ab84f0b' },
]);

export const V23_COMMITS = Object.freeze({
  preregistration: 'd78c3cc', trainResult: '2ee06d1', historicalPin: '2ee06d1',
  frozenEngine: '4839074', dataset: 'c3c1dcecfe2784a147f591f2b5b4526cbf99df9f',
});

export const V23_DISCREPANCIES: readonly SpecResearchDiscrepancy[] = Object.freeze([
  {
    id: 'D-V23-001',
    specStatement: 'Success = net expectancy > 0 per FILLED trade AND per ACTIONABLE SETUP under FUT_4 (2/2) AND FUT_7 (2/5).',
    researchBehaviour: 'S-cor: FUT_4 +0.0164/fill, +0.0001/setup; FUT_7 −0.0345/fill, −0.0002/setup → 2 of 4 pass. No arm passes all four.',
    impact: 'REJECTED. Per-setup denominators are ~0 because ~333 k actionable setups feed ~1.5 k trades.',
    reproductionPolicy: 'PRESERVE_RESEARCH_BEHAVIOUR',
    evidence: ['artifacts/research/v23/v23-train-metrics.json criterion* fields', 'docs/V2_3_TRAIN_RESULTS.md §1'],
  },
  {
    id: 'D-V23-002',
    specStatement: 'Arm S-full adds the Fee Drag Guard on top of S-cor; S-noguard is its control.',
    researchBehaviour: 'S-noguard is gate-identical to S-cor (same numbers: 1,497 closed, +0.0844). S-full rejects 290 setups by the guard and is WORSE (+0.0577) — the guard is "inert at 15m–4h" in the source verdict.',
    impact: 'Two arms carry one result; the archive keeps both for artifact fidelity.',
    reproductionPolicy: 'PRESERVE_RESEARCH_BEHAVIOUR',
    evidence: ['scripts/real-data/v23-replay.ts V23_ARMS', 'docs/V2_3_TRAIN_RESULTS.md §8'],
  },
  {
    id: 'D-V23-003',
    specStatement: 'Sniper filter condition 1 requires a swept structural extreme (pool kind SWING/EQUAL/CLUSTER).',
    researchBehaviour: '`V2Setup` does not expose the pool list; the replay recomputes it with `extremePoolKind(setup, visibleWindow, settings)` from corridor-entry.ts over the same causal window.',
    impact: 'Pool kind is a research-side recomputation, not an engine field; ported verbatim.',
    reproductionPolicy: 'PRESERVE_RESEARCH_BEHAVIOUR',
    evidence: ['scripts/real-data/v23-engine.ts sniperReversal() doc comment'],
  },
  {
    id: 'D-V23-004',
    specStatement: 'Outlier robustness is reported for the best arm.',
    researchBehaviour: 'S-cor: 77 % of the edge sits in the top 1 % of trades (ex-top-1 % gross ≈ +0.019); S-full ex-top-1 % = −0.003.',
    impact: 'Edge is concentration-dependent; the source recorded this as a reason against progression.',
    reproductionPolicy: 'PRESERVE_RESEARCH_BEHAVIOUR',
    evidence: ['artifacts/research/v23/v23-train-metrics.json arms.*.outlierDependence'],
  },
  {
    id: 'D-V23-005',
    specStatement: 'Entries, stops and outcome resolution come from the frozen V2 engine `4839074`.',
    researchBehaviour: 'replayV23 wraps evaluateV2 / resolveEntry / executableLadder / trackOutcome; only the filter, ladder and corridor differ.',
    impact: 'Reproduction inside CRYPTORA uses the isolated legacy engine port (`legacy/v2`).',
    reproductionPolicy: 'PRESERVE_RESEARCH_BEHAVIOUR',
    evidence: ['scripts/real-data/v23-replay.ts imports'],
  },
]);

const V23_REPRO = [rV23_train_S_cor];
export const V23_REPRODUCTION_EVIDENCE: readonly ReproductionEvidence[] = Object.freeze(
  V23_REPRO.map((e) => ({
    slice: `${e.slice}:${e.variantId}`,
    runAtUtc: e.runAtUtc,
    datasetCommit: e.dataset.commit,
    sourceArtifactPath: e.sourceArtifact.path,
    sourceArtifactSha256: e.sourceArtifact.sha256,
    deterministicDigest: e.deterministicDigest,
    tradeCount: e.tradeCount,
    allMatched: e.comparison.allMatched,
    firstMismatch: e.comparison.firstMismatch,
    evidencePath: `src/services/strategyArchive/results/v23/cryptora-reproduction/v23-${e.slice}-${e.variantId}-reproduction.json`,
  })),
);
/** Figures re-derived by CRYPTORA's rerun — stored separately from V23_SOURCE_RESULTS (never merged). */
export const V23_REPRODUCED_RESULTS = Object.freeze({
  origin: 'DERIVED_BY_CRYPTORA' as ResultOrigin,
  scope: 'Headline arm S-cor rerun (n=1497); the other five arms (A, S-base, S-full, A-cor, S-base-cor) were not rerun.',
  runs: Object.fromEntries(V23_REPRO.map((e) => [`${e.slice}:${e.variantId}`, { n: e.metrics.n, grossRPerTrade: e.metrics.grossRPerTrade, feeDragR: e.metrics.feeDragRHeadline, netRPerTrade: e.metrics.netRPerTradeHeadline, netRPerTradeStress: e.metrics.netRPerTradeStress, profitFactor: e.metrics.profitFactor, maxDrawdownR: e.metrics.maxDrawdownR, digest: e.deterministicDigest }])),
});

export const V23_SOURCE_RESULTS = Object.freeze({
  origin: 'SOURCE_REPORTED' as ResultOrigin,
  train: aTrain,
  windows: { train: { fromUtc: '2022-01-01T00:00:00Z', toUtc: '2024-05-26T13:00:00Z' } },
  validation: 'NEVER RUN — rejected on TRAIN.',
});

export const V23_CAVEATS_RU: readonly string[] = Object.freeze([
  'Исследование: ОТКЛОНЕНО НА TRAIN. Ни одна из шести веток не прошла все четыре критерия (нетто > 0 на сделку И на сетап при FUT_4 2/2 И FUT_7 2/5). Лучшая ветка S-cor: gross +0.0844, нетто @2/5 −0.0345 R/сделку (n=1,497).',
  'Нетто-положительна лучшая ветка только при оптимистичной модели 2/2 bps, только на сделку и только до удаления 15 выбросов: 77 % edge — в 1 % сделок.',
  'Sniper-фильтр отбирает реальное качество (baseline gross взятых +0.2663 против −0.0036 отклонённых; просадка −505.8R → −32.7R) — источник зафиксировал это как самый сильный положительный сигнал V2.x, но не как стратегию.',
  'Лестница R-multiple (1.5R/2.5R) на реверсалах ухудшила результат (S-base +0.0585 → S-tgt +0.0112); corridor entry добавил (+0.0112 → +0.0844); Fee Drag Guard инертен.',
  'Входы — замороженный движок V2 `4839074`; четыре таймфрейма в одном пуле. Валидация не проводилась. Не сопоставимо с V3.x.',
  'Воспроизводимость в CRYPTORA: REPRODUCED (headline-ветка S-cor) — перезапуск на датасете c3c1dce через изолированный порт замороженного движка V2 (4839074) совпал с артефактом источника по всем сравниваемым полям (n=1497, gross +0.0844, net −0.0345 @2/5, PF 1.1294; digest fnv1a32:74082f0a:n1497). Остальные ветки не перезапускались. «Воспроизведено» — только повторяемость чисел; результат остаётся ОТКЛОНЁННЫМ.',
  'CRYPTORA не исполняет сделки.',
]);

export const V23_RULES_RU = Object.freeze({
  entry: 'Замороженный движок V2 (4839074): ТОЛЬКО REVERSAL (continuation отключён); sniper-фильтр: свип SWING/EQUAL/CLUSTER-экстремума, направление, каузальный реклейм ≤ 3 бара, penetration ≥ 0.10 ATR, тень ≥ 0.25, тело ≥ 0.35, RVOL > 1.2. Вход по OPEN N+1 (A/S-base/S-tgt) или corridor ±0.10 ATR (≤ 0.15 %), 3 бара (S-cor/S-full/S-noguard).',
  stop: 'Структурный стоп frozen-движка (+0.25 ATR), сдвинутый на дельту заполнения.',
  targets: 'TP1 = 1.5R; TP2 = min(2.5R, ближайшая противоположная ликвидность за TP1); TP3 = следующая структура за TP2 (arm S-tgt+). A/S-base — frozen цели.',
  timeout: 'Frozen: 48 баров; SL и TP в одном баре → SL.',
  fees: 'Headline FUT_7: вход maker 2 bps, выход taker 5 bps; стресс SPOT 5/5; также GROSS и FUT_4 2/2.',
  scope: '15m/30m/1h/4h × 6 символов, TRAIN; 6 веток A/S-base/S-tgt/S-cor/S-full/S-noguard.',
});

const definition: StrategyDefinition = {
  id: 'V2_3_SNIPER_REVERSAL',
  version: '2.3',
  name: 'Sniper Reversal (reversal-only sniper filter, 1.5R/2.5R ladder, corridor)',
  nameRu: 'Sniper Reversal',
  verdict: 'REJECTED_ON_TRAIN',
  reproducibility: 'REPRODUCED',
  reproductionEvidence: V23_REPRODUCTION_EVIDENCE,
    legacyEngineDependency: 'FROZEN_V2_ENGINE_4839074',
  variants: V23_VARIANTS,
  slicesAvailable: ['train'],
  execTimeframe: '15m',
  scopeTimeframes: V23_CONSTANTS.SCOPE,
  structuralTimeframe: null,
  symbols: V23_CONSTANTS.SYMBOLS,
  assumptions: {
    fees: { kind: 'PER_LEG_BPS', makerBps: V23_CONSTANTS.MAKER_BPS, takerBps: V23_CONSTANTS.TAKER_BPS, entryIsMaker: true },
    stressFees: { kind: 'PER_LEG_BPS', makerBps: V23_CONSTANTS.STRESS_MAKER_BPS, takerBps: V23_CONSTANTS.STRESS_TAKER_BPS, entryIsMaker: true },
    feeSemantics: 'NET_AT_FEES',
    slippage: 'NOT_MODELLED', funding: 'NOT_MODELLED', spread: 'NOT_MODELLED',
    positionSizing: 'NONE_R_MULTIPLES_ONLY', marketData: 'BINANCE_SPOT_KLINES', feeVenueAssumed: 'BINANCE_USDT_FUTURES',
  },
  discrepancies: V23_DISCREPANCIES,
  sourcePins: V23_SOURCE_PINS,
  runSeries: runV23Series,
};
export const V23_DEFINITION: StrategyDefinition = Object.freeze(definition);
export { V23_ARMS };

/**
 * V2.2 — HTF-FOCUSED SPOT/FUTURES ENGINE — archived strategy definition (immutable).
 *
 * Source: svechnoy-suslik-v2 @ 5ce58db (TRAIN result; pre-registration 1b4f09b + Amendment 1 3952061). Frozen V2 engine 4839074.
 * RESEARCH VERDICT: REJECTED_ON_TRAIN — both pre-registered criteria failed (rr1 rejection < 40 % only in TRG/FULL and only
 * because other gates removed ~95 % of setups first; reversal share collapsed 19.89 % → 1.64 % instead of reaching ≥ 10 %).
 * The removed R-multiple TP fallback was the best-performing TP1 basis. No candidate selected; VALIDATION never run.
 * ⚠️ Historical research only. CRYPTORA does not execute trades.
 */

import type {
  ReproductionEvidence, ResultOrigin, SourceFilePin, SpecResearchDiscrepancy, StrategyDefinition, StrategyVariant,
} from '../../types';
import { V22_ARMS } from '../../legacy/v2/research/v22Replay';
import { runV22Series, V22_ARM_IDS } from './v22Runner';
import aTrain from '../../results/v22/v22-train-metrics.json' with { type: 'json' };
import rV22_train_FULL from '../../results/v22/cryptora-reproduction/v22-train-FULL-reproduction.json' with { type: 'json' };

const ARTIFACT = 'artifacts/research/v22/v22-train-metrics.json';
const ARTIFACT_SHA = 'f507ea2f0f07346a7763288c7762937a2d7722994be72dda6a759197d9b8fb8b';
const ARMS_RU: Record<string, string> = {
  A: 'Baseline (frozen engine as-is)', Ahtf: 'Baseline на HTF-scope (идентичен A)', T: 'Структурные цели (без R-multiple fallback)',
  R: 'Подтверждение экстремума V2.2 (body reclaim + RVOL / no-reclaim hold)', TR: 'T + R', TRG: 'T + R + Fee Guard + confluence ≥ 3/4',
  FULL: 'TRG + corridor entry',
};

export const V22_CONSTANTS = Object.freeze({
  SCOPE: ['15m', '30m', '1h', '4h'] as const,
  SYMBOLS: ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT'] as readonly string[],
  MAKER_BPS: 2, TAKER_BPS: 5, STRESS_MAKER_BPS: 5, STRESS_TAKER_BPS: 5,
  REV_MIN_BODY_RATIO: 0.35, REV_MIN_RVOL: 1.2, REV_RECLAIM_MAX_BARS: 3, CONT_MIN_BODY_RATIO: 0.50,
  CRITERION_RR1_REJECTION_MAX_PCT: 40, CRITERION_REVERSAL_SHARE_MIN_PCT: 10,
});

export const V22_VARIANTS: readonly StrategyVariant[] = Object.freeze(
  V22_ARM_IDS.map((id) => {
    const a = (aTrain.arms as Record<string, { closed: number; grossExpectancyPerFilled: number; netByFeeEnv: Record<string, { perFilled: number }>; criterionRr1Under40pct: boolean; criterionReversalAtLeast10pct: boolean }>)[id]!;
    return {
      id,
      label: ARMS_RU[id] ?? id,
      sourceRole: id === 'A' ? 'BASELINE ANCHOR' : id === 'FULL' ? 'FULL PRE-REGISTERED ENGINE' : 'ABLATION ARM',
      sourceVerdict: `closed ${a.closed}; gross ${a.grossExpectancyPerFilled} R; net ${a.netByFeeEnv.FUT_7!.perFilled} R @2/5 (SPOT ${a.netByFeeEnv.SPOT!.perFilled}); `
        + `rr1<40 % ${a.criterionRr1Under40pct ? 'PASS' : 'FAIL'}; reversal≥10 % ${a.criterionReversalAtLeast10pct ? 'PASS' : 'FAIL'}`,
      artifactPath: ARTIFACT,
      artifactSha256: ARTIFACT_SHA,
    };
  }),
);

export const V22_SOURCE_PINS: readonly SourceFilePin[] = Object.freeze([
  { role: 'PREREGISTRATION', path: 'docs/V2_2_HTF_SPOT_ENGINE_PREREGISTRATION.md', sha256: '836a30ea0aeb89447a7d7c32d73663665c05917c21d80ee3af34e6443c32273b' },
  { role: 'PREREGISTRATION', path: 'docs/V2_2_AMENDMENT_1_SCOPE_AND_FEES.md', sha256: '2406ad22bd5b7a6fd16886b878833c4ea1b62504b8cdc99ca144a1b32e96283a' },
  { role: 'RESULTS_DOC', path: 'docs/V2_2_TRAIN_RESULTS.md', sha256: '7adba56dd73809f79c6a6d85eacaca1fae2ab93478bfde54fc7dc935e680132b' },
  { role: 'SPEC', path: 'docs/strategies/V2_2_HTF_SPOT_ENGINE.md (retrospective archive spec, added at 1f3ae3a; hashed at 2d8a3dd)', sha256: '2f88d9daf555afed2abc12e2cc93aeee0cd85ee5209fd4b5538350eb5c604154' },
  { role: 'RESEARCH_IMPLEMENTATION', path: 'scripts/real-data/v22-engine.ts', sha256: 'e6eba37044a079fa694881c45afae16ad35472bb327482f959a89f6600fff3f8' },
  { role: 'RESEARCH_IMPLEMENTATION', path: 'scripts/real-data/v22-replay.ts', sha256: 'e8accd058a99dc64b1e984731b6443887fe93b273a63c069da5e36c0d6fa5921' },
  { role: 'RUNNER', path: 'scripts/real-data/v22-train.ts', sha256: 'b55ef3e79bcd7e91ee6feeb40f7bf994bf16720e98a499033174589f144aa0f1' },
  { role: 'SHARED_PRIMITIVE', path: 'scripts/real-data/corridor-entry.ts', sha256: 'c2eebef8af2dea3c92f4a221a6a5a6eb37ed00585385845b16ea83c74bfaf6bf' },
  { role: 'SHARED_PRIMITIVE', path: 'scripts/real-data/load.ts', sha256: 'ac7f56842fcd07c705099653d26170d350fec8a904160b5fe09ca2cf5b69267b' },
  { role: 'ARTIFACT', path: ARTIFACT, sha256: ARTIFACT_SHA },
  { role: 'SETTINGS', path: 'artifacts/research/v2-real-20260915-080338/settings.json', sha256: '92311c4f9a96bc2e6922fc952aacc53ae473ffb22bcb6749b11c2a0cfa0cd3f9' },
  { role: 'SPLITS', path: 'artifacts/research/v2-real-20260915-080338/splits.json', sha256: 'a44eed9ae3ad036853f14845113e392c434081301b21647398a4a3af2ab84f0b' },
]);

export const V22_COMMITS = Object.freeze({
  preregistration: '1b4f09b', amendment1: '3952061', trainResult: '5ce58db', historicalPin: '5ce58db',
  frozenEngine: '4839074', dataset: 'c3c1dcecfe2784a147f591f2b5b4526cbf99df9f',
});

export const V22_DISCREPANCIES: readonly SpecResearchDiscrepancy[] = Object.freeze([
  {
    id: 'D-V22-001',
    specStatement: 'Original pre-registration scope was the full V2.1 timeframe set; fees were the frozen 0.1 % lump.',
    researchBehaviour: 'Amendment 1 (3952061, before the run) restricted scope to 15m/30m/1h/4h and introduced four per-leg fee environments (GROSS / SPOT 5+5 / FUT_7 2+5 / FUT_4 2+2); FUT_7 is the headline, FUT_4 explicitly "best case, not the headline".',
    impact: 'Archived net figures use FUT_7 (2 maker / 5 taker) as headline and SPOT 5/5 as stress; gross is recovered from the frozen tracker by adding back the 0.1 % lump.',
    reproductionPolicy: 'PRESERVE_RESEARCH_BEHAVIOUR',
    evidence: ['docs/V2_2_AMENDMENT_1_SCOPE_AND_FEES.md', 'scripts/real-data/v22-engine.ts FEE_ENVS'],
  },
  {
    id: 'D-V22-002',
    specStatement: 'Arm `Ahtf` is a distinct ablation step (baseline restricted to HTF scope).',
    researchBehaviour: 'Because Amendment 1 already restricted the WHOLE study to 15m–4h, `A` and `Ahtf` run on identical series and produce identical numbers (30,888 closed, −0.0015 gross).',
    impact: 'Two arms, one result; the archive keeps both so the artifact table stays intact.',
    reproductionPolicy: 'PRESERVE_RESEARCH_BEHAVIOUR',
    evidence: ['artifacts/research/v22/v22-train-metrics.json arms.A vs arms.Ahtf'],
  },
  {
    id: 'D-V22-003',
    specStatement: 'Removing the R-multiple TP fallback should cut rr1 rejections below 40 %.',
    researchBehaviour: 'T arm: rr1 rejection 60.71 % (not < 40 %); gross per filled worsened −0.0015 → −0.0358; the removed fallback (R_MULTIPLE TP1, +0.0449) was the only profitable TP1 basis.',
    impact: 'Criterion 1 failed on its own terms; where it passes (TRG/FULL) it is due to upstream gates, not target placement.',
    reproductionPolicy: 'PRESERVE_RESEARCH_BEHAVIOUR',
    evidence: ['docs/V2_2_TRAIN_RESULTS.md §1, §3'],
  },
  {
    id: 'D-V22-004',
    specStatement: 'Percentile arrays in the source driver use reservoir sampling (`RES = 40000`, Math.random) for riskPct / riskAtr / latency.',
    researchBehaviour: 'Only `riskPct`, `riskAtrMedian` and `fillLatencyBars` are affected; n, gross/net expectancy, PF, DD, exits and all splits are exact. CRYPTORA does not reproduce sampled percentiles.',
    impact: 'Reproduction compares deterministic fields only; sampled percentiles are SOURCE_REPORTED.',
    reproductionPolicy: 'PRESERVE_RESEARCH_BEHAVIOUR',
    evidence: ['scripts/real-data/v22-train.ts `push()`'],
  },
  {
    id: 'D-V22-005',
    specStatement: 'Entries, stops and outcome resolution come from the frozen V2 engine `4839074`.',
    researchBehaviour: 'replayV22 wraps evaluateV2 / resolveEntry / executableLadder / trackOutcome; only the gates and TP1 placement differ.',
    impact: 'Reproduction inside CRYPTORA uses the isolated legacy engine port (`legacy/v2`).',
    reproductionPolicy: 'PRESERVE_RESEARCH_BEHAVIOUR',
    evidence: ['scripts/real-data/v22-replay.ts imports'],
  },
]);

const V22_REPRO = [rV22_train_FULL];
export const V22_REPRODUCTION_EVIDENCE: readonly ReproductionEvidence[] = Object.freeze(
  V22_REPRO.map((e) => ({
    slice: `${e.slice}:${e.variantId}`,
    runAtUtc: e.runAtUtc,
    datasetCommit: e.dataset.commit,
    sourceArtifactPath: e.sourceArtifact.path,
    sourceArtifactSha256: e.sourceArtifact.sha256,
    deterministicDigest: e.deterministicDigest,
    tradeCount: e.tradeCount,
    allMatched: e.comparison.allMatched,
    firstMismatch: e.comparison.firstMismatch,
    evidencePath: `src/services/strategyArchive/results/v22/cryptora-reproduction/v22-${e.slice}-${e.variantId}-reproduction.json`,
  })),
);
/** Figures re-derived by CRYPTORA's rerun — stored separately from V22_SOURCE_RESULTS (never merged). */
export const V22_REPRODUCED_RESULTS = Object.freeze({
  origin: 'DERIVED_BY_CRYPTORA' as ResultOrigin,
  scope: 'Headline arm FULL rerun (n=5323); the other six arms (A, T, R, TRG, S, Λ) share the same replay and were not rerun (D-V22 note: partial rerun of headline only).',
  runs: Object.fromEntries(V22_REPRO.map((e) => [`${e.slice}:${e.variantId}`, { n: e.metrics.n, grossRPerTrade: e.metrics.grossRPerTrade, feeDragR: e.metrics.feeDragRHeadline, netRPerTrade: e.metrics.netRPerTradeHeadline, netRPerTradeStress: e.metrics.netRPerTradeStress, profitFactor: e.metrics.profitFactor, maxDrawdownR: e.metrics.maxDrawdownR, digest: e.deterministicDigest }])),
});

export const V22_SOURCE_RESULTS = Object.freeze({
  origin: 'SOURCE_REPORTED' as ResultOrigin,
  train: aTrain,
  windows: { train: { fromUtc: '2022-01-01T00:00:00Z', toUtc: '2024-05-26T13:00:00Z' } },
  validation: 'NEVER RUN — rejected on TRAIN.',
});

export const V22_CAVEATS_RU: readonly string[] = Object.freeze([
  'Исследование: ОТКЛОНЕНО НА TRAIN. Оба предзаявленных критерия провалены: доля rr1-отказов < 40 % достигнута только в TRG/FULL (10.0 %) и лишь потому, что Fee Guard и confluence убрали ~95 % сетапов раньше; доля реверсалов упала с 19.89 % до 1.64 % вместо ≥ 10 %.',
  'Удалённый R-multiple fallback оказался единственным прибыльным основанием TP1 (+0.0449 gross); без него gross на сделку ухудшился с −0.0015 до −0.0358 (arm T).',
  'Нетто @2/5 bps отрицательно во всех семи ветках: baseline −0.1257, FULL −0.0715 R/сделку (n=5,323). Валидация не проводилась, кандидат не выбран.',
  'Единственная зафиксированная зацепка (не действие): новые гейты реверсала отбирают реверсалы с +0.0785 gross против −0.0270 у frozen-правила, но n=421.',
  'Входы — замороженный движок V2 `4839074`; четыре таймфрейма в одном пуле; scope и комиссии по Amendment 1 (D-V22-001). Не сопоставимо с V3.x.',
  'Воспроизводимость в CRYPTORA: REPRODUCED (headline-ветка FULL) — перезапуск на датасете c3c1dce через изолированный порт замороженного движка V2 (4839074) совпал с артефактом источника по всем сравниваемым полям (n=5323, gross +0.0083, net −0.0715 @2/5, PF 1.0131, exits, bySymbol/byDirection/byTimeframe; digest fnv1a32:1887e6c6:n5323). Остальные шесть веток не перезапускались. «Воспроизведено» означает только повторяемость чисел отрицательного результата.',
  'CRYPTORA не исполняет сделки.',
]);

export const V22_RULES_RU = Object.freeze({
  entry: 'Замороженный движок V2 (4839074): REVERSAL/CONTINUATION сетапы; вход по OPEN бара N+1 (или corridor ±0.10 ATR / ≤ 0.15 %, 3 бара — только FULL); один слот позиции (frozen trackOutcome).',
  confirm: 'REVERSAL: свип + реклейм ≤ 3 бара + penetration ≥ 0.10 ATR + тень ≥ 0.25 + тело ≥ 0.35 + RVOL > 1.2 (без объекта Displacement). CONTINUATION: закрытие ≥ 0.25 ATR за уровнем, тело ≥ 0.50, без немедленного реклейма (holdBars ≥ 1 снят).',
  stop: 'Структурный стоп frozen-движка (+0.25 ATR буфер), сдвинутый на дельту заполнения.',
  targets: 'TP1 = ближайшая противоположная ликвидность (INTERNAL_LIQUIDITY / RANGE_EDGE), иначе EQUILIBRIUM, иначе SKIP; R-multiple fallback удалён (arm T+).',
  timeout: 'Frozen: 48 баров; SL и TP в одном баре → SL.',
  fees: 'Headline FUT_7: вход maker 2 bps, выход taker 5 bps; стресс SPOT 5/5; также GROSS и FUT_4 2/2 в артефакте.',
  scope: '15m/30m/1h/4h × 6 символов, TRAIN; 7 веток абляции A/Ahtf/T/R/TR/TRG/FULL.',
});

const definition: StrategyDefinition = {
  id: 'V2_2_HTF_SPOT_ENGINE',
  version: '2.2',
  name: 'HTF Spot/Futures Engine (structural TP1 + body-reclaim confirmation)',
  nameRu: 'HTF Spot/Futures движок',
  verdict: 'REJECTED_ON_TRAIN',
  reproducibility: 'REPRODUCED',
  reproductionEvidence: V22_REPRODUCTION_EVIDENCE,
    legacyEngineDependency: 'FROZEN_V2_ENGINE_4839074',
  variants: V22_VARIANTS,
  slicesAvailable: ['train'],
  execTimeframe: '15m',
  scopeTimeframes: V22_CONSTANTS.SCOPE,
  structuralTimeframe: null,
  symbols: V22_CONSTANTS.SYMBOLS,
  assumptions: {
    fees: { kind: 'PER_LEG_BPS', makerBps: V22_CONSTANTS.MAKER_BPS, takerBps: V22_CONSTANTS.TAKER_BPS, entryIsMaker: true },
    stressFees: { kind: 'PER_LEG_BPS', makerBps: V22_CONSTANTS.STRESS_MAKER_BPS, takerBps: V22_CONSTANTS.STRESS_TAKER_BPS, entryIsMaker: true },
    feeSemantics: 'NET_AT_FEES',
    slippage: 'NOT_MODELLED', funding: 'NOT_MODELLED', spread: 'NOT_MODELLED',
    positionSizing: 'NONE_R_MULTIPLES_ONLY', marketData: 'BINANCE_SPOT_KLINES', feeVenueAssumed: 'BINANCE_USDT_FUTURES',
  },
  discrepancies: V22_DISCREPANCIES,
  sourcePins: V22_SOURCE_PINS,
  runSeries: runV22Series,
};
export const V22_DEFINITION: StrategyDefinition = Object.freeze(definition);
export { V22_ARMS };

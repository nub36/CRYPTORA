/**
 * V2.7 — TARGET RR OPTIMIZATION — archived strategy definition (immutable).
 *
 * Source: svechnoy-suslik-v2 @ 965fb15 (TRAIN result; pre-registration d9394b1). Frozen V2 engine 4839074. Dataset c3c1dce.
 * RESEARCH VERDICT: REJECTED_ON_TRAIN — no fixed-RR arm is net-positive; fee drag is identical across arms.
 * REPRODUCTION STATUS: see `reproducibility` — entries depend on the frozen V2 engine (sniper filter over
 * 15m/30m/1h/4h); the exit arms are ported here, the engine is ported separately (C6) as an isolated archive dependency.
 * ⚠️ Historical research only. CRYPTORA does not execute trades.
 */

import type {
  ResultOrigin, SourceFilePin, SpecResearchDiscrepancy, StrategyDefinition, StrategyVariant,
} from '../../types';
import { RR_ARMS, V27_CONSTANTS } from './v27Core';
import { runV27Series } from './v27Runner';
import aTrain from '../../results/v27/v27-train-metrics.json' with { type: 'json' };

const ARTIFACT = 'artifacts/research/v27/v27-train-metrics.json';
const ARTIFACT_SHA = '70fd54b51f53a6b7aa90a868d093bd7a488e4268108a5c63fe33eb9e988c939c';

/** Five pre-registered arms on ONE shared 317-entry set. None is a headline: the source found no positive arm. */
export const V27_VARIANTS: readonly StrategyVariant[] = Object.freeze(
  RR_ARMS.map((a) => {
    const arm = aTrain.arms.find((x) => x.arm === a.label)!;
    return {
      id: a.label,
      label: `TP = entry ± ${a.mult.toFixed(1)} × risk`,
      sourceRole: a.label === 'RR40' ? 'LEAST-NEGATIVE ARM (explicitly NOT an optimum per prereg)' : 'PRE-REGISTERED ARM',
      sourceVerdict: `net ${arm.netRPerTrade} R/trade @2/5 (gross ${arm.grossRPerTrade}, fee ${arm.feeRPerTrade}, n=${arm.n}) — NEGATIVE`,
      artifactPath: ARTIFACT,
      artifactSha256: ARTIFACT_SHA,
    };
  }),
);

export const V27_SOURCE_PINS: readonly SourceFilePin[] = Object.freeze([
  { role: 'PREREGISTRATION', path: 'docs/V2_7_RR_OPTIMIZATION_PREREGISTRATION.md', sha256: '4aa3d78d24fa253dbc4344e6f1671333e342328ba9561a96f9db47089605302a' },
  { role: 'RESULTS_DOC', path: 'docs/V2_7_TRAIN_RESULTS.md', sha256: '959c73b70a80832af1dedd09fcb58d996b66aa6d6e0cd2615990fa7daf18160a' },
  { role: 'SPEC', path: 'docs/strategies/V2_7_RR_OPTIMIZATION.md', sha256: 'aa42720a4376c74fcd27e147afe8edd4a91ac4e3acc59a4e46eac7a49ca4e1d7' },
  { role: 'RESEARCH_IMPLEMENTATION', path: 'research/v27_rr_test.ts', sha256: '65a64d2a4eb27ce85a7f3de5e8e52efb53215601806279fee38fee99675dc7fc' },
  { role: 'SHARED_PRIMITIVE', path: 'scripts/real-data/v24-engine.ts', sha256: '6f930e48998bdfbdafd5e7d3e1e07d79307febc3734fca7bc5e44655383edbe3' },
  { role: 'SHARED_PRIMITIVE', path: 'scripts/real-data/corridor-entry.ts', sha256: 'c2eebef8af2dea3c92f4a221a6a5a6eb37ed00585385845b16ea83c74bfaf6bf' },
  { role: 'ARTIFACT', path: ARTIFACT, sha256: ARTIFACT_SHA },
  { role: 'SETTINGS', path: 'artifacts/research/v2-real-20260915-080338/settings.json', sha256: '92311c4f9a96bc2e6922fc952aacc53ae473ffb22bcb6749b11c2a0cfa0cd3f9' },
  { role: 'SPLITS', path: 'artifacts/research/v2-real-20260915-080338/splits.json', sha256: 'a44eed9ae3ad036853f14845113e392c434081301b21647398a4a3af2ab84f0b' },
]);

export const V27_COMMITS = Object.freeze({
  preregistration: 'd9394b1',
  trainResult: '965fb15',
  historicalPin: '965fb15',
  frozenEngine: '4839074',
  dataset: 'c3c1dcecfe2784a147f591f2b5b4526cbf99df9f',
});

export const V27_DISCREPANCIES: readonly SpecResearchDiscrepancy[] = Object.freeze([
  {
    id: 'D-V27-001',
    specStatement: 'Task brief: stop buffer 0.05 ATR.',
    researchBehaviour: 'Frozen 0.25 ATR (`v2.stop_buffer_atr`) kept, because the brief also required "the SAME entries as V2.6" and the stop defines R (prereg §0.1).',
    impact: 'A tighter stop would mechanically inflate fee-in-R; the archived numbers use 0.25 ATR.',
    reproductionPolicy: 'PRESERVE_RESEARCH_BEHAVIOUR',
    evidence: ['artifacts/research/v27/v27-train-metrics.json `stopBufferNote`'],
  },
  {
    id: 'D-V27-002',
    specStatement: 'Task brief: 50-bar horizon.',
    researchBehaviour: 'MAX_BARS = 50 for the RR arms while the frozen tracker (which governs the position slot) times out at 48.',
    impact: 'Applied identically to all arms; logged by the source.',
    reproductionPolicy: 'PRESERVE_RESEARCH_BEHAVIOUR',
    evidence: ['artifacts/research/v27/v27-train-metrics.json `maxBarsNote`'],
  },
  {
    id: 'D-V27-003',
    specStatement: 'Artifact field `best` names RR40.',
    researchBehaviour: '`best` = least-negative arm (−0.0172). Pre-registration: "a peak is only meaningful if positive; least-negative is reported as a failure".',
    impact: 'The archive exposes no headline variant; RR40 must not be presented as an optimum.',
    reproductionPolicy: 'PRESERVE_RESEARCH_BEHAVIOUR',
    evidence: ['docs/V2_7_TRAIN_RESULTS.md §1'],
  },
  {
    id: 'D-V27-004',
    specStatement: 'Entries come from the frozen V2 engine `4839074` (evaluateV2, resolveEntry, executableLadder, trackOutcome slot, sniper filter).',
    researchBehaviour: 'The research file only decides where the TP sits; the entry population (317 sniper entries, 106,994 actionable setups) is produced by the frozen engine over 15m/30m/1h/4h with HTF context.',
    impact: 'Reproduction inside CRYPTORA requires the isolated legacy engine port (C6); until then the status is SOURCE_CHAIN_VERIFIED_NOT_RERUN.',
    reproductionPolicy: 'PRESERVE_RESEARCH_BEHAVIOUR',
    evidence: ['research/v27_rr_test.ts imports'],
  },
]);

export const V27_SOURCE_RESULTS = Object.freeze({
  origin: 'SOURCE_REPORTED' as ResultOrigin,
  train: aTrain,
  windows: { train: { fromUtc: '2022-01-01T00:00:00Z', toUtc: '2024-05-26T13:00:00Z' } },
  validation: 'NEVER RUN — rejected on TRAIN.',
});

export const V27_CAVEATS_RU: readonly string[] = Object.freeze([
  'Исследование: ОТКЛОНЕНО НА TRAIN. Все пять фиксированных целей (1.5R…4.0R) отрицательны нетто @2/5 bps: от −0.0782 (RR15) до −0.0172 (RR40), n=317 sniper-входов; валидация не проводилась.',
  'Гипотеза «большая цель размывает комиссию» арифметически ложна и опровергнута эмпирически: комиссионное трение одинаково для всех целей — 0.1555 R (разброс 0.0000), потому что R задаётся стопом, а не целью.',
  'RR40 — наименее убыточная, а не оптимальная цель (предрегистрация: «наименее отрицательное — это неудача поиска»). Headline-варианта нет.',
  'Входы — sniper-фильтр замороженного движка V2 `4839074` на 15m/30m/1h/4h с общим слотом позиции (frozen tracker); стоп 0.25 ATR, а не 0.05 из задания (D-V27-001).',
  'Не сопоставимо с V3.x: другой движок входов, четыре таймфрейма в одном пуле, горизонт 50 баров.',
  'CRYPTORA не исполняет сделки.',
]);

export const V27_RULES_RU = Object.freeze({
  entry: 'Замороженный движок V2 (4839074): REVERSAL-сетапы, 8-условный sniper-фильтр (свип реального экстремума SWING/EQUAL/CLUSTER, каузальный реклейм ≤ 3 бара, тело ≥ 0.35, RVOL > 1.2 …); вход по OPEN бара N+1; один слот позиции, управляемый frozen trackOutcome.',
  stop: 'Структурный за тенью свипа + 0.25 ATR (frozen).',
  targets: 'Одна фиксированная цель на 100 % позиции: 1.5 / 2.0 / 2.5 / 3.0 / 4.0 × risk; без трейлинга, частичных выходов и безубытка.',
  timeout: '50 баров, закрытие по close; SL и TP в одном баре → SL.',
  fees: 'Вход maker 2 bps, выход taker 5 bps; стресс 5/5.',
  scope: '15m/30m/1h/4h × 6 символов, TRAIN.',
});

const definition: StrategyDefinition = {
  id: 'V2_7_RR_OPTIMIZATION',
  version: '2.7',
  name: 'Target RR Optimisation (fixed 1.5–4.0R)',
  nameRu: 'Оптимизация фиксированной цели RR',
  verdict: 'REJECTED_ON_TRAIN',
  reproducibility: 'SOURCE_CHAIN_VERIFIED_NOT_RERUN',
  reproductionBlockedReason: 'Entry population is produced by the frozen V2 engine 4839074 (15m/30m/1h/4h, HTF context, sniper filter). The exit arms are ported; the engine is ported in C6 as an isolated legacy dependency, after which a rerun is attempted.',
  legacyEngineDependency: 'FROZEN_V2_ENGINE_4839074',
  variants: V27_VARIANTS,
  slicesAvailable: ['train'],
  execTimeframe: '15m',
  scopeTimeframes: V27_CONSTANTS.SCOPE,
  structuralTimeframe: null,
  symbols: V27_CONSTANTS.SYMBOLS,
  assumptions: {
    fees: { kind: 'PER_LEG_BPS', makerBps: V27_CONSTANTS.MAKER_BPS, takerBps: V27_CONSTANTS.TAKER_BPS, entryIsMaker: true },
    stressFees: { kind: 'PER_LEG_BPS', makerBps: V27_CONSTANTS.STRESS_MAKER_BPS, takerBps: V27_CONSTANTS.STRESS_TAKER_BPS, entryIsMaker: true },
    feeSemantics: 'NET_AT_FEES',
    slippage: 'NOT_MODELLED', funding: 'NOT_MODELLED', spread: 'NOT_MODELLED',
    positionSizing: 'NONE_R_MULTIPLES_ONLY', marketData: 'BINANCE_SPOT_KLINES', feeVenueAssumed: 'BINANCE_USDT_FUTURES',
  },
  discrepancies: V27_DISCREPANCIES,
  sourcePins: V27_SOURCE_PINS,
  runSeries: runV27Series,
};
export const V27_DEFINITION: StrategyDefinition = Object.freeze(definition);

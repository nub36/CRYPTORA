/**
 * V2.1a — STRUCTURAL LIMIT ENTRY (models B RETEST / C FVG / D OB∩FVG vs baseline A) — archived definition (immutable).
 *
 * Source: svechnoy-suslik-v2 @ 4b25bbb (TRAIN replay; pre-registration e3750fc, environment-recovery gate 356a874).
 * Frozen V2 engine 4839074 supplies setup, structural stop, target ladder and outcome; V2.1a changes ONLY when/at what
 * price the position is entered (resting limit at a structural anchor, 12-bar expiry, worse-edge fill, MISSED if TP1 first).
 *
 * RESEARCH VERDICT: REJECTED_ON_TRAIN (superseded). No candidate selected; VALIDATION never run. All three models are
 * net-negative at the frozen 0.1 % Spot fee (B −5.3159, C −3.5594, D −0.9386 R per filled trade) and every model is
 * WORSE than baseline A per ORIGINAL actionable setup once fees are charged. Model B's gross +3.53 R is a shrunken-
 * denominator artifact (median stop 0.0657 % of price → fee ≈ 1.9 R). Waiting for a retracement forfeited the winners
 * (MISSED setups had a baseline mean of +0.78 R).
 * ⚠️ Historical research only. CRYPTORA does not execute trades.
 */

import type {
  ResultOrigin, SourceFilePin, SpecResearchDiscrepancy, StrategyDefinition, StrategyVariant,
} from '../../types';
import { runV21aSeries, V21A_MODELS, V21A_SCOPE, V21A_SYMBOLS } from './v21aRunner';
import { EXPIRY_BARS, ZONE_ATR_FRACTION } from '../../legacy/v2/research/limitEntryReplay';
import aTrain from '../../results/v21a/limit-entry-train-metrics.json' with { type: 'json' };
import aGross from '../../results/v21a/limit-entry-train-gross.json' with { type: 'json' };
import aFidelity from '../../results/v21a/model-a-fidelity.json' with { type: 'json' };

const ARTIFACT = 'artifacts/research/limit-entry/limit-entry-train-metrics.json';
const ARTIFACT_SHA = '4769f633672b81fafe0bf4ff90981cb1a602fd3ebaf24894feb0d09a2d57f2d6';
const GROSS_ARTIFACT = 'artifacts/research/limit-entry/limit-entry-train-gross.json';
const GROSS_SHA = '654b72a6f3cc358802bb3c643e5ea83516d796e7c07517c07f2f004f4e84fcd0';

export const V21A_CONSTANTS = Object.freeze({
  SCOPE: V21A_SCOPE, SYMBOLS: V21A_SYMBOLS,
  EXPIRY_BARS, ZONE_ATR_FRACTION,
  /** Source fee model: frozen 0.1 % lump per trade (Binance Spot round trip), no maker discount. */
  FROZEN_FEE_PCT: 0.1,
  /** Archive per-leg context columns (derived, see D-V21A-003). */
  HEADLINE_MAKER_BPS: 5, HEADLINE_TAKER_BPS: 5, STRESS_MAKER_BPS: 2, STRESS_TAKER_BPS: 5,
  PRIMARY_METRIC: 'gross expectancy per ORIGINAL actionable setup (pre-registered)',
});

type Model = { actionableSetups: number; pendingCreated: number; closed: number; fillRate: number;
  grossExpectancyPerFilled: number; grossExpectancyPerActionableSetup: number; grossPF: number; maxDrawdownR: number;
  netExpectancyPerFilled: Record<string, number>; riskPct: { median: number }; missed: { n: number } };
type Gross = { n: number; grossExp: number; grossPF: number; netExpFrozen: number; medFeeR: number };
const MODEL_RU: Record<string, string> = {
  A: 'A — baseline: рыночный вход по OPEN N+1 (frozen)',
  B: 'B — RETEST: лимит у пробитого уровня ± 0.25 ATR',
  C: 'C — FVG: лимит у проксимального края незаполненного FVG',
  D: 'D — OB∩FVG: лимит в середине пересечения (иначе OB)',
};

export const V21A_VARIANTS: readonly StrategyVariant[] = Object.freeze(
  (['A', ...V21A_MODELS] as const).map((id) => {
    const m = (aTrain.models as Record<string, Model>)[id]!;
    const g = (aGross as Record<string, Gross>)[id]!;
    const role = id === 'A' ? 'BASELINE ANCHOR (frozen windowed-replay; SOURCE_REPORTED, not rerun by CRYPTORA)'
      : 'PRE-REGISTERED CANDIDATE — not selected';
    return {
      id, label: MODEL_RU[id] ?? id, sourceRole: role,
      sourceVerdict: `closed ${m.closed}; fill ${m.fillRate.toFixed(2)} %; GROSS ${g.grossExp.toFixed(4)} R/filled (${m.grossExpectancyPerActionableSetup} R/setup, PF ${g.grossPF.toFixed(4)}); `
        + `NET @0.1 % lump ${g.netExpFrozen.toFixed(4)} R (median fee ${g.medFeeR.toFixed(4)} R); median stop ${m.riskPct.median} %; missed ${m.missed.n}`,
      artifactPath: ARTIFACT, artifactSha256: ARTIFACT_SHA,
    };
  }),
);

export const V21A_SOURCE_PINS: readonly SourceFilePin[] = Object.freeze([
  { role: 'PREREGISTRATION', path: 'docs/V2_1_LIMIT_ENTRY_PREREGISTRATION.md', sha256: '81320d3f1a28dc3418e006638b7ea4c08f33adf2a49862f1f86c6e5d3046bee4' },
  { role: 'DESIGN', path: 'docs/V2_1_STRUCTURAL_LIMIT_ENTRY_DESIGN.md', sha256: 'b5e9534f4013cc2c0bebc4c93cfa493fe931675999371762e20ab5164e60dfbd' },
  { role: 'RESULTS_DOC', path: 'docs/V2_1_LIMIT_ENTRY_TRAIN_RESULTS.md', sha256: '053f70119524b8eed7d52e66ed9248cdbf2ad5b990160ba28fbdb2cf64a8514d' },
  { role: 'SPEC', path: 'docs/strategies/V2_1_CORRIDOR_ENTRY.md (retrospective archive spec covering V2.1a+V2.1b, added at 1f3ae3a; hashed at 2d8a3dd)', sha256: '0339e98ea35c544b068f1bedafb5ebcadfeab0f19c51b85dd9b086919845f141' },
  { role: 'RESEARCH_IMPLEMENTATION', path: 'scripts/real-data/limit-entry-replay.ts', sha256: '937dea115d74d2917b3a6add10aaa6919713471728280dceb918d987362fa3f3' },
  { role: 'RUNNER', path: 'scripts/real-data/limit-entry-train.ts', sha256: 'f92430b118357fbbacfa80805213dd52dbb1bf93667e513c3d3b8f457d79b711' },
  { role: 'BASELINE_RUNNER', path: 'scripts/real-data/windowed-replay.ts (model A — not ported)', sha256: '8b0307591318022f35760a36721b9a0f3f964845ea92e3f485cfca998e9778f5' },
  { role: 'ARTIFACT', path: ARTIFACT, sha256: ARTIFACT_SHA },
  { role: 'ARTIFACT', path: GROSS_ARTIFACT, sha256: GROSS_SHA },
  { role: 'ARTIFACT', path: 'artifacts/research/limit-entry/model-a-fidelity.json', sha256: '4fab86879a15feddde782bd3cd253384eb7568ac4c466e495e93ba4f6cddaa67' },
  { role: 'ARTIFACT', path: 'artifacts/research/limit-entry/train-structural-audit.json', sha256: '77c4551a7a08201510d89bda792a30531fc22c46b7b41cff3a95268df9bd9d55' },
  { role: 'SETTINGS', path: 'artifacts/research/v2-real-20260915-080338/settings.json', sha256: '92311c4f9a96bc2e6922fc952aacc53ae473ffb22bcb6749b11c2a0cfa0cd3f9' },
  { role: 'SPLITS', path: 'artifacts/research/v2-real-20260915-080338/splits.json', sha256: 'a44eed9ae3ad036853f14845113e392c434081301b21647398a4a3af2ab84f0b' },
]);

export const V21A_COMMITS = Object.freeze({
  preregistration: 'e3750fc', environmentRecovery: '356a874', trainResult: '4b25bbb', historicalPin: '4b25bbb',
  frozenEngine: '4839074', dataset: 'c3c1dcecfe2784a147f591f2b5b4526cbf99df9f',
});

export const V21A_DISCREPANCIES: readonly SpecResearchDiscrepancy[] = Object.freeze([
  {
    id: 'D-V21A-001',
    specStatement: 'Pre-registration: `expectancy per ORIGINAL actionable setup` is the primary metric.',
    researchBehaviour: 'Per-filled gross for B (+3.5281) / C (+0.6941) / D (+0.4325) exceeds A (+0.0350), but per-setup gross is +0.3510 / +0.0779 / +0.0335 and per-filled NET at the frozen fee is −5.3159 / −3.5594 / −0.9386. Fill rates 12.98 % / 25.49 % / 21.39 %.',
    impact: 'Any presentation of B/C/D gross per filled trade without the per-setup and net columns is selection bias. The archive stores all three columns.',
    reproductionPolicy: 'PRESERVE_RESEARCH_BEHAVIOUR',
    evidence: ['docs/V2_1_LIMIT_ENTRY_TRAIN_RESULTS.md §4–§5', 'limit-entry-train-metrics.json models.*'],
  },
  {
    id: 'D-V21A-002',
    specStatement: '`trackOutcome` stores an R already net of the frozen 0.1 % lump fee.',
    researchBehaviour: 'Gross is reconstructed as storedR + 0.001 × entry / riskPerUnit. Limit fills move the entry toward the stop, shrink riskPerUnit and inflate fee-in-R (model B median fee 1.9376 R).',
    impact: 'The gross vs net ranking is exactly inverted (B best gross, worst net). Stop-distance columns are essential context.',
    reproductionPolicy: 'PRESERVE_RESEARCH_BEHAVIOUR',
    evidence: ['docs/V2_1_LIMIT_ENTRY_TRAIN_RESULTS.md §2, §6'],
  },
  {
    id: 'D-V21A-003',
    specStatement: 'Archive convention: per-leg fee columns (maker entry / taker exits).',
    researchBehaviour: 'V2.1a reported NET at a 0.1 % lump of ENTRY notional and a round-trip bps sensitivity on mean(entry/risk); no per-leg model existed yet (introduced in V2.2 Amendment 1).',
    impact: 'CRYPTORA per-leg columns (SPOT 5/5 headline; FUT_7 2/5 stress) are derived context and are NOT byte-equal to the source net figures; reproduction compares gross, counts, funnel and distributions. Net numbers of V2.1a are NOT comparable with V2.2+ net@2/5 nor with V3.x.',
    reproductionPolicy: 'PRESERVE_RESEARCH_BEHAVIOUR',
    evidence: ['scripts/real-data/limit-entry-train.ts BPS/invSum', 'docs/V2_2_HTF_SPOT_ENGINE_PREREGISTRATION.md Amendment 1'],
  },
  {
    id: 'D-V21A-004',
    specStatement: 'Model A is the frozen baseline reproduced by the existing harness.',
    researchBehaviour: 'Model A comes from `windowed-replay.ts` (not ported); the source re-ran it after an environment loss and matched the frozen baseline exactly (model-a-fidelity.json PASS, 42/42 series).',
    impact: 'In CRYPTORA model A is SOURCE_REPORTED only; the runner refuses variant A. B/C/D are rerunnable through the legacy engine port.',
    reproductionPolicy: 'PRESERVE_RESEARCH_BEHAVIOUR',
    evidence: ['artifacts/research/limit-entry/model-a-fidelity.json'],
  },
  {
    id: 'D-V21A-006',
    specStatement: 'limit-entry-train-metrics.json fields `grossExpectancyPerFilled`, `grossPF`, `grossMedianR`, `maxDrawdownR`, `positiveRRate`, by* expectancies.',
    researchBehaviour: 'Those fields aggregate the STORED R (already net of the frozen 0.1 % lump): A −0.7289 = gross.json netExpFrozen; B −5.3159 idem. The true GROSS aggregates were written separately to limit-entry-train-gross.json (A +0.0350, B +3.5281, C +0.6941, D +0.4325) and used by the results doc.',
    impact: 'Field names in the metrics artifact are misleading; the archive reads gross figures from the gross artifact and treats the metrics artifact as the NET(0.1 % lump)/funnel source. Any rerun comparison uses gross.json for gross/PF/DD/median/posRate.',
    reproductionPolicy: 'PRESERVE_RESEARCH_BEHAVIOUR',
    evidence: ['artifacts/research/limit-entry/limit-entry-train-metrics.json vs limit-entry-train-gross.json', 'docs/V2_1_LIMIT_ENTRY_TRAIN_RESULTS.md §2, §4–§5'],
  },
  {
    id: 'D-V21A-005',
    specStatement: 'Scope of the study.',
    researchBehaviour: 'All 42 frozen splits — 1m/5m/15m/30m/1h/4h/1d × 6 symbols — pooled; 1m dominates every count (A: 246,692 of 328,872 closed).',
    impact: 'Pooled figures are driven by 1m/5m economics; the later programme (V2.2+) restricted scope to 15m…4h after the timeframe×cost diagnostic (V2.1b, dccf751). Not comparable with V2.2+ or V3.x.',
    reproductionPolicy: 'PRESERVE_RESEARCH_BEHAVIOUR',
    evidence: ['limit-entry-train-metrics.json models.*.byTimeframe'],
  },
]);

export const V21A_SOURCE_RESULTS = Object.freeze({
  origin: 'SOURCE_REPORTED' as ResultOrigin,
  train: aTrain,
  trainGross: aGross,
  modelAFidelity: aFidelity,
  feeSemantics: 'NET_AT_FROZEN_0_1PCT_LUMP + GROSS reconstructed; bps sensitivity 2/5/10/20 round-trip',
  windows: { train: { fromUtc: '2022-01-01T00:00:00Z', toUtc: '2024-05-26T13:00:00Z (per-series boundaries from frozen splits.json)' } },
  validation: 'NEVER RUN — no candidate selected on TRAIN.',
});

export const V21A_CAVEATS_RU: readonly string[] = Object.freeze([
  'Исследование: ОТКЛОНЕНО НА TRAIN (superseded). Кандидат не выбран, валидация не проводилась. Все три лимитные модели нетто-отрицательны при замороженной комиссии 0.1 %: B −5.3159, C −3.5594, D −0.9386 R на сделку (baseline A −0.7289).',
  'Gross-«успех» модели B (+3.53 R на сделку) — артефакт сжатого знаменателя: лимит ставит вход ближе к стопу (медианный стоп 0.0657 % цены), поэтому комиссия в R достигает ≈1.9 R. Ранжирование gross и net инвертировано ровно наоборот (D-V21A-002).',
  'Первичная предзаявленная метрика — gross на ИСХОДНЫЙ actionable-сетап: B +0.3510, C +0.0779, D +0.0335 против A +0.0350; при этом fill rate 12.98 % / 25.49 % / 21.39 %, а пропущенные сетапы (MISSED) имели baseline-среднее +0.78 R — ожидание отката отдаёт победителей (D-V21A-001).',
  'Комиссионная модель источника — единый lump 0.1 % от notional входа (Spot round-trip) без maker-скидки; per-leg колонки CRYPTORA (SPOT 5/5, FUT_7 2/5) — производный контекст, не равный числам источника и НЕ сопоставимый с net@2/5 версий V2.2+ и V3.x (D-V21A-003).',
  'Область: все 42 ряда 1m…1d × 6 символов в одном пуле; итог определяется экономикой 1m/5m. Позже программа сузила область до 15m…4h (V2.1b, диагностика таймфрейм × стоимость).',
  'Артефакт limit-entry-train-metrics.json под «gross»-именами хранит уже нетто-R (после lump 0.1 %); истинные gross-агрегаты — в limit-entry-train-gross.json (D-V21A-006). Архив читает gross оттуда.',
  'Модель A (baseline) — frozen windowed-replay, в CRYPTORA НЕ перезапускается (SOURCE_REPORTED; fidelity-гейт источника PASS 42/42). Модели B/C/D перезапускаемы через изолированный порт движка V2.',
  'CRYPTORA не исполняет сделки.',
]);

export const V21A_RULES_RU = Object.freeze({
  entry: 'Сетап — замороженный движок V2 (4839074) на закрытом баре N. Вместо рыночного входа по OPEN N+1 выставляется лимит в структурной зоне: B — пробитый уровень ± 0.25 ATR (проксимальный край); C — незаполненный FVG (проксимальный край); D — середина OB∩FVG, иначе OB. halfWidth = clamp(0.05·ATR, 1 тик, area/2); зона целиком на стороне отката, иначе ордер не создаётся.',
  fill: 'Заполнение только при проходе свечи СКВОЗЬ зону, по дальнему (худшему) краю; экспирация 12 баров; пробой структурного стопа до заполнения → CANCELLED; достижение frozen TP1 до заполнения → MISSED (не догоняем); одна свеча и fill, и SL → CANCELLED (неблагоприятное чтение).',
  stop: 'Структурный стоп frozen-движка (+0.25 ATR); НЕ сдвигается к лимитной цене; после заполнения rr1 пересчитывается, при rr1 < risk.min_rr сделка отклоняется (REJECTED_GEOMETRY).',
  exit: 'Frozen SMC-лестница целей (закрывает только последняя ступень), таймаут 48 баров, SL-приоритет на неоднозначном баре. Одна позиция одновременно.',
  fees: 'Источник: lump 0.1 % notional входа; чувствительность 2/5/10/20 bps round-trip. Архив: SPOT 5/5 per-leg (контекст), FUT_7 2/5 (стресс).',
  scope: '1m/5m/15m/30m/1h/4h/1d × BTC/ETH/BNB/SOL/XRP/DOGE, TRAIN, границы из frozen splits.json.',
});

const definition: StrategyDefinition = {
  id: 'V2_1A_STRUCTURAL_LIMIT_ENTRY',
  version: '2.1a',
  name: 'Structural Limit Entry (models B/C/D vs frozen OPEN N+1)',
  nameRu: 'Структурный лимитный вход',
  verdict: 'REJECTED_ON_TRAIN',
  reproducibility: 'SOURCE_CHAIN_VERIFIED_NOT_RERUN',
  reproductionBlockedReason: 'Runner ported over the isolated legacy V2 engine (models B/C/D); the 42-series rerun (1m…1d, ~1.2–1.8 M actionable setups per model) was not executed. Chain prereg e3750fc → implementation hash → artifact hash verified at 4b25bbb (identical at 2d8a3dd). Model A is SOURCE_REPORTED (windowed-replay not ported).',
  legacyEngineDependency: 'FROZEN_V2_ENGINE_4839074',
  variants: V21A_VARIANTS,
  // No headline: the source selected NO candidate.
  slicesAvailable: ['train'],
  execTimeframe: '1m',
  scopeTimeframes: V21A_CONSTANTS.SCOPE,
  structuralTimeframe: null,
  symbols: V21A_CONSTANTS.SYMBOLS,
  assumptions: {
    fees: { kind: 'PER_LEG_BPS', makerBps: V21A_CONSTANTS.HEADLINE_MAKER_BPS, takerBps: V21A_CONSTANTS.HEADLINE_TAKER_BPS, entryIsMaker: true },
    stressFees: { kind: 'PER_LEG_BPS', makerBps: V21A_CONSTANTS.STRESS_MAKER_BPS, takerBps: V21A_CONSTANTS.STRESS_TAKER_BPS, entryIsMaker: true },
    feeSemantics: 'NET_AT_FEES',
    slippage: 'NOT_MODELLED', funding: 'NOT_MODELLED', spread: 'NOT_MODELLED',
    positionSizing: 'NONE_R_MULTIPLES_ONLY', marketData: 'BINANCE_SPOT_KLINES', feeVenueAssumed: 'BINANCE_USDT_FUTURES',
  },
  discrepancies: V21A_DISCREPANCIES,
  sourcePins: V21A_SOURCE_PINS,
  runSeries: runV21aSeries,
};
export const V21A_DEFINITION: StrategyDefinition = Object.freeze(definition);

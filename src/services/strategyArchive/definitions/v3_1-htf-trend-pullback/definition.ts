/**
 * V3.1 — HTF TREND PULLBACK & MITIGATION — archived strategy definition (immutable).
 *
 * Source: svechnoy-suslik-v2 @ 292050c6c3f32807a85548e037f674d42a2efb18 (TRAIN result commit)
 * Pre-registration: 760b15f + Amendment 1. Dataset: c3c1dce.
 *
 * RESEARCH VERDICT: FALSIFIED_ON_TRAIN — a NEGATIVE historical result, archived on purpose.
 * REPRODUCTION STATUS is a separate axis (see `reproducibility`) and never implies success.
 * ⚠️ Historical research only. CRYPTORA does not execute trades.
 */

import type {
  ReproductionEvidence, ResultOrigin, SourceFilePin, SpecResearchDiscrepancy, StrategyDefinition, StrategyVariant,
} from '../../types';
import { V31_CONSTANTS } from './v31Core';
import { runV31Series } from './v31Runner';
import trainPrimary from '../../results/v31/v31-train-metrics.json' with { type: 'json' };
import trainSameBar from '../../results/v31/v31-train-metrics-samebar.json' with { type: 'json' };
import reproPrimary from '../../results/v31/cryptora-reproduction/v31-train-leg-reproduction.json' with { type: 'json' };
import reproSameBar from '../../results/v31/cryptora-reproduction/v31-train-same-bar-reproduction.json' with { type: 'json' };

export const V31_SOURCE_PINS: readonly SourceFilePin[] = Object.freeze([
  { role: 'PREREGISTRATION', path: 'docs/V3_1_HTF_TREND_PULLBACK_PREREGISTRATION.md', sha256: 'd3fe972cfe8ec7fe0f0f34a34138f53bb40e3038c61c4cb5ba9634f56be78218' },
  { role: 'PREREGISTRATION', path: 'docs/V3_1_HTF_TREND_PULLBACK_PREREGISTRATION_AMENDMENT_1.md', sha256: '060d729a7b92faeab4cb8ffe4dc6c345435a016d7cd052008b7ed05e33527a8a' },
  { role: 'RESULTS_DOC', path: 'docs/V3_1_HTF_TREND_PULLBACK_TRAIN_RESULTS.md', sha256: '3bd97c7945a46d27792a8ab54189c193a206244ce426fc2dab100d1bb735cb69' },
  { role: 'RESEARCH_IMPLEMENTATION', path: 'research/v31_trend_pullback.ts', sha256: '1f18bb3ce45bbc94d79f48181fde7ad9550731e5c031ac0bd54662b6804a3bc7' },
  { role: 'SHARED_PRIMITIVE', path: 'src/strategy/v2/structure.ts', sha256: 'e04806a33d1ebc4bab24f12f5240c7320ae8e00276157833e51534152a4e662f' },
  { role: 'SHARED_PRIMITIVE', path: 'src/strategy/v2/indicators.ts', sha256: '10594cadf615b0e048797e1db9504648794b0cbec41b62da6ec55641d1daa55c' },
  { role: 'ARTIFACT', path: 'artifacts/research/v31/v31-train-metrics.json', sha256: '1ae41fd6912c07f68d1701809f8ff842af45dbb4a9fcdcd238967af1d81f258e' },
  { role: 'ARTIFACT', path: 'artifacts/research/v31/v31-train-metrics-samebar.json', sha256: 'be2a853826ca60a3ca98e15d0692f39d04a4c0482b0fa7aaed3174458473f3c1' },
  { role: 'SETTINGS', path: 'artifacts/research/v2-real-20260915-080338/settings.json', sha256: '92311c4f9a96bc2e6922fc952aacc53ae473ffb22bcb6749b11c2a0cfa0cd3f9' },
  { role: 'SPLITS', path: 'artifacts/research/v2-real-20260915-080338/splits.json', sha256: 'a44eed9ae3ad036853f14845113e392c434081301b21647398a4a3af2ab84f0b' },
]);

export const V31_COMMITS = Object.freeze({
  preregistration: '760b15f',
  trainResult: '292050c6c3f32807a85548e037f674d42a2efb18',
  historicalPin: '292050c6c3f32807a85548e037f674d42a2efb18',
  dataset: 'c3c1dcecfe2784a147f591f2b5b4526cbf99df9f',
});

export const V31_VARIANTS: readonly StrategyVariant[] = Object.freeze([
  {
    id: 'leg', label: 'pullback=leg (Amendment 1)', sourceRole: 'PRIMARY',
    sourceVerdict: 'F1 FALSIFIED (net −0.1097 @2/5 bps, n=158; gross −0.0838); F2 holds; F3 holds',
    artifactPath: 'artifacts/research/v31/v31-train-metrics.json',
    artifactSha256: '1ae41fd6912c07f68d1701809f8ff842af45dbb4a9fcdcd238967af1d81f258e',
  },
  {
    id: 'same-bar', label: 'pullback=same-bar (original §2.3(4))', sourceRole: 'SECONDARY',
    sourceVerdict: 'F1 + F3 FALSIFIED (net −0.2819, n=82, underpowered)',
    artifactPath: 'artifacts/research/v31/v31-train-metrics-samebar.json',
    artifactSha256: 'be2a853826ca60a3ca98e15d0692f39d04a4c0482b0fa7aaed3174458473f3c1',
  },
]);

export const V31_DISCREPANCIES: readonly SpecResearchDiscrepancy[] = Object.freeze([
  {
    id: 'D-V31-001',
    specStatement: 'Pre-registration inherits V3.0 execution conventions (which state one position at a time).',
    researchBehaviour: 'research/v31_trend_pullback.ts resolves a fill by walking bars ahead and continues scanning from the fill bar with `pend = null` — overlapping trades on one symbol are possible (same pattern as D-V30-001).',
    impact: 'Trade count may be inflated relative to a strictly sequential engine; per-trade R unaffected in expectation. Verdict (net negative) is not changed by this.',
    reproductionPolicy: 'PRESERVE_RESEARCH_BEHAVIOUR',
    evidence: ['research/v31_trend_pullback.ts `main()` pending/fill block'],
  },
  {
    id: 'D-V31-002',
    specStatement: 'First artifact run (pre-fix) reported primary net −0.0762 R/trade.',
    researchBehaviour: 'A TP1 double-booking bug on the "TP2 after TP1" path was found by the R1..R5 unit tests; module fixed and both artifacts regenerated (net −0.1097). Source discloses both numbers (TRAIN_RESULTS §4).',
    impact: 'Archived figures are the CORRECTED ones; the pre-fix figures were never the record. Not a look-ahead issue.',
    reproductionPolicy: 'PRESERVE_RESEARCH_BEHAVIOUR',
    evidence: ['docs/V3_1_HTF_TREND_PULLBACK_TRAIN_RESULTS.md §4 Correction disclosure'],
  },
  {
    id: 'D-V31-003',
    specStatement: 'Fee model "realistic Binance futures fees (2/5 bps)".',
    researchBehaviour: 'Binance SPOT klines with a futures fee grid; funding/spread/slippage not modelled (inherited from the V3.0 harness).',
    impact: 'Spot-price simulation with a futures fee assumption.',
    reproductionPolicy: 'PRESERVE_RESEARCH_BEHAVIOUR',
    evidence: ['artifacts/research/v2-real-20260915-080338/dataset-manifest.json → provenance'],
  },
]);

export const V31_SOURCE_RESULTS = Object.freeze({
  origin: 'SOURCE_REPORTED' as ResultOrigin,
  train: { leg: trainPrimary, 'same-bar': trainSameBar },
  windows: { train: { fromUtc: '2022-01-01T00:00:00Z', toUtc: '2024-05-26T13:00:00Z' } },
  validation: 'NEVER RUN — F1 falsified on TRAIN; no unseen data was spent.',
});

export const V31_REPRODUCTION_EVIDENCE: readonly ReproductionEvidence[] = Object.freeze(
  [reproPrimary, reproSameBar].map((e) => ({
    slice: `${e.slice}:${e.variantId}`,
    runAtUtc: e.runAtUtc,
    datasetCommit: e.dataset.commit,
    sourceArtifactPath: e.sourceArtifact.path,
    sourceArtifactSha256: e.sourceArtifact.sha256,
    deterministicDigest: e.deterministicDigest,
    tradeCount: e.tradeCount,
    allMatched: e.comparison.allMatched,
    firstMismatch: e.comparison.firstMismatch,
    evidencePath: `src/services/strategyArchive/results/v31/cryptora-reproduction/v31-train-${e.variantId}-reproduction.json`,
  })),
);
export const V31_REPRODUCED_RESULTS = Object.freeze({
  origin: 'DERIVED_BY_CRYPTORA' as ResultOrigin,
  train: { leg: reproPrimary, 'same-bar': reproSameBar },
});

export const V31_CAVEATS_RU: readonly string[] = Object.freeze([
  'Исследование: ФАЛЬСИФИЦИРОВАНО НА TRAIN (F1: net −0.1097 R/сделку @2/5 bps, n=158; gross уже отрицателен −0.0838). Валидация не проводилась.',
  'Механизм широкого стопа сработал (fee drag 0.0258 R — минимальный в программе), но геометрия выплат (медианный TP1 0.64 R против стопа 1 R) не окупает его.',
  'Вторичный вариант same-bar: n=82 (недостаточная мощность), net −0.2819; F1 и F3 фальсифицированы.',
  'Первый прогон содержал баг двойного учёта TP1; исправленные цифры хуже (−0.0762 → −0.1097) — раскрыто источником (D-V31-002).',
  'Раннер допускал перекрывающиеся позиции (D-V31-001), как и V3.0.',
  'Не сопоставимо напрямую с V3.0: другая гипотеза (продолжение тренда vs разворот), TIMEOUT 60 vs 50 баров, другой TP2.',
  'Отрицательный результат сохранён намеренно: архив доказывает и причины отказа. «Воспроизведено» означает повторяемость чисел, а не пригодность стратегии.',
  'CRYPTORA не исполняет сделки.',
]);

export const V31_RULES_RU = Object.freeze({
  entry: '4H-тренд: close > EMA50 > EMA200 (или зеркально) + причинные HH/HL по подтверждённым свингам (strength 3); откат в 50 % активного импульса или в свежий 4H FVG (внутри текущего отката — Amendment 1); 1H-свеча возобновления: тело ≥ 0.35, RVOL > 1.25, закрытие за предыдущим 1H-свингом в направлении тренда. Лимитный коридор close ± 0.10 ATR(14), исполнение с N+1, срок 3 бара.',
  stop: 'За экстремумом отката ± 0.15 ATR(1H, 14).',
  targets: 'TP1 = экстремум импульса (50 %) → безубыток; TP2 = 1.5 Fib-расширение импульса.',
  timeout: '60 баров 1H, свеча входа считается первой.',
  intrabar: 'R1–R5 как в V3.0 (стоп раньше целей; TP1 раньше TP2; BE после бара TP1; стоп не двигается назад).',
  fees: 'Вход maker 2 bps, выходы taker 5 bps; стресс 5/5.',
});

const definition: StrategyDefinition = {
  id: 'V3_1_HTF_TREND_PULLBACK',
  version: '3.1',
  name: 'HTF Trend Pullback & Mitigation',
  nameRu: 'Откат в тренде старшего таймфрейма и митигация',
  verdict: 'FALSIFIED_ON_TRAIN',
  reproducibility: 'REPRODUCED',
  reproductionEvidence: V31_REPRODUCTION_EVIDENCE,
  variants: V31_VARIANTS,
  headlineVariantId: 'leg',
  slicesAvailable: ['train'],
  execTimeframe: V31_CONSTANTS.EXEC_TF,
  structuralTimeframe: V31_CONSTANTS.STRUCT_TF,
  symbols: V31_CONSTANTS.SYMBOLS,
  assumptions: {
    fees: { kind: 'PER_LEG_BPS', makerBps: V31_CONSTANTS.MAKER_BPS, takerBps: V31_CONSTANTS.TAKER_BPS, entryIsMaker: true },
    stressFees: { kind: 'PER_LEG_BPS', makerBps: V31_CONSTANTS.STRESS_MAKER_BPS, takerBps: V31_CONSTANTS.STRESS_TAKER_BPS, entryIsMaker: true },
    slippage: 'NOT_MODELLED',
    funding: 'NOT_MODELLED',
    spread: 'NOT_MODELLED',
    positionSizing: 'NONE_R_MULTIPLES_ONLY',
    marketData: 'BINANCE_SPOT_KLINES',
    feeVenueAssumed: 'BINANCE_USDT_FUTURES',
  },
  discrepancies: V31_DISCREPANCIES,
  sourcePins: V31_SOURCE_PINS,
  runSeries: runV31Series,
};
export const V31_DEFINITION: StrategyDefinition = Object.freeze(definition);

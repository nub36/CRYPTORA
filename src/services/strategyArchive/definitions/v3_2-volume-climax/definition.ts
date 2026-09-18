/**
 * V3.2 — HTF VOLUME CLIMAX & ABSORPTION — archived strategy definition (immutable).
 *
 * Source: svechnoy-suslik-v2 @ b46b4a0 (TRAIN result commit; pre-registration b631fba). Dataset c3c1dce.
 * RESEARCH VERDICT: FALSIFIED_ON_TRAIN (primary). EMA50-TP1 variants: UNPROMOTED (F3 falsified) —
 * their positive F1 is NOT the "V3.2 result" and is never presented as such.
 * ⚠️ Historical research only. CRYPTORA does not execute trades.
 */

import type {
  ReproductionEvidence, ResultOrigin, SourceFilePin, SpecResearchDiscrepancy, StrategyDefinition, StrategyVariant,
} from '../../types';
import { V32_CONSTANTS } from './v32Core';
import { runV32Series } from './v32Runner';
import aPrimary from '../../results/v32/v32-train-metrics.json' with { type: 'json' };
import aFast3 from '../../results/v32/v32-train-metrics-fast3.json' with { type: 'json' };
import aUnionEma from '../../results/v32/v32-train-metrics-union-ema50.json' with { type: 'json' };
import aFast3Ema from '../../results/v32/v32-train-metrics-fast3-ema50.json' with { type: 'json' };
import rPrimary from '../../results/v32/cryptora-reproduction/v32-train-union-cascade-reproduction.json' with { type: 'json' };
import rFast3 from '../../results/v32/cryptora-reproduction/v32-train-fast3-cascade-reproduction.json' with { type: 'json' };
import rUnionEma from '../../results/v32/cryptora-reproduction/v32-train-union-ema50-reproduction.json' with { type: 'json' };
import rFast3Ema from '../../results/v32/cryptora-reproduction/v32-train-fast3-ema50-reproduction.json' with { type: 'json' };

export const V32_VARIANTS: readonly StrategyVariant[] = Object.freeze([
  { id: 'union-cascade', label: 'cascade=union, tp1=cascade', sourceRole: 'PRIMARY', sourceVerdict: 'F1 FALSIFIED (net −0.0620 @2/5, gross −0.0082, n=307); F2 holds; F3 holds (60.59 %)', artifactPath: 'artifacts/research/v32/v32-train-metrics.json', artifactSha256: '380b41b5de9046121976514cdfc6b73a34b36eb1f5560f5e94bc037a33bc93fc' },
  { id: 'fast3-cascade', label: 'cascade=fast3, tp1=cascade', sourceRole: 'SECONDARY (spec ambiguity: k=3 only)', sourceVerdict: 'F1 FALSIFIED (net −0.1126, n=158); F3 holds', artifactPath: 'artifacts/research/v32/v32-train-metrics-fast3.json', artifactSha256: '03a188675df5519d6fa3978604736e6b181290cf4df1a6636042574bd3a33b18' },
  { id: 'union-ema50', label: 'cascade=union, tp1=ema50', sourceRole: 'SENSITIVITY — UNPROMOTED', sourceVerdict: 'F1 passes (+0.0530, n=213) but F3 FALSIFIED (42.72 % < 50 %) → V3_2_EMA50_VARIANT_UNPROMOTED', artifactPath: 'artifacts/research/v32/v32-train-metrics-union-ema50.json', artifactSha256: 'e5ee4b311458b1884b37149c9fd84a41f6d7b60b6c3b7bc617d34522ac134551' },
  { id: 'fast3-ema50', label: 'cascade=fast3, tp1=ema50', sourceRole: 'SENSITIVITY — UNPROMOTED', sourceVerdict: 'F1 passes (+0.0108, n=97, underpowered) but F3 FALSIFIED (42.27 %) → V3_2_EMA50_VARIANT_UNPROMOTED', artifactPath: 'artifacts/research/v32/v32-train-metrics-fast3-ema50.json', artifactSha256: '9a7457a54a6f6fa2d108e53de76e5b371177b473e57380db24b7f9eb2ad11b0f' },
]);

export const V32_SOURCE_PINS: readonly SourceFilePin[] = Object.freeze([
  { role: 'PREREGISTRATION', path: 'docs/V3_2_VOLUME_CLIMAX_PREREGISTRATION.md', sha256: '644453367c17c2a2eb1b74400dd88b62ec24506903280cc37f36b77ab8d1ffe7' },
  { role: 'RESULTS_DOC', path: 'docs/V3_2_VOLUME_CLIMAX_TRAIN_RESULTS.md', sha256: 'a03e0eb3c3dc0590d160d78447353c80256b16d6981e26095941ca142dec39ed' },
  { role: 'RESEARCH_IMPLEMENTATION', path: 'research/v32_volume_climax.ts', sha256: 'c209b8d7ecf38940b910cc8de49608a0d8a849b75c9083f4492f691c08075bb6' },
  { role: 'SHARED_PRIMITIVE', path: 'src/strategy/v2/indicators.ts', sha256: '10594cadf615b0e048797e1db9504648794b0cbec41b62da6ec55641d1daa55c' },
  ...V32_VARIANTS.map((v) => ({ role: 'ARTIFACT' as const, path: v.artifactPath, sha256: v.artifactSha256 })),
  { role: 'SETTINGS', path: 'artifacts/research/v2-real-20260915-080338/settings.json', sha256: '92311c4f9a96bc2e6922fc952aacc53ae473ffb22bcb6749b11c2a0cfa0cd3f9' },
  { role: 'SPLITS', path: 'artifacts/research/v2-real-20260915-080338/splits.json', sha256: 'a44eed9ae3ad036853f14845113e392c434081301b21647398a4a3af2ab84f0b' },
]);

export const V32_COMMITS = Object.freeze({
  preregistration: 'b631fba',
  trainResult: 'b46b4a0',
  historicalPin: 'b46b4a0',
  dataset: 'c3c1dcecfe2784a147f591f2b5b4526cbf99df9f',
});

export const V32_DISCREPANCIES: readonly SpecResearchDiscrepancy[] = Object.freeze([
  {
    id: 'D-V32-001',
    specStatement: 'Programme convention: one position at a time.',
    researchBehaviour: 'Runner continues scanning on the fill bar with `pend = null` — overlapping trades possible (same family as D-V30-001).',
    impact: 'Trade count may be inflated; verdict (zero pre-cost edge) unaffected.',
    reproductionPolicy: 'PRESERVE_RESEARCH_BEHAVIOUR',
    evidence: ['research/v32_volume_climax.ts `main()` pending/fill block'],
  },
  {
    id: 'D-V32-002',
    specStatement: 'Spec left two ambiguities: cascade window (largest k in 3..6 vs k=3) and TP1 (50 % of cascade vs EMA50).',
    researchBehaviour: 'Both shipped as variants; PRIMARY pre-declared as union/cascade (`isPrimary` in artifact). EMA50 variants pass F1 but falsify premise criterion F3 and were explicitly NOT promoted.',
    impact: 'Any presentation of +0.0530 as "the V3.2 result" would be post-hoc selection; the archived verdict is FALSIFIED.',
    reproductionPolicy: 'PRESERVE_RESEARCH_BEHAVIOUR',
    evidence: ['docs/V3_2_VOLUME_CLIMAX_TRAIN_RESULTS.md (V3_2_EMA50_VARIANT_UNPROMOTED)'],
  },
  {
    id: 'D-V32-003',
    specStatement: 'RVOL threshold "≥ 2.2".',
    researchBehaviour: 'Inclusive comparison (>=) as written, unlike V3.0/V3.1 which used strict >.',
    impact: 'Documented convention difference; preserved.',
    reproductionPolicy: 'PRESERVE_RESEARCH_BEHAVIOUR',
    evidence: ['research/v32_volume_climax.ts MIN_RVOL comment'],
  },
]);

export const V32_SOURCE_RESULTS = Object.freeze({
  origin: 'SOURCE_REPORTED' as ResultOrigin,
  train: { 'union-cascade': aPrimary, 'fast3-cascade': aFast3, 'union-ema50': aUnionEma, 'fast3-ema50': aFast3Ema },
  windows: { train: { fromUtc: '2022-01-01T00:00:00Z', toUtc: '2024-05-26T13:00:00Z' } },
  validation: 'NEVER RUN — F1 falsified on TRAIN (primary).',
});

const repro = [rPrimary, rFast3, rUnionEma, rFast3Ema];
export const V32_REPRODUCTION_EVIDENCE: readonly ReproductionEvidence[] = Object.freeze(
  repro.map((e) => ({
    slice: `${e.slice}:${e.variantId}`,
    runAtUtc: e.runAtUtc,
    datasetCommit: e.dataset.commit,
    sourceArtifactPath: e.sourceArtifact.path,
    sourceArtifactSha256: e.sourceArtifact.sha256,
    deterministicDigest: e.deterministicDigest,
    tradeCount: e.tradeCount,
    allMatched: e.comparison.allMatched,
    firstMismatch: e.comparison.firstMismatch,
    evidencePath: `src/services/strategyArchive/results/v32/cryptora-reproduction/v32-train-${e.variantId}-reproduction.json`,
  })),
);
export const V32_REPRODUCED_RESULTS = Object.freeze({
  origin: 'DERIVED_BY_CRYPTORA' as ResultOrigin,
  train: { 'union-cascade': rPrimary, 'fast3-cascade': rFast3, 'union-ema50': rUnionEma, 'fast3-ema50': rFast3Ema },
});

export const V32_CAVEATS_RU: readonly string[] = Object.freeze([
  'Исследование: ФАЛЬСИФИЦИРОВАНО НА TRAIN (primary union/cascade: net −0.0620 R/сделку @2/5 bps, n=307; gross −0.0082 — преимущество до комиссий равно нулю). Валидация не проводилась.',
  'Самый высокий TP1 hit rate в программе (60.59 %) и низкий fee drag (0.0538 R) не спасают: математическое ожидание до издержек ≈ 0.',
  'Варианты с TP1 = EMA50 (+0.0530 / +0.0108) проходят F1, но фальсифицируют критерий предпосылки F3 (TP1 hit < 50 %) — источник НЕ продвинул их (UNPROMOTED). Показывать +0.0530 как «результат V3.2» — постфактум-отбор.',
  'Все 4 архивных варианта перенесены; primary был предзаявлен (isPrimary в артефакте).',
  'Раннер допускал перекрывающиеся позиции (D-V32-001).',
  'Не сопоставимо напрямую с V3.0/V3.1: только 1h (без 4H-структуры), TIMEOUT 48 баров, RVOL ≥ 2.2 включительно.',
  '«Воспроизведено» — повторяемость чисел, не пригодность стратегии. CRYPTORA не исполняет сделки.',
]);

export const V32_RULES_RU = Object.freeze({
  entry: '1H: направленное расширение ≥ 2 ATR(14) за k баров (union: наибольший k из 6..3; fast3: k=3) + климакс объёма RVOL ≥ 2.2 + абсорбция (тень ≥ 40 % с закрытием в сторону fade, либо поглощение с телом ≥ 40 % и закрытием в крайних 30 % диапазона). Лимитный коридор close ± 0.10 ATR, исполнение с N+1, срок 3 бара.',
  stop: 'За экстремумом климаксной свечи ± 0.15 ATR.',
  targets: 'TP1 = 50 % каскада (или EMA50 в sensitivity-вариантах) → безубыток; TP2 = origin каскада.',
  timeout: '48 баров 1H, свеча входа считается первой.',
  intrabar: 'R1–R5 как в V3.0.',
  fees: 'Вход maker 2 bps, выходы taker 5 bps; стресс 5/5.',
});

const definition: StrategyDefinition = {
  id: 'V3_2_VOLUME_CLIMAX',
  version: '3.2',
  name: 'HTF Volume Climax & Absorption',
  nameRu: 'Климакс объёма и абсорбция',
  verdict: 'FALSIFIED_ON_TRAIN',
  reproducibility: 'REPRODUCED',
  reproductionEvidence: V32_REPRODUCTION_EVIDENCE,
  variants: V32_VARIANTS,
  headlineVariantId: 'union-cascade',
  slicesAvailable: ['train'],
  execTimeframe: V32_CONSTANTS.EXEC_TF,
  structuralTimeframe: null,
  symbols: V32_CONSTANTS.SYMBOLS,
  assumptions: {
    fees: { kind: 'PER_LEG_BPS', makerBps: V32_CONSTANTS.MAKER_BPS, takerBps: V32_CONSTANTS.TAKER_BPS, entryIsMaker: true },
    stressFees: { kind: 'PER_LEG_BPS', makerBps: V32_CONSTANTS.STRESS_MAKER_BPS, takerBps: V32_CONSTANTS.STRESS_TAKER_BPS, entryIsMaker: true },
    slippage: 'NOT_MODELLED', funding: 'NOT_MODELLED', spread: 'NOT_MODELLED',
    positionSizing: 'NONE_R_MULTIPLES_ONLY', marketData: 'BINANCE_SPOT_KLINES', feeVenueAssumed: 'BINANCE_USDT_FUTURES',
  },
  discrepancies: V32_DISCREPANCIES,
  sourcePins: V32_SOURCE_PINS,
  runSeries: runV32Series,
};
export const V32_DEFINITION: StrategyDefinition = Object.freeze(definition);

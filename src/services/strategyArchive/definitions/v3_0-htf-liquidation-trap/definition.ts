/**
 * V3.0 — HTF LIQUIDATION TRAP — archived strategy definition (immutable).
 *
 * Source: svechnoy-suslik-v2 @ 292050c6c3f32807a85548e037f674d42a2efb18
 * Dataset: nub36/svechnoy-suslik-binance-data @ c3c1dcecfe2784a147f591f2b5b4526cbf99df9f
 *
 * ⚠️ Historical research only. Not a signal, not a forecast, not a trading
 * system. CRYPTORA does not execute trades.
 */

import type {
  ReproductionEvidence, ResultOrigin, SourceFilePin, SpecResearchDiscrepancy, StrategyDefinition,
} from '../../types';
import { V30_CONSTANTS } from './v30Core';
import { runV30Series } from './v30Runner';
import trainMetrics from '../../results/v30/v30-train-metrics.json' with { type: 'json' };
import validationMetrics from '../../results/v30/v30-validation-metrics.json' with { type: 'json' };
import portParity from '../../results/v30/v30-port-parity.json' with { type: 'json' };
import reproTrain from '../../results/v30/cryptora-reproduction/v30-train-reproduction.json' with { type: 'json' };
import reproValidation from '../../results/v30/cryptora-reproduction/v30-validation-reproduction.json' with { type: 'json' };

/**
 * Evidence of the REAL re-run inside CRYPTORA (2026-09-16) on dataset c3c1dce via
 * scripts/strategy-archive/reproduce-v30.mjs. Every source field matched; FIRST_MISMATCH = none.
 * These figures are DERIVED_BY_CRYPTORA and are stored separately from SOURCE_REPORTED.
 */
export const V30_REPRODUCTION_EVIDENCE: readonly ReproductionEvidence[] = Object.freeze(
  [reproTrain, reproValidation].map((e) => ({
    slice: e.slice,
    runAtUtc: e.runAtUtc,
    datasetCommit: e.dataset.commit,
    sourceArtifactPath: e.sourceArtifact.path,
    sourceArtifactSha256: e.sourceArtifact.sha256,
    deterministicDigest: e.deterministicDigest,
    tradeCount: e.tradeCount,
    allMatched: e.comparison.allMatched,
    firstMismatch: e.comparison.firstMismatch,
    evidencePath: `src/services/strategyArchive/results/v30/cryptora-reproduction/v30-${e.slice}-reproduction.json`,
  })),
);
export const V30_REPRODUCED_RESULTS = Object.freeze({
  origin: 'DERIVED_BY_CRYPTORA' as ResultOrigin,
  train: reproTrain,
  validation: reproValidation,
});

export const V30_SOURCE_PINS: readonly SourceFilePin[] = Object.freeze([
  { role: 'SPEC', path: 'docs/strategies/V3_0_HTF_LIQUIDATION_TRAP.md', sha256: '58ff842a4631aeb796b892d44bb7e40f71df9b2b3cce432174a2bfd7c863040e' },
  { role: 'PREREGISTRATION', path: 'docs/V3_0_HTF_LIQUIDATION_TRAP_PREREGISTRATION.md', sha256: '895ff330042d61d002a6448a142c78cc6265a52eed4d17916907b74529e204c3' },
  { role: 'RESULTS_DOC', path: 'docs/V3_0_VALIDATION_RESULTS.md', sha256: '823c03796b8de7e2349f30acfb3d56c77de3dfe8e7532d6ebc0de6191a213284' },
  { role: 'RESEARCH_IMPLEMENTATION', path: 'research/v30_htf_trap.ts', sha256: 'a821757ff0319a100a8a9087da1bdd137abb1df0785493d644ad4d87f05dc4cd' },
  { role: 'RUNNER', path: 'research/v30_validate.ts', sha256: 'b6d582eca49dd5a1e8a09c5c1c899b45548329776cdd29f2abc1827a6704a28b' },
  { role: 'SHARED_PRIMITIVE', path: 'src/strategy/v2/structure.ts', sha256: 'e04806a33d1ebc4bab24f12f5240c7320ae8e00276157833e51534152a4e662f' },
  { role: 'SHARED_PRIMITIVE', path: 'src/strategy/v2/indicators.ts', sha256: '10594cadf615b0e048797e1db9504648794b0cbec41b62da6ec55641d1daa55c' },
  { role: 'SHARED_PRIMITIVE', path: 'src/strategy/v2/htf.ts', sha256: 'b175efade6feb8069e5564502931585bf09ef371ad181813758422e774fe88f0' },
  { role: 'ARTIFACT', path: 'artifacts/research/v30/v30-train-metrics.json', sha256: 'bc18ad9612b987678a40551be9ecfb064db5c15a72ebf3ff3d6e7357fca33fec' },
  { role: 'ARTIFACT', path: 'artifacts/research/v30/v30-validation-metrics.json', sha256: '703e38811dfa71d1db1b9846928ad8b5d1dd1262c06d78372255a9009655f7f6' },
  { role: 'PRODUCTION_PORT', path: 'artifacts/research/v30/v30-port-parity.json', sha256: '5a5b9cb4fb45994713e4d54f570da556cb09b3e7dcac6f6f59f2e68e767d2e68' },
  { role: 'SETTINGS', path: 'artifacts/research/v2-real-20260915-080338/settings.json', sha256: '92311c4f9a96bc2e6922fc952aacc53ae473ffb22bcb6749b11c2a0cfa0cd3f9' },
  { role: 'SPLITS', path: 'artifacts/research/v2-real-20260915-080338/splits.json', sha256: 'a44eed9ae3ad036853f14845113e392c434081301b21647398a4a3af2ab84f0b' },
  { role: 'DATASET_MANIFEST', path: 'artifacts/research/v2-real-20260915-080338/dataset-manifest.json', sha256: 'e31d739fc21d82331a45b366512c87ea9b296d2ae32f41933303ea7877cee39e' },
  { role: 'DATASET_MANIFEST', path: 'artifacts/research/v30-validation-20260916/dataset-manifest.json', sha256: 'cc8572f7102469c43c78a22a87e770c2fd0bf6be15737915ab5113b395cd1b3d' },
]);

export const V30_COMMITS = Object.freeze({
  frozenEngine: '48390748ff1ed1f08b104206c3430142059d7430',
  preregistration: '6c2bf9e3302dff59eb226285f3fa7f419b5c1f64',
  train: '5674e65',
  freeze: '21feabe',
  validation: '3278087',
  productionPort: '76a8f32',
  sourceHead: '292050c6c3f32807a85548e037f674d42a2efb18',
  dataset: 'c3c1dcecfe2784a147f591f2b5b4526cbf99df9f',
});

export const V30_DISCREPANCIES: readonly SpecResearchDiscrepancy[] = Object.freeze([
  {
    id: 'D-V30-001',
    specStatement:
      'docs/strategies/V3_0_HTF_LIQUIDATION_TRAP.md §A5/B5: "one position at a time — per series; no overlapping trades".',
    researchBehaviour:
      'research/v30_htf_trap.ts and research/v30_validate.ts resolve a filled trade by walking the bars ahead (manageTrade) and then continue scanning from the fill bar with `pend = null`; the `busy` flag is declared and never set. A new corridor can therefore be published while an earlier simulated trade is still in flight — overlapping positions on one symbol.',
    impact:
      'Trade COUNT (n = 1,585 TRAIN / 536 VALIDATION) and the per-month trade rate are inflated relative to a strictly single-position engine; per-trade R statistics are unaffected in expectation. src/strategy/v30/runner.ts (production port) documents this and holds one position per symbol.',
    reproductionPolicy: 'PRESERVE_RESEARCH_BEHAVIOUR',
    evidence: [
      'research/v30_htf_trap.ts lines ~303–381 (`let busy = false; … if (pend && !busy) … void busy;`)',
      'src/strategy/v30/runner.ts header "KNOWN DIVERGENCE FROM THE VALIDATED SIMULATOR"',
      'docs/V3_0_PRODUCTION_PORT.md §"in flight"',
    ],
  },
  {
    id: 'D-V30-002',
    specStatement: 'Fee model labelled "realistic Binance futures fees (2/5 bps)".',
    researchBehaviour: 'Candles are Binance SPOT monthly klines (dataset manifest provenance.market = "Spot"); the futures fee grid is applied to spot price paths. Funding, spread, slippage and post-only rejection are not modelled.',
    impact: 'Results are a spot-price simulation with a futures fee assumption; not an exchange-accurate futures backtest.',
    reproductionPolicy: 'PRESERVE_RESEARCH_BEHAVIOUR',
    evidence: ['artifacts/research/v2-real-20260915-080338/dataset-manifest.json → provenance', 'docs/strategies/V3_0_HTF_LIQUIDATION_TRAP.md §A8/B8 caveats 4–5'],
  },
]);

/** Source-reported headline figures (verbatim from the pinned artifacts). */
export const V30_SOURCE_RESULTS = Object.freeze({
  origin: 'SOURCE_REPORTED' as ResultOrigin,
  train: trainMetrics,
  validation: validationMetrics,
  portParity: portParity,
  windows: {
    train: { fromUtc: '2022-01-01T00:00:00Z', toUtc: '2024-05-26T13:00:00Z', barsPerSymbol1h: 21037 },
    validation: { fromUtc: '2024-05-26T14:00:00Z', toUtc: '2025-03-14T18:00:00Z' },
    testSpent: 'TEST 2025-03-14…2025-12-31 was spent on the V1/V2 baseline only; TEST 2026-H1 unspent (no data).',
  },
});

/** Caveats that MUST accompany any display of the numbers above. */
export const V30_CAVEATS_RU: readonly string[] = Object.freeze([
  'Историческое исследование на Binance Spot klines 2022–2025; не прогноз и не обещание будущей доходности.',
  'VALIDATION (n=536): 3 из 6 монет отрицательны (BTC −0.0129, SOL −0.0685, XRP −0.0966 R/сделку); PASS только по агрегату.',
  'Концентрация результата: без топ-5 сделок gross +0.0482 R < комиссия 0.0673 R → net отрицательный; удержано 30.1 % преимущества (ex-top-1 %).',
  'Исследовательский раннер допускал перекрывающиеся позиции (спецификация заявляла «одна позиция за раз») — расхождение D-V30-001; количество сделок завышено относительно строго последовательного движка.',
  'Не сопоставимо напрямую с V2.x: другой таймфрейм (только 1h), другая модель комиссий (3 ноги), другой период и семантика входа.',
  'Slippage, funding, спред и отклонение post-only не моделировались; данные Spot, комиссии Futures.',
  'Воспроизводимость в CRYPTORA: REPRODUCED — реальный прогон TRAIN и VALIDATION на датасете c3c1dce совпал с артефактами источника по всем полям (digest fnv1a32:8156fe4a:n1585 / fnv1a32:02e59d33:n536). «Воспроизведено» означает только повторяемость чисел, а не успешность стратегии.',
  'CRYPTORA не исполняет сделки: никакого автотрейдинга, сигналов к исполнению или биржевых ключей.',
]);

const definition: StrategyDefinition = {
  id: 'V3_0_HTF_LIQUIDATION_TRAP',
  version: '3.0',
  name: 'HTF Liquidation Trap',
  nameRu: 'Ловушка ликвидности на старшем таймфрейме',
  verdict: 'VALIDATED_FOR_RESEARCH',
  reproducibility: 'REPRODUCED',
  reproductionEvidence: V30_REPRODUCTION_EVIDENCE,
  execTimeframe: V30_CONSTANTS.EXEC_TF,
  structuralTimeframe: V30_CONSTANTS.STRUCT_TF,
  symbols: V30_CONSTANTS.SYMBOLS,
  assumptions: {
    fees: { kind: 'PER_LEG_BPS', makerBps: V30_CONSTANTS.MAKER_BPS, takerBps: V30_CONSTANTS.TAKER_BPS, entryIsMaker: true },
    stressFees: { kind: 'PER_LEG_BPS', makerBps: V30_CONSTANTS.STRESS_MAKER_BPS, takerBps: V30_CONSTANTS.STRESS_TAKER_BPS, entryIsMaker: true },
    slippage: 'NOT_MODELLED',
    funding: 'NOT_MODELLED',
    spread: 'NOT_MODELLED',
    positionSizing: 'NONE_R_MULTIPLES_ONLY',
    marketData: 'BINANCE_SPOT_KLINES',
    feeVenueAssumed: 'BINANCE_USDT_FUTURES',
  },
  discrepancies: V30_DISCREPANCIES,
  sourcePins: V30_SOURCE_PINS,
  runSeries: runV30Series,
};
export const V30_DEFINITION: StrategyDefinition = Object.freeze(definition);

/** Human-readable rule summary (RU) — mirrors the spec; used by the read-only card. */
export const V30_RULES_RU = Object.freeze({
  entry: '1H-свеча пробивает подтверждённый 4H swing (strength 3, confirmedIndex = i+3, только закрытые 4H) и той же свечой закрывается обратно; тело ≥ 0.35 диапазона; RVOL > 1.25. Лимитный коридор close ± 0.10 ATR(14), исполнение с N+1 по худшему краю, срок 3 бара; стоп до входа или неоднозначная свеча → отмена.',
  stop: 'За экстремумом выноса ± 0.15 ATR(1H, 14).',
  targets: 'TP1 = середина 4H-диапазона (50 % позиции) → стоп в безубыток; TP2 = противоположный 4H swing (остаток).',
  timeout: '50 баров 1H, свеча входа считается первой.',
  intrabar: 'R1 стоп раньше целей; R2 TP1 раньше TP2; R3 безубыток только после бара TP1; R4 стоп не двигается назад; R5 таймаут с бара входа.',
  fees: 'За каждую ногу: вход maker 2 bps, каждая закрывающая нога taker 5 bps (три ноги при частичном выходе); стресс 5/5.',
});

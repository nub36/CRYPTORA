/**
 * V2.8 — ZERO-FEE SNIPER + TRAILING — archived strategy definition (immutable).
 *
 * Source: svechnoy-suslik-v2 TRAIN 54243a7 → candidate freeze 852167c → VALIDATION 1d4d575. Frozen V2 engine 4839074.
 * RESEARCH VERDICT: VALIDATED_GROSS_ONLY — both pre-registered criteria met on VALIDATION (gross +0.0488 R, PF 1.1087,
 * n=98) with fees = 0; removing ONE trade (top 1 %) flips it negative (−0.0143). Superseded by V3.0 in the source.
 *
 * ⚠️⚠️ ALL V2.8 FIGURES ARE GROSS (ZERO-FEE). At the programme's 2/5 bps model this entry population carries
 * ~0.1555 R of fee drag (V2.7), i.e. the strategy is net-negative. NEVER show V2.8 next to V3.x net@fees numbers
 * without the incomparability warning. CRYPTORA does not execute trades.
 */

import type {
  ResultOrigin, SourceFilePin, SpecResearchDiscrepancy, StrategyDefinition, StrategyVariant,
} from '../../types';
import { ARM_ORDER, V28_CONSTANTS } from './v28Core';
import { runV28Series } from './v28Runner';
import aTrain from '../../results/v28/v28-train-metrics.json' with { type: 'json' };
import aValid from '../../results/v28/v28-validation-metrics.json' with { type: 'json' };

const TRAIN_ART = 'artifacts/research/v28/v28-train-metrics.json';
const TRAIN_SHA = '34c82d05b8200b82fbcd5a3c0ce1e40cc19d3fc9deb09c4a3ad6c6d35f1146ec';
const VALID_ART = 'artifacts/research/v28/v28-validation-metrics.json';
const VALID_SHA = '6cd74114eceaf8b9ec0571a1693b07561689ed57dc1cc14ed7ced2ddf3231ee0';

/** Seven exit arms on ONE shared 317-entry TRAIN set. Only `Trail` was frozen (852167c) and validated; SMC anchor only. */
export const V28_VARIANTS: readonly StrategyVariant[] = Object.freeze(
  ARM_ORDER.map((arm) => {
    const t = aTrain.arms.find((x) => x.arm === arm)!;
    const v = aValid.arms.find((x) => x.arm === arm);
    const role = arm === 'Trail'
      ? 'CANDIDATE (frozen 852167c before VALIDATION; chosen on outlier robustness, not raw gross)'
      : arm === 'SMC' ? 'ANCHOR (frozen tracker; raw-gross winner on TRAIN, collapsed on VALIDATION; NOT the candidate)'
        : 'TRAIN-ONLY COMPARISON ARM (V2.7 fixed target, zero fee)';
    const verdict = `TRAIN gross ${t.grossRPerTrade} R (n=${t.n}, PF ${t.profitFactor}, ex-top-1 % ${t.outlierDependence.exTop1Pct})`
      + (v ? `; VALIDATION gross ${v.grossRPerTrade} R (n=${v.n}, PF ${v.profitFactor}, ex-top-1 % ${v.outlierDependence.exTop1Pct})` : '; not validated')
      + ' — ZERO FEES';
    return { id: arm, label: `exit=${arm} (fees=0)`, sourceRole: role, sourceVerdict: verdict, artifactPath: v ? VALID_ART : TRAIN_ART, artifactSha256: v ? VALID_SHA : TRAIN_SHA };
  }),
);

export const V28_SOURCE_PINS: readonly SourceFilePin[] = Object.freeze([
  { role: 'PREREGISTRATION', path: 'docs/V2_8_ZERO_FEE_SNIPER_TRAILING_VALIDATION.md', sha256: '590ee62c654f8347a8bfe6a1281e3827cdbecd1bf24b7678599b4dbe9368b366' },
  { role: 'PREREGISTRATION', path: 'docs/V2_8_FINAL_UNTOUCHED_TEST_2026_PREREGISTRATION.md', sha256: '258dbef4b38db775d08f1a16e9c7d7a92fcfc1178a95b730407f80b8c4df0676' },
  { role: 'RESULTS_DOC', path: 'docs/V2_8_GROSS_ONLY_RESULTS.md', sha256: 'eaf8c2feec28c0050ae867ea8ad8e96abe1daffbf97b1690c92e9dc97f052c2a' },
  { role: 'RESULTS_DOC', path: 'docs/V2_8_VALIDATION_RESULTS.md', sha256: 'd3cb8b78d3799805c76672a9976eec0d31636471614d325ab689a5a7f19dafe9' },
  { role: 'SPEC', path: 'docs/strategies/V2_8_ZERO_FEE_SNIPER_TRAILING.md', sha256: '7d6dae9a306d0327629e083a7ff4af1d5e5b6c0a1a8a45a281ea3dc84b1eb481' },
  { role: 'RESEARCH_IMPLEMENTATION', path: 'research/v28_gross_only.ts', sha256: 'bb237f47ad7cd342dd893db3e0bf8185776945f5ece02f60a61064c75bceeaef' },
  { role: 'RESEARCH_IMPLEMENTATION', path: 'research/v28_validate.ts', sha256: '6e267907960dbeb83ac5fde4ae3a7311622b60b1df30e881cacc32d55c0ab445' },
  { role: 'SHARED_PRIMITIVE', path: 'scripts/real-data/v25-trailing.ts', sha256: 'fe6c307ee53273edcc155e16643bfecade61a6bf3a60296325ef8491460f50fa' },
  { role: 'SHARED_PRIMITIVE', path: 'research/v27_rr_test.ts', sha256: '65a64d2a4eb27ce85a7f3de5e8e52efb53215601806279fee38fee99675dc7fc' },
  { role: 'SHARED_PRIMITIVE', path: 'scripts/real-data/v24-engine.ts', sha256: '6f930e48998bdfbdafd5e7d3e1e07d79307febc3734fca7bc5e44655383edbe3' },
  { role: 'SHARED_PRIMITIVE', path: 'scripts/real-data/corridor-entry.ts', sha256: 'c2eebef8af2dea3c92f4a221a6a5a6eb37ed00585385845b16ea83c74bfaf6bf' },
  { role: 'ARTIFACT', path: TRAIN_ART, sha256: TRAIN_SHA },
  { role: 'ARTIFACT', path: VALID_ART, sha256: VALID_SHA },
  { role: 'SETTINGS', path: 'artifacts/research/v2-real-20260915-080338/settings.json', sha256: '92311c4f9a96bc2e6922fc952aacc53ae473ffb22bcb6749b11c2a0cfa0cd3f9' },
  { role: 'SPLITS', path: 'artifacts/research/v2-real-20260915-080338/splits.json', sha256: 'a44eed9ae3ad036853f14845113e392c434081301b21647398a4a3af2ab84f0b' },
]);

export const V28_COMMITS = Object.freeze({
  trainResult: '54243a7',
  candidateFreeze: '852167c',
  validationResult: '1d4d575',
  historicalPin: '1d4d575',
  frozenEngine: '4839074',
  dataset: 'c3c1dcecfe2784a147f591f2b5b4526cbf99df9f',
});

export const V28_DISCREPANCIES: readonly SpecResearchDiscrepancy[] = Object.freeze([
  {
    id: 'D-V28-001',
    specStatement: 'Programme convention: results are net of the 2/5 bps fee model.',
    researchBehaviour: 'ALL fees set to ZERO by design ("pure alpha" question). SMC arm recovers gross by adding back the frozen 0.1 % lump fee that trackOutcome subtracts.',
    impact: 'Every V2.8 figure is GROSS. With the programme fee model this population loses ≈0.1555 R/trade to fees (V2.7), so the strategy is net-negative. Incomparable with V3.x net figures.',
    reproductionPolicy: 'PRESERVE_RESEARCH_BEHAVIOUR',
    evidence: ['artifacts/research/v28/v28-train-metrics.json `feesDisabled`/`feeNote`', 'docs/V2_8_VALIDATION_RESULTS.md'],
  },
  {
    id: 'D-V28-002',
    specStatement: 'Validation criteria: gross R/trade > 0 and PF > 1.0.',
    researchBehaviour: 'PASS (+0.0488, PF 1.1087, n=98) but ex-top-1 % (one trade) = −0.0143; median R sign-flipped TRAIN→VALIDATION (+0.0364 → −0.1270).',
    impact: 'Source labelled it V2_8_VALIDATED_FOR_RESEARCH "with serious reservations"; the archive verdict is VALIDATED_GROSS_ONLY. Not a trading recommendation.',
    reproductionPolicy: 'PRESERVE_RESEARCH_BEHAVIOUR',
    evidence: ['docs/V2_8_VALIDATION_RESULTS.md §4'],
  },
  {
    id: 'D-V28-003',
    specStatement: 'Seven arms compared on TRAIN.',
    researchBehaviour: 'Only Trail was frozen as candidate (852167c, chosen on outlier robustness over raw-gross winner SMC); VALIDATION ran SMC (anchor) + Trail only; RR arms never validated.',
    impact: 'Candidate selection happened on TRAIN before validation — documented, not post-hoc. RR arms are TRAIN-only comparisons.',
    reproductionPolicy: 'PRESERVE_RESEARCH_BEHAVIOUR',
    evidence: ['research/v28_validate.ts VALIDATION_ARMS', 'docs/V2_8_ZERO_FEE_SNIPER_TRAILING_VALIDATION.md'],
  },
  {
    id: 'D-V28-004',
    specStatement: 'Final untouched TEST (2026-H1) pre-registered.',
    researchBehaviour: 'Never run: 2026 data was not downloadable at the time (pre-registration §6). TEST window remains unread.',
    impact: 'No out-of-sample result beyond the single VALIDATION window exists.',
    reproductionPolicy: 'PRESERVE_RESEARCH_BEHAVIOUR',
    evidence: ['docs/V2_8_FINAL_UNTOUCHED_TEST_2026_PREREGISTRATION.md'],
  },
  {
    id: 'D-V28-005',
    specStatement: 'Entries and the SMC arm depend on the frozen V2 engine `4839074`.',
    researchBehaviour: 'Sniper entry population (317 TRAIN / 98 VALIDATION) and the SMC arm come from evaluateV2 / resolveEntry / executableLadder / trackOutcome.',
    impact: 'Reproduction inside CRYPTORA requires the isolated legacy engine port (C6); until then SOURCE_CHAIN_VERIFIED_NOT_RERUN.',
    reproductionPolicy: 'PRESERVE_RESEARCH_BEHAVIOUR',
    evidence: ['research/v28_gross_only.ts imports'],
  },
]);

export const V28_SOURCE_RESULTS = Object.freeze({
  origin: 'SOURCE_REPORTED' as ResultOrigin,
  train: aTrain,
  validation: aValid,
  windows: {
    train: { fromUtc: '2022-01-01T00:00:00Z', toUtc: '2024-05-26T13:00:00Z' },
    validation: { fromUtc: '2024-05-26T14:00:00Z', toUtc: '2025-03-14T18:00:00Z' },
  },
  feeSemantics: 'GROSS_ONLY_ZERO_FEE' as const,
});

export const V28_CAVEATS_RU: readonly string[] = Object.freeze([
  '⚠️ ВСЕ ЦИФРЫ V2.8 — GROSS ПРИ НУЛЕВЫХ КОМИССИЯХ. При модели программы 2/5 bps эта популяция входов теряет ≈0.1555 R/сделку на комиссиях (V2.7), т.е. нетто стратегия отрицательна. НЕ сопоставимо с net-результатами V3.x без этого предупреждения.',
  'Исследование: ВАЛИДИРОВАНО ТОЛЬКО GROSS. Кандидат Trail (sniper-вход + трейлинг V2.5) прошёл оба предзаявленных критерия на VALIDATION: gross +0.0488 R/сделку, PF 1.1087, n=98 — но удаление ОДНОЙ сделки (топ-1 %) даёт −0.0143; медиана сделки сменила знак (TRAIN +0.0364 → VALIDATION −0.1270).',
  'Кандидат заморожен до валидации (852167c) по устойчивости к выбросам, а не по сырому gross: победитель TRAIN по gross — SMC (0.1490) — на VALIDATION рухнул до −0.1821.',
  'На TRAIN сравнивались 7 выходов на одном наборе из 317 входов; RR-варианты никогда не валидировались. TEST-2026 предзаявлен, но не запускался (данных не было).',
  'В источнике вытеснена V3.0 (SUPERSEDED). Входы — замороженный движок V2 `4839074`, четыре таймфрейма в одном пуле.',
  'CRYPTORA не исполняет сделки.',
]);

export const V28_RULES_RU = Object.freeze({
  entry: 'Замороженный движок V2 (4839074): REVERSAL-сетапы, 8-условный sniper-фильтр (свип реального экстремума, каузальный реклейм ≤ 3 бара, penetration ≥ 0.10 ATR, тень ≥ 0.25, тело ≥ 0.35, RVOL > 1.2 …); вход по OPEN бара N+1; один слот позиции, управляемый frozen trackOutcome.',
  stop: 'Структурный за тенью свипа + 0.25 ATR (frozen).',
  exitTrail: 'Кандидат Trail (V2.5): безубыток при MFE ≥ 1R, трейлинг 1R от пика MFE с шагом 0.25R, без целей; таймаут 10 баров, если +1R не достигнут; R1–R5 консервативно.',
  exitOthers: 'SMC — frozen лестница целей/структурный SL/таймаут 48 (gross восстановлен добавлением 0.1 % lump fee); RR15…RR40 — фиксированные цели V2.7 на 50 барах.',
  fees: 'НОЛЬ. Все цифры gross.',
  scope: '15m/30m/1h/4h × 6 символов; TRAIN (7 выходов) и VALIDATION (SMC + Trail).',
});

const definition: StrategyDefinition = {
  id: 'V2_8_ZERO_FEE_SNIPER_TRAILING',
  version: '2.8',
  name: 'Zero-fee Sniper + Trailing (gross-only)',
  nameRu: 'Снайпер + трейлинг при нулевых комиссиях (только gross)',
  verdict: 'VALIDATED_GROSS_ONLY',
  reproducibility: 'SOURCE_CHAIN_VERIFIED_NOT_RERUN',
  reproductionBlockedReason: 'Entry population and the SMC arm are produced by the frozen V2 engine 4839074 (15m/30m/1h/4h, HTF context, sniper filter, frozen trackOutcome). Exit arms are ported; the engine is ported in C6 as an isolated legacy dependency, after which a rerun is attempted.',
  legacyEngineDependency: 'FROZEN_V2_ENGINE_4839074',
  variants: V28_VARIANTS,
  headlineVariantId: 'Trail',
  slicesAvailable: ['train', 'validation'],
  execTimeframe: '15m',
  scopeTimeframes: V28_CONSTANTS.SCOPE,
  structuralTimeframe: null,
  symbols: V28_CONSTANTS.SYMBOLS,
  assumptions: {
    fees: { kind: 'PER_LEG_BPS', makerBps: 0, takerBps: 0, entryIsMaker: true },
    feeSemantics: 'GROSS_ONLY_ZERO_FEE',
    slippage: 'NOT_MODELLED', funding: 'NOT_MODELLED', spread: 'NOT_MODELLED',
    positionSizing: 'NONE_R_MULTIPLES_ONLY', marketData: 'BINANCE_SPOT_KLINES', feeVenueAssumed: 'BINANCE_USDT_FUTURES',
  },
  discrepancies: V28_DISCREPANCIES,
  sourcePins: V28_SOURCE_PINS,
  runSeries: runV28Series,
};
export const V28_DEFINITION: StrategyDefinition = Object.freeze(definition);

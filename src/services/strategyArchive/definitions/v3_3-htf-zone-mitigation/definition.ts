/**
 * V3.3 — HTF ZONE MITIGATION & LTF SQUEEZE — archived strategy definition (immutable).
 *
 * Source: svechnoy-suslik-v2 @ a7ecd79 (TRAIN result commit; pre-registration 16728ef, amendment 01cbc28,
 * strategy doc 2d8a3dd). Dataset c3c1dce.
 * RESEARCH VERDICT: TRAIN_ONLY_NOT_VALIDATED — the pre-registered headline passed F1/F2/F3 on TRAIN but
 * VALIDATION was never run (window already spent by V3.0) and the result is tail-fragile
 * (ex-top-1 % gross 0.0264 R < fee drag 0.0511 R). The seven other runs are SENSITIVITY only.
 * ⚠️ Historical research only. Not a validated strategy. CRYPTORA does not execute trades.
 */

import type {
  ReproductionEvidence, ResultOrigin, SourceFilePin, SpecResearchDiscrepancy, StrategyDefinition, StrategyVariant,
} from '../../types';
import { V33_CONSTANTS } from './v33Core';
import { runV33Series, V33_VARIANT_IDS } from './v33Runner';
import aWPD from '../../results/v33/v33-train-metrics-while-protective-displacement.json' with { type: 'json' };
import aWPS from '../../results/v33/v33-train-metrics-while-protective-swing.json' with { type: 'json' };
import aWCD from '../../results/v33/v33-train-metrics-while-climax-displacement.json' with { type: 'json' };
import aWCS from '../../results/v33/v33-train-metrics-while-climax-swing.json' with { type: 'json' };
import aFPD from '../../results/v33/v33-train-metrics-first-protective-displacement.json' with { type: 'json' };
import aFPS from '../../results/v33/v33-train-metrics-first-protective-swing.json' with { type: 'json' };
import aFCD from '../../results/v33/v33-train-metrics-first-climax-displacement.json' with { type: 'json' };
import aFCS from '../../results/v33/v33-train-metrics-first-climax-swing.json' with { type: 'json' };
import rWPD from '../../results/v33/cryptora-reproduction/v33-train-while-protective-displacement-reproduction.json' with { type: 'json' };
import rWPS from '../../results/v33/cryptora-reproduction/v33-train-while-protective-swing-reproduction.json' with { type: 'json' };
import rWCD from '../../results/v33/cryptora-reproduction/v33-train-while-climax-displacement-reproduction.json' with { type: 'json' };
import rWCS from '../../results/v33/cryptora-reproduction/v33-train-while-climax-swing-reproduction.json' with { type: 'json' };
import rFPD from '../../results/v33/cryptora-reproduction/v33-train-first-protective-displacement-reproduction.json' with { type: 'json' };
import rFPS from '../../results/v33/cryptora-reproduction/v33-train-first-protective-swing-reproduction.json' with { type: 'json' };
import rFCD from '../../results/v33/cryptora-reproduction/v33-train-first-climax-displacement-reproduction.json' with { type: 'json' };
import rFCS from '../../results/v33/cryptora-reproduction/v33-train-first-climax-swing-reproduction.json' with { type: 'json' };

const art = (id: string) => `artifacts/research/v33/v33-train-metrics-${id}.json`;

/** All 8 archived runs. Only the first is the historically pre-registered headline; the rest are sensitivity. */
export const V33_VARIANTS: readonly StrategyVariant[] = Object.freeze([
  { id: 'while-protective-displacement', label: 'window=while, stop=protective, leg=displacement', sourceRole: 'PRIMARY (pre-registered, isPrimary)', sourceVerdict: 'F1 PASS net +0.0267 @2/5 (gross +0.0778, n=6957); F2 HOLDS 0.0511; F3 HOLDS 65.24 % — tail-fragile (ex-top-1 % 0.0264 < fee 0.0511)', artifactPath: art('while-protective-displacement'), artifactSha256: '61cdc7929412e58c030836293263ab7304d7bd9307a2cbf09322799ef8cf0513' },
  { id: 'while-protective-swing', label: 'window=while, stop=protective, leg=swing', sourceRole: 'SENSITIVITY (Amendment 1 leg)', sourceVerdict: 'F1 PASS net +0.0233 (n=2087); F2/F3 hold (56.54 %)', artifactPath: art('while-protective-swing'), artifactSha256: '9b43839f8607bd809d1ab08db77f47377eda855923663869ea6deb7d75b933a3' },
  { id: 'while-climax-displacement', label: 'window=while, stop=climax, leg=displacement', sourceRole: 'SENSITIVITY (tighter stop)', sourceVerdict: 'F1 PASS net +0.1058 (n=6263); F2/F3 hold (60.96 %) — post-hoc, NOT the pre-registered stop', artifactPath: art('while-climax-displacement'), artifactSha256: '8c87de344857ad74f69de78f421fff3917e54224f801c8d339e2bcb260a0fa12' },
  { id: 'while-climax-swing', label: 'window=while, stop=climax, leg=swing', sourceRole: 'SENSITIVITY', sourceVerdict: 'F1 PASS net +0.0920 (n=1856); F3 FALSIFIED (49.78 % < 50 %)', artifactPath: art('while-climax-swing'), artifactSha256: '6a07bf9023f4ccc9f08857e7f0d1a5d9cd329f0af1b7f4730cf62c88ca554e75' },
  { id: 'first-protective-displacement', label: 'window=first, stop=protective, leg=displacement', sourceRole: 'SENSITIVITY (first-touch only)', sourceVerdict: 'F1 FAIL net −0.0253 (n=600); F2/F3 hold', artifactPath: art('first-protective-displacement'), artifactSha256: 'de794663ffede558daf051fdca564bce6d9210b1dcfd1c0e3ea2fd70fa3375d2' },
  { id: 'first-protective-swing', label: 'window=first, stop=protective, leg=swing', sourceRole: 'SENSITIVITY', sourceVerdict: 'F1 FAIL net −0.0343 (n=111, underpowered)', artifactPath: art('first-protective-swing'), artifactSha256: '1ae86863b00c02e55565fd879341f41d830965476fd28bc1335c7199b5bd582d' },
  { id: 'first-climax-displacement', label: 'window=first, stop=climax, leg=displacement', sourceRole: 'SENSITIVITY', sourceVerdict: 'F1 PASS net +0.0612 (n=542); F2/F3 hold', artifactPath: art('first-climax-displacement'), artifactSha256: 'a286de8143dda82d650a73851c4bc137d0a2258cf82cafef7aa56f6d90f82b73' },
  { id: 'first-climax-swing', label: 'window=first, stop=climax, leg=swing', sourceRole: 'SENSITIVITY', sourceVerdict: 'F1 PASS net +0.1456 (n=97, underpowered; ex-top-5 −0.0252)', artifactPath: art('first-climax-swing'), artifactSha256: '6e4cf8f609c4ea089a2b7471519cbcdac05ae7a267ffc37e24e7dabc6c8fe10a' },
]);
if (V33_VARIANTS.length !== V33_VARIANT_IDS.length) throw new Error('V3.3 variant table out of sync');

export const V33_SOURCE_PINS: readonly SourceFilePin[] = Object.freeze([
  { role: 'PREREGISTRATION', path: 'docs/V3_3_HTF_ZONE_MITIGATION_PREREGISTRATION.md', sha256: '1ddf4cdebec4d29d47cd544860d8148f588b8b9869b3779b74446aaab9599ca8' },
  { role: 'PREREGISTRATION', path: 'docs/V3_3_HTF_ZONE_MITIGATION_PREREGISTRATION_AMENDMENT_1.md', sha256: '9d001bbdfe336f85a571728d3549e5a47781a44afc401f853c2d7f4f22e520a5' },
  { role: 'RESULTS_DOC', path: 'docs/V3_3_HTF_ZONE_MITIGATION_TRAIN_RESULTS.md', sha256: 'f0a5f36943e7d473a53ad779e0a8e59fa05ac99bc726bedc2196beb504fb1eda' },
  { role: 'RESEARCH_IMPLEMENTATION', path: 'research/v33_zone_mitigation.ts', sha256: '3f5b1478a1b0c240a85b28a0280d61761246091ca0ed122fab2e03113fe2b1c6' },
  { role: 'SHARED_PRIMITIVE', path: 'src/strategy/v2/structure.ts', sha256: 'e04806a33d1ebc4bab24f12f5240c7320ae8e00276157833e51534152a4e662f' },
  { role: 'SHARED_PRIMITIVE', path: 'src/strategy/v2/indicators.ts', sha256: '10594cadf615b0e048797e1db9504648794b0cbec41b62da6ec55641d1daa55c' },
  ...V33_VARIANTS.map((v) => ({ role: 'ARTIFACT' as const, path: v.artifactPath, sha256: v.artifactSha256 })),
  { role: 'SETTINGS', path: 'artifacts/research/v2-real-20260915-080338/settings.json', sha256: '92311c4f9a96bc2e6922fc952aacc53ae473ffb22bcb6749b11c2a0cfa0cd3f9' },
  { role: 'SPLITS', path: 'artifacts/research/v2-real-20260915-080338/splits.json', sha256: 'a44eed9ae3ad036853f14845113e392c434081301b21647398a4a3af2ab84f0b' },
]);

export const V33_COMMITS = Object.freeze({
  preregistration: '16728ef',
  amendment1: '01cbc28',
  trainResult: 'a7ecd79',
  strategyDoc: '2d8a3dd',
  historicalPin: 'a7ecd79',
  dataset: 'c3c1dcecfe2784a147f591f2b5b4526cbf99df9f',
});

export const V33_DISCREPANCIES: readonly SpecResearchDiscrepancy[] = Object.freeze([
  {
    id: 'D-V33-001',
    specStatement: 'Early working title / first pre-registration draft wording: "HTF Zone Continuation".',
    researchBehaviour: 'The implemented logic trades a REVERSAL out of the mitigated zone in the direction of the original displacement (mitigation / reversal entry), and the final docs call it "Zone Mitigation & LTF Squeeze".',
    impact: 'Naming only; the archived name is the final one. Recorded so the rename is not mistaken for a second strategy.',
    reproductionPolicy: 'PRESERVE_RESEARCH_BEHAVIOUR',
    evidence: ['docs/V3_3_HTF_ZONE_MITIGATION_PREREGISTRATION.md', 'docs/strategies/V3_3_HTF_ZONE_MITIGATION.md @2d8a3dd'],
  },
  {
    id: 'D-V33-002',
    specStatement: 'Programme convention: one position at a time.',
    researchBehaviour: 'Runner continues scanning on the fill bar with `pend = null` — overlapping trades possible (same family as D-V30-001 / D-V32-001). With `while` windows this materially inflates n (6,957).',
    impact: 'n and per-trade metrics are not those of a single-position portfolio; preserved as written.',
    reproductionPolicy: 'PRESERVE_RESEARCH_BEHAVIOUR',
    evidence: ['research/v33_zone_mitigation.ts `main()` pending/fill block'],
  },
  {
    id: 'D-V33-003',
    specStatement: 'Pre-registration text does not name the corridor expiry.',
    researchBehaviour: 'CORRIDOR_EXPIRY_BARS = 3 inherited verbatim from V3.0; TIMEOUT 48 as V3.2.',
    impact: 'Documented inherited constant.',
    reproductionPolicy: 'PRESERVE_RESEARCH_BEHAVIOUR',
    evidence: ['research/v33_zone_mitigation.ts constants block'],
  },
  {
    id: 'D-V33-004',
    specStatement: 'Pre-registration: one primary configuration.',
    researchBehaviour: 'Eight runs (window × stop × leg) were executed and archived; the primary was pre-declared (`isPrimary`) and Amendment 1 added the `swing` leg and the tie-break before results were read. `stop=climax` variants show larger net R but are post-hoc sensitivity.',
    impact: 'Any presentation of +0.1058 (while-climax-displacement) as "the V3.3 result" would be post-hoc selection; the archived headline is +0.0267 TRAIN-only.',
    reproductionPolicy: 'PRESERVE_RESEARCH_BEHAVIOUR',
    evidence: ['docs/V3_3_HTF_ZONE_MITIGATION_TRAIN_RESULTS.md', 'docs/V3_3_HTF_ZONE_MITIGATION_PREREGISTRATION_AMENDMENT_1.md'],
  },
  {
    id: 'D-V33-005',
    specStatement: 'Pre-registration: VALIDATION would follow a TRAIN pass.',
    researchBehaviour: 'VALIDATION was never run: the single VALIDATION window had already been read by V3.0 (2026-09-16) and TEST-2026 must stay unread. Source status = V3_3_TRAIN_ONLY.',
    impact: 'No out-of-sample evidence exists. This is NOT a validated strategy and must never be compared with V3.0 VALIDATION numbers.',
    reproductionPolicy: 'PRESERVE_RESEARCH_BEHAVIOUR',
    evidence: ['docs/strategies/V3_3_HTF_ZONE_MITIGATION.md @2d8a3dd (status block)'],
  },
]);

export const V33_SOURCE_RESULTS = Object.freeze({
  origin: 'SOURCE_REPORTED' as ResultOrigin,
  train: {
    'while-protective-displacement': aWPD, 'while-protective-swing': aWPS, 'while-climax-displacement': aWCD, 'while-climax-swing': aWCS,
    'first-protective-displacement': aFPD, 'first-protective-swing': aFPS, 'first-climax-displacement': aFCD, 'first-climax-swing': aFCS,
  },
  windows: { train: { fromUtc: '2022-01-01T00:00:00Z', toUtc: '2024-05-26T13:00:00Z' } },
  validation: 'NEVER RUN — VALIDATION window already spent by V3.0; source status V3_3_TRAIN_ONLY.',
});

const repro = [rWPD, rWPS, rWCD, rWCS, rFPD, rFPS, rFCD, rFCS];
export const V33_REPRODUCTION_EVIDENCE: readonly ReproductionEvidence[] = Object.freeze(
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
    evidencePath: `src/services/strategyArchive/results/v33/cryptora-reproduction/v33-train-${e.variantId}-reproduction.json`,
  })),
);
export const V33_REPRODUCED_RESULTS = Object.freeze({
  origin: 'DERIVED_BY_CRYPTORA' as ResultOrigin,
  train: {
    'while-protective-displacement': rWPD, 'while-protective-swing': rWPS, 'while-climax-displacement': rWCD, 'while-climax-swing': rWCS,
    'first-protective-displacement': rFPD, 'first-protective-swing': rFPS, 'first-climax-displacement': rFCD, 'first-climax-swing': rFCS,
  },
});

export const V33_CAVEATS_RU: readonly string[] = Object.freeze([
  'Исследование: ТОЛЬКО TRAIN, НЕ ВАЛИДИРОВАНО (источник: V3_3_TRAIN_ONLY). Предзаявленный основной вариант прошёл F1/F2/F3 на TRAIN (net +0.0267 R/сделку @2/5 bps, n=6957), но окно VALIDATION уже было израсходовано V3.0, а TEST-2026 не читается — внесэмпловых данных нет.',
  'Результат хрупок по хвосту: без верхнего 1 % сделок gross 0.0264 R < комиссионное трение 0.0511 R. TRAIN — «сожжённые» данные (их читали V3.0, V3.1, V3.2).',
  'Архивированы все 8 прогонов (window × stop × leg). Только while/protective/displacement — исторический headline; остальные — чувствительность. Варианты stop=climax (до +0.1058) — постфактум; показывать их как «результат V3.3» — отбор по результату. Оба first/protective проваливают F1.',
  'Это стратегия РАЗВОРОТА из митигированной зоны (mitigation), а не «Zone Continuation», как в раннем черновике названия (D-V33-001).',
  'Раннер допускал перекрывающиеся позиции (D-V33-002): при window=while это существенно раздувает n.',
  'Не сопоставимо напрямую с V3.0 (там есть VALIDATION), V3.1 и V3.2: другие зоны (OB/FVG 4H), TIMEOUT 48, RVOL ≥ 1.25 включительно.',
  '«Воспроизведено» — повторяемость чисел, не пригодность стратегии. CRYPTORA не исполняет сделки.',
]);

export const V33_RULES_RU = Object.freeze({
  zones: '4H: displacement (тело ≥ 0.6 ATR(14)) создаёт зону — Order Block (последняя противоположная свеча за ≤ 5 баров) и/или FVG (3-свечной дисбаланс ≥ 0.15 ATR). OB известен с закрытия бара i, FVG — с i+1.',
  mitigation: '1H: OB митигирован при первом касании, «умирает» при закрытии за дальней границей; FVG — при заполнении ≥ 50 %, умирает при полном заполнении. window=while: любой бар окна; window=first: только бар митигации.',
  entry: '1H-бар пересекает зону, RVOL ≥ 1.25 и есть абсорбция: тень отклонения ≥ 35 % и/или тело ≥ 40 % с закрытием в крайних 30 % диапазона. Несколько зон → самая свежая (OB перед FVG). Лимитный коридор close ± 0.10 ATR, исполнение с N+1, срок 3 бара.',
  stop: 'protective: за min/max(экстремум климакса, граница зоны) ± 0.15 ATR; climax: за экстремумом климаксной свечи ± 0.15 ATR.',
  targets: 'TP1 = середина ноги displacement (или подтверждённой swing-ноги 4H в leg=swing) → безубыток; TP2 = противоположный подтверждённый 4H swing.',
  timeout: '48 баров 1H, свеча входа считается первой.',
  intrabar: 'R1–R5 как в V3.0.',
  fees: 'Вход maker 2 bps, выходы taker 5 bps; стресс 5/5.',
});

const definition: StrategyDefinition = {
  id: 'V3_3_HTF_ZONE_MITIGATION',
  version: '3.3',
  name: 'HTF Zone Mitigation & LTF Squeeze',
  nameRu: 'Митигация зоны HTF и сжатие LTF',
  verdict: 'TRAIN_ONLY_NOT_VALIDATED',
  reproducibility: 'REPRODUCED',
  reproductionEvidence: V33_REPRODUCTION_EVIDENCE,
  variants: V33_VARIANTS,
  headlineVariantId: 'while-protective-displacement',
  slicesAvailable: ['train'],
  execTimeframe: V33_CONSTANTS.EXEC_TF,
  structuralTimeframe: V33_CONSTANTS.STRUCT_TF,
  symbols: V33_CONSTANTS.SYMBOLS,
  assumptions: {
    fees: { kind: 'PER_LEG_BPS', makerBps: V33_CONSTANTS.MAKER_BPS, takerBps: V33_CONSTANTS.TAKER_BPS, entryIsMaker: true },
    stressFees: { kind: 'PER_LEG_BPS', makerBps: V33_CONSTANTS.STRESS_MAKER_BPS, takerBps: V33_CONSTANTS.STRESS_TAKER_BPS, entryIsMaker: true },
    slippage: 'NOT_MODELLED', funding: 'NOT_MODELLED', spread: 'NOT_MODELLED',
    positionSizing: 'NONE_R_MULTIPLES_ONLY', marketData: 'BINANCE_SPOT_KLINES', feeVenueAssumed: 'BINANCE_USDT_FUTURES',
  },
  discrepancies: V33_DISCREPANCIES,
  sourcePins: V33_SOURCE_PINS,
  runSeries: runV33Series,
};
export const V33_DEFINITION: StrategyDefinition = Object.freeze(definition);

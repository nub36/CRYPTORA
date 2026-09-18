/**
 * V2.1b — CONFIRMED-EXTREME CORRIDOR ENTRY (7-arm ablation A/E/F/C/EF/EFC/FULL) — archived definition (immutable).
 *
 * Source: svechnoy-suslik-v2 @ 374b335 (TRAIN results + decision; pre-registration 5ce3761; timeframe×cost diagnostic
 * dccf751). Frozen V2 engine 4839074 supplies setup/stop/ladder/outcome; V2.1b adds three pre-registered gates
 * (confirmed extreme, fee-drag guard, confluence ≥ 3/4) and a corridor entry centred on close(N) (±0.10 ATR, 3-bar expiry).
 *
 * RESEARCH VERDICT: REJECTED_ON_TRAIN (source status CORRIDOR_ENTRY_REJECTED_ON_TRAIN; superseded by V2.8). On the
 * pre-registered primary metric — gross per ORIGINAL actionable setup — NO filtered arm beats the unfiltered baseline
 * (A +0.0090; FULL +0.0001). The fee-drag guard removed the edge with the cost (rejected setups had baseline gross +0.0676
 * vs +0.0142 admitted). VALIDATION was NOT run and NOT burned. The corridor mechanic solved the MISSED defect of V2.1a
 * (277 missed, 1-bar median latency) but preserved no edge. By-product: the timeframe×cost diagnostic (Spot 0.1 %
 * stops destroying gross at 4h baseline / 1h with filters) which set the 15m…4h scope of V2.2+.
 * ⚠️ Historical research only. CRYPTORA does not execute trades.
 */

import type {
  ResultOrigin, SourceFilePin, SpecResearchDiscrepancy, StrategyDefinition, StrategyVariant,
} from '../../types';
import { runV21bSeries, V21B_ARM_IDS, V21B_ARMS, V21B_SCOPE, V21B_SYMBOLS } from './v21bRunner';
import {
  CONFLUENCE_MIN, CORRIDOR_ATR_FRAC, CORRIDOR_MAX_PCT, EXPIRY_BARS, FEE_GUARD_ATR, FEE_GUARD_PCT, RVOL_MIN,
} from '../../legacy/v2/corridorEntry';
import aTrain from '../../results/v21b/corridor-train-metrics.json' with { type: 'json' };
import aTfDiag from '../../results/v21b/tf-cost-diagnostic.json' with { type: 'json' };

const ARTIFACT = 'artifacts/research/corridor/corridor-train-metrics.json';
const ARTIFACT_SHA = '13267c74f8f3252628c92532b08df335307074affb3289b5a9861bfe3c129d80';
const TFDIAG = 'artifacts/research/corridor/tf-cost-diagnostic.json';
const TFDIAG_SHA = 'd7eb16c0a87373999181aa9f38229fe36a8fa8892a64f019cd96b1e39a957df7';

export const V21B_CONSTANTS = Object.freeze({
  SCOPE: V21B_SCOPE, SYMBOLS: V21B_SYMBOLS, ARMS: V21B_ARMS,
  CORRIDOR_ATR_FRAC, CORRIDOR_MAX_PCT, EXPIRY_BARS, FEE_GUARD_PCT, FEE_GUARD_ATR, CONFLUENCE_MIN, RVOL_MIN,
  FROZEN_FEE_PCT: 0.1,
  HEADLINE_MAKER_BPS: 5, HEADLINE_TAKER_BPS: 5, STRESS_MAKER_BPS: 2, STRESS_TAKER_BPS: 5,
  PRIMARY_METRIC: 'gross expectancy per ORIGINAL actionable setup (pre-registered §10)',
});

type Arm = { actionableSetups: number; pendingCreated: number; closed: number; fillRateOfActionable: number; fillRateOfPending: number;
  grossExpectancyPerFilled: number; grossExpectancyPerActionableSetup: number; grossPF: number | null; maxDrawdownR: number;
  netExpectancyPerFilled: Record<string, number>; riskPct: { median: number }; fillLatencyBars: { median: number } };
const ARMS_RU: Record<string, string> = {
  A: 'A — baseline (без фильтров, OPEN N+1)', E: 'E — confirmed extreme', F: 'F — fee-drag guard', C: 'C — confluence ≥ 3/4',
  EF: 'EF — extreme + fee guard', EFC: 'EFC — все три фильтра, вход OPEN N+1', FULL: 'FULL — три фильтра + коридор',
};

export const V21B_VARIANTS: readonly StrategyVariant[] = Object.freeze(
  V21B_ARM_IDS.map((id) => {
    const a = (aTrain.arms as Record<string, Arm>)[id]!;
    const role = id === 'A' ? 'BASELINE ANCHOR' : id === 'FULL' ? 'PRE-REGISTERED FULL SYSTEM — rejected (no arm carried forward)' : 'ABLATION ARM';
    return {
      id, label: ARMS_RU[id] ?? id, sourceRole: role,
      sourceVerdict: `closed ${a.closed}; fill ${a.fillRateOfActionable} % of setups; GROSS ${a.grossExpectancyPerFilled} R/filled, ${a.grossExpectancyPerActionableSetup} R/setup (PRIMARY); `
        + `PF ${a.grossPF}; NET @0.1 % lump ${a.netExpectancyPerFilled['10bps']} R; median stop ${a.riskPct.median} %; latency ${a.fillLatencyBars.median} bar`,
      artifactPath: ARTIFACT, artifactSha256: ARTIFACT_SHA,
    };
  }),
);

export const V21B_SOURCE_PINS: readonly SourceFilePin[] = Object.freeze([
  { role: 'PREREGISTRATION', path: 'docs/V2_1_CONFIRMED_EXTREME_CORRIDOR_PREREGISTRATION.md', sha256: '38a1874e87b84708d695be18b497e9dc02c46d9d3ee632339fa2b350d0a48542' },
  { role: 'RESULTS_DOC', path: 'docs/V2_1_CORRIDOR_TRAIN_RESULTS.md', sha256: 'beab6766699098a6c80da6fef41f0f8e72d8db30a99eccf44343f059fb810630' },
  { role: 'DECISION', path: 'docs/V2_1_CORRIDOR_DECISION.md', sha256: '10c8a37c683b908668f90d0bd7d19dadeee4ed978336f3be6bc9da6a1448e058' },
  { role: 'DIAGNOSTIC_DOC', path: 'docs/V2_1_TIMEFRAME_COST_DIAGNOSTIC.md', sha256: 'eafdcedfc2b3972d5d351ea3728790b59cca9c7b2f818a2f6053e5fc80abd873' },
  { role: 'SPEC', path: 'docs/strategies/V2_1_CORRIDOR_ENTRY.md (retrospective archive spec covering V2.1a+V2.1b, added at 1f3ae3a; hashed at 2d8a3dd)', sha256: '0339e98ea35c544b068f1bedafb5ebcadfeab0f19c51b85dd9b086919845f141' },
  { role: 'RESEARCH_IMPLEMENTATION', path: 'scripts/real-data/corridor-entry.ts', sha256: 'c2eebef8af2dea3c92f4a221a6a5a6eb37ed00585385845b16ea83c74bfaf6bf' },
  { role: 'RESEARCH_IMPLEMENTATION', path: 'scripts/real-data/corridor-replay.ts', sha256: 'eb3ba5a4c2c0a22b11a1b1c6fa03ca75287b9b649ecf61aef23f4d0875624f6e' },
  { role: 'RUNNER', path: 'scripts/real-data/corridor-train.ts', sha256: 'aa84770ae7ae313d2366928cacb34aa9d09715298cb2a5fc42cb10bdbdf06ff4' },
  { role: 'RUNNER', path: 'scripts/real-data/corridor-tf-arms.ts (diagnostic arms A/FULL)', sha256: '5999cb3eac69bdeac5ae9a13177d2bd37f78d91b57efd62508243d78355d33d2' },
  { role: 'ARTIFACT', path: ARTIFACT, sha256: ARTIFACT_SHA },
  { role: 'ARTIFACT', path: TFDIAG, sha256: TFDIAG_SHA },
  { role: 'SETTINGS', path: 'artifacts/research/v2-real-20260915-080338/settings.json', sha256: '92311c4f9a96bc2e6922fc952aacc53ae473ffb22bcb6749b11c2a0cfa0cd3f9' },
  { role: 'SPLITS', path: 'artifacts/research/v2-real-20260915-080338/splits.json', sha256: 'a44eed9ae3ad036853f14845113e392c434081301b21647398a4a3af2ab84f0b' },
]);

export const V21B_COMMITS = Object.freeze({
  preregistration: '5ce3761', trainResult: '374b335', tfCostDiagnostic: 'dccf751', historicalPin: '374b335',
  frozenEngine: '4839074', dataset: 'c3c1dcecfe2784a147f591f2b5b4526cbf99df9f',
});

export const V21B_DISCREPANCIES: readonly SpecResearchDiscrepancy[] = Object.freeze([
  {
    id: 'D-V21B-001',
    specStatement: 'Pre-registration §4: the fee-drag guard (stop ≥ 0.35 % AND ≥ 0.5 ATR) makes per-trade expectancy rise "purely because fee-in-R shrinks" — per-setup gross is primary.',
    researchBehaviour: 'Confirmed and worse: setups the guard REJECTED had baseline gross +0.0676 (n=107,742) vs +0.0142 (n=19,253) admitted — the guard filtered tight stops, and tight-stop trades carried the edge. FULL net per filled improved 6.2× (−0.7289 → −0.1167) while per-setup gross is +0.0001.',
    impact: '"Less bad per trade by trading 1.69 % of setups" is cost avoidance, not alpha (source wording). Archive shows per-setup first.',
    reproductionPolicy: 'PRESERVE_RESEARCH_BEHAVIOUR',
    evidence: ['docs/V2_1_CORRIDOR_DECISION.md "Why rejected" 1–2'],
  },
  {
    id: 'D-V21B-002',
    specStatement: 'Corridor fill rate.',
    researchBehaviour: 'True fill rate of published corridors is 24.09 % (56,492 of 234,478); 176,707 (75.36 %) corridors were rejected AT FILL on rr1 < risk.min_rr because the structural stop is not shifted to the fill. A conditional 97.79 % figure (fills among non-rejected) also appears in the source.',
    impact: 'Only the 24.09 % figure is used by the archive; the conditional figure is not a fill rate.',
    reproductionPolicy: 'PRESERVE_RESEARCH_BEHAVIOUR',
    evidence: ['docs/V2_1_CORRIDOR_DECISION.md "What is worth keeping"', 'corridor-train-metrics.json arms.FULL.terminal/rejectReasons'],
  },
  {
    id: 'D-V21B-003',
    specStatement: 'Premise: EQH/EQL (EQUAL) pools are the strongest liquidity magnets.',
    researchBehaviour: 'EQUAL is the WORST pool kind (−0.0035, n=12,808) while CLUSTER is the best (+0.0218, n=5,013); reversal path effectively dead (445 of 56,486 closed).',
    impact: 'A design premise was contradicted on TRAIN; recorded, not "fixed".',
    reproductionPolicy: 'PRESERVE_RESEARCH_BEHAVIOUR',
    evidence: ['corridor-train-metrics.json arms.FULL.byPoolKind / bySetupKind'],
  },
  {
    id: 'D-V21B-004',
    specStatement: 'Archive convention: per-leg fee columns.',
    researchBehaviour: 'V2.1b reported NET at the frozen 0.1 % lump and a 0/2/5/10/20 bps ROUND-TRIP sensitivity on mean(entry/risk) (`netExpectancyPerFilled["10bps"]` = frozen lump). No per-leg model yet.',
    impact: 'CRYPTORA per-leg columns (SPOT 5/5 headline; FUT_7 2/5 stress) are derived context, not byte-equal to the source; reproduction compares gross, counts and distributions. Not comparable with V2.2+ net@2/5 or V3.x.',
    reproductionPolicy: 'PRESERVE_RESEARCH_BEHAVIOUR',
    evidence: ['scripts/real-data/corridor-train.ts BPS / invSum'],
  },
  {
    id: 'D-V21B-005',
    specStatement: 'Timeframe × cost diagnostic (dccf751) is measurement, not a strategy result.',
    researchBehaviour: 'Baseline A survives the 0.1 % Spot round trip only at 4h (+0.0321 net, n=1,025) and 1d (+0.3263, n=132); FULL from 1h (+0.0294, n=1,037). Sub-hourly is "arithmetically dead on Spot". Finding acknowledged and carried into the V2.2 scope (15m…4h) at 1b4f09b.',
    impact: 'These per-timeframe cells are TRAIN-only slices read AFTER the pooled result; they must not be presented as a validated 4h/1d strategy. Stored as a diagnostic artifact.',
    reproductionPolicy: 'PRESERVE_RESEARCH_BEHAVIOUR',
    evidence: ['docs/V2_1_TIMEFRAME_COST_DIAGNOSTIC.md §3–§6', 'tf-cost-diagnostic.json'],
  },
  {
    id: 'D-V21B-006',
    specStatement: 'Pool-kind labelling.',
    researchBehaviour: 'corridor-train.ts enables the expensive `extremePoolKind` diagnostic for arm FULL only (`--poolKinds=true`); other arms record NONE. The label never gates a trade.',
    impact: 'CRYPTORA runner mirrors this (poolKinds only for FULL); results are unaffected by the flag.',
    reproductionPolicy: 'PRESERVE_RESEARCH_BEHAVIOUR',
    evidence: ['scripts/real-data/corridor-train.ts main()'],
  },
]);

export const V21B_SOURCE_RESULTS = Object.freeze({
  origin: 'SOURCE_REPORTED' as ResultOrigin,
  train: aTrain,
  tfCostDiagnostic: aTfDiag,
  primaryMetricPerSetup: { A: 0.0090, E: 0.0059, C: 0.0011, FULL: 0.0001, F: -0.0003, EF: -0.0002, EFC: 0 },
  feeSemantics: 'NET_AT_FROZEN_0_1PCT_LUMP + GROSS reconstructed; bps sensitivity 0/2/5/10/20 round-trip',
  windows: { train: { fromUtc: '2022-01-01T00:00:00Z', toUtc: '2024-05-26T13:00:00Z (per-series boundaries from frozen splits.json)' } },
  validation: 'NOT RUN and NOT burned (decision §10) — no arm carried forward.',
});

export const V21B_CAVEATS_RU: readonly string[] = Object.freeze([
  'Исследование: ОТКЛОНЕНО НА TRAIN (источник: CORRIDOR_ENTRY_REJECTED_ON_TRAIN; superseded V2.8). По предзаявленной первичной метрике — gross на ИСХОДНЫЙ actionable-сетап — ни одна отфильтрованная ветка не превосходит baseline: A +0.0090, E +0.0059, C +0.0011, FULL +0.0001, F −0.0003, EF −0.0002, EFC 0. Валидация не запускалась и не «сожжена».',
  'Fee-drag guard убрал edge вместе с комиссией: отклонённые им сетапы имели baseline gross +0.0676 против +0.0142 у допущенных (D-V21B-001). Улучшение net на сделку в 6.2× (−0.7289 → −0.1167) — избегание издержек, а не альфа: FULL торгует 1.69 % сетапов.',
  'Коридор решил дефект V2.1a (только 277 MISSED, медианная задержка 1 бар), но реальный fill rate коридоров 24.09 % — 75.36 % отклонены при заполнении по rr1 < min_rr (D-V21B-002). Реверсальный путь фактически мёртв (445 из 56 486); премисса EQH/EQL опровергнута — EQUAL худший пул, CLUSTER лучший (D-V21B-003).',
  'Комиссионная модель источника — lump 0.1 % (Spot round-trip) + чувствительность 0/2/5/10/20 bps; per-leg колонки CRYPTORA — производный контекст, НЕ сопоставимый с net@2/5 V2.2+ и V3.x (D-V21B-004).',
  'Побочный результат — диагностика таймфрейм × стоимость: baseline переживает 0.1 % Spot только на 4h/1d, FULL — с 1h; это TRAIN-срезы, прочитанные постфактум, а не валидированная стратегия (D-V21B-005). Именно это задало область 15m…4h для V2.2+.',
  'Область: все 42 ряда 1m…1d × 6 символов; пул определяется 1m/5m. Входы — замороженный движок V2 4839074.',
  'CRYPTORA не исполняет сделки.',
]);

export const V21B_RULES_RU = Object.freeze({
  entry: 'Сетап — замороженный движок V2 (4839074) на закрытом баре N. Гейты (предзаявлены): E — confirmed extreme (реверсал: свип ≥ 0.10 ATR, тень ≥ 0.25, реклейм ≤ 3 бара; континуация: close ≥ 0.25 ATR за уровнем, тело ≥ 0.50, удержание ≥ 1 бар); F — стоп ≥ 0.35 % цены И ≥ 0.5 ATR (стоп никогда не расширяется); C — confluence ≥ 3 из 4 (RVOL > 1.2, RSI-дивергенция/зона 45/55, MACD, EMA).',
  fill: 'Коридор: centre = close(N), halfWidth = clamp(0.10·ATR, 1 тик, 0.15 % цены), заполнение с N+1 по худшему краю зоны; экспирация 3 бара; SL до заполнения → CANCELLED; TP1 до заполнения → MISSED; fill и SL в одном баре → CANCELLED. Ветки без corridor — вход по OPEN N+1.',
  stop: 'Структурный стоп frozen-движка (+0.25 ATR), не сдвигается к заполнению; rr1 < risk.min_rr → REJECTED_GEOMETRY.',
  exit: 'Frozen SMC-лестница целей (последняя ступень), 48 баров, SL-приоритет. Одна позиция одновременно.',
  fees: 'Источник: lump 0.1 %; чувствительность 0/2/5/10/20 bps round-trip. Архив: SPOT 5/5 (контекст), FUT_7 2/5 (стресс).',
  scope: '1m/5m/15m/30m/1h/4h/1d × BTC/ETH/BNB/SOL/XRP/DOGE, TRAIN; 7 веток аблации одного и того же прохода.',
});

const definition: StrategyDefinition = {
  id: 'V2_1B_CORRIDOR_ENTRY',
  version: '2.1b',
  name: 'Confirmed-Extreme Corridor Entry (7-arm gate ablation)',
  nameRu: 'Коридорный вход (confirmed extreme)',
  verdict: 'REJECTED_ON_TRAIN',
  reproducibility: 'SOURCE_CHAIN_VERIFIED_NOT_RERUN',
  reproductionBlockedReason: 'Runner ported over the isolated legacy V2 engine (7 arms); the 42-series rerun (1m…1d, 1.3–3.3 M actionable setups per arm) was not executed. Chain prereg 5ce3761 → implementation hash → artifact hash verified at 374b335 (identical at 2d8a3dd).',
  legacyEngineDependency: 'FROZEN_V2_ENGINE_4839074',
  variants: V21B_VARIANTS,
  headlineVariantId: 'FULL',
  slicesAvailable: ['train'],
  execTimeframe: '1m',
  scopeTimeframes: V21B_CONSTANTS.SCOPE,
  structuralTimeframe: null,
  symbols: V21B_CONSTANTS.SYMBOLS,
  assumptions: {
    fees: { kind: 'PER_LEG_BPS', makerBps: V21B_CONSTANTS.HEADLINE_MAKER_BPS, takerBps: V21B_CONSTANTS.HEADLINE_TAKER_BPS, entryIsMaker: true },
    stressFees: { kind: 'PER_LEG_BPS', makerBps: V21B_CONSTANTS.STRESS_MAKER_BPS, takerBps: V21B_CONSTANTS.STRESS_TAKER_BPS, entryIsMaker: true },
    feeSemantics: 'NET_AT_FEES',
    slippage: 'NOT_MODELLED', funding: 'NOT_MODELLED', spread: 'NOT_MODELLED',
    positionSizing: 'NONE_R_MULTIPLES_ONLY', marketData: 'BINANCE_SPOT_KLINES', feeVenueAssumed: 'BINANCE_USDT_FUTURES',
  },
  discrepancies: V21B_DISCREPANCIES,
  sourcePins: V21B_SOURCE_PINS,
  runSeries: runV21bSeries,
};
export const V21B_DEFINITION: StrategyDefinition = Object.freeze(definition);

/**
 * Strategy Archive — presentation model (pure, derived from the registry).
 *
 * ⚠️ CRYPTORA DOES NOT EXECUTE TRADES. This module only *describes* archived research
 * for the read-only /strategies panel. It never ranks versions by profitability,
 * never merges RESEARCH VERDICT with REPRODUCTION STATUS, and flags incomparable
 * assumptions before any two versions are placed side by side.
 */
import type { ReproducibilityStatus, ResearchVerdict, StrategyDefinition } from './types';
import { STRATEGY_ARCHIVE } from './registry';
import { V30_SOURCE_RESULTS, V30_CAVEATS_RU, V30_RULES_RU, V30_COMMITS } from './definitions/v3_0-htf-liquidation-trap/definition';
import { V31_SOURCE_RESULTS, V31_CAVEATS_RU, V31_RULES_RU, V31_COMMITS } from './definitions/v3_1-htf-trend-pullback/definition';
import { V32_SOURCE_RESULTS, V32_CAVEATS_RU, V32_RULES_RU, V32_COMMITS } from './definitions/v3_2-volume-climax/definition';
import { V33_SOURCE_RESULTS, V33_CAVEATS_RU, V33_RULES_RU, V33_COMMITS } from './definitions/v3_3-htf-zone-mitigation/definition';
import { V27_SOURCE_RESULTS, V27_CAVEATS_RU, V27_RULES_RU, V27_COMMITS } from './definitions/v2_7-rr-optimization/definition';
import { V28_SOURCE_RESULTS, V28_CAVEATS_RU, V28_RULES_RU, V28_COMMITS } from './definitions/v2_8-zero-fee-sniper-trailing/definition';
import { V22_SOURCE_RESULTS, V22_CAVEATS_RU, V22_RULES_RU, V22_COMMITS } from './definitions/v2_2-htf-spot-engine/definition';
import { V23_SOURCE_RESULTS, V23_CAVEATS_RU, V23_RULES_RU, V23_COMMITS } from './definitions/v2_3-sniper-reversal/definition';
import { V24_SOURCE_RESULTS, V24_CAVEATS_RU, V24_RULES_RU, V24_COMMITS } from './definitions/v2_4-asymmetric-sniper/definition';
import { V25_SOURCE_RESULTS, V25_CAVEATS_RU, V25_RULES_RU, V25_COMMITS } from './definitions/v2_5-trailing-stop/definition';
import { V26_SOURCE_RESULTS, V26_CAVEATS_RU, V26_RULES_RU, V26_COMMITS } from './definitions/v2_6-sniper-trailing/definition';
import { V21A_SOURCE_RESULTS, V21A_CAVEATS_RU, V21A_RULES_RU, V21A_COMMITS } from './definitions/v2_1a-structural-limit-entry/definition';
import { V21B_SOURCE_RESULTS, V21B_CAVEATS_RU, V21B_RULES_RU, V21B_COMMITS } from './definitions/v2_1b-corridor-entry/definition';

/* ------------------------------------------------------------------ labels */

/** RESEARCH VERDICT → Russian label. Never mixed with reproducibility. */
export const VERDICT_LABEL_RU: Readonly<Record<ResearchVerdict, string>> = Object.freeze({
  VALIDATED_FOR_RESEARCH: 'ВАЛИДИРОВАНО ИСТОЧНИКОМ',
  VALIDATED_GROSS_ONLY: 'ВАЛИДИРОВАНО ИСТОЧНИКОМ (ТОЛЬКО GROSS, fees=0)',
  TRAIN_ONLY_NOT_VALIDATED: 'TRAIN ONLY — НЕ ВАЛИДИРОВАНО',
  FAILED_VALIDATION: 'ВАЛИДАЦИЯ ПРОВАЛЕНА',
  REJECTED_ON_TRAIN: 'ОТКЛОНЕНО НА TRAIN',
  FALSIFIED_ON_TRAIN: 'ФАЛЬСИФИЦИРОВАНО НА TRAIN',
  BASELINE: 'БАЗОВАЯ ЛИНИЯ',
});

/** REPRODUCTION STATUS → Russian label. "REPRODUCED" ≠ "successful". */
export const REPRO_LABEL_RU: Readonly<Record<ReproducibilityStatus, string>> = Object.freeze({
  REPRODUCED: 'ВОСПРОИЗВЕДЕНО В CRYPTORA',
  SOURCE_CHAIN_VERIFIED_NOT_RERUN: 'ЦЕПОЧКА ИСТОЧНИКА ПРОВЕРЕНА · НЕ ПЕРЕЗАПУСКАЛОСЬ',
  REPRODUCTION_MISMATCH: 'РАСХОЖДЕНИЕ ПРИ ПЕРЕЗАПУСКЕ',
  REPRODUCTION_BLOCKED: 'ПЕРЕЗАПУСК НЕВОЗМОЖЕН',
  UNVERIFIED: 'НЕ ПРОВЕРЕНО',
});

export type VerdictTone = 'positive' | 'neutral' | 'negative';
export function verdictTone(v: ResearchVerdict): VerdictTone {
  switch (v) {
    case 'VALIDATED_FOR_RESEARCH': return 'positive';
    case 'VALIDATED_GROSS_ONLY': case 'TRAIN_ONLY_NOT_VALIDATED': case 'BASELINE': return 'neutral';
    default: return 'negative';
  }
}

/* ----------------------------------------------------------------- filters */

export type ArchiveFilterId = 'ALL' | 'VALIDATED' | 'TRAIN_ONLY' | 'FAILED_VALIDATION' | 'REJECTED' | 'FALSIFIED';

export const ARCHIVE_FILTERS: readonly { id: ArchiveFilterId; label: string; verdicts: readonly ResearchVerdict[] | null }[] = Object.freeze([
  { id: 'ALL', label: 'Все', verdicts: null },
  { id: 'VALIDATED', label: 'Валидировано', verdicts: ['VALIDATED_FOR_RESEARCH', 'VALIDATED_GROSS_ONLY'] },
  { id: 'TRAIN_ONLY', label: 'Train-only', verdicts: ['TRAIN_ONLY_NOT_VALIDATED'] },
  { id: 'FAILED_VALIDATION', label: 'Провалена валидация', verdicts: ['FAILED_VALIDATION'] },
  { id: 'REJECTED', label: 'Отклонено', verdicts: ['REJECTED_ON_TRAIN'] },
  { id: 'FALSIFIED', label: 'Фальсифицировано', verdicts: ['FALSIFIED_ON_TRAIN'] },
]);

export function filterMatches(filter: ArchiveFilterId, verdict: ResearchVerdict): boolean {
  const f = ARCHIVE_FILTERS.find((x) => x.id === filter);
  return !f || f.verdicts === null || f.verdicts.includes(verdict);
}

/* ------------------------------------------------------------ comparability */

/**
 * Comparability group — versions in different groups must never be read side by side
 * without the explicit warning returned by `comparabilityWarnings()`.
 */
export type ComparabilityGroup = 'V3_NET_1H_4H' | 'V2_POOLED_4TF_NET' | 'V2_GROSS_ZERO_FEE' | 'V2_1_LUMP_FEE_7TF';

export const COMPARABILITY_GROUP_RU: Readonly<Record<ComparabilityGroup, string>> = Object.freeze({
  V3_NET_1H_4H: 'V3.x: 1h исполнение · 4h структура · нетто @2/5 bps за ногу · одна позиция на пару не гарантирована (перекрытие)',
  V2_POOLED_4TF_NET: 'V2.2–V2.7: замороженный движок V2 `4839074` · 15m/30m/1h/4h в одном пуле · нетто @2/5 bps · метрика на заполненный ордер',
  V2_GROSS_ZERO_FEE: 'V2.8: те же входы V2.x, но ВСЕ цифры gross при fees=0 — нетто не считалось',
  V2_1_LUMP_FEE_7TF: 'V2.1a/b: 1m…1d (7 ТФ) · нетто = единый lump 0.1 % на сделку · основная метрика — gross на исходный setup',
});

export interface AssumptionRow {
  period: string;
  validationType: 'TRAIN + VALIDATION' | 'TRAIN only';
  execTimeframe: string;
  structuralTimeframe: string;
  symbols: string;
  feeModel: string;
  feeSemantics: 'NET_AT_FEES' | 'GROSS_ONLY_ZERO_FEE' | 'NET_LUMP_0_1PCT';
  metricDenominator: 'на заполненный ордер' | 'на исходный actionable setup';
  entryEngine: 'V3 (собственные правила)' | 'frozen V2 4839074';
}

export interface HeadlineFigures {
  /** What the number refers to (source's pre-registered headline or an explicit "no headline" statement). */
  label: string;
  slice: 'TRAIN' | 'VALIDATION';
  n: number;
  grossRPerTrade: number | null;
  /** Net figure + its fee model, or a statement that net was not computed. */
  netRPerTrade: number | null;
  netFeeModel: string;
  origin: 'SOURCE_REPORTED';
}

export interface ArchiveCardModel {
  id: string;
  version: string;
  name: string;
  nameRu: string;
  verdict: ResearchVerdict;
  verdictLabelRu: string;
  verdictTone: VerdictTone;
  reproducibility: ReproducibilityStatus;
  reproLabelRu: string;
  reproDetailRu: string;
  reproducedTradeCounts: readonly { slice: string; n: number; digest: string }[];
  headline: readonly HeadlineFigures[];
  headlineNoteRu: string;
  assumptions: AssumptionRow;
  group: ComparabilityGroup;
  provenance: { sourcePin: string; dataset: string; artifactCount: number; discrepancyCount: number; frozenEngine: string | null };
  variantCount: number;
  rulesRu: Readonly<Record<string, string>>;
  caveatsRu: readonly string[];
  discrepancies: StrategyDefinition['discrepancies'];
  /** Ordering key: chronological programme order, never a performance rank. */
  order: number;
}

/* -------------------------------------------------------------- helpers */

const TRAIN = '2022-01-01 → 2024-05-26';
const VALID = '2024-05-26 → 2025-03-14';
const r4 = (x: number) => Math.round(x * 1e4) / 1e4;

// Loose views over frozen source artifacts (shapes differ per programme; values are read, never rewritten).
type Rec = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function v3Headline(label: string, slice: 'TRAIN' | 'VALIDATION', a: Rec): HeadlineFigures {
  return { label, slice, n: a.n, grossRPerTrade: a.grossRPerTrade, netRPerTrade: a.netRPerTrade.FUT_4, netFeeModel: '2/5 bps за ногу', origin: 'SOURCE_REPORTED' };
}
function v2Headline(label: string, slice: 'TRAIN' | 'VALIDATION', a: Rec, env: string): HeadlineFigures {
  return {
    label, slice, n: a.closed, grossRPerTrade: a.netByFeeEnv.GROSS.perFilled,
    netRPerTrade: a.netByFeeEnv[env].perFilled, netFeeModel: '2/5 bps за ногу', origin: 'SOURCE_REPORTED',
  };
}

function base(def: StrategyDefinition, group: ComparabilityGroup, commits: Rec, rules: Rec, caveats: readonly string[]) {
  const sourcePin = String(commits.historicalPin ?? commits.sourceHead ?? 'UNKNOWN').slice(0, 7);
  const frozen = def.legacyEngineDependency === 'FROZEN_V2_ENGINE_4839074' ? '4839074' : null;
  const hasValidation = def.slicesAvailable.includes('validation');
  const scope = def.scopeTimeframes ? def.scopeTimeframes.join('/') : def.execTimeframe;
  const fees = def.assumptions.fees;
  const evidence = def.reproductionEvidence ?? [];
  return {
    id: def.id, version: def.version, name: def.name, nameRu: def.nameRu,
    verdict: def.verdict, verdictLabelRu: VERDICT_LABEL_RU[def.verdict], verdictTone: verdictTone(def.verdict),
    reproducibility: def.reproducibility, reproLabelRu: REPRO_LABEL_RU[def.reproducibility],
    reproDetailRu: def.reproducibility === 'REPRODUCED'
      ? `Реальный перезапуск на датасете ${String(commits.dataset).slice(0, 7)}: ${evidence.length} прогон(ов), все сравниваемые поля совпали. «Воспроизведено» = повторяемость чисел, не успешность.`
      : def.reproductionBlockedReason ?? 'Причина не записана.',
    reproducedTradeCounts: evidence.map((e) => ({ slice: String(e.slice), n: e.tradeCount, digest: e.deterministicDigest })),
    assumptions: {
      period: hasValidation ? `TRAIN ${TRAIN}; VALIDATION ${VALID}` : `TRAIN ${TRAIN}`,
      validationType: hasValidation ? 'TRAIN + VALIDATION' : 'TRAIN only',
      execTimeframe: scope,
      structuralTimeframe: def.structuralTimeframe ?? (group === 'V3_NET_1H_4H' ? '—' : '1h/4h/1d (контекст движка V2)'),
      symbols: def.symbols.join(', '),
      feeModel: group === 'V2_1_LUMP_FEE_7TF' ? 'lump 0.1 % на сделку (источник); per-leg колонки — DERIVED' : `${fees.makerBps}/${fees.takerBps} bps (maker вход / taker выходы)`,
      feeSemantics: group === 'V2_GROSS_ZERO_FEE' ? 'GROSS_ONLY_ZERO_FEE' : group === 'V2_1_LUMP_FEE_7TF' ? 'NET_LUMP_0_1PCT' : 'NET_AT_FEES',
      metricDenominator: group === 'V2_1_LUMP_FEE_7TF' ? 'на исходный actionable setup' : 'на заполненный ордер',
      entryEngine: frozen ? 'frozen V2 4839074' : 'V3 (собственные правила)',
    } as AssumptionRow,
    group,
    provenance: {
      sourcePin, dataset: String(commits.dataset).slice(0, 7),
      artifactCount: def.sourcePins.filter((p) => p.role === 'ARTIFACT').length,
      discrepancyCount: def.discrepancies.length, frozenEngine: frozen,
    },
    variantCount: def.variants?.length ?? 1,
    rulesRu: rules as Record<string, string>, caveatsRu: caveats, discrepancies: def.discrepancies,
  };
}

/* ------------------------------------------------------------- per version */

type Builder = (def: StrategyDefinition) => ArchiveCardModel;

const BUILDERS: Readonly<Record<string, Builder>> = Object.freeze({
  V2_1A_STRUCTURAL_LIMIT_ENTRY: (def) => {
    const g = (V21A_SOURCE_RESULTS as Rec).trainGross;
    const m = (V21A_SOURCE_RESULTS as Rec).train.models;
    return {
      ...base(def, 'V2_1_LUMP_FEE_7TF', V21A_COMMITS, V21A_RULES_RU, V21A_CAVEATS_RU), order: 1,
      headline: [
        { label: 'Модель A (baseline, SOURCE_REPORTED)', slice: 'TRAIN', n: g.A.n, grossRPerTrade: r4(g.A.grossExp), netRPerTrade: r4(g.A.netExpFrozen), netFeeModel: 'lump 0.1 %', origin: 'SOURCE_REPORTED' },
        { label: 'Модель B (лучший gross/filled, худший нетто; fill 12.98 %)', slice: 'TRAIN', n: g.B.n, grossRPerTrade: r4(g.B.grossExp), netRPerTrade: r4(g.B.netExpFrozen), netFeeModel: 'lump 0.1 %', origin: 'SOURCE_REPORTED' },
      ],
      // gross per ORIGINAL actionable setup = grossTotal (gross artifact) / actionableSetups (metrics artifact) — the metrics
      // artifact's own `grossExpectancyPerActionableSetup` stores NET-after-lump under a gross name (D-V21A-006).
      headlineNoteRu: `Headline нет: ни одна из 4 моделей не выбрана. Основная метрика — gross на исходный setup: ${(['A', 'B', 'C', 'D'] as const).map((k) => `${k} ${fmtSigned(g[k].grossTotal / m[k].actionableSetups)}`).join(', ')}. Нетто после lump 0.1 % отрицательно у всех.`,
    };
  },
  V2_1B_CORRIDOR_ENTRY: (def) => {
    const arms = (V21B_SOURCE_RESULTS as Rec).train.arms;
    const p = (V21B_SOURCE_RESULTS as Rec).primaryMetricPerSetup;
    const h = (a: string, label: string): HeadlineFigures => ({
      label, slice: 'TRAIN', n: arms[a].closed, grossRPerTrade: arms[a].grossExpectancyPerFilled,
      netRPerTrade: arms[a].netExpectancyPerFilled['10bps'], netFeeModel: '10 bps round-trip ≈ lump 0.1 %', origin: 'SOURCE_REPORTED',
    });
    return {
      ...base(def, 'V2_1_LUMP_FEE_7TF', V21B_COMMITS, V21B_RULES_RU, V21B_CAVEATS_RU), order: 2,
      headline: [h('FULL', 'FULL (headline, все гейты) — отклонена'), h('A', 'A (baseline)')],
      headlineNoteRu: `Предзаявленная метрика gross на исходный setup: A ${fmtSigned(p.A)} > E ${fmtSigned(p.E)} > C ${fmtSigned(p.C)} > FULL ${fmtSigned(p.FULL)} ≥ EFC/EF/F — ни один фильтр не превзошёл baseline. Диагностика ТФ×комиссия — не вердикт.`,
    };
  },
  V2_2_HTF_SPOT_ENGINE: (def) => ({
    ...base(def, 'V2_POOLED_4TF_NET', V22_COMMITS, V22_RULES_RU, V22_CAVEATS_RU), order: 3,
    headline: [v2Headline('FULL (все гейты) — отклонена', 'TRAIN', (V22_SOURCE_RESULTS as Rec).train.arms.FULL, 'FUT_7')],
    headlineNoteRu: 'Оба предзаявленных критерия провалены; 7 веток A/Ahtf/T/R/TR/TRG/FULL, нетто @2/5 отрицательно во всех.',
  }),
  V2_3_SNIPER_REVERSAL: (def) => ({
    ...base(def, 'V2_POOLED_4TF_NET', V23_COMMITS, V23_RULES_RU, V23_CAVEATS_RU), order: 4,
    headline: [v2Headline('S-cor (лучшая из 6 веток) — отклонена', 'TRAIN', (V23_SOURCE_RESULTS as Rec).train.arms['S-cor'], 'FUT_7')],
    headlineNoteRu: 'Ни одна из 6 веток не прошла все критерии; нетто-положительна только при оптимистичной модели 2/2 bps.',
  }),
  V2_4_ASYMMETRIC_SNIPER: (def) => ({
    ...base(def, 'V2_POOLED_4TF_NET', V24_COMMITS, V24_RULES_RU, V24_CAVEATS_RU), order: 5,
    headline: [
      v2Headline('S-asym (кандидат заморожен до VALIDATION)', 'TRAIN', (V24_SOURCE_RESULTS as Rec).train.arms['S-asym'], 'FUT_7'),
      v2Headline('S-asym', 'VALIDATION', (V24_SOURCE_RESULTS as Rec).validation.arms['S-asym'], 'FUT_7'),
    ],
    headlineNoteRu: 'Единственная V2.x с прочитанной VALIDATION: знак gross инвертировался (+0.2023 → −0.1098) — провал не является артефактом комиссий.',
  }),
  V2_5_TRAILING_STOP: (def) => ({
    ...base(def, 'V2_POOLED_4TF_NET', V25_COMMITS, V25_RULES_RU, V25_CAVEATS_RU), order: 6,
    headline: [v2Headline('V25 (трейлинг) vs baseline A −0.1257 нетто', 'TRAIN', (V25_SOURCE_RESULTS as Rec).train.arms.V25, 'FUT_4')],
    headlineNoteRu: 'Критерий «лучше baseline» пройден при отрицательном нетто обеих веток; валидация не проводилась (программа перешла к V2.6).',
  }),
  V2_6_SNIPER_TRAILING: (def) => ({
    ...base(def, 'V2_POOLED_4TF_NET', V26_COMMITS, V26_RULES_RU, V26_CAVEATS_RU), order: 7,
    headline: [v2Headline('V26 (sniper ∩ трейлинг) — отклонена', 'TRAIN', (V26_SOURCE_RESULTS as Rec).train.arms.V26, 'FUT_4')],
    headlineNoteRu: 'V26-frozen-exit gross +0.1490 ≥ V26 +0.1462 — трейлинг после sniper-фильтра избыточен. Те же 317 входов, что V2.7/V2.8.',
  }),
  V2_7_RR_OPTIMIZATION: (def) => {
    const arms = (V27_SOURCE_RESULTS as Rec).train.arms as Rec[];
    const rr15 = arms.find((a) => a.arm === 'RR15')!; const rr40 = arms.find((a) => a.arm === 'RR40')!;
    const h = (a: Rec, label: string): HeadlineFigures => ({ label, slice: 'TRAIN', n: a.n, grossRPerTrade: a.grossRPerTrade, netRPerTrade: a.netRPerTrade, netFeeModel: '2/5 bps за ногу', origin: 'SOURCE_REPORTED' });
    return {
      ...base(def, 'V2_POOLED_4TF_NET', V27_COMMITS, V27_RULES_RU, V27_CAVEATS_RU), order: 8,
      headline: [h(rr15, 'RR15 (наиболее убыточная цель)'), h(rr40, 'RR40 (наименее убыточная — не оптимум)')],
      headlineNoteRu: 'Headline нет: все 5 фиксированных целей нетто-отрицательны; fee drag 0.1555 R одинаков для всех.',
    };
  },
  V2_8_ZERO_FEE_SNIPER_TRAILING: (def) => {
    const t = ((V28_SOURCE_RESULTS as Rec).train.arms as Rec[]).find((a) => a.arm === 'Trail')!;
    const v = ((V28_SOURCE_RESULTS as Rec).validation.arms as Rec[]).find((a) => a.arm === 'Trail')!;
    const h = (a: Rec, slice: 'TRAIN' | 'VALIDATION'): HeadlineFigures => ({ label: 'Trail (кандидат) — GROSS, fees=0', slice, n: a.n, grossRPerTrade: a.grossRPerTrade, netRPerTrade: null, netFeeModel: 'НЕ СЧИТАЛОСЬ (fees=0)', origin: 'SOURCE_REPORTED' });
    return {
      ...base(def, 'V2_GROSS_ZERO_FEE', V28_COMMITS, V28_RULES_RU, V28_CAVEATS_RU), order: 9,
      headline: [h(t, 'TRAIN'), h(v, 'VALIDATION')],
      headlineNoteRu: '⚠️ Все цифры gross при нулевых комиссиях. При 2/5 bps популяция теряет ≈0.1555 R/сделку → нетто отрицательна. VALIDATION PASS держится на одной сделке (без неё −0.0143).',
    };
  },
  V3_0_HTF_LIQUIDATION_TRAP: (def) => ({
    ...base(def, 'V3_NET_1H_4H', V30_COMMITS, V30_RULES_RU, V30_CAVEATS_RU), order: 10,
    headline: [v3Headline('V3.0', 'TRAIN', V30_SOURCE_RESULTS.train as Rec), v3Headline('V3.0 (один прогон)', 'VALIDATION', V30_SOURCE_RESULTS.validation as Rec)],
    headlineNoteRu: 'Валидировано источником для исследования: 3 из 6 пар на VALIDATION отрицательны; без топ-5 сделок нетто < комиссии; перекрытие позиций (D-V30-001).',
  }),
  V3_1_HTF_TREND_PULLBACK: (def) => ({
    ...base(def, 'V3_NET_1H_4H', V31_COMMITS, V31_RULES_RU, V31_CAVEATS_RU), order: 11,
    headline: [v3Headline('leg (PRIMARY) — фальсифицирована', 'TRAIN', (V31_SOURCE_RESULTS as Rec).train.leg)],
    headlineNoteRu: 'Критерий F1 провален на TRAIN (same-bar ещё хуже: −0.2819); VALIDATION не расходовалась.',
  }),
  V3_2_VOLUME_CLIMAX: (def) => ({
    ...base(def, 'V3_NET_1H_4H', V32_COMMITS, V32_RULES_RU, V32_CAVEATS_RU), order: 12,
    headline: [v3Headline('union-cascade (PRIMARY) — фальсифицирована', 'TRAIN', (V32_SOURCE_RESULTS as Rec).train['union-cascade'])],
    headlineNoteRu: 'EMA50-варианты (+0.0530 n=213 / +0.0108 n=97) провалили F3 и НЕ продвинуты — показывать их как результат было бы cherry-picking.',
  }),
  V3_3_HTF_ZONE_MITIGATION: (def) => ({
    ...base(def, 'V3_NET_1H_4H', V33_COMMITS, V33_RULES_RU, V33_CAVEATS_RU), order: 13,
    headline: [v3Headline('while-protective-displacement (предзаявленный headline)', 'TRAIN', (V33_SOURCE_RESULTS as Rec).train['while-protective-displacement'])],
    headlineNoteRu: 'Только TRAIN: окно VALIDATION уже израсходовано V3.0. Без топ-1 % сделок gross 0.0264 < комиссии 0.0511. 7 остальных прогонов — чувствительность.',
  }),
});

export function fmtSigned(x: number, digits = 4): string {
  return `${x > 0 ? '+' : ''}${x.toFixed(digits)}`;
}

/* ------------------------------------------------------------------ public */

/** All registry entries as card models, in programme (chronological) order — never by performance. */
export function buildArchiveCards(defs: readonly StrategyDefinition[] = STRATEGY_ARCHIVE): ArchiveCardModel[] {
  return defs
    .map((d) => {
      const b = BUILDERS[d.id];
      if (!b) throw new Error(`strategyArchive/presentation: no card builder for ${d.id}`);
      return b(d);
    })
    .sort((a, b) => a.order - b.order);
}

export function filterCounts(cards: readonly ArchiveCardModel[]): Record<ArchiveFilterId, number> {
  const out = {} as Record<ArchiveFilterId, number>;
  for (const f of ARCHIVE_FILTERS) out[f.id] = cards.filter((c) => filterMatches(f.id, c.verdict)).length;
  return out;
}

/** Warnings that MUST be displayed before the selected cards are read side by side. Empty ⇒ comparable assumptions. */
export function comparabilityWarnings(cards: readonly ArchiveCardModel[]): string[] {
  const w: string[] = [];
  if (cards.length < 2) return w;
  const groups = new Set(cards.map((c) => c.group));
  if (groups.size > 1) {
    w.push('НЕСОПОСТАВИМО: разные семейства допущений — ' + [...groups].map((g) => COMPARABILITY_GROUP_RU[g]).join(' ‖ '));
  }
  const sem = new Set(cards.map((c) => c.assumptions.feeSemantics));
  if (sem.has('GROSS_ONLY_ZERO_FEE') && sem.size > 1) {
    w.push('⚠️ Gross при fees=0 (V2.8) нельзя сравнивать с нетто-цифрами: при 2/5 bps популяция V2.8 теряет ≈0.1555 R/сделку.');
  }
  if (sem.has('NET_LUMP_0_1PCT') && sem.size > 1) {
    w.push('⚠️ V2.1 считает нетто как lump 0.1 % на сделку и метрику «на исходный setup» — другой знаменатель и другая модель комиссий.');
  }
  const vt = new Set(cards.map((c) => c.assumptions.validationType));
  if (vt.size > 1) w.push('Разный тип проверки: часть версий имеет только TRAIN, часть — TRAIN + VALIDATION. TRAIN-результат не сравнивается с VALIDATION-результатом.');
  const tf = new Set(cards.map((c) => c.assumptions.execTimeframe));
  if (tf.size > 1) w.push('Разные таймфреймы исполнения: ' + [...tf].join(' vs ') + '.');
  const eng = new Set(cards.map((c) => c.assumptions.entryEngine));
  if (eng.size > 1) w.push('Разные движки входов: ' + [...eng].join(' vs ') + '.');
  return w;
}

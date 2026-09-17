export * from './types';
export { STRATEGY_ARCHIVE, STRATEGY_ARCHIVE_PLANNED, STRATEGY_ARCHIVE_TOTAL_ROWS, getStrategyDefinition } from './registry';
export { reproduce, splitFor } from './engine/reproductionEngine';
export { computeRMetrics, tradesDigest } from './engine/rMetrics';
export { ohlcvToArchiveCandles, archiveCandlesToOhlcv, detectTimestampUnit, toMs, validateSeries } from './shared/candleAdapter';
export { FROZEN_ENGINE, FROZEN_SETTINGS_SHA256 } from './shared/frozenSettings';
export {
  V30_DEFINITION, V30_SOURCE_RESULTS, V30_REPRODUCTION_EVIDENCE, V30_REPRODUCED_RESULTS, V30_CAVEATS_RU, V30_RULES_RU, V30_DISCREPANCIES, V30_COMMITS, V30_SOURCE_PINS,
} from './definitions/v3_0-htf-liquidation-trap/definition';
export { V30_CONSTANTS } from './definitions/v3_0-htf-liquidation-trap/v30Core';
export {
  V31_DEFINITION, V31_SOURCE_RESULTS, V31_REPRODUCTION_EVIDENCE, V31_REPRODUCED_RESULTS, V31_CAVEATS_RU, V31_RULES_RU, V31_DISCREPANCIES, V31_COMMITS, V31_SOURCE_PINS, V31_VARIANTS,
} from './definitions/v3_1-htf-trend-pullback/definition';
export { V31_CONSTANTS } from './definitions/v3_1-htf-trend-pullback/v31Core';
export {
  V32_DEFINITION, V32_SOURCE_RESULTS, V32_REPRODUCTION_EVIDENCE, V32_REPRODUCED_RESULTS, V32_CAVEATS_RU, V32_RULES_RU, V32_DISCREPANCIES, V32_COMMITS, V32_SOURCE_PINS, V32_VARIANTS,
} from './definitions/v3_2-volume-climax/definition';
export { V32_CONSTANTS } from './definitions/v3_2-volume-climax/v32Core';
export {
  V33_DEFINITION, V33_SOURCE_RESULTS, V33_REPRODUCTION_EVIDENCE, V33_REPRODUCED_RESULTS, V33_CAVEATS_RU, V33_RULES_RU, V33_DISCREPANCIES, V33_COMMITS, V33_SOURCE_PINS, V33_VARIANTS,
} from './definitions/v3_3-htf-zone-mitigation/definition';
export { V33_CONSTANTS } from './definitions/v3_3-htf-zone-mitigation/v33Core';
export { V33_VARIANT_IDS } from './definitions/v3_3-htf-zone-mitigation/v33Runner';
export {
  V27_DEFINITION, V27_SOURCE_RESULTS, V27_REPRODUCTION_EVIDENCE, V27_REPRODUCED_RESULTS, V27_CAVEATS_RU, V27_RULES_RU, V27_DISCREPANCIES, V27_COMMITS, V27_SOURCE_PINS, V27_VARIANTS,
} from './definitions/v2_7-rr-optimization/definition';
export { V27_CONSTANTS, RR_ARMS as V27_RR_ARMS } from './definitions/v2_7-rr-optimization/v27Core';
export {
  V28_DEFINITION, V28_SOURCE_RESULTS, V28_REPRODUCTION_EVIDENCE, V28_REPRODUCED_RESULTS, V28_CAVEATS_RU, V28_RULES_RU, V28_DISCREPANCIES, V28_COMMITS, V28_SOURCE_PINS, V28_VARIANTS,
} from './definitions/v2_8-zero-fee-sniper-trailing/definition';
export { V28_CONSTANTS, ARM_ORDER as V28_ARM_ORDER } from './definitions/v2_8-zero-fee-sniper-trailing/v28Core';
export {
  V22_DEFINITION, V22_SOURCE_RESULTS, V22_REPRODUCTION_EVIDENCE, V22_REPRODUCED_RESULTS, V22_CAVEATS_RU, V22_RULES_RU, V22_DISCREPANCIES, V22_COMMITS, V22_SOURCE_PINS, V22_VARIANTS, V22_CONSTANTS,
} from './definitions/v2_2-htf-spot-engine/definition';
export {
  V23_DEFINITION, V23_SOURCE_RESULTS, V23_REPRODUCTION_EVIDENCE, V23_REPRODUCED_RESULTS, V23_CAVEATS_RU, V23_RULES_RU, V23_DISCREPANCIES, V23_COMMITS, V23_SOURCE_PINS, V23_VARIANTS, V23_CONSTANTS,
} from './definitions/v2_3-sniper-reversal/definition';
export {
  V24_DEFINITION, V24_SOURCE_RESULTS, V24_REPRODUCTION_EVIDENCE, V24_REPRODUCED_RESULTS, V24_CAVEATS_RU, V24_RULES_RU, V24_DISCREPANCIES, V24_COMMITS, V24_SOURCE_PINS, V24_VARIANTS, V24_CONSTANTS,
} from './definitions/v2_4-asymmetric-sniper/definition';
export {
  V25_DEFINITION, V25_SOURCE_RESULTS, V25_REPRODUCTION_EVIDENCE, V25_REPRODUCED_RESULTS, V25_CAVEATS_RU, V25_RULES_RU, V25_DISCREPANCIES, V25_COMMITS, V25_SOURCE_PINS, V25_VARIANTS, V25_CONSTANTS,
} from './definitions/v2_5-trailing-stop/definition';
export {
  V21A_DEFINITION, V21A_SOURCE_RESULTS, V21A_CAVEATS_RU, V21A_RULES_RU, V21A_DISCREPANCIES, V21A_COMMITS, V21A_SOURCE_PINS, V21A_VARIANTS, V21A_CONSTANTS,
} from './definitions/v2_1a-structural-limit-entry/definition';
export {
  V21B_DEFINITION, V21B_SOURCE_RESULTS, V21B_CAVEATS_RU, V21B_RULES_RU, V21B_DISCREPANCIES, V21B_COMMITS, V21B_SOURCE_PINS, V21B_VARIANTS, V21B_CONSTANTS,
} from './definitions/v2_1b-corridor-entry/definition';
export {
  V26_DEFINITION, V26_SOURCE_RESULTS, V26_REPRODUCTION_EVIDENCE, V26_REPRODUCED_RESULTS, V26_CAVEATS_RU, V26_RULES_RU, V26_DISCREPANCIES, V26_COMMITS, V26_SOURCE_PINS, V26_VARIANTS, V26_CONSTANTS,
} from './definitions/v2_6-sniper-trailing/definition';
export { LEGACY_V2_PROVENANCE } from './legacy/v2';
export {
  buildArchiveCards, filterCounts, filterMatches, comparabilityWarnings, fmtSigned, verdictTone,
  ARCHIVE_FILTERS, VERDICT_LABEL_RU, REPRO_LABEL_RU, COMPARABILITY_GROUP_RU,
} from './presentation';
export type { ArchiveCardModel, ArchiveFilterId, ComparabilityGroup, HeadlineFigures, AssumptionRow, VerdictTone } from './presentation';

/**
 * Изолированный модуль стратегии V3.4 для отдельного Android-продукта.
 *
 * Состав:
 *   • strategy/ — дословные копии frozen-ядра CRYPTORA (V3.3/V3.0 core,
 *     примитивы, замороженные настройки, типы). Математика не менялась:
 *     `test/parity.sources.test.ts` доказывает побайтовое совпадение копий с
 *     исходниками (кроме строк импорта), `test/parity.replay.test.ts` —
 *     совпадение результатов на одинаковых обезличенных данных;
 *   • signals/ — реплей V3.4, фильтр качества целей, ведение опубликованного
 *     сигнала;
 *   • config.ts — подтверждённые метаданные и вселенная стратегии;
 *   • engine.ts — серверный проход по символу и правило публикации;
 *   • validate.ts — проверки целостности рыночных данных.
 *
 * Торговли нет: ни ордеров, ни ключей, ни приватных эндпоинтов.
 */
export * from './config';
export * from './validate';
export * from './engine';

export type { ArchiveCandle, ArchiveDirection, ArchiveTimeframe } from './strategy/types';
export { ARCHIVE_TF_MS } from './strategy/types';
export { V33_CONSTANTS, manageTrade, inspectTrade, absorption, buildZones, trackZone, confirmedSwingLevels } from './strategy/v33Core';
export { V30_CONSTANTS, corridorStep } from './strategy/v30Core';
export { FROZEN_ENGINE, FROZEN_SETTINGS_SHA256 } from './strategy/frozenSettings';

export {
  V34_ENTRY_ZONE_ATR_PAD,
  V34_TP1_MIN_R,
  V34_TP2_MIN_R,
  expandEntryZone,
  canonicalEntryReference,
  evaluateTargetQuality,
  TARGET_QUALITY_REASON_RU,
  type TargetQualityReason,
} from './signals/targetQuality';

export {
  runV34LiveReplay,
  v34CorridorHook,
  atrFromV33Corridor,
  v34GateCounts,
  V34_LIVE_VARIANT_ID,
  V34_EXIT_RULE_RU,
} from './signals/v34LiveReplay';
export { runV33LiveReplay, V33_STRATEGY_ID, V33_STRATEGY_VERSION } from './signals/v33LiveReplay';

export type { ReplayOutput, ReplayRecord, ReplayFill, ReplayOutcome, ReplayFinalStatus } from './signals/replayTypes';
export {
  trackV34PublishedSignal,
  type LifecycleResult,
  type LifecycleProgress,
  type PublishedSignal,
  type SignalFill,
  type SignalOutcome,
} from './signals/lifecycle';
export { ohlcvToArchive, toClosedArchive, countGaps, type OHLCV } from './signals/ohlcv';

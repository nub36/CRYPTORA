/**
 * CRYPTORA — Strategy Lab · точка сборки исследовательского ядра (RESEARCH ONLY)
 * ---------------------------------------------------------------------------
 * Сервер написан на JS, а исследовательские формулы Lab — на TypeScript в
 * `src/services/strategyLab/`. Чтобы НЕ дублировать математику в React и НЕ
 * держать вторую копию формул на сервере, esbuild собирает этот файл вместе с
 * его TS-зависимостями в один ESM-модуль, который импортирует Node
 * (см. labCoreBundle.js). Сервер исполняет буквально тот же код, что описан в
 * src/ — единственный источник истины Lab.
 *
 * ЭТО ОТДЕЛЬНЫЙ, изолированный бандл: он НЕ трогает production entry.ts и НЕ
 * импортирует production-стратегии (V2.8/V3.0/V3.3/V3.4).
 */

export { runLabReplay, UnknownLabStrategyError } from '@/services/strategyLab/engine';
export { evaluateDraftStrategy } from '@/services/strategyLab/strategies/draftStrategy';
export {
  LAB_STRATEGIES,
  getLabStrategy,
  isKnownLabStrategy,
  defaultDraftDefinition,
  defaultResearchConfig,
  EMA_ATR_ID,
} from '@/services/strategyLab/registry';
export { LAB_TIMEFRAMES, LAB_TF_SECONDS, LAB_MAX_CANDLES } from '@/services/strategyLab/types';

/**
 * CRYPTORA — Strategy Lab · code-first исследовательский черновик (RESEARCH ONLY)
 * ---------------------------------------------------------------------------
 * CODE-FIRST LAB. Блок-редактор и «простой конструктор» удалены: авторинг
 * стратегии = НАСТРОЙКИ ИНДИКАТОРОВ + КОД СТРАТЕГИИ.
 *
 * `StrategyResearchDraft` — ЕДИНСТВЕННАЯ пользовательская модель Lab и ровно та
 * структура, которую следующим этапом будем сохранять в БД:
 *
 *   { name, indicators, sourceCode, execution, apiVersion }
 *
 * Поля `authoringMode` больше НЕ существует — режим авторинга один.
 *
 * Индикаторы — ЕДИНСТВЕННЫЙ источник объявлений (период/источник/видимость).
 * Код ссылается на них по стабильным идентификаторам (см. ./identifiers.ts) и
 * НИКОГДА не задаёт период повторно.
 *
 * RESEARCH ONLY: модуль не участвует в production-стратегиях (V2.8/V3.0/V3.3/
 * V3.4), сигналах, scheduler и БД.
 */

import type { ExecutionSettings, IndicatorDefinition } from '../types';
import { buildStarterCode } from '../code/templates';

/**
 * Версия контракта code-first черновика.
 * v1 — блок-схема/`StrategyGraph` (удалена из UI);
 * v2 — индикаторы + код (минимальная версионная правка грамматики, §5).
 */
export const RESEARCH_DRAFT_API_VERSION = 2 as const;

export interface StrategyResearchDraft {
  name: string;
  indicators: IndicatorDefinition[];
  sourceCode: string;
  execution: ExecutionSettings;
  apiVersion: typeof RESEARCH_DRAFT_API_VERSION;
}

/** Исполнение по умолчанию — совпадает с текущим Draft-конструктором (паритет). */
export const DEFAULT_DRAFT_EXECUTION: Readonly<ExecutionSettings> = Object.freeze({
  feeBps: 5,
  slippageBps: 2,
});

/**
 * Стартовый черновик: EMA 20/50 + ATR 14 (полный эквивалент прежней стратегии
 * по умолчанию) и понятный код, ссылающийся на эти индикаторы по именам.
 */
export function defaultResearchDraft(name = 'EMA Trend'): StrategyResearchDraft {
  return {
    name,
    indicators: [
      { id: 'ema-fast', type: 'EMA', name: 'EMA Fast', period: 20, source: 'close', visible: true },
      { id: 'ema-slow', type: 'EMA', name: 'EMA Slow', period: 50, source: 'close', visible: true },
      { id: 'atr-main', type: 'ATR', name: 'ATR Main', period: 14, visible: false },
    ],
    sourceCode: buildStarterCode(name),
    execution: { ...DEFAULT_DRAFT_EXECUTION },
    apiVersion: RESEARCH_DRAFT_API_VERSION,
  };
}

/** Глубокая копия (чистые данные, без ссылок на UI-объекты). */
export function cloneResearchDraft(draft: StrategyResearchDraft): StrategyResearchDraft {
  return {
    name: draft.name,
    indicators: draft.indicators.map((i) => ({ ...i })),
    sourceCode: draft.sourceCode,
    execution: { ...draft.execution },
    apiVersion: draft.apiVersion,
  };
}

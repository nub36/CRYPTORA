/**
 * CRYPTORA — Strategy Lab · стратегия EMA + ATR (RESEARCH ONLY)
 * ---------------------------------------------------------------------------
 * Полноценная исследовательская стратегия CRYPTORA. Работает только внутри
 * Strategy Lab: не публикует production-сигналы и не пишет в БД.
 *
 * Переиспользует унифицированный движок evaluateDraftStrategy с точным
 * математическим паритетом.
 */

import { evaluateDraftStrategy, type DraftStrategyEvaluation } from './draftStrategy';
import type { LabCandle, ResearchConfig, StrategyDraftDefinition } from '../types';

export type EmaAtrEvaluation = DraftStrategyEvaluation;

export function configToDraftDefinition(config: ResearchConfig): StrategyDraftDefinition {
  return {
    name: 'EMA + ATR',
    indicators: [
      {
        id: 'ema-fast',
        type: 'EMA',
        name: `EMA ${config.indicators.emaFast}`,
        period: config.indicators.emaFast,
        source: 'close',
        visible: true,
      },
      {
        id: 'ema-slow',
        type: 'EMA',
        name: `EMA ${config.indicators.emaSlow}`,
        period: config.indicators.emaSlow,
        source: 'close',
        visible: true,
      },
      {
        id: 'atr',
        type: 'ATR',
        name: `ATR ${config.indicators.atrPeriod}`,
        period: config.indicators.atrPeriod,
        visible: false,
      },
    ],
    long: {
      left: 'ema-fast',
      operator: 'crossesAbove',
      right: 'ema-slow',
    },
    short: {
      left: 'ema-fast',
      operator: 'crossesBelow',
      right: 'ema-slow',
    },
    stop: {
      type: 'atrMultiple',
      indicatorId: 'atr',
      multiplier: config.strategy.stopAtrMult,
    },
    target: {
      type: 'rMultiple',
      multiple: config.strategy.targetR,
    },
    execution: {
      feeBps: config.execution.feeBps,
      slippageBps: config.execution.slippageBps,
    },
  };
}

export function evaluateEmaAtr(
  candles: LabCandle[],
  config: ResearchConfig
): EmaAtrEvaluation {
  const definition = configToDraftDefinition(config);
  return evaluateDraftStrategy(candles, definition);
}

/**
 * CRYPTORA — Strategy Lab · исследовательский движок (RESEARCH ONLY)
 * ---------------------------------------------------------------------------
 * Чистая детерминированная функция: свечи + config/definition → события/сделки/
 * отказы/метрики. БЕЗ сети, БЕЗ БД, БЕЗ Math.random, БЕЗ Date.now в расчётах
 * (только `generatedAt` в meta как штамп ответа). Это ЕДИНСТВЕННЫЙ источник
 * формул Lab — сервер исполняет именно её (esbuild-бандл), фронтенд её НЕ дублирует.
 *
 * No look-ahead гарантируется стратегией: решение на баре i использует только
 * бары ≤ i.
 */

import { evaluateEmaAtr } from './strategies/emaAtr';
import { evaluateDraftStrategy } from './strategies/draftStrategy';
import { computeMetrics } from './metrics';
import { SAME_BAR_RULE } from './executionSimulator';
import { BLOCK_GRAPH_ID, EMA_ATR_ID, getLabStrategy } from './registry';
import { compileGraphToDraftDefinition } from './graph/compile';
import type { LabReplayInput, LabReplayResult } from './types';

export class UnknownLabStrategyError extends Error {
  constructor(id: string) {
    super(`Unknown Strategy Lab strategy: ${id}`);
    this.name = 'UnknownLabStrategyError';
  }
}

export function runLabReplay(input: LabReplayInput, nowMs = Date.now()): LabReplayResult {
  const candles = input.candles;
  const notes: string[] = [];

  let evaluation;
  let strategyId: string;
  let strategyName: string;

  if (input.strategyGraph) {
    /*
     * Блок-схема компилируется в существующее декларативное определение ОДИН
     * раз за реплей (§11, §28): дальше работает тот же evaluateDraftStrategy,
     * поэтому побарового интерпретатора графа нет и паритет сохраняется.
     */
    const compiled = compileGraphToDraftDefinition(input.strategyGraph);
    strategyId = input.strategyId || BLOCK_GRAPH_ID;
    strategyName = compiled.name || 'Блок-схема';
    evaluation = evaluateDraftStrategy(candles, compiled);
  } else if (input.strategyDefinition) {
    strategyId = input.strategyId || 'CONSTRUCTOR';
    strategyName = input.strategyDefinition.name || 'Конструктор стратегий';
    evaluation = evaluateDraftStrategy(candles, input.strategyDefinition);
  } else if (input.strategyId === EMA_ATR_ID && input.researchConfig) {
    const meta = getLabStrategy(input.strategyId);
    strategyId = EMA_ATR_ID;
    strategyName = meta?.name || 'EMA + ATR';
    evaluation = evaluateEmaAtr(candles, input.researchConfig);
  } else if (input.strategyId) {
    const meta = getLabStrategy(input.strategyId);
    if (!meta) throw new UnknownLabStrategyError(input.strategyId);
    strategyId = input.strategyId;
    strategyName = meta.name;
    if (input.researchConfig) {
      evaluation = evaluateEmaAtr(candles, input.researchConfig);
    } else {
      throw new Error('Research configuration or strategy definition required');
    }
  } else {
    throw new Error('Neither strategyDefinition nor strategyId provided');
  }

  const metrics = computeMetrics(
    evaluation.trades,
    evaluation.candidateCount,
    evaluation.rejectedCount
  );

  if (candles.length === 0) notes.push('Нет закрытых свечей в выбранном диапазоне.');
  if (evaluation.warmupBars >= candles.length && candles.length > 0) {
    notes.push('Диапазон короче прогрева индикаторов — сигналов быть не может.');
  }

  return {
    meta: {
      strategyId,
      strategyName,
      market: input.market,
      symbol: input.symbol,
      timeframe: input.timeframe,
      from: input.from,
      to: input.to,
      candleCount: candles.length,
      evaluatedBars: evaluation.evaluatedBars,
      warmupBars: evaluation.warmupBars,
      firstCandleTime: candles.length > 0 ? candles[0].time : null,
      lastCandleTime: candles.length > 0 ? candles[candles.length - 1].time : null,
      sameBarRule: SAME_BAR_RULE,
      researchOnly: true,
      generatedAt: nowMs,
      notes,
    },
    candles,
    indicators: evaluation.indicators,
    orderBlocks: evaluation.orderBlocks,
    events: evaluation.events,
    trades: evaluation.trades,
    rejections: evaluation.rejections,
    metrics,
  };
}

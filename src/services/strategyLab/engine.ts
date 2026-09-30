/**
 * CRYPTORA — Strategy Lab · исследовательский движок (RESEARCH ONLY)
 * ---------------------------------------------------------------------------
 * Чистая детерминированная функция: свечи + config → события/сделки/отказы/
 * метрики. БЕЗ сети, БЕЗ БД, БЕЗ Math.random, БЕЗ Date.now в расчётах (только
 * `generatedAt` в meta как штамп ответа). Это ЕДИНСТВЕННЫЙ источник формул Lab —
 * сервер исполняет именно её (esbuild-бандл), фронтенд её НЕ дублирует.
 *
 * No look-ahead гарантируется стратегией: решение на баре i использует только
 * бары ≤ i (см. strategies/emaAtr.ts).
 */

import { evaluateEmaAtr } from './strategies/emaAtr';
import { computeMetrics } from './metrics';
import { SAME_BAR_RULE } from './executionSimulator';
import { EMA_ATR_ID, getLabStrategy } from './registry';
import type { LabReplayInput, LabReplayResult } from './types';

export class UnknownLabStrategyError extends Error {
  constructor(id: string) {
    super(`Unknown Strategy Lab strategy: ${id}`);
    this.name = 'UnknownLabStrategyError';
  }
}

export function runLabReplay(input: LabReplayInput, nowMs = Date.now()): LabReplayResult {
  const meta = getLabStrategy(input.strategyId);
  if (!meta) throw new UnknownLabStrategyError(input.strategyId);

  const candles = input.candles;
  const notes: string[] = [];

  let evaluation;
  switch (input.strategyId) {
    case EMA_ATR_ID:
      evaluation = evaluateEmaAtr(candles, input.researchConfig);
      break;
    default:
      // getLabStrategy уже отсёк неизвестные id; ветка — страховка на будущее.
      throw new UnknownLabStrategyError(input.strategyId);
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
      strategyId: input.strategyId,
      strategyName: meta.name,
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
    events: evaluation.events,
    trades: evaluation.trades,
    rejections: evaluation.rejections,
    metrics,
  };
}

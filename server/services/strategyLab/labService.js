/**
 * CRYPTORA — Strategy Lab · сервис (RESEARCH ONLY, изолированно)
 * ---------------------------------------------------------------------------
 * Оркестрация одного replay: исторические свечи (Lab-сервис) → исследовательское
 * ядро из src/ (esbuild-бандл) → результат. НИКАКИХ production-записей: не
 * трогает strategy_settings, signals, strategy_test_runs, scheduler, БД.
 *
 * Server = source of truth: индикаторы/entry/stop/tp/rejection/метрики считает
 * ЯДРО на сервере, фронтенд только визуализирует ответ.
 */

import { loadLabCore } from './labCoreBundle.js';
import { fetchLabCandles } from './historicalCandles.js';

export class LabRequestError extends Error {
  constructor(message, status = 400, code = 'LAB_BAD_REQUEST') {
    super(message);
    this.name = 'LabRequestError';
    this.status = status;
    this.code = code;
  }
}

/** Список исследовательских стратегий + описатели параметров (для UI). */
export async function listStrategies() {
  const core = await loadLabCore();
  return core.LAB_STRATEGIES;
}

/**
 * Выполнить replay. `parsed` — уже провалидированный объект из
 * validators/strategyLab.js (strategyId / strategyDefinition, market, symbol,
 * timeframe, from(ms), to(ms), researchConfig).
 *
 * @param {{ fetchFn?: typeof fetch, nowMs?: number }} [options]
 */
export async function runReplay(parsed, options = {}) {
  const core = await loadLabCore();

  const strategyId = parsed.strategyDefinition
    ? (parsed.strategyId || 'CONSTRUCTOR')
    : parsed.strategyId;

  if (strategyId && !parsed.strategyDefinition && !core.isKnownLabStrategy(strategyId)) {
    throw new LabRequestError(`Неизвестная стратегия: ${strategyId}`, 400, 'UNKNOWN_STRATEGY');
  }

  const nowMs = options.nowMs ?? Date.now();

  const candles = await fetchLabCandles(
    {
      market: parsed.market,
      symbol: parsed.symbol,
      timeframe: parsed.timeframe,
      fromMs: parsed.from,
      toMs: parsed.to,
    },
    { fetchFn: options.fetchFn, nowMs, maxCandles: core.LAB_MAX_CANDLES }
  );

  const result = core.runLabReplay(
    {
      strategyId,
      strategyDefinition: parsed.strategyDefinition,
      market: parsed.market,
      symbol: parsed.symbol,
      timeframe: parsed.timeframe,
      from: parsed.from,
      to: parsed.to,
      candles,
      researchConfig: parsed.researchConfig,
    },
    nowMs
  );

  return result;
}

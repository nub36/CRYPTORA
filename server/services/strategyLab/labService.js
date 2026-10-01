/**
 * CRYPTORA — Strategy Lab service (RESEARCH ONLY, isolated).
 *
 * Orchestrates one replay: exact local archive when it fully covers the range,
 * otherwise the existing Lab-only Binance REST reader. It never touches the
 * production market pipeline, DB, settings, signals, test runs, or scheduler.
 */

import { loadLabCore } from './labCoreBundle.js';
import { fetchLabCandles } from './historicalCandles.js';
import {
  inspectLocalSeriesCoverage,
  readLocalHistoricalCandles,
} from './localHistoricalCandles.js';
import {
  LAB_TF_MS,
  REST_MAX_CANDLES,
  LOCAL_MAX_CANDLES,
} from '../../validators/strategyLab.js';

const LOCAL_ARCHIVE_TIMEFRAMES = new Set(['5m', '15m', '30m', '1h', '4h']);

export { REST_MAX_CANDLES, LOCAL_MAX_CANDLES };

export class LabRequestError extends Error {
  constructor(message, status = 400, code = 'LAB_BAD_REQUEST') {
    super(message);
    this.name = 'LabRequestError';
    this.status = status;
    this.code = code;
  }
}

/** List research strategies and parameter descriptors for the UI. */
export async function listStrategies() {
  const core = await loadLabCore();
  return core.LAB_STRATEGIES;
}

export function estimateRequestedCandles(parsed) {
  const intervalMs = LAB_TF_MS[parsed.timeframe];
  if (!intervalMs || !(parsed.from < parsed.to)) {
    throw new LabRequestError('Некорректный диапазон или таймфрейм', 400, 'BAD_RANGE');
  }
  return Math.ceil((parsed.to - parsed.from) / intervalMs);
}

function enforceLimit(estimated, maximum, source) {
  if (estimated <= maximum) return;
  const sourceLabel = source === 'local-dataset' ? 'локального архива' : 'Binance REST';
  throw new LabRequestError(
    `Диапазон требует ~${estimated} свечей, максимум для ${sourceLabel}: ${maximum}. Сузьте период или увеличьте таймфрейм.`,
    400,
    source === 'local-dataset' ? 'LOCAL_RANGE_TOO_LARGE' : 'REST_RANGE_TOO_LARGE'
  );
}

/**
 * Select one exact source only after basic request validation. Test seams are
 * optional and never used by the HTTP route in production.
 */
export async function selectHistoricalCandles(parsed, options = {}) {
  const params = {
    market: parsed.market,
    symbol: parsed.symbol,
    timeframe: parsed.timeframe,
    fromMs: parsed.from,
    toMs: parsed.to,
  };
  const estimated = estimateRequestedCandles(parsed);
  const inspect = options.localInspector ?? inspectLocalSeriesCoverage;
  const readLocal = options.localReader ?? readLocalHistoricalCandles;

  const inspection = LOCAL_ARCHIVE_TIMEFRAMES.has(parsed.timeframe)
    ? await inspect(params, { root: options.dataRoot })
    : { datasetAvailable: false, covered: false, reason: 'unsupported-local-timeframe' };

  if (inspection.covered) {
    enforceLimit(estimated, LOCAL_MAX_CANDLES, 'local-dataset');
    const local = await readLocal(params, {
      root: options.dataRoot,
      nowMs: options.nowMs,
      inspection,
    });
    if (!local?.covered || !Array.isArray(local.candles)) {
      throw new LabRequestError('Локальный архив изменился во время чтения', 503, 'LOCAL_DATA_CHANGED');
    }
    return {
      candles: local.candles,
      meta: {
        dataSource: 'local-dataset',
        dataset: {
          version: local.meta.datasetVersion,
          manifestGeneratedAt: local.meta.manifestGeneratedAt,
          coverageFrom: local.meta.coverageFrom,
          coverageTo: local.meta.coverageTo,
          seriesSha256: local.meta.seriesSha256,
        },
      },
    };
  }

  // Missing series or insufficient coverage may use REST, but the strict REST
  // cap remains unchanged and is enforced before any external request.
  enforceLimit(estimated, REST_MAX_CANDLES, 'binance-rest');
  const candles = await fetchLabCandles(params, {
    fetchFn: options.fetchFn,
    nowMs: options.nowMs,
    maxCandles: REST_MAX_CANDLES,
    timeoutMs: options.timeoutMs,
  });
  return { candles, meta: { dataSource: 'binance-rest' } };
}

/**
 * Run one replay from a parsed validator result. Source selection and its
 * source-specific limit happen before loading/executing the calculation core.
 */
export async function runReplay(parsed, options = {}) {
  /*
   * Стратегия проверяется НЕЗАВИСИМО от фронтенда и ДО загрузки свечей: клиент
   * не является источником истины, а невалидная стратегия не должна тянуть
   * данные. Используются ТЕ ЖЕ компилятор кода и валидатор, что и в UI.
   *
   * Ядро подгружается заранее ТОЛЬКО ради этого: для остальных запросов порядок
   * «сначала дешёвые проверки диапазона, потом ядро» сохраняется без изменений.
   */
  let core = options.core ?? null;

  /*
   * CODE-FIRST: черновик (индикаторы + код) компилируется СЕРВЕРОМ до загрузки
   * свечей. Клиент не является источником истины: код разбирается тем же
   * безопасным лексером/парсером, ссылки на индикаторы, типы, стоп и цель
   * проверяются здесь заново. Никакого eval / new Function / VM.
   */
  let draftDefinition = null;
  if (parsed.strategyDraft) {
    core = core ?? (await loadLabCore());
    const compiled = core.compileResearchDraft(parsed.strategyDraft);
    if (!compiled.ok || !compiled.definition) {
      throw new LabRequestError(
        `Код стратегии некорректен: ${core.formatCodeErrors(compiled.errors)}`,
        400,
        'INVALID_STRATEGY_CODE'
      );
    }
    draftDefinition = compiled.definition;
  }

  if (parsed.strategyGraph) {
    core = core ?? (await loadLabCore());
    const validation = core.validateStrategyGraph(parsed.strategyGraph);
    if (!validation.ok) {
      throw new LabRequestError(
        `Блок-схема некорректна: ${core.formatGraphErrors(validation.errors)}`,
        400,
        'INVALID_STRATEGY_GRAPH'
      );
    }
  }

  const historical = await selectHistoricalCandles(parsed, options);
  core = core ?? (await loadLabCore());

  const strategyId = draftDefinition
    ? (parsed.strategyId || core.CODE_DRAFT_ID)
    : parsed.strategyGraph
    ? (parsed.strategyId || core.BLOCK_GRAPH_ID)
    : parsed.strategyDefinition
      ? (parsed.strategyId || 'CONSTRUCTOR')
      : parsed.strategyId;

  if (
    strategyId &&
    !draftDefinition &&
    !parsed.strategyDefinition &&
    !parsed.strategyGraph &&
    !core.isKnownLabStrategy(strategyId)
  ) {
    throw new LabRequestError(`Неизвестная стратегия: ${strategyId}`, 400, 'UNKNOWN_STRATEGY');
  }

  const nowMs = options.nowMs ?? Date.now();
  const result = core.runLabReplay(
    {
      strategyId,
      strategyDefinition: draftDefinition ?? parsed.strategyDefinition,
      strategyGraph: parsed.strategyGraph,
      market: parsed.market,
      symbol: parsed.symbol,
      timeframe: parsed.timeframe,
      from: parsed.from,
      to: parsed.to,
      candles: historical.candles,
      researchConfig: parsed.researchConfig,
    },
    nowMs
  );

  return {
    ...result,
    meta: {
      ...result.meta,
      ...historical.meta,
    },
  };
}

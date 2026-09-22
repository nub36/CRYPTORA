/**
 * CRYPTORA — Серверный движок стратегий.
 *
 * Что здесь происходит и чего здесь НЕТ:
 *  • Математики стратегий здесь нет. Движок загружает скомпилированное ядро из
 *    `src/` (см. strategyCoreBundle.js) и вызывает тот же `LiveSignalEngine`,
 *    что и браузер. Ручного пересказа формул нет: именно расхождение копии с
 *    определением породило баг V3.3 на проде.
 *  • Торговых ключей, исполнения ордеров и приватных эндпоинтов нет.
 *
 * Поток одного скана:
 *   1. взять закрытые свечи через MarketDataFetcher (кэш + дедуп);
 *   2. выполнить один проход LiveSignalEngine.scanOnce() — оценка и проверка
 *      инварианта геометрии происходят внутри ядра;
 *   3. забрать готовые сетапы из ledger ядра и сохранить в PostgreSQL через
 *      signalRepository (дедупликация по закрытой свече);
 *   4. вернуть сводку. Ошибки не глотаются: их фиксирует планировщик.
 */

import { loadStrategyCore } from './strategyCoreBundle.js';
import { getMarketDataFetcher } from './marketDataFetcher.js';
import { insertSignal, countActiveSignals } from '../signalRepository.js';
import { getStrategy } from '../strategyCatalog.js';
import { recordScanResult, recordSignalEmitted } from '../strategySettings.js';

/**
 * Соответствие registry id ↔ ключ стратегии внутри LiveSignalEngine.
 * Ключи движка — это версии, а не registry id; сверено с вызовами
 * runV30/runV33/runV28 в src/services/signals/live/LiveSignalEngine.ts.
 */
export const ENGINE_STRATEGY_KEY = {
  V3_0_HTF_LIQUIDATION_TRAP: 'V3.0',
  V3_3_HTF_ZONE_MITIGATION: 'V3.3',
  V2_8_ZERO_FEE_SNIPER_TRAILING: 'V2.8',
};

/** Таймфрейм исполнения по стратегии — из определений (execTimeframe). */
export const EXEC_TIMEFRAME = {
  V3_0_HTF_LIQUIDATION_TRAP: '1h',
  V3_3_HTF_ZONE_MITIGATION: '1h',
  V2_8_ZERO_FEE_SNIPER_TRAILING: '15m',
};

/**
 * @param {object} p
 * @param {string} p.strategyId
 * @param {string[]|null} [p.symbols] — переопределение из strategy_settings
 * @param {import('./marketDataFetcher.js').MarketDataFetcher} [p.fetcher]
 * @param {boolean} [p.persist] — false только в тестах
 * @returns {Promise<{strategyId:string, symbolsScanned:number, evaluated:boolean,
 *                    setupsFound:number, inserted:number, duplicates:number,
 *                    rejected:object|null}>}
 */
export async function runStrategyScan({ strategyId, symbols = null, fetcher, persist = true }) {
  const meta = getStrategy(strategyId);
  if (!meta) {
    const err = new Error(`Unknown strategy: ${strategyId}`);
    /** @type {any} */ (err).statusCode = 404;
    throw err;
  }
  const engineKey = ENGINE_STRATEGY_KEY[strategyId];
  if (!engineKey) {
    const err = new Error(`No live adapter for strategy: ${strategyId}`);
    /** @type {any} */ (err).statusCode = 501;
    throw err;
  }

  const universe = Array.isArray(symbols) && symbols.length > 0 ? symbols : meta.defaultSymbols;
  const dataFetcher = fetcher ?? getMarketDataFetcher();
  const core = await loadStrategyCore();

  // Ядро — синглтон с ledger внутри. Сбрасываем, чтобы скан другой стратегии
  // не подмешал чужие сетапы и не переиспользовал устаревший экземпляр.
  core.SignalsAuditLedger.resetInstance?.();
  core.LiveSignalEngine.resetInstance();

  const engine = core.LiveSignalEngine.getInstance({
    provider: dataFetcher.asProvider(),
    symbols: universe,
    strategies: [engineKey],
  });
  if (!engine) throw new Error('Failed to instantiate strategy core engine');

  /**
   * Предзагрузка свечей.
   *
   * Ядро глотает ошибки по каждому символу внутри scanSymbol(), поэтому полный
   * отказ рыночных данных выглядел бы как «сигналов нет» — а это подмена
   * «нет данных» на «нет сетапов», что запрещено. Здесь данные тянем явно:
   *   • сбой пробрасывается наверх и попадает в strategy_settings.last_error;
   *   • ядро затем берёт свечи из кэша фетчера, повторных HTTP-запросов нет.
   */
  const execTf = EXEC_TIMEFRAME[strategyId] ?? '1h';
  const timeframes = [...new Set([execTf, ...meta.timeframes])];
  const fetchResults = await Promise.allSettled(
    universe.flatMap((symbol) =>
      timeframes.map((tf) => dataFetcher.getCandles(symbol, tf))
    )
  );
  const failures = fetchResults.filter((r) => r.status === 'rejected');
  if (failures.length > 0) {
    const first = /** @type {PromiseRejectedResult} */ (failures[0]).reason;
    const err = new Error(
      `Market data unavailable for ${failures.length}/${fetchResults.length} series: ` +
        (first instanceof Error ? first.message : String(first))
    );
    /** @type {any} */ (err).code = 'MARKET_DATA_UNAVAILABLE';
    throw err;
  }

  const ledger = core.SignalsAuditLedger.getInstance();
  const before = new Set(ledger.getSetups().map((s) => s.id));

  // ОДИН проход по требованию, без setInterval: расписанием владеет
  // StrategyScheduler, а не ядро.
  await engine.scanOnce();

  const fresh = ledger.getSetups().filter((s) => !before.has(s.id));

  let inserted = 0;
  let duplicates = 0;

  for (const setup of fresh) {
    if (!persist) continue;
    const res = await insertSignal({
      strategyId,
      symbol: setup.symbol,
      timeframe: setup.timeframe,
      direction: setup.direction,
      // Дедупликация по закрытой свече. Если метки нет (старая запись ядра),
      // сигнал не сохраняется: сохранять без ключа — значит потерять дедуп.
      signalCandleTs:
        typeof setup.sourceCandleTs === 'number'
          ? new Date(setup.sourceCandleTs)
          : new Date(setup.createdAt),
      entryMin: setup.entryZone?.[0] ?? null,
      entryMax: setup.entryZone?.[1] ?? null,
      stopLoss: setup.invalidationLevel ?? null,
      tp1: setup.targets?.[0] ?? null,
      tp2: setup.targets?.[1] ?? null,
      status: 'ACTIVE',
      metadata: {
        engineSetupId: setup.id,
        riskRewardRatio: setup.riskRewardRatio ?? null,
        confirmingFactors: setup.confirmingFactors ?? [],
        invalidationFactors: setup.invalidationFactors ?? [],
        engineVersion: engineKey,
      },
    });
    if (res.inserted) inserted++;
    else duplicates++;
  }

  if (inserted > 0) await recordSignalEmitted(strategyId);

  return {
    strategyId,
    symbolsScanned: universe.length,
    evaluated: true,
    setupsFound: fresh.length,
    inserted,
    duplicates,
    rejected: engine.lastRejected ?? null,
    activeSignals: persist ? await countActiveSignals(strategyId) : null,
  };
}

/**
 * Сканирует одну стратегию и фиксирует результат в strategy_settings.
 * Ошибка НЕ пробрасывается наружу как крах: она записывается в last_error,
 * чтобы бэкенд продолжал работать.
 */
export async function scanStrategySafely({ strategyId, symbols = null, fetcher, persist = true }) {
  try {
    const result = await runStrategyScan({ strategyId, symbols, fetcher, persist });
    if (persist) await recordScanResult({ strategyId, error: null });
    return { ok: true, ...result };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (persist) {
      await recordScanResult({ strategyId, error: message }).catch(() => {});
    }
    return { ok: false, strategyId, error: message };
  }
}

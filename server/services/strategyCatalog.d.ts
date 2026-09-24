/**
 * Декларации для server/services/strategyCatalog.js.
 *
 * Каталог — единственный источник состава продуктовых стратегий для сервера:
 * порядок в API, таймфреймы исполнения/контекста, дефолтный универсум и бейджи.
 * Математики стратегий здесь нет и быть не должно: она живёт в `src/` и
 * исполняется через скомпилированное ядро.
 */

export type StrategyBadge = 'RESEARCH' | 'TRAIN_ONLY' | 'GROSS_ONLY';

export interface ProductStrategy {
  /** Идентификатор в реестре (тот же, что в `strategy_settings` и в сигналах). */
  id: string;
  /** Версия стратегии, напр. '3.0'. */
  version: string;
  name: string;
  nameRu: string;
  /** ВСЕ серии, которые стратегия реально использует (исполнение + контекст). */
  timeframes: string[];
  /**
   * Таймфрейм ИСПОЛНЕНИЯ: бар, на котором принимается решение и публикуется
   * сетап. У всех трёх продуктовых стратегий — '1h' (сверено с `EXEC_TIMEFRAME`
   * ядра и `V28_LIVE_TIMEFRAME`); '15m' — параметр исторического исследования
   * V2.8, а не LIVE-характеристика.
   */
  execTimeframe: string;
  /** Старшие серии контекста (структура/зоны) — отдельно от исполнения. */
  contextTimeframes: string[];
  /** Универсум по умолчанию, в биржевой форме ('BTCUSDT'). */
  defaultSymbols: string[];
  defaultScanIntervalSeconds: number;
  badge: StrategyBadge;
}

export declare const PRODUCT_STRATEGIES: readonly ProductStrategy[];
export declare const KNOWN_STRATEGY_IDS: ReadonlySet<string>;
export declare function getStrategy(id: string): ProductStrategy | undefined;
export declare function isKnownStrategyId(id: string): boolean;
export declare const BADGE_LABELS: Readonly<Record<StrategyBadge, string>>;

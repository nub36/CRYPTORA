/**
 * Типовая форма продуктового каталога CRYPTORA (`server/services/strategyCatalog.js`).
 * Файл нужен только тестам: сам каталог — обычный JS, а контракт «продукт =
 * каталог» проверяется здесь строго типизированно.
 */
export type StrategyBadge = 'RESEARCH' | 'TRAIN_ONLY' | 'GROSS_ONLY' | 'DERIVED_NO_BACKTEST';

export interface ProductStrategy {
  id: string;
  version: string;
  name: string;
  nameRu: string;
  timeframes: string[];
  execTimeframe: string;
  contextTimeframes: string[];
  defaultSymbols: string[];
  defaultScanIntervalSeconds: number;
  badge: StrategyBadge;
}

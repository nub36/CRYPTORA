/**
 * Общий презентационный слой карточки инструмента (задача §2, §17).
 *
 * Обе страницы — `/coin/:symbol` (Spot) и `/futures/:symbol` (USD-M) —
 * собираются из ЭТИХ компонентов. Второй копии «страницы на 2000 строк» нет:
 * различие рынков живёт в данных (адаптеры/хуки), а не в вёрстке.
 */
export {
  InstrumentSectionCard,
  InstrumentMetricRow,
  NoData,
  type InstrumentSectionStatus,
  type InstrumentMetricRowProps,
} from './InstrumentSectionCard';
export { InstrumentMetricsCard } from './InstrumentMetricsCard';
export { InstrumentChartCard } from './InstrumentChartCard';
export { InstrumentRadarCard, type RadarSourcePolicy } from './InstrumentRadarCard';
export {
  buildSpotStatisticsRows,
  buildFuturesStatisticsRows,
  buildDerivativesRows,
  buildTechnicalRows,
  buildCorrelationRows,
  sectionSourceNote,
  formatUntil,
  type CorrelationContext,
  type InstrumentIndicatorsInput,
} from './instrumentMetrics';

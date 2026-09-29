import React from 'react';
import {
  InstrumentMetricRow,
  InstrumentSectionCard,
  type InstrumentMetricRowProps,
  type InstrumentSectionCardProps,
} from './InstrumentSectionCard';

/**
 * Секция «метка → значение» (задача §2, §5, §6, §7, §8).
 *
 * Один компонент обслуживает «Рыночную статистику», «Деривативы»,
 * «Технические индикаторы» и «Корреляцию с BTC» на ОБЕИХ страницах: рынок
 * задаёт только НАБОР строк (см. `instrumentMetrics.tsx`), а вёрстка,
 * состояния и отступы общие. Правка стиля карточки автоматически применяется
 * к Spot и Futures — дублировать фикс не нужно (§17).
 */
export interface InstrumentMetricsCardProps extends Omit<InstrumentSectionCardProps, 'children'> {
  rows: InstrumentMetricRowProps[];
}

export const InstrumentMetricsCard: React.FC<InstrumentMetricsCardProps> = ({ rows, ...section }) => (
  <InstrumentSectionCard {...section}>
    <div className="space-y-2">
      {rows.map((row) => (
        <InstrumentMetricRow key={row.label} {...row} />
      ))}
    </div>
  </InstrumentSectionCard>
);

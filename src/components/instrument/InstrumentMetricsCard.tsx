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
  /**
   * `rows` (по умолчанию) — вертикальные строки «метка → значение».
   *
   * `inline` — горизонтальная informational-раскладка для ШИРОКОЙ карточки
   * (UI-cleanup §4: «Корреляция с BTC» на desktop занимает всю строку grid).
   * Ячейки стоят в один ряд (`sm:grid-cols-3`), каждая ограничена собственной
   * шириной (`min-w-0`), поэтому текст не растягивается «на километр»;
   * на мобильном (<640px) возвращается вертикальный список ячеек.
   */
  variant?: 'rows' | 'inline';
}

/** Одна ячейка inline-карточки: подпись сверху, значение снизу, ширина ограничена. */
const InlineMetricCell: React.FC<InstrumentMetricRowProps> = ({
  label,
  value,
  tone = null,
  hint,
  qa,
  suffix,
}) => (
  <div
    data-qa={qa}
    className="min-w-0 rounded-md border border-white/[0.06] bg-surface-elevated/40 px-3 py-2"
  >
    <div className="truncate font-sans text-[11px] text-slate-400" title={hint}>{label}</div>
    <div
      className={`mt-1 truncate font-mono text-xs tabular-nums ${
        tone === null || tone === undefined
          ? 'font-semibold text-white'
          : tone >= 0
            ? 'font-bold text-brand-green'
            : 'font-bold text-brand-red'
      }`}
    >
      {value}
      {suffix}
    </div>
  </div>
);

export const InstrumentMetricsCard: React.FC<InstrumentMetricsCardProps> = ({
  rows,
  variant = 'rows',
  ...section
}) => (
  <InstrumentSectionCard {...section}>
    {variant === 'inline' ? (
      <div data-qa={`${section.qa}-cells`} className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
        {rows.map((row) => (
          <InlineMetricCell key={row.label} {...row} />
        ))}
      </div>
    ) : (
      <div className="space-y-2">
        {rows.map((row) => (
          <InstrumentMetricRow key={row.label} {...row} />
        ))}
      </div>
    )}
  </InstrumentSectionCard>
);

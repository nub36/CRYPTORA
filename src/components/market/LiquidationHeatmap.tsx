import React, { useMemo } from 'react';
import { Layers, ShieldAlert } from 'lucide-react';
import { LiquidationHeatmapModel } from '@/services/liquidations/LiquidationHeatmap';
import { Badge } from '@/components/common/Badge';
import { formatCurrency } from '@/utils/formatters';

interface LiquidationHeatmapProps {
  model: LiquidationHeatmapModel | null;
  /** Причина, по которой карта не построена (честная деградация вместо заглушек). */
  unavailableNote?: string;
}

/**
 * Интенсивность → цвет. Детерминированная шкала:
 * низкая плотность — циан, средняя — янтарь, высокая — роза.
 */
function colorFor(value: number): string {
  if (value <= 0.001) return 'rgba(10, 15, 29, 0)';
  const alpha = Number((0.12 + Math.min(1, value) * 0.88).toFixed(3));
  if (value < 0.34) return `rgba(34, 211, 238, ${alpha})`;
  if (value < 0.67) return `rgba(251, 191, 36, ${alpha})`;
  return `rgba(244, 63, 94, ${alpha})`;
}

function rowGradient(values: number[]): string {
  if (values.length === 0) return 'transparent';
  const step = 100 / values.length;
  const stops = values.map((value, index) => {
    const from = Number((index * step).toFixed(3));
    const to = Number(((index + 1) * step).toFixed(3));
    const color = colorFor(value);
    return `${color} ${from}%, ${color} ${to}%`;
  });
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}

/**
 * LiquidationHeatmap — 2D-карта плотности зон ликвидации (цена × время).
 *
 * Реализована DOM-градиентами (по одной строке цены), а не canvas: карта должна
 * быть проверяема скриншот-тестами и оставаться доступной для текстового описания.
 *
 * ⚠️ Карта ВСЕГДА маркируется `MODEL / ESTIMATED` и никогда не показывается как
 * фактические события ликвидаций — они живут отдельно, в потоке биржи.
 */
export const LiquidationHeatmap: React.FC<LiquidationHeatmapProps> = ({ model, unavailableNote }) => {
  const busiestRow = useMemo(() => {
    if (!model) return null;
    return model.rows.reduce((best, row) => {
      const total = row.values.reduce((a, b) => a + b, 0);
      return total > best.total ? { total, price: row.price } : best;
    }, { total: 0, price: model.referencePrice });
  }, [model]);

  return (
    <section
      data-qa="liquidation-heatmap"
      aria-label="Расчетная тепловая карта плотности ликвидаций"
      className="bg-surface border border-surface-border rounded-lg p-3.5 sm:p-4 space-y-3"
    >
      <header className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-surface-border">
        <div className="flex items-center space-x-2">
          <Layers className="w-4 h-4 text-cyan-400" />
          <span className="text-[13px] font-bold uppercase tracking-wider text-white font-mono">
            Тепловая карта плотности ликвидаций (Price × Time)
          </span>
        </div>
        <div className="flex items-center space-x-2">
          {model && (
            <Badge variant={model.inputSource === 'DEMO' ? 'amber' : 'green'}>
              {model.inputSource === 'DEMO' ? 'ВХОД: DEMO-СВЕЧИ' : 'ВХОД: ФАКТИЧЕСКИЕ СВЕЧИ'}
            </Badge>
          )}
          <Badge variant="cyan">MODEL / ESTIMATED</Badge>
        </div>
      </header>

      {model ? (
        <>
          <div className="flex items-start gap-1.5 text-[13px] text-amber-300/90 font-sans">
            <ShieldAlert className="w-4 h-4 flex-shrink-0 mt-0.5 text-amber-400" />
            <p className="leading-relaxed">
              {model.methodNote}{' '}
              <span className="text-slate-400">
                Максимальная расчетная плотность — вблизи{' '}
                <strong className="text-slate-200">{formatCurrency(model.peakPrice)}</strong> при текущей
                метке <strong className="text-slate-200">{formatCurrency(model.referencePrice)}</strong>.
              </span>
            </p>
          </div>

          <div className="flex gap-2">
            {/* Ось цены */}
            <div className="relative w-16 sm:w-20 h-[260px] sm:h-[300px] flex-shrink-0">
              {model.priceTicks.map((tick) => (
                <span
                  key={`price-${tick.offsetPct}`}
                  className="absolute right-1 -translate-y-1/2 text-[11px] font-mono text-slate-400 tabular-nums"
                  style={{ top: `${tick.offsetPct}%` }}
                >
                  {tick.label}
                </span>
              ))}
            </div>

            {/* Полотно карты: одна строка цены = один градиент по времени */}
            <div className="relative flex-1 min-w-0">
              <div
                className="h-[260px] sm:h-[300px] rounded border border-white/[0.06] bg-[#0a0f1d] overflow-hidden"
                role="img"
                aria-label={`Тепловая карта плотности ликвидаций: ${model.columns} временных колонок, ${model.rows.length} ценовых уровней, максимальная плотность вблизи ${formatCurrency(
                  model.peakPrice
                )}`}
              >
                {model.rows.map((row, index) => (
                  <div
                    key={`row-${index}`}
                    className="w-full"
                    style={{ height: `${100 / model.rows.length}%`, background: rowGradient(row.values) }}
                  />
                ))}
              </div>

              {/* Метка текущей цены: где модель видит рынок сейчас */}
              <div
                className="absolute left-0 right-0 border-t border-dashed border-white/40 pointer-events-none"
                style={{
                  top: `${Math.min(
                    100,
                    Math.max(0, ((model.rows[0].price - model.referencePrice) / (model.rows[0].price - model.rows[model.rows.length - 1].price)) * 100)
                  )}%`,
                }}
              />
            </div>
          </div>

          {/* Ось времени */}
          <div className="relative h-4 ml-[68px] sm:ml-[84px] mr-0">
            {model.timeTicks.map((tick, index) => {
              // Выравнивание по краям обязательно: иначе крайние подписи вылезают за карточку.
              const isLast = index === model.timeTicks.length - 1;
              const anchor = isLast || tick.offsetPct > 85 ? 'translateX(-100%)' : index === 0 || tick.offsetPct < 15 ? 'none' : 'translateX(-50%)';
              return (
                <span
                  key={`time-${index}`}
                  className="absolute text-[11px] font-mono text-slate-400 whitespace-nowrap"
                  style={{ left: `${tick.offsetPct}%`, transform: anchor }}
                >
                  {tick.label}
                </span>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-surface-border">
            <div className="flex items-center space-x-2 text-[11px] font-mono text-slate-400">
              <span>Плотность:</span>
              <span className="w-10 h-2.5 rounded-sm" style={{ background: colorFor(0.15) }} />
              <span className="w-10 h-2.5 rounded-sm" style={{ background: colorFor(0.5) }} />
              <span className="w-10 h-2.5 rounded-sm" style={{ background: colorFor(1) }} />
              <span className="text-slate-500">низкая → высокая</span>
            </div>
            <div className="text-[11px] font-mono text-slate-400">
              Плечи модели: {model.leverageTiers.map((t) => `${t}x`).join(' · ')} · колонок: {model.columns}
              {busiestRow && (
                <span className="text-slate-500">
                  {' '}
                  · пик плотности: {formatCurrency(busiestRow.price)}
                </span>
              )}
            </div>
          </div>
        </>
      ) : (
        <div className="py-6 text-center space-y-1.5">
          <p className="text-[13px] text-slate-300 font-sans">
            Карта не построена: недостаточно входных данных для расчетной модели.
          </p>
          <p className="text-xs text-slate-500 font-sans">
            {unavailableNote ??
              'Требуются исторические свечи и метка цены. Оценочные зоны не подставляются «на глаз».'}
          </p>
        </div>
      )}
    </section>
  );
};

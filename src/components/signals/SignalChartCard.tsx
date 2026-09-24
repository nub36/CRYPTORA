/**
 * SignalChartCard — свечной график выбранного инструмента (§6, §7, §8).
 *
 * Переиспользует общий `CandleChart` аддитивно: маркеры истории сигналов и
 * линии уровней ВЫБРАННОГО сигнала передаются через новые опциональные
 * props (`markers`, `levelLines`, `onMarkerClick`). Существующие потребители
 * `CandleChart` (/coin, /overview) не передают их и ведут себя как раньше.
 *
 * Свечи запрашиваются ТОЛЬКО для выбранного символа и выбранного таймфрейма
 * (хук `useSignalChartCandles`); веера запросов по вселенной здесь нет.
 */

import React from 'react';
import type { OHLCV, Timeframe } from '@/types/market';
import type { KlineTick } from '@/types/realtime';
import type { ChartLevelLine, ChartMarker } from '@/types/chart';
import { CandleChart } from '@/components/common/CandleChart';
import { timeframeMismatchNote } from '@/utils/serverSignalText';

/** Компактный набор таймфреймов графика. 1h — исполнение всех трёх стратегий. */
export const SIGNAL_CHART_TIMEFRAMES: readonly Timeframe[] = ['15m', '1h', '4h', '1D'];

interface SignalChartCardProps {
  symbol: string;
  pair: string;
  timeframe: Timeframe;
  onTimeframeChange: (tf: Timeframe) => void;
  candles: OHLCV[];
  realtimeKline: KlineTick | null;
  candlePhase: 'idle' | 'loading' | 'ready' | 'error';
  candleError: string | null;
  markers: ChartMarker[];
  levelLines: ChartLevelLine[];
  /** Вызывается, когда пользователь кликнул по бару с маркером. */
  onMarkerSelect: (signalId: string) => void;
  /** Таймфрейм выбранного сигнала — для честной пометки о рассогласовании. */
  selectedSignalTimeframe?: string | null;
  height?: number;
}

export const SignalChartCard: React.FC<SignalChartCardProps> = ({
  symbol,
  pair,
  timeframe,
  onTimeframeChange,
  candles,
  realtimeKline,
  candlePhase,
  candleError,
  markers,
  levelLines,
  onMarkerSelect,
  selectedSignalTimeframe = null,
  height,
}) => {
  const mismatch = timeframeMismatchNote(selectedSignalTimeframe, timeframe);

  const handleMarkerClick = (marker: ChartMarker, atTime: ChartMarker[]) => {
    // Приоритет: явно выбранный маркер → открытый сигнал → поздний.
    // Порядок сервера: поздний = первый в порядке убывания, но здесь мы берём
    // тот, что передаёт график как основной, и даём странице уточнить выбор.
    const chosen =
      atTime.find((m) => m.payload?.['selected'] === true) ??
      atTime.find((m) => m.payload?.['status'] === 'ACTIVE' || m.payload?.['status'] === 'FILLED') ??
      marker;
    const id = typeof chosen.payload?.['signalId'] === 'string' ? chosen.payload['signalId'] : null;
    if (id) onMarkerSelect(id);
  };

  return (
    <section
      data-qa="signals-chart-card"
      className="space-y-2 rounded-lg border border-surface-border bg-surface p-3"
      aria-label={`График ${pair}`}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <span className="ui-h2">{pair}</span>
          <span className="rounded border border-surface-border bg-surface-elevated px-2 py-0.5 text-xs font-mono text-slate-300">
            {timeframe}
          </span>
        </div>

        {/* Компактный переключатель таймфрейма графика (§5). */}
        <div
          className="flex items-center gap-1 self-start rounded border border-surface-border bg-surface-elevated p-1"
          role="group"
          aria-label="Таймфрейм графика"
        >
          {SIGNAL_CHART_TIMEFRAMES.map((tf) => (
            <button
              key={tf}
              type="button"
              onClick={() => onTimeframeChange(tf)}
              aria-pressed={timeframe === tf}
              data-qa={`signals-chart-tf-${tf}`}
              className={`min-h-[36px] rounded px-2.5 text-xs transition-colors ${
                timeframe === tf
                  ? 'bg-brand-cyan font-bold text-slate-950'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {tf}
            </button>
          ))}
        </div>
      </div>

      {/* Честная пометка: график и сигнал могут быть на разных таймфреймах (§5). */}
      {mismatch && (
        <p className="ui-helper text-amber-300" data-qa="signals-chart-tf-mismatch">
          {mismatch}. Сигнал выпускается стратегией на своём таймфрейме исполнения — переключение
          таймфрейма графика не меняет таймфрейм сигнала.
        </p>
      )}

      <div className="relative">
        <CandleChart
          data={candles}
          symbol={pair}
          timeframe={timeframe}
          realtimeKline={realtimeKline}
          height={height}
          showMA={false}
          markers={markers}
          levelLines={levelLines}
          onMarkerClick={handleMarkerClick}
        />

        {(candlePhase === 'loading' || candlePhase === 'error') && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl bg-black/30">
            <span
              className={`rounded border px-3 py-1.5 text-xs ${
                candlePhase === 'error'
                  ? 'border-rose-500/40 bg-rose-500/10 text-rose-300'
                  : 'border-surface-border bg-surface-elevated text-slate-300'
              }`}
              data-qa={candlePhase === 'error' ? 'signals-chart-error' : 'signals-chart-loading'}
            >
              {candlePhase === 'error'
                ? `Свечи недоступны${candleError ? `: ${candleError}` : ''}`
                : 'Загрузка свечей…'}
            </span>
          </div>
        )}
      </div>

      <p className="ui-helper">
        Свечи — только выбранный инструмент и таймфрейм. Маркеры — сохранённые сервером сигналы; клик по
        маркеру выбирает сигнал и показывает его уровни. Линии — уровни выбранного сигнала.
      </p>
      <span className="sr-only" aria-live="polite" data-qa="signals-chart-symbol">{symbol}</span>
    </section>
  );
};

export default SignalChartCard;

import React, { useState, useEffect, useMemo } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import type { OHLCV, Timeframe } from '@/types/market';
import type { KlineTick } from '@/types/realtime';
import type { ChartLevelLine, ChartMarker } from '@/types/chart';
import type { SignalUiModel } from '@/services/signals/ui/signalUiModel';
import { CandleChart } from '@/components/common/CandleChart';
import { timeframeMismatchNote } from '@/utils/serverSignalText';
import { timeZoneLabel, browserTimeZone } from '@/utils/timePresentation';
import { buildSignalLevelLines } from '@/services/signals/ui/signalChartProjection';
import {
  ChartDisplaySettingsModal,
  loadChartDisplaySettings,
  saveChartDisplaySettings,
  type ChartDisplaySettings,
} from './ChartDisplaySettingsModal';
import { SignalMarkerPopover } from './SignalMarkerPopover';

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
  /** Выбранный сигнал — для отображения деталей в карточке / попапе. */
  activeSignal?: SignalUiModel | null;
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
  activeSignal = null,
  height,
}) => {
  const mismatch = timeframeMismatchNote(selectedSignalTimeframe, timeframe);

  // Настройки отображения графика (минималистичный mobile default)
  const [displaySettings, setDisplaySettings] = useState<ChartDisplaySettings>(loadChartDisplaySettings);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);

  // Смена монеты закрывает попап маркера
  useEffect(() => {
    setIsPopoverOpen(false);
  }, [symbol]);

  const handleMarkerClick = (marker: ChartMarker, atTime: ChartMarker[]) => {
    // Приоритет: явно выбранный маркер → открытый сигнал → поздний.
    const chosen =
      atTime.find((m) => m.payload?.['selected'] === true) ??
      atTime.find((m) => m.payload?.['status'] === 'ACTIVE' || m.payload?.['status'] === 'FILLED') ??
      marker;
    const id = typeof chosen.payload?.['signalId'] === 'string' ? chosen.payload['signalId'] : null;
    if (id) {
      onMarkerSelect(id);
      setIsPopoverOpen(true);
      // Автоматически включаем уровни для выбранного сигнала
      if (!displaySettings.showLevels) {
        setDisplaySettings((prev) => {
          const next = { ...prev, showLevels: true };
          saveChartDisplaySettings(next);
          return next;
        });
      }
    }
  };

  const handleToggleLevels = () => {
    setDisplaySettings((prev) => {
      const next = { ...prev, showLevels: !prev.showLevels };
      saveChartDisplaySettings(next);
      return next;
    });
  };

  // Вычисляем линии уровней с учётом пользовательских настроек отображения
  const effectiveLevelLines = useMemo(() => {
    if (!displaySettings.showLevels) return [];
    if (activeSignal) {
      return buildSignalLevelLines(activeSignal, {
        showEffective: true,
        showLabels: displaySettings.showLevelLabels,
        compact: true,
      }).lines;
    }
    return levelLines;
  }, [displaySettings.showLevels, displaySettings.showLevelLabels, activeSignal, levelLines]);

  const effectiveMarkers = displaySettings.showMarkers ? markers : [];

  return (
    <section
      data-qa="signals-chart-card"
      className="space-y-2 rounded-lg border border-surface-border bg-surface p-3"
      aria-label={`График ${pair}`}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <span className="ui-h2">{pair}</span>
          <span className="rounded border border-surface-border bg-surface-elevated px-2 py-0.5 text-xs font-mono text-slate-300">
            {timeframe}
          </span>
          {/*
            Часовой пояс устройства в тулбаре на desktop (НЕ поверх canvas).
            На mobile скрыт (hidden sm:inline-block), чтобы не занимать ценное пространство.
          */}
          <span
            className="hidden sm:inline-block rounded border border-surface-border bg-surface-elevated/80 px-2 py-0.5 text-[11px] text-slate-400"
            data-qa="chart-timezone-label"
            title={`Часовой пояс: ${browserTimeZone()}`}
          >
            {timeZoneLabel('BROWSER')}
          </span>
        </div>

        {/* Переключатель таймфрейма + кнопка настроек отображения */}
        <div className="flex items-center gap-1.5 self-start">
          <div
            className="flex items-center gap-1 rounded border border-surface-border bg-surface-elevated p-1"
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

          {/* Компактная кнопка настройки отображения графика */}
          <button
            type="button"
            onClick={() => setIsSettingsOpen(true)}
            aria-label="Настройки отображения графика"
            data-qa="chart-display-settings-btn"
            data-testid="chart-display-settings-btn"
            className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded border border-surface-border bg-surface-elevated text-slate-400 hover:text-white hover:bg-surface-elevated/80 transition-colors"
            title="Отображение графика"
          >
            <SlidersHorizontal className="h-4 w-4" />
          </button>
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
          showVolume={displaySettings.showVolume}
          showBadges={displaySettings.showBadges}
          showTimezone={false}
          markers={effectiveMarkers}
          levelLines={effectiveLevelLines}
          onMarkerClick={handleMarkerClick}
        />

        {/* Карточка / bottom sheet деталей сигнала по тапу на маркер */}
        <SignalMarkerPopover
          model={activeSignal}
          isOpen={isPopoverOpen && !!activeSignal}
          onClose={() => setIsPopoverOpen(false)}
          showLevels={displaySettings.showLevels}
          onToggleLevels={handleToggleLevels}
        />

        {(candlePhase === 'loading' || candlePhase === 'error') && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl bg-black/30">
            <span
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium backdrop-blur-sm ${
                candlePhase === 'error'
                  ? 'border-rose-500/40 bg-surface/90 text-rose-300'
                  : 'border-surface-border bg-surface/90 text-slate-300'
              }`}
              data-qa={candlePhase === 'error' ? 'signals-chart-error' : 'signals-chart-loading'}
            >
              {candlePhase === 'error' ? candleError ?? 'Свечи недоступны' : 'Загрузка свечей…'}
            </span>
          </div>
        )}
      </div>

      {/* Модальное окно настроек отображения графика */}
      <ChartDisplaySettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={displaySettings}
        onChange={setDisplaySettings}
      />

      <p className="ui-helper">
        Свечи — только выбранный инструмент и таймфрейм. Маркеры — сохранённые сервером сигналы; клик по
        маркеру выбирает сигнал и показывает его уровни. Линии — уровни выбранного сигнала.
      </p>
      <span className="sr-only" aria-live="polite" data-qa="signals-chart-symbol" data-testid="signals-chart-symbol">{symbol}</span>
    </section>
  );
};

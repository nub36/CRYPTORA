/**
 * CRYPTORA — Strategy Lab · обёртка графика (frontend, RESEARCH ONLY)
 * ---------------------------------------------------------------------------
 * Переиспользует существующий CandleChart ТОЛЬКО через его публичные props
 * (data / indicators / markers / levelLines / onMarkerClick / resetViewToken /
 * timeframe / showMA / showVolume). CandleChart НЕ модифицируется.
 *
 * Состав слоя (§4–§16 задачи Chart Strategy Visualization):
 *   • OHLCV + volume — как есть из результата бэктеста;
 *   • EMA с visible=true — в слоты sma20/sma50/sma200 (больше 3 линий общий
 *     график не принимает — честное ограничение без его правки); visible=false
 *     не рисуется, но продолжает участвовать в математике движка;
 *   • ATR сознательно НЕ рисуется поверх цены (нет отдельной pane);
 *   • маркеры CANDIDATE/FILL/TP1/STOP/EXIT — см. labChartProjection;
 *   • Entry/SL/TP level lines — ТОЛЬКО для выбранной сделки (§6);
 *   • overlay-переключатели — чистое presentation-состояние (§10);
 *   • resetViewToken — после каждого НОВОГО результата график получает
 *     разумный стартовый диапазон (последние ~72 бара, полная история доступна
 *     для scroll/zoom). Это фикс «сжатых свечей + пустого пространства»:
 *     без него CandleChart считает замену датасета живым обновлением и
 *     оставляет viewport прошлого бэктеста (см. report, §11/§12).
 */

import React, { useMemo, useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { CandleChart } from '@/components/common/CandleChart';
import type { OHLCV, Timeframe } from '@/types/market';
import type { ChartMarker } from '@/types/chart';
import type {
  LabReplayResult,
  LabTimeframe,
  LabTrade,
  StrategyDraftDefinition,
  PeriodIndicatorDefinition,
} from '@/services/strategyLab/types';
import {
  LAB_MARKERS_MAX,
  DEFAULT_LAB_MARKER_OVERLAYS,
  mapLabEventMarkers,
  mapFractalMarkers,
  mapFvgZones,
  mapMarketStructureProjection,
  mapOrderBlockZones,
  mapTradeLevels,
  type LabMarkerOverlays,
} from '@/services/strategyLab/labChartProjection';
import { LabTradeInspector } from './LabTradeInspector';

/**
 * Lab TF → production Timeframe. '1m' в production-типе отсутствует: значение
 * нужно CandleChart только для сравнения «сменился ли таймфрейм» (стартовое
 * окно) и маппинга WS-интервала (в Lab realtime-тика нет, а '1m' — валидный
 * интервал Binance), поэтому безопасно приводится к Timeframe на границе.
 */
const TF_TO_CHART: Record<LabTimeframe, Timeframe | '1m'> = {
  '1m': '1m',
  '5m': '5m',
  '15m': '15m',
  '30m': '30m',
  '1h': '1h',
  '4h': '4h',
  '1d': '1D',
};

function toChartData(result: LabReplayResult): OHLCV[] {
  return result.candles.map((c) => ({
    time: c.time,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
  }));
}

function toAligned(series?: (number | null)[]): number[] | undefined {
  if (!series || series.length === 0) return undefined;
  return series.map((v) => (v === null ? NaN : v));
}

function dataSourceLabel(source: string | undefined): string | null {
  if (source === 'local-dataset') return 'Локальный архив';
  if (source === 'binance-rest') return 'Binance REST';
  return null;
}

interface LabChartProps {
  result: LabReplayResult | null;
  selectedTrade: LabTrade | null;
  onSelectTrade: (tradeId: string | null) => void;
  /** Определение стратегии — для диагностики условий в инспекторе (§7). */
  definition?: StrategyDraftDefinition | null;
  height?: number;
}

const EMA_COLORS = ['#f59e0b', '#3b82f6', '#a855f7'];

const OVERLAY_CHIPS: Array<{ key: keyof LabMarkerOverlays | 'indicators'; label: string }> = [
  { key: 'indicators', label: 'Индикаторы' },
  { key: 'signals', label: 'LONG / SHORT' },
  { key: 'entries', label: 'Входы' },
  { key: 'stopTarget', label: 'SL / TP' },
  { key: 'exits', label: 'Выходы' },
];

export const LabChart: React.FC<LabChartProps> = ({
  result,
  selectedTrade,
  onSelectTrade,
  definition,
  height,
}) => {
  // ── Presentation-состояние оверлеев (§10): ТОЛЬКО отображение. ──
  const [overlays, setOverlays] = useState<LabMarkerOverlays & { indicators: boolean }>({
    ...DEFAULT_LAB_MARKER_OVERLAYS,
    indicators: true,
  });

  // ── Viewport-эпоха: любое НОВОЕ содержимое результата или ручной сброс
  // увеличивает счётчик → CandleChart (публичный prop resetViewToken) ставит
  // разумный стартовый диапазон. Выбор сделки/оверлеи счётчик НЕ трогают.
  const [viewEpoch, setViewEpoch] = useState(0);
  const [manualResets, setManualResets] = useState(0);
  const lastResultRef = useRef<LabReplayResult | null>(null);
  if (result !== lastResultRef.current) {
    lastResultRef.current = result;
    setViewEpoch((e) => e + 1);
  }
  const resetViewToken = viewEpoch + manualResets;

  const data = useMemo(() => (result ? toChartData(result) : []), [result]);

  // Выборка видимых EMA серий для графика (visible=false не рисуется)
  const { indicators, legendEmas } = useMemo(() => {
    if (!result || !overlays.indicators) return { indicators: undefined, legendEmas: [] };

    const defs = result.indicators.indicatorsList;
    const byId = result.indicators.byIndicatorId;

    if (defs && byId) {
      const visibleEmas = defs.filter(
        (ind): ind is PeriodIndicatorDefinition & { type: 'EMA' } => ind.type === 'EMA' && ind.visible !== false
      );
      const sma20 = visibleEmas[0] ? toAligned(byId[visibleEmas[0].id]) : undefined;
      const sma50 = visibleEmas[1] ? toAligned(byId[visibleEmas[1].id]) : undefined;
      const sma200 = visibleEmas[2] ? toAligned(byId[visibleEmas[2].id]) : undefined;

      const legend = visibleEmas.slice(0, 3).map((ind, i) => ({
        name: ind.name || `EMA ${ind.period}`,
        color: EMA_COLORS[i] ?? '#f59e0b',
      }));

      return { indicators: { sma20, sma50, sma200 }, legendEmas: legend };
    }

    // Fallback на стандартные emaFast / emaSlow
    return {
      indicators: {
        sma20: toAligned(result.indicators.emaFast),
        sma50: toAligned(result.indicators.emaSlow),
      },
      legendEmas: [
        { name: 'EMA Fast', color: EMA_COLORS[0] },
        { name: 'EMA Slow', color: EMA_COLORS[1] },
      ],
    };
  }, [result, overlays.indicators]);

  const markerProjection = useMemo(
    () =>
      result
        ? mapLabEventMarkers(result.events, result.candles, {
            selectedTradeId: selectedTrade?.id ?? null,
            overlays: {
              signals: overlays.signals,
              entries: overlays.entries,
              stopTarget: overlays.stopTarget,
              exits: overlays.exits,
            },
          })
        : { markers: [], skipped: 0 },
    [result, selectedTrade, overlays]
  );

  // Order Block and FVG zones are derived solely from the immutable replay
  // result and per-indicator visibility. Their projection never reruns the
  // strategy. FVG rectangles are appended after Order Blocks so the stronger
  // OB styling stays on top of the subtler FVG fill.
  const priceZones = useMemo(
    () => (result ? [...mapFvgZones(result), ...mapOrderBlockZones(result)] : []),
    [result]
  );
  const marketStructureProjection = useMemo(
    () => (result ? mapMarketStructureProjection(result) : { markers: [], priceSegments: [] }),
    [result]
  );

  const chartMarkers = useMemo(() => {
    if (!result) return [];
    return [...markerProjection.markers, ...mapFractalMarkers(result), ...marketStructureProjection.markers]
      .map((marker, index) => ({ marker, index }))
      .sort((a, b) => a.marker.time - b.marker.time || a.index - b.index)
      .map(({ marker }) => marker);
  }, [result, markerProjection.markers, marketStructureProjection.markers]);

  // Детальные уровни — только для выбранной сделки (§6), с учётом оверлеев.
  const levelLines = useMemo(
    () =>
      mapTradeLevels(selectedTrade, {
        include: {
          entry: overlays.entries,
          stop: overlays.stopTarget,
          target: overlays.stopTarget,
        },
      }),
    [selectedTrade, overlays.entries, overlays.stopTarget]
  );

  const handleMarkerClick = (_marker: ChartMarker, atTime: ChartMarker[]) => {
    const withTrade = atTime.find((m) => m.payload?.tradeId);
    const tradeId = (withTrade?.payload?.tradeId as string | undefined) ?? null;
    onSelectTrade(tradeId);
  };

  const chartTf = result ? TF_TO_CHART[result.meta.timeframe as LabTimeframe] : undefined;
  const effectiveHeight = height ?? 420;
  const source = dataSourceLabel(result?.meta.dataSource);

  if (!result) {
    return (
      <div
        data-lab-tutorial="chart"
        className="flex min-h-[320px] sm:min-h-[380px] xl:min-h-[440px] items-center justify-center rounded-lg border border-white/[0.08] bg-surface-inset/40 p-4 text-center text-sm text-slate-400"
      >
        <span>Запустите бэктест, чтобы построить график и отобразить сигналы.</span>
      </div>
    );
  }

  if (data.length === 0) {
    // Успешный бэктест без закрытых свечей: это не ошибка API и не «нулевой
    // результат» — честное сообщение о данных (§14).
    return (
      <div
        data-lab-tutorial="chart"
        data-qa="lab-chart-empty-candles"
        className="flex min-h-[320px] sm:min-h-[380px] items-center justify-center rounded-lg border border-white/[0.08] bg-surface-inset/40 p-4 text-center text-sm text-slate-400"
      >
        <span>В выбранном диапазоне нет закрытых свечей — график недоступен.</span>
      </div>
    );
  }

  const toggle = (key: keyof LabMarkerOverlays | 'indicators') =>
    setOverlays((prev) => ({ ...prev, [key]: !prev[key] }));

  return (
    <div
      data-lab-tutorial="chart"
      className="rounded-lg border border-white/[0.08] bg-surface-inset/40 p-2 sm:p-3"
    >
      {/* ── Overlay-переключатели + источник данных (§10/§15) ── */}
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 px-1">
        <span className="text-[11px] font-semibold tracking-wide text-slate-500">
          Показать
        </span>
        <div className="flex flex-wrap items-center gap-1.5" data-qa="lab-overlay-controls">
          {OVERLAY_CHIPS.map(({ key, label }) => {
            const active = overlays[key];
            return (
              <button
                key={key}
                type="button"
                aria-pressed={active}
                data-qa={`lab-overlay-${key}`}
                onClick={() => toggle(key)}
                className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  active
                    ? 'border-cyan-400/40 bg-cyan-400/10 text-cyan-200'
                    : 'border-white/10 bg-white/[0.03] text-slate-500'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => setManualResets((n) => n + 1)}
          data-qa="lab-chart-reset-view"
          className="ml-auto flex items-center gap-1 rounded border border-white/10 bg-white/[0.04] px-2 py-1 text-[11px] text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
          title="Показать последние свечи"
        >
          <RotateCcw className="h-3 w-3" />
          Последние свечи
        </button>
      </div>

      {/* Легенда видимых EMA (≤3 слота общего графика) */}
      {legendEmas.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[11px] text-slate-300">
          {legendEmas.map((item) => (
            <span key={item.name} className="flex items-center gap-1 font-medium">
              <span className="inline-block h-2 w-3 rounded-sm" style={{ background: item.color }} />
              {item.name}
            </span>
          ))}
          {legendEmas.length >= 3 &&
            (result.indicators.indicatorsList?.filter(
              (ind) => ind.type === 'EMA' && ind.visible !== false
            ).length ?? 0) > 3 && (
              <span className="text-[11px] text-slate-500">
                (на графике первые 3 видимые EMA)
              </span>
            )}
        </div>
      )}

      <CandleChart
        data={data}
        symbol={result.meta.symbol}
        height={effectiveHeight}
        timeframe={chartTf as Timeframe | undefined}
        indicators={indicators}
        showMA={overlays.indicators}
        showVolume
        showBadges={false}
        markers={chartMarkers}
        priceZones={priceZones}
        priceSegments={marketStructureProjection.priceSegments}
        levelLines={levelLines}
        onMarkerClick={handleMarkerClick}
        resetViewToken={resetViewToken}
      />

      {/* ── Подписи под графиком: источник данных / пустой результат / лимит ── */}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[11px] text-slate-400">
        {source && (
          <span data-qa="lab-data-source">
            Источник данных: <span className="font-medium text-slate-300">{source}</span>
          </span>
        )}
        {result.metrics.trades === 0 &&
          (result.metrics.totalCandidates === 0 ? (
            <span data-qa="lab-chart-zero-trades" className="text-amber-300">
              За выбранный период стратегия не сформировала условий входа.
            </span>
          ) : (
            <span data-qa="lab-chart-zero-trades" className="text-amber-300">
              Условия входа возникали, но все сигналы отклонены движком — см. вкладку «Отказы».
            </span>
          ))}
        {markerProjection.skipped > 0 && (
          <span data-qa="lab-chart-markers-capped" className="text-slate-500">
            На графике показаны не все события (лимит {LAB_MARKERS_MAX} маркеров) — полные
            результаты во вкладке «Сделки».
          </span>
        )}
        {selectedTrade && (
          <span className="flex items-center gap-1 text-cyan-300">
            <span className="inline-block h-2 w-2 rounded-full bg-cyan-400" />
            Выбрана сделка {selectedTrade.side} ({selectedTrade.outcome})
          </span>
        )}
      </div>

      {/* ── Инспектор выбранной сделки (§7) ── */}
      {selectedTrade && (
        <LabTradeInspector
          result={result}
          trade={selectedTrade}
          definition={definition}
          onClose={() => onSelectTrade(null)}
        />
      )}
    </div>
  );
};

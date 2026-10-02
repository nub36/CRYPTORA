/**
 * CRYPTORA — Strategy Lab · проекция событий на существующий график (frontend)
 * ---------------------------------------------------------------------------
 * Чистые функции: события/сделки Lab → ChartMarker[] / ChartLevelLine[] в
 * типах существующего CandleChart (`@/types/chart`). Библиотеку lightweight-charts
 * НЕ импортируем и НЕ трогаем сам CandleChart — используем только его публичный
 * контракт props. Это отдельный Lab-специфичный аналог signalChartProjection.ts
 * (production-проекция не изменяется).
 *
 * Семантика маркеров (§4–§5 задачи Chart Strategy Visualization):
 *   • CANDIDATE — сигнал LONG/SHORT на баре РЕШЕНИЯ (зелёная стрелка вверх /
 *     красная стрелка вниз) на strategy timestamp;
 *   • FILL — фактический вход: бар и цена ИСПОЛНЕНИЯ (open следующего бара с
 *     проскальзыванием), а не бар сигнала;
 *   • TP1 / STOP — фактические ИСХОДЫ: маркер ставится на бар, где цель/стоп
 *     РЕАЛЬНО наступили, а не на момент входа (уровень известен при входе,
 *     исход — нет);
 *   • EXIT — закрытие без SL/TP (END_OF_DATA) на фактическом баре выхода.
 *     Никаких выдуманных типов выхода: только существующие события движка.
 *   • ENTRY/REJECTION на график не проецируются: ENTRY дублирует FILL на том же
 *     баре, REJECTION не является сделкой (виден во вкладке «Отказы»).
 *
 * No-look-ahead сохраняется: маркер ставится строго на `candleTime` события;
 * `knownAt` движка остаётся единственным источником «когда это стало известно».
 *
 * Маркер ставится только на бар, который РЕАЛЬНО есть в загруженных свечах —
 * иначе библиотека его не отрисует; такие события уходят в `skipped`.
 *
 * Порядок маркеров ОБЯЗАН быть возрастающим по time: lightweight-charts ищет
 * видимое окно бинарным поиском и не сортирует сам. Сделки могут перекрываться,
 * поэтому события движка НЕ хронологичны — сортируем здесь (устойчиво).
 */

import type { ChartLevelLine, ChartMarker, ChartPriceSegment, ChartPriceZone } from '@/types/chart';
import type { LabCandle, LabEvent, LabFairValueGap, LabMarketStructureEvent, LabOrderBlock, LabTrade } from './types';

/**
 * Presentation-лимит числа маркеров (§13): плотный поток не должен топить
 * рендер. РАСЧЁТЫ стратегии не урезаются — лимит касается только отрисовки;
 * полные результаты всегда доступны во вкладках «Обзор»/«Сделки».
 */
export const LAB_MARKERS_MAX = 300;

const COLORS = {
  long: 'rgba(16, 185, 129, 0.95)',
  short: 'rgba(244, 63, 94, 0.95)',
  entry: '#22d3ee',
  stop: '#f43f5e',
  target: '#10b981',
  exit: 'rgba(148, 163, 184, 0.9)',
} as const;

export interface LabMarkerProjection {
  markers: ChartMarker[];
  /** Сколько событий не попали на график (нет бара / presentation-лимит). */
  skipped: number;
}

/**
 * Группы маркеров для overlay-переключателей (§10). ТОЛЬКО презентация:
 * выключенная группа не меняет ни расчёты, ни метрики, ни таблицу сделок.
 */
export interface LabMarkerOverlays {
  /** CANDIDATE — сигналы LONG/SHORT на баре решения. */
  signals: boolean;
  /** FILL — фактические входы. */
  entries: boolean;
  /** STOP/TP1 — фактические исходы SL/TP. */
  stopTarget: boolean;
  /** EXIT — закрытия без SL/TP (END_OF_DATA). */
  exits: boolean;
}

export const DEFAULT_LAB_MARKER_OVERLAYS: Readonly<LabMarkerOverlays> = Object.freeze({
  signals: true,
  entries: true,
  stopTarget: true,
  exits: true,
});

/** Устойчивая сортировка маркеров по времени (требование lightweight-charts). */
function sortMarkersByTime(markers: ChartMarker[]): ChartMarker[] {
  return markers
    .map((marker, index) => ({ marker, index }))
    .sort((a, b) => a.marker.time - b.marker.time || a.index - b.index)
    .map((entry) => entry.marker);
}

/**
 * Проекция ключевых событий (CANDIDATE / FILL / STOP / TP1 / EXIT) в маркеры.
 *
 * Маркеры ВЫБРАННОЙ сделки всегда сохраняются при presentation-лимите —
 * выбор сделки обязан показывать её события даже в плотном потоке (§6/§13).
 */
export function mapLabEventMarkers(
  events: LabEvent[],
  candles: LabCandle[],
  opts: { selectedTradeId?: string | null; overlays?: Partial<LabMarkerOverlays> } = {}
): LabMarkerProjection {
  const overlays: LabMarkerOverlays = { ...DEFAULT_LAB_MARKER_OVERLAYS, ...(opts.overlays ?? {}) };
  const selectedTradeId = opts.selectedTradeId ?? null;
  const candleTimes = new Set<number>(candles.map((c) => c.time));

  // Сделки, у которых есть исходной маркер TP1/STOP: их EXIT не рисуем, чтобы
  // не задваивать закрытие на одном баре. Зависимость от НАЛИЧИЯ события, а не
  // от видимости группы: скрытие SL/TP не должно «раскрывать» EXIT.
  const tradesWithOutcomeEvent = new Set<string>();
  for (const ev of events) {
    if (ev.kind !== 'TP1' && ev.kind !== 'STOP') continue;
    const tradeId = ev.payload?.tradeId;
    if (typeof tradeId === 'string') tradesWithOutcomeEvent.add(tradeId);
  }

  const selected: ChartMarker[] = [];
  const rest: ChartMarker[] = [];
  let skipped = 0;

  for (const ev of events) {
    // Группы, отключённые overlay-переключателем, не считаются «пропавшими».
    if (ev.kind === 'CANDIDATE' && !overlays.signals) continue;
    if (ev.kind === 'FILL' && !overlays.entries) continue;
    if ((ev.kind === 'STOP' || ev.kind === 'TP1') && !overlays.stopTarget) continue;
    if (ev.kind === 'EXIT' && !overlays.exits) continue;

    if (
      ev.kind !== 'CANDIDATE' &&
      ev.kind !== 'FILL' &&
      ev.kind !== 'STOP' &&
      ev.kind !== 'TP1' &&
      ev.kind !== 'EXIT'
    ) {
      continue; // ENTRY (дубль FILL), REJECTION — на график не проецируются
    }

    if (!candleTimes.has(ev.candleTime)) {
      skipped += 1;
      continue;
    }

    const isLong = ev.side === 'LONG';
    const tradeId = (ev.payload?.tradeId as string | undefined) ?? null;
    const isSelected = tradeId !== null && tradeId === selectedTradeId;

    let marker: ChartMarker;
    switch (ev.kind) {
      case 'CANDIDATE':
        marker = {
          id: ev.id,
          time: ev.candleTime,
          position: isLong ? 'belowBar' : 'aboveBar',
          shape: isLong ? 'arrowUp' : 'arrowDown',
          color: isLong ? COLORS.long : COLORS.short,
          text: ev.side ?? '',
          size: 2,
          payload: { kind: ev.kind, side: ev.side, tradeId },
        };
        break;
      case 'FILL':
        marker = {
          id: ev.id,
          time: ev.candleTime,
          position: isLong ? 'belowBar' : 'aboveBar',
          shape: 'circle',
          color: COLORS.entry,
          text: 'Вход',
          size: 1,
          payload: { kind: ev.kind, side: ev.side, tradeId, price: ev.price },
        };
        break;
      case 'TP1':
        marker = {
          id: ev.id,
          time: ev.candleTime,
          position: isLong ? 'aboveBar' : 'belowBar',
          shape: 'circle',
          color: COLORS.target,
          text: 'TP',
          size: 1,
          payload: { kind: ev.kind, side: ev.side, tradeId, price: ev.price },
        };
        break;
      case 'STOP':
        marker = {
          id: ev.id,
          time: ev.candleTime,
          position: isLong ? 'belowBar' : 'aboveBar',
          shape: 'square',
          color: COLORS.stop,
          text: 'SL',
          size: 1,
          payload: { kind: ev.kind, side: ev.side, tradeId, reason: ev.reason, price: ev.price },
        };
        break;
      default: {
        // EXIT без исходного маркера TP1/STOP (END_OF_DATA и любые будущие
        // фактические причины движка — типы выхода не выдумываются).
        if (tradeId !== null && tradesWithOutcomeEvent.has(tradeId)) continue;
        marker = {
          id: ev.id,
          time: ev.candleTime,
          position: isLong ? 'belowBar' : 'aboveBar',
          shape: 'circle',
          color: COLORS.exit,
          text: 'Выход',
          size: 1,
          payload: { kind: ev.kind, side: ev.side, tradeId, reason: ev.reason, price: ev.price },
        };
        break;
      }
    }

    (isSelected ? selected : rest).push(marker);
  }

  // Presentation-лимит: обычные маркеры — до LAB_MARKERS_MAX по хронологии,
  // маркеры выбранной сделки добавляются всегда (их ≤ 5 на сделку).
  let markers: ChartMarker[];
  if (rest.length <= LAB_MARKERS_MAX) {
    markers = [...rest, ...selected];
  } else {
    markers = [...rest.slice(0, LAB_MARKERS_MAX), ...selected];
    skipped += rest.length - LAB_MARKERS_MAX;
  }

  // Подсветка выбранной сделки: её маркеры увеличиваются.
  if (selectedTradeId) {
    for (const m of markers) {
      if ((m.payload?.tradeId as string | undefined) === selectedTradeId) {
        m.size = Math.min(4, (m.size ?? 1) + 1);
      }
    }
  }

  return { markers: sortMarkersByTime(markers), skipped };
}

/** Горизонтальные уровни выбранной сделки: вход / стоп / цель (§6). */
export function mapTradeLevels(
  trade: LabTrade | null,
  opts: { include?: { entry?: boolean; stop?: boolean; target?: boolean } } = {}
): ChartLevelLine[] {
  if (!trade) return [];
  const include = { entry: true, stop: true, target: true, ...(opts.include ?? {}) };
  const lines: ChartLevelLine[] = [];
  if (include.entry) {
    lines.push({
      id: `lvl-entry-${trade.id}`,
      price: trade.entryPrice,
      title: `Вход ${trade.side}`,
      color: COLORS.entry,
      style: 'solid',
      lineWidth: 1,
    });
  }
  if (include.stop) {
    lines.push({
      id: `lvl-stop-${trade.id}`,
      price: trade.stop,
      title: 'Стоп (SL)',
      color: COLORS.stop,
      style: 'dashed',
      lineWidth: 1,
    });
  }
  if (include.target) {
    lines.push({
      id: `lvl-target-${trade.id}`,
      price: trade.target,
      title: 'Цель (TP)',
      color: COLORS.target,
      style: 'dashed',
      lineWidth: 1,
    });
  }
  return lines;
}

export function mapFractalMarkers(result: { candles: LabCandle[]; indicators: { indicatorsList?: Array<{ id: string; type: string; visible?: boolean }>; fractalEvents?: Array<{ indicatorId: string; kind: 'HIGH'|'LOW'; sourceCandleTime: number; sourceIndex: number; confirmationIndex: number; knownAt: number; price: number }>; } }): ChartMarker[] {
  const times = new Set(result.candles.map((c) => c.time));
  return (result.indicators.fractalEvents ?? []).filter((e) => result.indicators.indicatorsList?.some((i) => i.id === e.indicatorId && i.type === 'FRACTALS' && i.visible !== false) && times.has(e.sourceCandleTime)).map((e) => ({ id: `fractal-${e.indicatorId}-${e.kind}-${e.sourceIndex}`, time: e.sourceCandleTime, position: e.kind === 'HIGH' ? 'aboveBar' : 'belowBar', shape: e.kind === 'HIGH' ? 'arrowDown' : 'arrowUp', color: e.kind === 'HIGH' ? '#a78bfa' : '#38bdf8', size: 1, text: e.kind === 'HIGH' ? 'FH' : 'FL', payload: { indicatorId: e.indicatorId, sourceIndex: e.sourceIndex, confirmationIndex: e.confirmationIndex, knownAt: e.knownAt, price: e.price } }));
}

const ORDER_BLOCK_COLORS = {
  BULLISH: { fill: 'rgba(20, 184, 166, 0.14)', border: 'rgba(45, 212, 191, 0.58)' },
  BEARISH: { fill: 'rgba(244, 63, 94, 0.13)', border: 'rgba(251, 113, 133, 0.58)' },
} as const;

/**
 * Lab domain zones → library-agnostic CandleChart rectangles. Visual start is
 * deliberately the source candle; `knownAt` remains in the result model and is
 * never substituted as an x coordinate.
 */
export function mapOrderBlockZones(result: {
  candles: LabCandle[];
  orderBlocks?: LabOrderBlock[];
  indicators: { indicatorsList?: Array<{ id: string; type: string; visible?: boolean }> };
}): ChartPriceZone[] {
  const latestTime = result.candles.at(-1)?.time;
  if (latestTime === undefined) return [];
  const knownTimes = new Set(result.candles.map((candle) => candle.time));

  return (result.orderBlocks ?? [])
    .filter((block) =>
      result.indicators.indicatorsList?.some(
        (indicator) => indicator.id === block.indicatorId && indicator.type === 'ORDER_BLOCK' && indicator.visible !== false
      )
    )
    .flatMap((block) => {
      const toTime = block.state === 'INVALIDATED'
        ? block.invalidationCandleTime
        : latestTime;
      if (!knownTimes.has(block.sourceCandleTime) || toTime === undefined || !knownTimes.has(toTime)) return [];
      const palette = ORDER_BLOCK_COLORS[block.direction];
      const mitigated = block.state === 'MITIGATED';
      const invalidated = block.state === 'INVALIDATED';
      return [{
        id: block.id,
        fromTime: block.sourceCandleTime,
        toTime,
        low: block.low,
        high: block.high,
        fillColor: mitigated || invalidated ? palette.fill.replace(/0\.1[34]\)/, invalidated ? '0.055)' : '0.085)') : palette.fill,
        borderColor: invalidated ? palette.border.replace(/0\.58\)/, '0.38)') : palette.border,
        state: block.state,
      } satisfies ChartPriceZone];
    })
    .sort((a, b) => a.fromTime - b.fromTime || a.id.localeCompare(b.id));
}


/** Deliberately subtler than Order Blocks: FVG zones are context, not levels. */
const FVG_COLORS = {
  BULLISH: { fill: 'rgba(20, 184, 166, 0.09)', border: 'rgba(45, 212, 191, 0.38)' },
  BEARISH: { fill: 'rgba(244, 63, 94, 0.08)', border: 'rgba(251, 113, 133, 0.38)' },
} as const;

/**
 * Fair Value Gap zones → generic CandleChart rectangles. The zone visually
 * starts at candle A (`firstCandleTime`); ACTIVE/PARTIALLY_FILLED zones extend
 * to the latest replay candle, FILLED zones stop at `fillCandleTime`.
 * Projection is gated purely by indicator `visible`; it never reruns the
 * strategy, and `knownAt` is never substituted as an x coordinate.
 */
export function mapFvgZones(result: {
  candles: LabCandle[];
  fairValueGaps?: LabFairValueGap[];
  indicators: { indicatorsList?: Array<{ id: string; type: string; visible?: boolean }> };
}): ChartPriceZone[] {
  const latestTime = result.candles.at(-1)?.time;
  if (latestTime === undefined) return [];
  const knownTimes = new Set(result.candles.map((candle) => candle.time));

  return (result.fairValueGaps ?? [])
    .filter((zone) =>
      result.indicators.indicatorsList?.some(
        (indicator) => indicator.id === zone.indicatorId && indicator.type === 'FVG' && indicator.visible !== false
      )
    )
    .flatMap((zone) => {
      const toTime = zone.state === 'FILLED' ? zone.fillCandleTime : latestTime;
      if (!knownTimes.has(zone.firstCandleTime) || toTime === undefined || !knownTimes.has(toTime)) return [];
      const palette = FVG_COLORS[zone.direction];
      const filled = zone.state === 'FILLED';
      return [{
        id: zone.id,
        fromTime: zone.firstCandleTime,
        toTime,
        low: zone.low,
        high: zone.high,
        fillColor: filled ? palette.fill.replace(/0\.0[89]\)/, '0.04)') : palette.fill,
        borderColor: filled ? palette.border.replace(/0\.38\)/, '0.22)') : palette.border,
        state: zone.state,
      } satisfies ChartPriceZone];
    })
    .sort((a, b) => a.fromTime - b.fromTime || a.id.localeCompare(b.id));
}

const MARKET_STRUCTURE_COLORS = {
  swingHigh: 'rgba(148, 163, 184, 0.82)',
  swingLow: 'rgba(148, 163, 184, 0.82)',
  bullish: 'rgba(45, 212, 191, 0.82)',
  bearish: 'rgba(251, 113, 133, 0.82)',
} as const;

export interface MarketStructureProjection {
  markers: ChartMarker[];
  priceSegments: ChartPriceSegment[];
}

/**
 * Pure Market Structure V1 chart projection. It intentionally reads the
 * immutable replay output only and gates rendering by `visible`; no structure
 * state, events, trades, or metrics are recalculated here.
 */
export function mapMarketStructureProjection(result: {
  candles: LabCandle[];
  marketStructureEvents?: LabMarketStructureEvent[];
  indicators: { indicatorsList?: Array<{ id: string; type: string; visible?: boolean }> };
}): MarketStructureProjection {
  const visibleIds = new Set(
    (result.indicators.indicatorsList ?? [])
      .filter((indicator) => indicator.type === 'MARKET_STRUCTURE' && indicator.visible !== false)
      .map((indicator) => indicator.id)
  );
  const candleTimes = new Set(result.candles.map((candle) => candle.time));
  const markers: ChartMarker[] = [];
  const priceSegments: ChartPriceSegment[] = [];

  for (const event of result.marketStructureEvents ?? []) {
    if (!visibleIds.has(event.indicatorId)) continue;
    if (!('breakIndex' in event)) {
      if (!candleTimes.has(event.sourceCandleTime)) continue;
      const high = event.kind === 'SWING_HIGH';
      markers.push({
        id: `marker-${event.id}`,
        time: event.sourceCandleTime,
        position: high ? 'aboveBar' : 'belowBar',
        shape: high ? 'arrowDown' : 'arrowUp',
        color: high ? MARKET_STRUCTURE_COLORS.swingHigh : MARKET_STRUCTURE_COLORS.swingLow,
        text: high ? 'SH' : 'SL',
        size: 1,
        payload: {
          kind: event.kind,
          indicatorId: event.indicatorId,
          sourceIndex: event.sourceIndex,
          confirmationIndex: event.confirmationIndex,
          knownAt: event.knownAt,
          price: event.price,
        },
      });
      continue;
    }

    if (!candleTimes.has(event.brokenSwingSourceCandleTime) || !candleTimes.has(event.breakCandleTime)) continue;
    const bullish = event.kind === 'BULLISH_BOS' || event.kind === 'BULLISH_CHOCH';
    const choch = event.kind === 'BULLISH_CHOCH' || event.kind === 'BEARISH_CHOCH';
    const color = bullish ? MARKET_STRUCTURE_COLORS.bullish : MARKET_STRUCTURE_COLORS.bearish;
    priceSegments.push({
      id: `segment-${event.id}`,
      fromTime: event.brokenSwingSourceCandleTime,
      toTime: event.breakCandleTime,
      price: event.level,
      color,
      style: choch ? 'dashed' : 'solid',
      lineWidth: 1,
    });
    markers.push({
      id: `marker-${event.id}`,
      time: event.breakCandleTime,
      position: bullish ? 'belowBar' : 'aboveBar',
      shape: bullish ? 'arrowUp' : 'arrowDown',
      color,
      text: choch ? 'CHoCH' : 'BOS',
      size: 1,
      payload: {
        kind: event.kind,
        indicatorId: event.indicatorId,
        knownAt: event.knownAt,
        level: event.level,
        brokenSwingId: event.brokenSwingId,
      },
    });
  }

  return {
    markers: sortMarkersByTime(markers),
    priceSegments: priceSegments.sort((a, b) => a.fromTime - b.fromTime || a.id.localeCompare(b.id)),
  };
}

/**
 * CRYPTORA — Strategy Lab · проекция событий на существующий график (frontend)
 * ---------------------------------------------------------------------------
 * Чистые функции: события/сделки Lab → ChartMarker[] / ChartLevelLine[] в
 * типах существующего CandleChart (`@/types/chart`). Библиотеку lightweight-charts
 * НЕ импортируем и НЕ трогаем сам CandleChart — используем только его публичный
 * контракт props. Это точный аналог прецедента signalChartProjection.ts, но
 * отдельный, Lab-специфичный (production-проекция не изменяется).
 *
 * Маркер ставится только на бар, который РЕАЛЬНО есть в загруженных свечах —
 * иначе библиотека его не отрисует; такие события уходят в `skipped`.
 */

import type { ChartLevelLine, ChartMarker } from '@/types/chart';
import type { LabCandle, LabEvent, LabTrade } from './types';

/** Ограничение числа маркеров, чтобы плотный поток не топил рендер. */
export const LAB_MARKERS_MAX = 300;

const COLORS = {
  long: 'rgba(16, 185, 129, 0.95)',
  short: 'rgba(244, 63, 94, 0.95)',
  entry: '#22d3ee',
  stop: '#f43f5e',
  target: '#10b981',
  neutral: 'rgba(148, 163, 184, 0.9)',
} as const;

export interface LabMarkerProjection {
  markers: ChartMarker[];
  skipped: number;
}

/**
 * Проекция ключевых событий (ENTRY / STOP / TP1 / EXIT) в маркеры. CANDIDATE и
 * FILL опускаем на графике, чтобы не задваивать метки на том же баре — они видны
 * в инспекторе/таблицах.
 */
export function mapLabEventMarkers(
  events: LabEvent[],
  candles: LabCandle[],
  opts: { selectedTradeId?: string | null } = {}
): LabMarkerProjection {
  const candleTimes = new Set<number>(candles.map((c) => c.time));
  const markers: ChartMarker[] = [];
  let skipped = 0;

  for (const ev of events) {
    if (ev.kind !== 'ENTRY' && ev.kind !== 'STOP' && ev.kind !== 'TP1') continue;
    if (!candleTimes.has(ev.candleTime)) {
      skipped += 1;
      continue;
    }
    if (markers.length >= LAB_MARKERS_MAX) {
      skipped += 1;
      continue;
    }

    const isLong = ev.side === 'LONG';
    const tradeId = (ev.payload?.tradeId as string | undefined) ?? null;
    let marker: ChartMarker;
    if (ev.kind === 'ENTRY') {
      marker = {
        id: ev.id,
        time: ev.candleTime,
        position: isLong ? 'belowBar' : 'aboveBar',
        shape: isLong ? 'arrowUp' : 'arrowDown',
        color: isLong ? COLORS.long : COLORS.short,
        text: `${ev.side ?? ''}`,
        size: 2,
        payload: { kind: ev.kind, side: ev.side, tradeId },
      };
    } else if (ev.kind === 'STOP') {
      marker = {
        id: ev.id,
        time: ev.candleTime,
        position: 'aboveBar',
        shape: 'square',
        color: COLORS.stop,
        text: 'SL',
        size: 1,
        payload: { kind: ev.kind, reason: ev.reason, tradeId },
      };
    } else {
      marker = {
        id: ev.id,
        time: ev.candleTime,
        position: 'belowBar',
        shape: 'circle',
        color: COLORS.target,
        text: 'TP1',
        size: 1,
        payload: { kind: ev.kind, tradeId },
      };
    }
    markers.push(marker);
  }

  // Подсветка выбранной сделки: увеличиваем маркеры, относящиеся к ней.
  if (opts.selectedTradeId) {
    for (const m of markers) {
      if ((m.payload?.tradeId as string | undefined) === opts.selectedTradeId) {
        m.size = Math.min(4, (m.size ?? 1) + 1);
      }
    }
  }

  return { markers, skipped };
}

/** Горизонтальные уровни выбранной сделки: вход / стоп / цель. */
export function mapTradeLevels(trade: LabTrade | null): ChartLevelLine[] {
  if (!trade) return [];
  return [
    {
      id: `lvl-entry-${trade.id}`,
      price: trade.entryPrice,
      title: `Вход ${trade.side}`,
      color: COLORS.entry,
      style: 'solid',
      lineWidth: 1,
    },
    {
      id: `lvl-stop-${trade.id}`,
      price: trade.stop,
      title: 'Стоп',
      color: COLORS.stop,
      style: 'dashed',
      lineWidth: 1,
    },
    {
      id: `lvl-target-${trade.id}`,
      price: trade.target,
      title: 'Цель (TP)',
      color: COLORS.target,
      style: 'dashed',
      lineWidth: 1,
    },
  ];
}

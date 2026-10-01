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

import type { ChartLevelLine, ChartMarker } from '@/types/chart';
import type { LabCandle, LabEvent, LabTrade } from './types';

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

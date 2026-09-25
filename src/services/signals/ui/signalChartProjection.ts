/**
 * signalChartProjection — проекция СОХРАНЁННЫХ серверных сигналов на график.
 *
 * Чистые функции (без React и без lightweight-charts): маркеры истории и линии
 * уровней выбранного сигнала. Здесь нет ни одной цены, которой не было бы в
 * DTO: маркер встаёт на `signalCandleTs` (openTime закрытого бара сетапа), а
 * линии — на `entryMin/entryMax/stopLoss/targets[]` (и после исполнения —
 * `fillPrice/fillStop/fillTargets[]`).
 *
 * Модель поведения (та же, что у `mapLiquidationMarkers` — прецедент проекта):
 *   • маркер прикрепляется только к бару, который РЕАЛЬНО есть в загруженных
 *     свечах: сигнал вне окна графика честно уходит в `skipped`, а не рисуется
 *     «примерно» на краю;
 *   • история → маркеры, уровни → только ВЫБРАННЫЙ сигнал (иначе десятки
 *     наборов линий на мобильном экране нечитаемы, §8 задачи);
 *   • сторона читается БЕЗ цвета: форма (arrowUp/arrowDown), позиция
 *     (belowBar/aboveBar) и текст «LONG · V3.0» / «SHORT · V2.8».
 */

import type { ChartLevelLine, ChartMarker } from '@/types/chart';
import type { SignalLevelRow, SignalUiModel } from './signalUiModel';
import { formatSignalPrice } from '@/utils/serverSignalText';

/** Ограничение числа маркеров: плотный поток не должен топить рендер графика. */
export const SIGNAL_MARKERS_MAX = 100;

/**
 * Ограничение числа линий уровней. Лестница целей рисуется ЦЕЛИКОМ (0, 1, 3,
 * 5 целей — фактический массив), граница нужна только как страховка от
 * патологических данных: больше двух десятков линий на экране всё равно
 * нечитаемы, а `skippedLevels` делает усечение видимым, а не тихим.
 */
export const LEVEL_LINES_MAX = 24;

export const SIGNAL_MARKER_COLORS = {
  LONG_OPEN: 'rgba(16, 185, 129, 0.95)',
  LONG_CLOSED: 'rgba(16, 185, 129, 0.5)',
  SHORT_OPEN: 'rgba(244, 63, 94, 0.95)',
  SHORT_CLOSED: 'rgba(244, 63, 94, 0.5)',
} as const;

/** Семантика цветов линий стабильна между экранами (§8). */
export const LEVEL_LINE_COLORS = {
  entry: '#22d3ee',
  stop: '#f43f5e',
  target: '#10b981',
} as const;

/** Длительность бара для таймфреймов проекта (тип `Timeframe` + серверные значения). */
export const TIMEFRAME_SECONDS: Readonly<Record<string, number>> = Object.freeze({
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '30m': 1800,
  '1h': 3600,
  '2h': 7200,
  '4h': 14400,
  '6h': 21600,
  '8h': 28800,
  '12h': 43200,
  '1D': 86400,
  '1d': 86400,
  '1W': 604800,
  '1w': 604800,
  '1M': 2592000,
});

/**
 * Длительность бара в секундах; 0 для неизвестного таймфрейма — тогда маркеры
 * честно не рисуются ( snapping «на глаз» по неизвестной сетке запрещён).
 */
export function timeframeToSeconds(timeframe: string | null | undefined): number {
  if (!timeframe) return 0;
  return TIMEFRAME_SECONDS[timeframe] ?? 0;
}

export interface CandleTime {
  /** Unix-время бара: секунды или миллисекунды (нормализуется здесь). */
  time: number;
}

export interface SignalMarkersResult {
  markers: ChartMarker[];
  /** Сигналов этого инструмента, включая те, что вне окна графика. */
  matched: number;
  /** Не отрисовано: бар вне загруженного окна / невалидное время. */
  skipped: number;
}

export interface MapSignalMarkersOptions {
  /** Выбранный сигнал: выделяется крупнее. */
  selectedId?: string | null;
  /** Показывать текстовые подписи у маркеров на графике. По умолчанию false (компактные маркеры). */
  showLabels?: boolean;
}

/** Время сигнала в unix-секундах; null — если сервер отдал невалидное значение. */
export function signalTimeSeconds(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return null;
  return Math.floor(parsed / 1000);
}

/** Нормализация времени бара к секундам (защита от миллисекунд на границе). */
function candleTimeSeconds(time: number): number | null {
  const value = Number(time);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.floor(value > 100_000_000_000 ? value / 1000 : value);
}

/**
 * Маркеры истории сигналов поверх свечей.
 *
 * @param models               сигналы выбранного инструмента (порядок сервера)
 * @param candles              загруженные свечи ВЫБРАННОГО таймфрейма
 * @param timeframeSec         длительность бара графика в секундах
 * @param optionsOrSelectedId  опции или selectedId (для обратной совместимости)
 */
export function mapSignalMarkers(
  models: readonly SignalUiModel[],
  candles: readonly CandleTime[],
  timeframeSec: number,
  optionsOrSelectedId?: MapSignalMarkersOptions | string | null
): SignalMarkersResult {
  const isLegacyCall =
    typeof optionsOrSelectedId === 'string' ||
    optionsOrSelectedId === null ||
    optionsOrSelectedId === undefined;

  const selectedId = isLegacyCall ? optionsOrSelectedId ?? null : optionsOrSelectedId.selectedId ?? null;
  const showLabels = isLegacyCall ? true : optionsOrSelectedId.showLabels ?? false;

  const candleTimes = new Set<number>();
  for (const candle of candles) {
    const seconds = candleTimeSeconds(candle.time);
    if (seconds !== null) candleTimes.add(seconds);
  }

  const markers: ChartMarker[] = [];
  let matched = 0;
  let skipped = 0;
  if (candleTimes.size === 0 || !(timeframeSec > 0)) {
    return { markers, matched: models.length, skipped: models.length };
  }

  for (const model of models) {
    matched++;
    const seconds = signalTimeSeconds(model.signalCandleTs);
    if (seconds === null) {
      skipped++;
      continue;
    }
    const snapped = seconds - (seconds % timeframeSec);
    if (!candleTimes.has(snapped)) {
      // Бар сигнала вне загруженного окна графика: маркер не рисуется,
      // но сигнал остаётся в истории (лента и график — разные области).
      skipped++;
      continue;
    }
    const isLong = model.direction === 'LONG';
    const selected = Boolean(selectedId) && model.id === selectedId;

    // Компактные маркеры без гигантского текста поверх свечей.
    // Сторона читается формой и положением: LONG = arrowUp под баром,
    // SHORT = arrowDown над баром. Открытые (ACTIVE/FILLED) ярче и крупнее,
    // закрытая история — аккуратная и менее заметная.
    const size = selected ? (model.isOpen ? 3 : 2) : model.isOpen ? 2 : 1;
    const text = showLabels
      ? `${model.directionText} · ${model.strategyShort}${selected ? ' •' : ''}`
      : undefined;

    markers.push({
      id: model.id,
      time: snapped,
      position: isLong ? 'belowBar' : 'aboveBar',
      shape: isLong ? 'arrowUp' : 'arrowDown',
      color: isLong
        ? model.isOpen
          ? SIGNAL_MARKER_COLORS.LONG_OPEN
          : SIGNAL_MARKER_COLORS.LONG_CLOSED
        : model.isOpen
          ? SIGNAL_MARKER_COLORS.SHORT_OPEN
          : SIGNAL_MARKER_COLORS.SHORT_CLOSED,
      ...(text !== undefined ? { text } : {}),
      size,
      payload: {
        signalId: model.id,
        pair: model.pair,
        direction: model.direction,
        strategyId: model.strategyId,
        strategyShort: model.strategyShort,
        status: model.status,
        statusLabel: model.statusLabel,
        timeframe: model.timeframe,
        selected,
        isOpen: model.isOpen,
        signalCandleTs: model.signalCandleTs,
        model,
      },
    });
  }

  markers.sort((a, b) => a.time - b.time);
  const trimmed = markers.length > SIGNAL_MARKERS_MAX ? markers.slice(-SIGNAL_MARKERS_MAX) : markers;
  return { markers: trimmed, matched, skipped: skipped + (markers.length - trimmed.length) };
}

/**
 * Маркер на кликнутом баре.
 *
 * `lightweight-charts` отдаёт клику только время бара, поэтому выбор делается
 * здесь: если на баре несколько сигналов, приоритет у выбранного, затем у
 * открытого, затем у самого позднего (лента сервера уже отсортирована, так что
 * «поздний» — это первый встреченный в порядке убывания).
 */
export function pickMarkerAtTime(
  markers: readonly ChartMarker[],
  timeSeconds: number | null,
  models: readonly SignalUiModel[]
): ChartMarker | null {
  if (timeSeconds === null) return null;
  const atBar = markers.filter((m) => m.time === timeSeconds);
  if (atBar.length === 0) return null;
  if (atBar.length === 1) return atBar[0]!;

  const selected = atBar.find((m) => m.payload?.['selected'] === true);
  if (selected) return selected;

  const byId = new Map(models.map((m) => [m.id, m]));
  const open = atBar.find((m) => byId.get(String(m.payload?.['signalId'] ?? ''))?.isOpen === true);
  if (open) return open;

  // Порядок сервера: модели идут от новых к старым, маркеры — от старых к новым.
  const order = new Map(models.map((m, index) => [m.id, index]));
  return [...atBar].sort(
    (a, b) =>
      (order.get(String(a.payload?.['signalId'] ?? '')) ?? Number.MAX_SAFE_INTEGER) -
      (order.get(String(b.payload?.['signalId'] ?? '')) ?? Number.MAX_SAFE_INTEGER)
  )[0] ?? null;
}

export interface BuildLevelLinesOptions {
  showEffective?: boolean;
  /** Показывать текстовые подписи у линий на графике. Default: true. */
  showLabels?: boolean;
  /** Использовать компактные названия (Вход ↓, Стоп, TP1) вместо длинных предложений. Default: false. */
  compact?: boolean;
}

/**
 * Компактная подпись уровня для графика (не занимать половину экрана).
 * Полные названия остаются в карточке / попапе выбранного сигнала.
 */
export function compactLevelLabel(row: SignalLevelRow): string {
  if (row.effective) {
    if (row.kind === 'entry') return 'Факт';
    if (row.kind === 'stop') return 'SL эфф';
    if (row.kind === 'target') return `TP${(row.targetIndex ?? 0) + 1} эфф`;
  }
  if (row.kind === 'entry') {
    if (row.id === 'entry-low') return 'Вход ↓';
    if (row.id === 'entry-high') return 'Вход ↑';
    return 'Вход';
  }
  if (row.kind === 'stop') {
    return 'Стоп';
  }
  if (row.kind === 'target') {
    return `TP${(row.targetIndex ?? 0) + 1}`;
  }
  return row.label;
}

function lineTitle(row: SignalLevelRow, compact = false, showLabels = true): string {
  if (!showLabels) return '';
  const label = compact ? compactLevelLabel(row) : row.label;
  const comparator = row.comparator ? `${row.comparator} ` : '';
  return `${label} ${comparator}${formatSignalPrice(row.price)}`;
}

function levelStyle(row: SignalLevelRow): ChartLevelLine['style'] {
  if (row.effective) return 'largeDashed';
  if (row.kind === 'stop') return 'dashed';
  if (row.kind === 'target') return 'dotted';
  return 'solid';
}

function rowToLine(row: SignalLevelRow, compact = false, showLabels = true): ChartLevelLine {
  return {
    id: row.effective ? `eff-${row.id}` : row.id,
    price: row.price,
    title: lineTitle(row, compact, showLabels),
    color: LEVEL_LINE_COLORS[row.kind],
    style: levelStyle(row),
    lineWidth: row.kind === 'stop' ? 2 : 1,
    axisLabelVisible: showLabels,
  };
}

/**
 * Линии уровней ВЫБРАННОГО сигнала.
 *
 * `showEffective` включает второй набор (факт входа / эффективные стоп и цели
 * после исполнения) — он существует только если сервер его отдал. Публикационные
 * уровни при этом остаются на графике: подменять один набор другим нельзя.
 */
export function buildSignalLevelLines(
  model: SignalUiModel | null,
  opts: BuildLevelLinesOptions = {}
): { lines: ChartLevelLine[]; skippedLevels: number } {
  if (!model) return { lines: [], skippedLevels: 0 };
  const showEffective = opts.showEffective ?? false;
  const showLabels = opts.showLabels ?? true;
  const compact = opts.compact ?? false;

  const rows = showEffective ? [...model.levels, ...model.effectiveLevels] : model.levels;
  const lines = rows.map((r) => rowToLine(r, compact, showLabels));
  if (lines.length <= LEVEL_LINES_MAX) return { lines, skippedLevels: 0 };
  return { lines: lines.slice(0, LEVEL_LINES_MAX), skippedLevels: lines.length - LEVEL_LINES_MAX };
}

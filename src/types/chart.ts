/**
 * Общие типы оверлеев графика (маркеры событий и горизонтальные уровни).
 *
 * Вынесены из компонента, чтобы сервисы (например, проекция сигналов на график)
 * не импортировали React-компонент и не знали про lightweight-charts: mapping
 * в типы библиотеки живёт внутри `CandleChart`, а доменные данные остаются
 * библиотечно-независимыми и тестируемыми.
 *
 * Все типы аддитивны: существующие потребители `CandleChart` (/coin, /overview)
 * их не передают и ведут себя ровно как раньше.
 */

/** Позиция маркера относительно бара (термины lightweight-charts). */
export type ChartMarkerPosition = 'aboveBar' | 'belowBar' | 'inBar';

/** Форма маркера: сторона события должна читаться БЕЗ цвета (§21 доступность). */
export type ChartMarkerShape = 'arrowUp' | 'arrowDown' | 'circle' | 'square';

export interface ChartMarker {
  /** Стабильный идентификатор (для выделения и клика). */
  id: string;
  /** Unix-секунды openTime бара, к которому маркер прикреплён. */
  time: number;
  position: ChartMarkerPosition;
  shape: ChartMarkerShape;
  color: string;
  /** Короткая подпись на графике: «LONG · V3.0». */
  text?: string;
  /** 1..3 — размер маркера библиотеки. */
  size?: number;
  /**
   * Произвольные доменные данные (id сигнала, статус, стратегия). В библиотеку
   * не передаются; возвращаются обработчику клика.
   */
  payload?: Record<string, unknown>;
}

/** Стиль линии уровня (соответствует LineStyle lightweight-charts). */
export type ChartLevelLineStyle = 'solid' | 'dashed' | 'dotted' | 'largeDashed' | 'sparseDotted';

export interface ChartLevelLine {
  /** Стабильный идентификатор: по нему линии заменяются при смене сигнала. */
  id: string;
  /** Цена уровня — как её сохранил сервер (ничего не досчитывается). */
  price: number;
  /** Подпись у линии: «Цель 2 · 118 400,25». */
  title: string;
  color: string;
  style?: ChartLevelLineStyle;
  lineWidth?: 1 | 2 | 3 | 4;
  /** Показывать ли цену на оси (по умолчанию true). */
  axisLabelVisible?: boolean;
}

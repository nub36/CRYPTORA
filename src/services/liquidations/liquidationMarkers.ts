/**
 * liquidationMarkers — чистая функция наложения фактических событий ликвидаций
 * на ценовой график (страница /liquidations).
 *
 * Событие попадает на график только если:
 *  - его BASE совпадает с выбранным инструментом,
 *  - у него валидные время и цена,
 *  - его время ложится на свечу из загруженного ряда (снап вниз к сетке
 *    таймфрейма; события вне ряда пропускаются и считаются в `skipped`).
 *
 * Маркеры полупрозрачные и мелкие — свечи должны оставаться читаемыми.
 * Никаких оценочных точек не дорисовывается: нет события — нет маркера.
 */

import type { LiquidationEvent } from '@/types/market';

export interface MarkerCandle {
  /** Unix-время открытия свечи в секундах (как OHLCV.time). */
  time: number;
}

export interface LiquidationMarker {
  /** Время свечи (секунды) — точка привязки маркера. */
  time: number;
  side: 'LONG' | 'SHORT';
  /** Полупрозрачный цвет стороны. */
  color: string;
  size: 1 | 2;
  shape: 'circle';
  position: 'aboveBar' | 'belowBar';
  /** id исходного события (для отладки/тултипов). */
  eventId: string;
}

export const LIQUIDATION_MARKER_COLORS = {
  LONG: 'rgba(16, 185, 129, 0.55)',
  SHORT: 'rgba(244, 63, 94, 0.55)',
} as const;

/** Лимит маркеров: сотни событий за сутки не должны убивать рендер. */
export const LIQUIDATION_MARKERS_MAX = 200;

export interface LiquidationMarkersResult {
  markers: LiquidationMarker[];
  /** Событий подошло по инструменту (включая пропущенные вне ряда). */
  matched: number;
  /** Пропущено: вне ряда свечей / битое время / невалидная цена. */
  skipped: number;
}

export function mapLiquidationMarkers(
  events: readonly LiquidationEvent[],
  candles: readonly MarkerCandle[],
  baseSymbol: string,
  timeframeSec: number,
): LiquidationMarkersResult {
  const base = baseSymbol.trim().toUpperCase();
  const candleTimes = new Set<number>();
  for (const c of candles) {
    if (Number.isFinite(c.time)) candleTimes.add(Math.floor(c.time));
  }
  const markers: LiquidationMarker[] = [];
  let matched = 0;
  let skipped = 0;
  if (candleTimes.size === 0 || !(timeframeSec > 0)) {
    return { markers, matched, skipped };
  }
  for (const e of events) {
    if (!e || e.symbol.trim().toUpperCase() !== base) continue;
    matched++;
    const ms = Date.parse(e.timestamp);
    if (!Number.isFinite(ms)) {
      skipped++;
      continue;
    }
    if (!Number.isFinite(e.price)) {
      skipped++;
      continue;
    }
    const sec = Math.floor(ms / 1000);
    const snapped = sec - (sec % timeframeSec);
    if (!candleTimes.has(snapped)) {
      skipped++;
      continue;
    }
    markers.push({
      time: snapped,
      side: e.side,
      color: e.side === 'LONG' ? LIQUIDATION_MARKER_COLORS.LONG : LIQUIDATION_MARKER_COLORS.SHORT,
      size: 1,
      shape: 'circle',
      // Ликвидированный лонг — цена пришла снизу; шорт — вынос наверх.
      position: e.side === 'LONG' ? 'belowBar' : 'aboveBar',
      eventId: e.id,
    });
  }
  // Новейшие — в конец (хронологический порядок для series.setMarkers).
  markers.sort((a, b) => a.time - b.time);
  const trimmed = markers.slice(-LIQUIDATION_MARKERS_MAX);
  return { markers: trimmed, matched, skipped: skipped + (markers.length - trimmed.length) };
}

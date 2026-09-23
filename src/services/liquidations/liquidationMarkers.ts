import type { LiquidationEvent } from '@/types/market';

export interface MarkerCandle {
  /** Unix timestamp in seconds (normalizes milliseconds at the chart boundary). */
  time: number;
}

export interface LiquidationMarker {
  time: number;
  side: 'LONG' | 'SHORT';
  color: string;
  size: 1 | 2 | 3;
  shape: 'circle';
  position: 'aboveBar' | 'belowBar';
  eventId: string;
}

export const LIQUIDATION_MARKER_COLORS = {
  LONG: 'rgba(16, 211, 146, 0.72)',
  SHORT: 'rgba(251, 85, 119, 0.72)',
} as const;

/** Keep dense stream bursts from overwhelming the chart renderer. */
export const LIQUIDATION_MARKERS_MAX = 200;

export interface LiquidationMarkersResult {
  markers: LiquidationMarker[];
  /** Events for the selected instrument, including those outside the loaded range. */
  matched: number;
  skipped: number;
}

function eventTimeSeconds(timestamp: string): number {
  const numeric = Number(timestamp);
  if (Number.isFinite(numeric) && numeric > 0) return Math.floor(numeric > 100_000_000_000 ? numeric / 1000 : numeric);
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : NaN;
}

function canonicalSymbol(value: string): string {
  return value.trim().toUpperCase().replace(/[-_/]?USDT$/, '');
}

export function mapLiquidationMarkers(
  events: readonly LiquidationEvent[],
  candles: readonly MarkerCandle[],
  baseSymbol: string,
  timeframeSec: number,
): LiquidationMarkersResult {
  const base = canonicalSymbol(baseSymbol);
  const candleTimes = new Set<number>();
  for (const candle of candles) {
    const value = Number(candle.time);
    if (!Number.isFinite(value)) continue;
    candleTimes.add(Math.floor(value > 100_000_000_000 ? value / 1000 : value));
  }
  const markers: LiquidationMarker[] = [];
  let matched = 0;
  let skipped = 0;
  if (candleTimes.size === 0 || !(timeframeSec > 0)) return { markers, matched, skipped };

  for (const event of events) {
    if (!event || canonicalSymbol(event.symbol) !== base) continue;
    matched++;
    const seconds = eventTimeSeconds(event.timestamp);
    const price = Number(event.price);
    const amount = Number(event.amountUsd);
    if (!Number.isFinite(seconds) || !Number.isFinite(price) || price <= 0 || !Number.isFinite(amount) || amount <= 0) {
      skipped++;
      continue;
    }
    const snapped = seconds - (seconds % timeframeSec);
    if (!candleTimes.has(snapped)) {
      skipped++;
      continue;
    }
    markers.push({
      time: snapped,
      side: event.side,
      color: event.side === 'LONG' ? LIQUIDATION_MARKER_COLORS.LONG : LIQUIDATION_MARKER_COLORS.SHORT,
      size: amount >= 1_000_000 ? 3 : amount >= 100_000 ? 2 : 1,
      shape: 'circle',
      position: event.side === 'LONG' ? 'belowBar' : 'aboveBar',
      eventId: event.id,
    });
  }
  markers.sort((a, b) => a.time - b.time);
  const trimmed = markers.slice(-LIQUIDATION_MARKERS_MAX);
  return { markers: trimmed, matched, skipped: skipped + (markers.length - trimmed.length) };
}

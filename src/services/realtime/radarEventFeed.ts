import type { RadarEvent } from '@/types/market';

export interface MergeRadarEventsOptions {
  includeDemo?: boolean;
  limit?: number;
}

/**
 * Merge the initial provider snapshot with real-time EventBus arrivals.
 * IDs are de-duplicated, malformed timestamps are excluded, and newest events
 * lead the bounded preview. Live callers must leave includeDemo=false.
 */
export function mergeRadarEvents(
  current: readonly RadarEvent[],
  incoming: readonly RadarEvent[],
  { includeDemo = false, limit = 100 }: MergeRadarEventsOptions = {},
): RadarEvent[] {
  const unique = new Map<string, RadarEvent>();
  for (const event of [...current, ...incoming]) {
    if (!event || !event.id || (!includeDemo && event.isDemo)) continue;
    if (!Number.isFinite(Date.parse(event.timestamp))) continue;
    unique.set(event.id, event);
  }
  return [...unique.values()]
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
    .slice(0, Math.max(0, limit));
}

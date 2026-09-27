import type { RadarEvent } from '../../../src/types/market';

export interface PersistedRadarEvent extends RadarEvent {
  provenance: NonNullable<RadarEvent['provenance']>;
}

export function radarEventDedupeKey(event: RadarEvent, sourceTickTimestamp: number, source?: { exchange: string; market: string }): string;
export function mapRadarEventRow(row: Record<string, any>): PersistedRadarEvent;
export function persistRadarEvent(input: {
  event: RadarEvent;
  sourceTickTimestamp: number;
  source?: { exchange: string; market: string };
}): Promise<{ inserted: boolean; event: PersistedRadarEvent | null; dedupeKey: string }>;
export function listRadarEvents(input?: { limit?: number; symbol?: string | null; before?: string | null }): Promise<PersistedRadarEvent[]>;
export function purgeExpiredRadarEvents(input: { retentionDays: number; batchSize?: number }): Promise<number>;
export const RADAR_HISTORY_MAX_LIMIT: number;

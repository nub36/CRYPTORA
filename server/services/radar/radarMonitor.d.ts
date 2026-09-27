import type { RadarEvent } from '../../../src/types/market';

export type RadarPublicErrorCode =
  | 'STARTUP_ERROR'
  | 'UNIVERSE_UNAVAILABLE'
  | 'UNIVERSE_REFRESH_ERROR'
  | 'MARKET_FEED_ERROR'
  | 'PERSISTENCE_ERROR'
  | 'RETENTION_CLEANUP_ERROR'
  | 'INTERNAL_ERROR';

export interface RadarMonitorStatus {
  source: 'server';
  running: boolean;
  lifecycle: string;
  configuredUniverseCount: number;
  activeUniverseCount: number;
  inactiveUniverseCount: number;
  activeUniverseKnown: boolean;
  detector: Record<string, any>;
  marketFeed: Record<string, any>;
  retentionDays: number | null;
  errorCode: RadarPublicErrorCode | null;
  [key: string]: any;
}

export class RadarMonitor {
  constructor(options?: Record<string, any>);
  start(): Promise<void>;
  stop(): Promise<void>;
  refreshUniverse(): Promise<void>;
  processTicker(tick: any): RadarEvent[];
  drain(): Promise<void>;
  runRetention(): Promise<number>;
  getStatus(): RadarMonitorStatus;
  recordError(error: unknown, code?: RadarPublicErrorCode): void;
}

export const RADAR_PUBLIC_ERROR_CODES: readonly RadarPublicErrorCode[];

export function getRadarMonitor(): RadarMonitor;
export function resetRadarMonitor(): Promise<void>;
export function radarMonitorStatus(): RadarMonitorStatus;

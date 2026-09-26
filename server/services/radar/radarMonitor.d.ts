import type { RadarEvent } from '../../../src/types/market';

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
}

export function getRadarMonitor(): RadarMonitor;
export function resetRadarMonitor(): Promise<void>;
export function radarMonitorStatus(): RadarMonitorStatus;

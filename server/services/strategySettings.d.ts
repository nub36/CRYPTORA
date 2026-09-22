/** Декларации для strategySettings.js — тесты импортируют модуль типизированно. */

export interface StrategySettingRow {
  strategyId: string;
  enabled: boolean;
  scanIntervalSeconds: number;
  symbols: string[] | null;
  lastScanAt: string | null;
  lastSignalAt: string | null;
  lastError: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface StrategyState extends StrategySettingRow {
  version: string;
  name: string;
  nameRu: string;
  timeframes: string[];
  badge: string;
  status: 'OFF' | 'ON' | 'ERROR';
  activeSignalCount: number;
}

export const MIN_SCAN_INTERVAL_SECONDS: number;

export function listStrategyStates(): Promise<StrategyState[]>;
export function deriveStatus(state: Pick<StrategySettingRow, 'enabled' | 'lastError'>): 'OFF' | 'ON' | 'ERROR';
export function getStrategyState(strategyId: string): Promise<StrategyState | null>;
export function getEnabledStrategies(): Promise<StrategySettingRow[]>;
export function setStrategyEnabled(p: {
  strategyId: string;
  enabled: boolean;
  actorUserId: string | null;
}): Promise<StrategySettingRow>;
export function recordScanResult(p: { strategyId: string; error?: string | null }): Promise<void>;
export function recordSignalEmitted(strategyId: string): Promise<void>;
export function engineStatus(): Promise<{
  totalStrategies: number;
  enabledCount: number;
  errorCount: number;
  lastScanAt: string | null;
  lastSignalAt: string | null;
  signalsTotal: number;
  signalsActive: number;
}>;

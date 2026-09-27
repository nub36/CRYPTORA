import type { RadarEvent } from '../../src/types/market';
import type { TickerTick } from '../../src/types/realtime';

export interface FrozenAnomalyOptions {
  windowSize?: number;
  volumeZScoreHighThreshold?: number;
  volumeZScoreMedThreshold?: number;
  priceVelocityHighThreshold?: number;
  priceVelocityMedThreshold?: number;
  volatilityExpansionHighThreshold?: number;
  volatilityExpansionMedThreshold?: number;
  cooldownMs?: number;
}

export interface AnomalySymbolStatus {
  symbol: string;
  volumeObservations: number;
  priceObservations: number;
  rangeObservations: number;
  observationCount: number;
  maxObservationCount: number;
  warmed: boolean;
}

export interface AnomalyCoreStatus {
  windowSize: number;
  trackedSymbols: number;
  warmedSymbols: number;
  maxObservations: number;
  symbols: AnomalySymbolStatus[];
}

export class AnomalyCalculationCore {
  constructor(options?: FrozenAnomalyOptions, runtime?: { now?: () => number });
  processTick(tick: TickerTick): RadarEvent[];
  evaluateVolumeSpike(symbol: string, currentVolume: number, historicalVolumes: number[]): RadarEvent | null;
  evaluatePriceVelocity(symbol: string, currentPrice: number, currentTime: number, historicalPrices: Array<{ price: number; timestamp: number }>): RadarEvent | null;
  evaluateVolatilityExpansion(symbol: string, currentRangePct: number, historicalRanges: number[]): RadarEvent | null;
  getStatus(symbols?: readonly string[]): AnomalyCoreStatus;
  clearSymbols(symbols: readonly string[]): void;
  clear(): void;
}

export const FROZEN_ANOMALY_DEFAULTS: Readonly<Required<FrozenAnomalyOptions>>;

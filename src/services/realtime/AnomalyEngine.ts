import { RadarEvent } from '@/types/market';
import { TickerTick } from '@/types/realtime';
import { EventBus } from './EventBus';
import {
  AnomalyCalculationCore,
  type AnomalyCoreStatus,
  type AnomalySymbolStatus as CoreAnomalySymbolStatus,
  type FrozenAnomalyOptions,
} from '../../../shared/radar/anomalyCalculationCore.js';

/**
 * Browser adapter around the shared frozen calculation core.
 *
 * Production Radar no longer constructs this adapter: the backend imports the
 * same core directly. This class remains for deterministic unit/debug uses and
 * preserves the legacy browser EventBus/buffer API without becoming a second
 * authoritative event source.
 */
export interface AnomalyEngineOptions extends FrozenAnomalyOptions {
  maxBufferedEvents?: number;
}

export type AnomalySymbolStatus = CoreAnomalySymbolStatus;

export interface AnomalyEngineStatus extends AnomalyCoreStatus {
  bufferedEvents: number;
}

export class AnomalyEngine {
  private readonly core: AnomalyCalculationCore;
  private readonly maxBufferedEvents: number;
  private bufferedEvents: RadarEvent[] = [];
  private eventBus?: EventBus;

  constructor(options: AnomalyEngineOptions = {}, eventBus?: EventBus) {
    this.core = new AnomalyCalculationCore(options);
    this.maxBufferedEvents = options.maxBufferedEvents ?? 100;
    this.eventBus = eventBus;
  }

  public processTick(tick: TickerTick): RadarEvent[] {
    const detected = this.core.processTick(tick);
    for (const event of detected) {
      this.addEvent(event);
      this.eventBus?.publishRadarEvent(event);
    }
    return detected;
  }

  /** Legacy public test/debug seams delegate to the one shared calculation source. */
  public evaluateVolumeSpike(symbol: string, currentVolume: number, historicalVolumes: number[]): RadarEvent | null {
    return this.core.evaluateVolumeSpike(symbol, currentVolume, historicalVolumes);
  }

  public evaluatePriceVelocity(
    symbol: string,
    currentPrice: number,
    currentTime: number,
    historicalPrices: { price: number; timestamp: number }[],
  ): RadarEvent | null {
    return this.core.evaluatePriceVelocity(symbol, currentPrice, currentTime, historicalPrices);
  }

  public evaluateVolatilityExpansion(symbol: string, currentRangePct: number, historicalRanges: number[]): RadarEvent | null {
    return this.core.evaluateVolatilityExpansion(symbol, currentRangePct, historicalRanges);
  }

  private addEvent(event: RadarEvent): void {
    this.bufferedEvents.unshift(event);
    if (this.bufferedEvents.length > this.maxBufferedEvents) this.bufferedEvents.pop();
  }

  public getEvents(symbol?: string): RadarEvent[] {
    if (symbol) return this.bufferedEvents.filter((event) => event.symbol.toUpperCase() === symbol.toUpperCase());
    return [...this.bufferedEvents];
  }

  public getStatus(symbols?: readonly string[]): AnomalyEngineStatus {
    return { ...this.core.getStatus(symbols), bufferedEvents: this.bufferedEvents.length };
  }

  public seedInitialEvents(events: RadarEvent[]): void {
    for (const event of events) this.bufferedEvents.push(event);
  }

  /** Clears no calculations beyond the requested removed universe symbols. */
  public clearSymbols(symbols: readonly string[]): void {
    this.core.clearSymbols(symbols);
    const removed = new Set(symbols.map((symbol) => symbol.trim().toUpperCase()));
    this.bufferedEvents = this.bufferedEvents.filter((event) => !removed.has(event.symbol.toUpperCase()));
  }

  public clear(): void {
    this.core.clear();
    this.bufferedEvents = [];
  }
}

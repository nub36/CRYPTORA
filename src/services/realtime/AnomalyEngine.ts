import { RadarEvent, RadarSeverity } from '@/types/market';
import { TickerTick } from '@/types/realtime';
import { EventBus } from './EventBus';

export interface AnomalyEngineOptions {
  windowSize?: number; // default 20
  volumeZScoreHighThreshold?: number; // default 3.0
  volumeZScoreMedThreshold?: number; // default 2.0
  priceVelocityHighThreshold?: number; // default 4.0 (%)
  priceVelocityMedThreshold?: number; // default 2.5 (%)
  volatilityExpansionHighThreshold?: number; // default 2.5x
  volatilityExpansionMedThreshold?: number; // default 1.8x
  cooldownMs?: number; // default 30000 ms (30s)
  maxBufferedEvents?: number; // default 100
}

interface SymbolHistory {
  volumes: number[];
  prices: { price: number; timestamp: number }[];
  ranges: number[];
}

export class AnomalyEngine {
  private windowSize: number;
  private volumeZScoreHigh: number;
  private volumeZScoreMed: number;
  private priceVelocityHigh: number;
  private priceVelocityMed: number;
  private volatilityExpansionHigh: number;
  private volatilityExpansionMed: number;
  private cooldownMs: number;
  private maxBufferedEvents: number;

  private symbolHistories: Map<string, SymbolHistory> = new Map();
  private lastAlertTimestamp: Map<string, number> = new Map(); // key: symbol:anomalyType
  private bufferedEvents: RadarEvent[] = [];
  private eventBus?: EventBus;

  constructor(options: AnomalyEngineOptions = {}, eventBus?: EventBus) {
    this.windowSize = options.windowSize ?? 20;
    this.volumeZScoreHigh = options.volumeZScoreHighThreshold ?? 3.0;
    this.volumeZScoreMed = options.volumeZScoreMedThreshold ?? 2.0;
    this.priceVelocityHigh = options.priceVelocityHighThreshold ?? 4.0;
    this.priceVelocityMed = options.priceVelocityMedThreshold ?? 2.5;
    this.volatilityExpansionHigh = options.volatilityExpansionHighThreshold ?? 2.5;
    this.volatilityExpansionMed = options.volatilityExpansionMedThreshold ?? 1.8;
    this.cooldownMs = options.cooldownMs ?? 30000;
    this.maxBufferedEvents = options.maxBufferedEvents ?? 100;
    this.eventBus = eventBus;
  }

  /**
   * Process a ticker tick through anomaly detection pipelines.
   * Returns newly triggered RadarEvent if any anomaly was detected, or null.
   */
  public processTick(tick: TickerTick): RadarEvent[] {
    const detected: RadarEvent[] = [];
    const symbol = tick.symbol;

    let history = this.symbolHistories.get(symbol);
    if (!history) {
      history = { volumes: [], prices: [], ranges: [] };
      this.symbolHistories.set(symbol, history);
    }

    // 1. Check Volume Spike (Z-Score)
    if (tick.volume24h > 0) {
      const volumeAnomaly = this.evaluateVolumeSpike(symbol, tick.volume24h, history.volumes);
      if (volumeAnomaly) detected.push(volumeAnomaly);
      history.volumes.push(tick.volume24h);
      if (history.volumes.length > this.windowSize) {
        history.volumes.shift();
      }
    }

    // 2. Check Price Velocity
    const priceAnomaly = this.evaluatePriceVelocity(symbol, tick.price, tick.timestamp, history.prices);
    if (priceAnomaly) detected.push(priceAnomaly);
    history.prices.push({ price: tick.price, timestamp: tick.timestamp });
    if (history.prices.length > this.windowSize) {
      history.prices.shift();
    }

    // 3. Check Volatility Expansion
    const currentRange = tick.high24h - tick.low24h;
    if (currentRange > 0 && tick.price > 0) {
      const rangeRatio = (currentRange / tick.price) * 100;
      const volatilityAnomaly = this.evaluateVolatilityExpansion(symbol, rangeRatio, history.ranges);
      if (volatilityAnomaly) detected.push(volatilityAnomaly);
      history.ranges.push(rangeRatio);
      if (history.ranges.length > this.windowSize) {
        history.ranges.shift();
      }
    }

    // Buffer and dispatch detected events
    for (const event of detected) {
      this.addEvent(event);
      if (this.eventBus) {
        this.eventBus.publishRadarEvent(event);
      }
    }

    return detected;
  }

  /**
   * Evaluate Volume Z-Score:
   * Z = (V - mean) / stdDev
   */
  public evaluateVolumeSpike(symbol: string, currentVolume: number, historicalVolumes: number[]): RadarEvent | null {
    if (historicalVolumes.length < 5) return null;

    const mean = historicalVolumes.reduce((acc, v) => acc + v, 0) / historicalVolumes.length;
    const variance =
      historicalVolumes.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / historicalVolumes.length;
    const stdDev = Math.max(Math.sqrt(variance), mean * 0.02);

    if (stdDev <= 0) return null;

    const zScore = (currentVolume - mean) / stdDev;

    if (zScore >= this.volumeZScoreMed) {
      const severity: RadarSeverity = zScore >= this.volumeZScoreHigh ? 'HIGH' : 'MEDIUM';
      const anomalyKey = `${symbol}:VOLUME_SPIKE`;

      if (this.isCooldownActive(anomalyKey)) return null;

      this.recordAlert(anomalyKey);

      return {
        id: `radar-vol-${symbol}-${Date.now()}`,
        timestamp: new Date().toISOString(),
        symbol,
        type: 'VOLUME_SPIKE',
        severity,
        metricValue: `Z-Score: +${zScore.toFixed(2)}σ`,
        observation: `Аномальный объем: Z-Score +${zScore.toFixed(1)}σ выше скользящего среднего (${currentVolume.toLocaleString('en-US', { maximumFractionDigits: 0 })}).`,
        isDemo: false,
        metadata: {
          zScore,
          currentVolume,
          mean,
          stdDev,
        },
      };
    }

    return null;
  }

  /**
   * Evaluate rapid price changes over short window.
   */
  public evaluatePriceVelocity(
    symbol: string,
    currentPrice: number,
    currentTime: number,
    historicalPrices: { price: number; timestamp: number }[]
  ): RadarEvent | null {
    if (historicalPrices.length < 3) return null;

    // Compare with price from ~1 to 5 min ago (or oldest in short window)
    const baseline = historicalPrices[0];
    if (!baseline || baseline.price <= 0) return null;

    const priceChangePct = ((currentPrice - baseline.price) / baseline.price) * 100;
    const absChange = Math.abs(priceChangePct);

    if (absChange >= this.priceVelocityMed) {
      const severity: RadarSeverity = absChange >= this.priceVelocityHigh ? 'HIGH' : 'MEDIUM';
      const anomalyKey = `${symbol}:PRICE_MOVE`;

      if (this.isCooldownActive(anomalyKey)) return null;

      this.recordAlert(anomalyKey);

      const direction = priceChangePct >= 0 ? '+' : '';
      return {
        id: `radar-price-${symbol}-${Date.now()}`,
        timestamp: new Date().toISOString(),
        symbol,
        type: 'PRICE_MOVE',
        severity,
        metricValue: `${direction}${priceChangePct.toFixed(2)}%`,
        observation: `Резкий ценовой импульс ${direction}${priceChangePct.toFixed(2)}% по ${symbol} относительно базового уровня.`,
        isDemo: false,
        metadata: {
          priceChangePct,
          currentPrice,
          baselinePrice: baseline.price,
          elapsedMs: currentTime - baseline.timestamp,
        },
      };
    }

    return null;
  }

  /**
   * Evaluate volatility expansion (True range percentage widening).
   */
  public evaluateVolatilityExpansion(
    symbol: string,
    currentRangePct: number,
    historicalRanges: number[]
  ): RadarEvent | null {
    if (historicalRanges.length < 5) return null;

    const avgRange = historicalRanges.reduce((acc, r) => acc + r, 0) / historicalRanges.length;
    if (avgRange <= 0) return null;

    const ratio = currentRangePct / avgRange;

    if (ratio >= this.volatilityExpansionMed) {
      const severity: RadarSeverity = ratio >= this.volatilityExpansionHigh ? 'HIGH' : 'MEDIUM';
      const anomalyKey = `${symbol}:VOLATILITY_EXPANSION`;

      if (this.isCooldownActive(anomalyKey)) return null;

      this.recordAlert(anomalyKey);

      return {
        id: `radar-volat-${symbol}-${Date.now()}`,
        timestamp: new Date().toISOString(),
        symbol,
        type: 'VOLATILITY_EXPANSION',
        severity,
        metricValue: `${ratio.toFixed(1)}x avg range`,
        observation: `Расширение волатильности: суточный диапазон в ${ratio.toFixed(1)} раза превышает средний показатель.`,
        isDemo: false,
        metadata: {
          ratio,
          currentRangePct,
          avgRange,
        },
      };
    }

    return null;
  }

  private isCooldownActive(key: string): boolean {
    const lastTime = this.lastAlertTimestamp.get(key);
    if (!lastTime) return false;
    return Date.now() - lastTime < this.cooldownMs;
  }

  private recordAlert(key: string): void {
    this.lastAlertTimestamp.set(key, Date.now());
  }

  private addEvent(event: RadarEvent): void {
    this.bufferedEvents.unshift(event);
    if (this.bufferedEvents.length > this.maxBufferedEvents) {
      this.bufferedEvents.pop();
    }
  }

  public getEvents(symbol?: string): RadarEvent[] {
    if (symbol) {
      return this.bufferedEvents.filter((e) => e.symbol.toUpperCase() === symbol.toUpperCase());
    }
    return [...this.bufferedEvents];
  }

  public seedInitialEvents(events: RadarEvent[]): void {
    for (const e of events) {
      this.bufferedEvents.push(e);
    }
  }

  public clear(): void {
    this.symbolHistories.clear();
    this.lastAlertTimestamp.clear();
    this.bufferedEvents = [];
  }
}

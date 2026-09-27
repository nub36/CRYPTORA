/**
 * Frozen deterministic Radar calculation core.
 *
 * This module deliberately contains only the state and calculations shared by
 * browser presentation and the server monitor. Runtime ownership (WebSocket,
 * persistence, API delivery) belongs to its caller. Keep this JavaScript so
 * Node can execute the same source that Vite imports; TypeScript consumers use
 * the adjacent declaration file.
 */

const DEFAULTS = {
  windowSize: 20,
  volumeZScoreHighThreshold: 3.0,
  volumeZScoreMedThreshold: 2.0,
  priceVelocityHighThreshold: 4.0,
  priceVelocityMedThreshold: 2.5,
  volatilityExpansionHighThreshold: 2.5,
  volatilityExpansionMedThreshold: 1.8,
  cooldownMs: 30_000,
};

export class AnomalyCalculationCore {
  constructor(options = {}, runtime = {}) {
    this.windowSize = options.windowSize ?? DEFAULTS.windowSize;
    this.volumeZScoreHigh = options.volumeZScoreHighThreshold ?? DEFAULTS.volumeZScoreHighThreshold;
    this.volumeZScoreMed = options.volumeZScoreMedThreshold ?? DEFAULTS.volumeZScoreMedThreshold;
    this.priceVelocityHigh = options.priceVelocityHighThreshold ?? DEFAULTS.priceVelocityHighThreshold;
    this.priceVelocityMed = options.priceVelocityMedThreshold ?? DEFAULTS.priceVelocityMedThreshold;
    this.volatilityExpansionHigh = options.volatilityExpansionHighThreshold ?? DEFAULTS.volatilityExpansionHighThreshold;
    this.volatilityExpansionMed = options.volatilityExpansionMedThreshold ?? DEFAULTS.volatilityExpansionMedThreshold;
    this.cooldownMs = options.cooldownMs ?? DEFAULTS.cooldownMs;
    this.now = runtime.now ?? (() => Date.now());
    this.symbolHistories = new Map();
    this.lastAlertTimestamp = new Map();
  }

  /**
   * Process one normalized Spot ticker. Calculation order and all thresholds are
   * the pre-migration Radar engine semantics; do not move observations before
   * their evaluation without an explicit owner-approved math change.
   */
  processTick(tick) {
    const detected = [];
    const symbol = tick.symbol;

    let history = this.symbolHistories.get(symbol);
    if (!history) {
      history = { volumes: [], prices: [], ranges: [] };
      this.symbolHistories.set(symbol, history);
    }

    // 1. Volume Spike (Z-Score)
    if (tick.volume24h > 0) {
      const volumeAnomaly = this.evaluateVolumeSpike(symbol, tick.volume24h, history.volumes);
      if (volumeAnomaly) detected.push(volumeAnomaly);
      history.volumes.push(tick.volume24h);
      if (history.volumes.length > this.windowSize) history.volumes.shift();
    }

    // 2. Price Velocity
    const priceAnomaly = this.evaluatePriceVelocity(symbol, tick.price, tick.timestamp, history.prices);
    if (priceAnomaly) detected.push(priceAnomaly);
    history.prices.push({ price: tick.price, timestamp: tick.timestamp });
    if (history.prices.length > this.windowSize) history.prices.shift();

    // 3. Volatility Expansion
    const currentRange = tick.high24h - tick.low24h;
    if (currentRange > 0 && tick.price > 0) {
      const rangeRatio = (currentRange / tick.price) * 100;
      const volatilityAnomaly = this.evaluateVolatilityExpansion(symbol, rangeRatio, history.ranges);
      if (volatilityAnomaly) detected.push(volatilityAnomaly);
      history.ranges.push(rangeRatio);
      if (history.ranges.length > this.windowSize) history.ranges.shift();
    }

    return detected;
  }

  /** Z = (V - mean) / stdDev. */
  evaluateVolumeSpike(symbol, currentVolume, historicalVolumes) {
    if (historicalVolumes.length < 5) return null;

    const mean = historicalVolumes.reduce((acc, v) => acc + v, 0) / historicalVolumes.length;
    const variance = historicalVolumes.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / historicalVolumes.length;
    const stdDev = Math.max(Math.sqrt(variance), mean * 0.02);

    if (stdDev <= 0) return null;

    const zScore = (currentVolume - mean) / stdDev;
    if (zScore >= this.volumeZScoreMed) {
      const severity = zScore >= this.volumeZScoreHigh ? 'HIGH' : 'MEDIUM';
      const anomalyKey = `${symbol}:VOLUME_SPIKE`;
      if (this.isCooldownActive(anomalyKey)) return null;
      this.recordAlert(anomalyKey);

      return {
        id: `radar-vol-${symbol}-${this.now()}`,
        timestamp: new Date(this.now()).toISOString(),
        symbol,
        type: 'VOLUME_SPIKE',
        severity,
        metricValue: `Z-Score: +${zScore.toFixed(2)}σ`,
        observation: `Аномальный объем: Z-Score +${zScore.toFixed(1)}σ выше скользящего среднего (${currentVolume.toLocaleString('en-US', { maximumFractionDigits: 0 })}).`,
        isDemo: false,
        metadata: { zScore, currentVolume, mean, stdDev },
      };
    }
    return null;
  }

  /** Rapid price movement against the oldest available short-window baseline. */
  evaluatePriceVelocity(symbol, currentPrice, currentTime, historicalPrices) {
    if (historicalPrices.length < 3) return null;
    const baseline = historicalPrices[0];
    if (!baseline || baseline.price <= 0) return null;

    const priceChangePct = ((currentPrice - baseline.price) / baseline.price) * 100;
    const absChange = Math.abs(priceChangePct);
    if (absChange >= this.priceVelocityMed) {
      const severity = absChange >= this.priceVelocityHigh ? 'HIGH' : 'MEDIUM';
      const anomalyKey = `${symbol}:PRICE_MOVE`;
      if (this.isCooldownActive(anomalyKey)) return null;
      this.recordAlert(anomalyKey);

      const direction = priceChangePct >= 0 ? '+' : '';
      return {
        id: `radar-price-${symbol}-${this.now()}`,
        timestamp: new Date(this.now()).toISOString(),
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

  /** True-range percentage widening against the rolling mean. */
  evaluateVolatilityExpansion(symbol, currentRangePct, historicalRanges) {
    if (historicalRanges.length < 5) return null;

    const avgRange = historicalRanges.reduce((acc, r) => acc + r, 0) / historicalRanges.length;
    if (avgRange <= 0) return null;

    const ratio = currentRangePct / avgRange;
    if (ratio >= this.volatilityExpansionMed) {
      const severity = ratio >= this.volatilityExpansionHigh ? 'HIGH' : 'MEDIUM';
      const anomalyKey = `${symbol}:VOLATILITY_EXPANSION`;
      if (this.isCooldownActive(anomalyKey)) return null;
      this.recordAlert(anomalyKey);

      return {
        id: `radar-volat-${symbol}-${this.now()}`,
        timestamp: new Date(this.now()).toISOString(),
        symbol,
        type: 'VOLATILITY_EXPANSION',
        severity,
        metricValue: `${ratio.toFixed(1)}x avg range`,
        observation: `Расширение волатильности: суточный диапазон в ${ratio.toFixed(1)} раза превышает средний показатель.`,
        isDemo: false,
        metadata: { ratio, currentRangePct, avgRange },
      };
    }
    return null;
  }

  isCooldownActive(key) {
    const lastTime = this.lastAlertTimestamp.get(key);
    if (!lastTime) return false;
    return this.now() - lastTime < this.cooldownMs;
  }

  recordAlert(key) {
    this.lastAlertTimestamp.set(key, this.now());
  }

  getStatus(symbols) {
    const requested = symbols
      ? Array.from(new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))).sort()
      : Array.from(this.symbolHistories.keys()).sort();

    const statuses = requested.map((symbol) => {
      const history = this.symbolHistories.get(symbol);
      const volumeObservations = history?.volumes.length ?? 0;
      const priceObservations = history?.prices.length ?? 0;
      const rangeObservations = history?.ranges.length ?? 0;
      const observationCount = Math.min(volumeObservations, priceObservations, rangeObservations);
      const maxObservationCount = Math.max(volumeObservations, priceObservations, rangeObservations);
      return {
        symbol,
        volumeObservations,
        priceObservations,
        rangeObservations,
        observationCount,
        maxObservationCount,
        warmed: observationCount >= this.windowSize,
      };
    });

    return {
      windowSize: this.windowSize,
      trackedSymbols: this.symbolHistories.size,
      warmedSymbols: statuses.filter((status) => status.warmed).length,
      maxObservations: statuses.reduce((max, status) => Math.max(max, status.maxObservationCount), 0),
      symbols: statuses,
    };
  }

  clearSymbols(symbols) {
    for (const raw of symbols) {
      const symbol = String(raw).trim().toUpperCase();
      if (!symbol) continue;
      this.symbolHistories.delete(symbol);
      for (const key of this.lastAlertTimestamp.keys()) {
        if (key.startsWith(`${symbol}:`)) this.lastAlertTimestamp.delete(key);
      }
    }
  }

  clear() {
    this.symbolHistories.clear();
    this.lastAlertTimestamp.clear();
  }
}

export const FROZEN_ANOMALY_DEFAULTS = Object.freeze({ ...DEFAULTS });

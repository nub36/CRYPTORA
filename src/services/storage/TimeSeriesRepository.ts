import { OHLCV, Timeframe } from '@/types/market';

export interface TimeSeriesGap {
  start: number; // Unix timestamp in seconds
  end: number;
  missingCandles: number;
}

export interface GapDetectionResult {
  symbol: string;
  timeframe: Timeframe;
  expectedIntervalSec: number;
  totalGaps: number;
  gaps: TimeSeriesGap[];
}

export interface TimeSeriesRepository {
  saveCandles(symbol: string, timeframe: Timeframe, candles: OHLCV[]): Promise<number>;
  getCandles(
    symbol: string,
    timeframe: Timeframe,
    options?: { from?: number; to?: number; limit?: number }
  ): Promise<OHLCV[]>;
  getLatestCandle(symbol: string, timeframe: Timeframe): Promise<OHLCV | null>;
  detectGaps(symbol: string, timeframe: Timeframe): Promise<GapDetectionResult>;
  clear(symbol?: string, timeframe?: Timeframe): Promise<void>;
}

export const TIMEFRAME_INTERVAL_SECONDS: Record<Timeframe, number> = {
  '15m': 15 * 60,
  '1h': 60 * 60,
  '4h': 4 * 60 * 60,
  '1D': 24 * 60 * 60,
  '1W': 7 * 24 * 60 * 60,
};

export class MemoryTimeSeriesRepository implements TimeSeriesRepository {
  private static instance: MemoryTimeSeriesRepository | null = null;
  // Key: `${symbol}:${timeframe}` -> Map<timestamp, OHLCV>
  private store: Map<string, Map<number, OHLCV>> = new Map();
  private maxCandlesPerSeries: number;

  constructor(maxCandlesPerSeries = 5000) {
    this.maxCandlesPerSeries = maxCandlesPerSeries;
  }

  public static getInstance(maxCandles?: number): MemoryTimeSeriesRepository {
    if (!MemoryTimeSeriesRepository.instance) {
      MemoryTimeSeriesRepository.instance = new MemoryTimeSeriesRepository(maxCandles);
    }
    return MemoryTimeSeriesRepository.instance;
  }

  private getKey(symbol: string, timeframe: Timeframe): string {
    return `${symbol.toUpperCase()}:${timeframe}`;
  }

  public async saveCandles(
    symbol: string,
    timeframe: Timeframe,
    candles: OHLCV[]
  ): Promise<number> {
    if (!candles || candles.length === 0) return 0;

    const key = this.getKey(symbol, timeframe);
    let series = this.store.get(key);
    if (!series) {
      series = new Map<number, OHLCV>();
      this.store.set(key, series);
    }

    let addedCount = 0;
    for (const candle of candles) {
      if (!series.has(candle.time)) {
        addedCount++;
      }
      series.set(candle.time, candle);
    }

    // Evict oldest if exceeding limit
    if (series.size > this.maxCandlesPerSeries) {
      const sortedKeys = Array.from(series.keys()).sort((a, b) => a - b);
      const toRemove = sortedKeys.slice(0, series.size - this.maxCandlesPerSeries);
      for (const k of toRemove) {
        series.delete(k);
      }
    }

    return addedCount;
  }

  public async getCandles(
    symbol: string,
    timeframe: Timeframe,
    options: { from?: number; to?: number; limit?: number } = {}
  ): Promise<OHLCV[]> {
    const key = this.getKey(symbol, timeframe);
    const series = this.store.get(key);
    if (!series || series.size === 0) return [];

    let sorted = Array.from(series.values()).sort((a, b) => a.time - b.time);

    if (options.from !== undefined) {
      sorted = sorted.filter((c) => c.time >= options.from!);
    }

    if (options.to !== undefined) {
      sorted = sorted.filter((c) => c.time <= options.to!);
    }

    if (options.limit !== undefined && options.limit > 0) {
      sorted = sorted.slice(-options.limit);
    }

    return sorted;
  }

  public async getLatestCandle(symbol: string, timeframe: Timeframe): Promise<OHLCV | null> {
    const candles = await this.getCandles(symbol, timeframe, { limit: 1 });
    return candles.length > 0 ? candles[0] : null;
  }

  /**
   * Detect gaps in time series. Gaps happen when elapsed time between two consecutive candles
   * exceeds 1.5 * expected interval.
   */
  public async detectGaps(symbol: string, timeframe: Timeframe): Promise<GapDetectionResult> {
    const intervalSec = TIMEFRAME_INTERVAL_SECONDS[timeframe];
    const candles = await this.getCandles(symbol, timeframe);

    const gaps: TimeSeriesGap[] = [];

    if (candles.length < 2) {
      return {
        symbol: symbol.toUpperCase(),
        timeframe,
        expectedIntervalSec: intervalSec,
        totalGaps: 0,
        gaps,
      };
    }

    for (let i = 1; i < candles.length; i++) {
      const prevTime = candles[i - 1].time;
      const currTime = candles[i].time;
      const diff = currTime - prevTime;

      if (diff > intervalSec * 1.5) {
        const missingCount = Math.round(diff / intervalSec) - 1;
        gaps.push({
          start: prevTime,
          end: currTime,
          missingCandles: Math.max(1, missingCount),
        });
      }
    }

    return {
      symbol: symbol.toUpperCase(),
      timeframe,
      expectedIntervalSec: intervalSec,
      totalGaps: gaps.length,
      gaps,
    };
  }

  public async clear(symbol?: string, timeframe?: Timeframe): Promise<void> {
    if (symbol && timeframe) {
      this.store.delete(this.getKey(symbol, timeframe));
    } else if (symbol) {
      const prefix = `${symbol.toUpperCase()}:`;
      for (const key of this.store.keys()) {
        if (key.startsWith(prefix)) {
          this.store.delete(key);
        }
      }
    } else {
      this.store.clear();
    }
  }
}

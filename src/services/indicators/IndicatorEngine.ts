import { OHLCV, TechnicalIndicators } from '@/types/market';

export interface BollingerBandsResult {
  upper: number;
  middle: number;
  lower: number;
  bandwidthPct: number;
}

export interface MACDResult {
  macd: number;
  signal: number;
  hist: number;
}

export interface VolumeProfileLevel {
  price: number;
  volume: number;
  percentage: number;
}

export interface VolumeProfileResult {
  poc: number; // Point of Control
  vah: number; // Value Area High (70% volume)
  val: number; // Value Area Low (70% volume)
  levels: VolumeProfileLevel[];
}

export interface CompleteIndicatorsResult extends TechnicalIndicators {
  atr14: number;
  vwap: number;
  bollinger: BollingerBandsResult;
  volumeProfile?: VolumeProfileResult;
  cvd?: number;
}

export class IndicatorEngine {
  /**
   * Simple Moving Average (SMA)
   */
  public static calculateSMA(prices: number[], period: number): number[] {
    if (prices.length < period || period <= 0) return [];

    const result: number[] = [];
    let sum = 0;

    for (let i = 0; i < period; i++) {
      sum += prices[i];
    }
    result.push(sum / period);

    for (let i = period; i < prices.length; i++) {
      sum += prices[i] - prices[i - period];
      result.push(sum / period);
    }

    return result;
  }

  /**
   * Exponential Moving Average (EMA)
   */
  public static calculateEMA(prices: number[], period: number): number[] {
    if (prices.length < period || period <= 0) return [];

    const k = 2 / (period + 1);
    const result: number[] = [];

    // Initialize first EMA with SMA of first 'period' elements
    let sum = 0;
    for (let i = 0; i < period; i++) {
      sum += prices[i];
    }
    let prevEma = sum / period;
    result.push(prevEma);

    for (let i = period; i < prices.length; i++) {
      const currentEma = prices[i] * k + prevEma * (1 - k);
      result.push(currentEma);
      prevEma = currentEma;
    }

    return result;
  }

  /**
   * Relative Strength Index (RSI) using Wilder's Smoothing Method
   */
  public static calculateRSI(prices: number[], period = 14): number[] {
    if (prices.length <= period || period <= 0) return [];

    const result: number[] = [];
    let gainsSum = 0;
    let lossesSum = 0;

    // First period gains and losses
    for (let i = 1; i <= period; i++) {
      const diff = prices[i] - prices[i - 1];
      if (diff >= 0) {
        gainsSum += diff;
      } else {
        lossesSum += Math.abs(diff);
      }
    }

    let avgGain = gainsSum / period;
    let avgLoss = lossesSum / period;

    let rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    let rsi = avgLoss === 0 ? 100 : 100 - 100 / (1 + rs);
    result.push(Math.min(100, Math.max(0, rsi)));

    // Subsequent periods using Wilder's smoothing
    for (let i = period + 1; i < prices.length; i++) {
      const diff = prices[i] - prices[i - 1];
      const gain = diff > 0 ? diff : 0;
      const loss = diff < 0 ? Math.abs(diff) : 0;

      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;

      if (avgLoss === 0) {
        result.push(100);
      } else {
        rs = avgGain / avgLoss;
        rsi = 100 - 100 / (1 + rs);
        result.push(Math.min(100, Math.max(0, rsi)));
      }
    }

    return result;
  }

  /**
   * Moving Average Convergence Divergence (MACD)
   * Defaults: fast = 12, slow = 26, signal = 9
   */
  public static calculateMACD(
    prices: number[],
    fastPeriod = 12,
    slowPeriod = 26,
    signalPeriod = 9
  ): MACDResult[] {
    if (prices.length < slowPeriod + signalPeriod) return [];

    const fastEma = this.calculateEMA(prices, fastPeriod);
    const slowEma = this.calculateEMA(prices, slowPeriod);

    // Align fast and slow EMAs
    const offset = slowPeriod - fastPeriod;
    const macdLine: number[] = [];

    for (let i = 0; i < slowEma.length; i++) {
      macdLine.push(fastEma[i + offset] - slowEma[i]);
    }

    const signalLine = this.calculateEMA(macdLine, signalPeriod);
    const macdOffset = macdLine.length - signalLine.length;

    const result: MACDResult[] = [];
    for (let i = 0; i < signalLine.length; i++) {
      const macdVal = macdLine[i + macdOffset];
      const sigVal = signalLine[i];
      result.push({
        macd: Number(macdVal.toFixed(4)),
        signal: Number(sigVal.toFixed(4)),
        hist: Number((macdVal - sigVal).toFixed(4)),
      });
    }

    return result;
  }

  /**
   * Bollinger Bands (SMA period 20, multiplier 2)
   */
  public static calculateBollingerBands(
    prices: number[],
    period = 20,
    multiplier = 2
  ): BollingerBandsResult[] {
    if (prices.length < period || period <= 0) return [];

    const result: BollingerBandsResult[] = [];

    for (let i = period - 1; i < prices.length; i++) {
      const window = prices.slice(i - period + 1, i + 1);
      const middle = window.reduce((sum, p) => sum + p, 0) / period;

      const variance =
        window.reduce((sum, p) => sum + Math.pow(p - middle, 2), 0) / period;
      const stdDev = Math.sqrt(variance);

      const upper = middle + multiplier * stdDev;
      const lower = middle - multiplier * stdDev;
      const bandwidthPct = middle > 0 ? ((upper - lower) / middle) * 100 : 0;

      result.push({
        middle: Number(middle.toFixed(4)),
        upper: Number(upper.toFixed(4)),
        lower: Number(lower.toFixed(4)),
        bandwidthPct: Number(bandwidthPct.toFixed(2)),
      });
    }

    return result;
  }

  /**
   * Average True Range (ATR) using Wilder's Smoothing
   */
  public static calculateATR(candles: OHLCV[], period = 14): number[] {
    if (candles.length <= period || period <= 0) return [];

    const trueRanges: number[] = [];

    // First True Range is simply High - Low
    trueRanges.push(candles[0].high - candles[0].low);

    for (let i = 1; i < candles.length; i++) {
      const current = candles[i];
      const prevClose = candles[i - 1].close;

      const tr = Math.max(
        current.high - current.low,
        Math.abs(current.high - prevClose),
        Math.abs(current.low - prevClose)
      );
      trueRanges.push(tr);
    }

    const result: number[] = [];

    // First ATR is simple average of first 'period' true ranges
    let sum = 0;
    for (let i = 0; i < period; i++) {
      sum += trueRanges[i];
    }
    let prevAtr = sum / period;
    result.push(Number(prevAtr.toFixed(4)));

    // Subsequent periods with Wilder's smoothing
    for (let i = period; i < trueRanges.length; i++) {
      const currentAtr = (prevAtr * (period - 1) + trueRanges[i]) / period;
      result.push(Number(currentAtr.toFixed(4)));
      prevAtr = currentAtr;
    }

    return result;
  }

  /**
   * Volume-Weighted Average Price (VWAP)
   */
  public static calculateVWAP(candles: OHLCV[]): number {
    if (candles.length === 0) return 0;

    let cumulativeTypicalVolume = 0;
    let cumulativeVolume = 0;

    for (const c of candles) {
      const typicalPrice = (c.high + c.low + c.close) / 3;
      cumulativeTypicalVolume += typicalPrice * c.volume;
      cumulativeVolume += c.volume;
    }

    if (cumulativeVolume <= 0) return candles[candles.length - 1].close;
    return Number((cumulativeTypicalVolume / cumulativeVolume).toFixed(4));
  }

  /**
   * Volume Profile (POC, VAH, VAL over price buckets)
   */
  public static calculateVolumeProfile(
    candles: OHLCV[],
    bucketsCount = 24
  ): VolumeProfileResult {
    if (candles.length === 0) {
      return { poc: 0, vah: 0, val: 0, levels: [] };
    }

    let minPrice = Infinity;
    let maxPrice = -Infinity;
    let totalVolume = 0;

    for (const c of candles) {
      if (c.low < minPrice) minPrice = c.low;
      if (c.high > maxPrice) maxPrice = c.high;
      totalVolume += c.volume;
    }

    if (minPrice === maxPrice || totalVolume <= 0) {
      const p = candles[candles.length - 1].close;
      return { poc: p, vah: p, val: p, levels: [] };
    }

    const bucketSize = (maxPrice - minPrice) / bucketsCount;
    const buckets = new Array(bucketsCount).fill(0);

    for (const c of candles) {
      const typicalPrice = (c.high + c.low + c.close) / 3;
      const index = Math.min(
        Math.floor((typicalPrice - minPrice) / bucketSize),
        bucketsCount - 1
      );
      buckets[index] += c.volume;
    }

    let maxVol = -1;
    let pocIndex = 0;

    const levels: VolumeProfileLevel[] = buckets.map((vol, idx) => {
      const price = minPrice + (idx + 0.5) * bucketSize;
      if (vol > maxVol) {
        maxVol = vol;
        pocIndex = idx;
      }
      return {
        price: Number(price.toFixed(4)),
        volume: Number(vol.toFixed(2)),
        percentage: Number(((vol / totalVolume) * 100).toFixed(1)),
      };
    });

    const poc = Number((minPrice + (pocIndex + 0.5) * bucketSize).toFixed(4));

    // Calculate 70% Value Area around POC
    const targetVolume = totalVolume * 0.7;
    let accumulatedVolume = buckets[pocIndex];
    let upIdx = pocIndex + 1;
    let downIdx = pocIndex - 1;

    while (
      accumulatedVolume < targetVolume &&
      (upIdx < bucketsCount || downIdx >= 0)
    ) {
      const upVol = upIdx < bucketsCount ? buckets[upIdx] : 0;
      const downVol = downIdx >= 0 ? buckets[downIdx] : 0;

      if (upVol >= downVol) {
        accumulatedVolume += upVol;
        upIdx++;
      } else {
        accumulatedVolume += downVol;
        downIdx--;
      }
    }

    const valIndex = Math.max(0, downIdx + 1);
    const vahIndex = Math.min(bucketsCount - 1, upIdx - 1);

    const val = Number((minPrice + (valIndex + 0.5) * bucketSize).toFixed(4));
    const vah = Number((minPrice + (vahIndex + 0.5) * bucketSize).toFixed(4));

    return { poc, vah, val, levels };
  }

  /**
   * Cumulative Volume Delta (CVD) estimation from candle sequence
   * Estimates buying volume vs selling volume based on close relative to open
   */
  public static calculateCVD(candles: OHLCV[]): number {
    let cvd = 0;

    for (const c of candles) {
      const range = c.high - c.low;
      if (range > 0) {
        // Delta ratio based on candle close location within range
        const buyRatio = (c.close - c.low) / range;
        const sellRatio = (c.high - c.close) / range;
        const delta = (buyRatio - sellRatio) * c.volume;
        cvd += delta;
      }
    }

    return Number(cvd.toFixed(2));
  }

  /**
   * Full indicator suite computation from raw OHLCV series
   */
  public static computeCompleteIndicators(candles: OHLCV[]): CompleteIndicatorsResult {
    const closes = candles.map((c) => c.close);
    const lastPrice = closes.length > 0 ? closes[closes.length - 1] : 0;

    // RSI
    const rsiSeries = this.calculateRSI(closes, 14);
    const rsi14 = rsiSeries.length > 0 ? Number(rsiSeries[rsiSeries.length - 1].toFixed(2)) : 50;

    // MACD
    const macdSeries = this.calculateMACD(closes, 12, 26, 9);
    const macd =
      macdSeries.length > 0
        ? macdSeries[macdSeries.length - 1]
        : { macd: 0, signal: 0, hist: 0 };

    // SMAs
    const sma20Series = this.calculateSMA(closes, 20);
    const sma50Series = this.calculateSMA(closes, 50);
    const sma200Series = this.calculateSMA(closes, 200);

    const sma20 = sma20Series.length > 0 ? Number(sma20Series[sma20Series.length - 1].toFixed(4)) : lastPrice;
    const sma50 = sma50Series.length > 0 ? Number(sma50Series[sma50Series.length - 1].toFixed(4)) : lastPrice;
    const sma200 = sma200Series.length > 0 ? Number(sma200Series[sma200Series.length - 1].toFixed(4)) : lastPrice;

    // Bollinger Bands
    const bbSeries = this.calculateBollingerBands(closes, 20, 2);
    const bollinger: BollingerBandsResult =
      bbSeries.length > 0
        ? bbSeries[bbSeries.length - 1]
        : {
            upper: lastPrice * 1.05,
            middle: lastPrice,
            lower: lastPrice * 0.95,
            bandwidthPct: 10,
          };

    // ATR
    const atrSeries = this.calculateATR(candles, 14);
    const atr14 = atrSeries.length > 0 ? atrSeries[atrSeries.length - 1] : lastPrice * 0.02;

    // VWAP
    const vwap = this.calculateVWAP(candles);

    // Volume Profile & CVD
    const volumeProfile = this.calculateVolumeProfile(candles);
    const cvd = this.calculateCVD(candles);

    return {
      rsi14,
      macd,
      sma20,
      sma50,
      sma200,
      bollinger,
      atr14,
      vwap,
      volumeProfile,
      cvd,
    };
  }
}

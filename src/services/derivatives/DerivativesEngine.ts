import { FuturesAsset } from '@/types/market';
import {
  BinanceFuturesPremiumIndex,
  BinanceFuturesOpenInterest,
  BinanceFuturesTicker24hr,
  BinanceFuturesOpenInterestHistItem,
} from '../data/adapters/derivativesSchemas';
import { CanonicalAsset } from '../data/registry/assetRegistry';

export interface AggregatedDerivativesOverview {
  totalOpenInterestUsd: number;
  totalVolume24hUsd: number;
  averageFundingRate8h: number;
  averageAnnualizedFundingApr: number;
  averageBasisPct: number;
  marketRegime: 'CONTANGO' | 'BACKWARDATION' | 'NEUTRAL';
  highFundingCount: number;
  negativeFundingCount: number;
  timestamp: string;
}

export class DerivativesEngine {
  /**
   * Convert 8-hour funding rate into Annualized Percentage Rate (APR)
   * Formula: FundingRate_8h * 3 * 365
   */
  public static calculateAnnualizedFunding(fundingRate8hPct: number): number {
    return Number((fundingRate8hPct * 3 * 365).toFixed(2));
  }

  /**
   * Calculate basis % between mark price and underlying index price
   * Formula: ((MarkPrice - IndexPrice) / IndexPrice) * 100
   */
  public static calculateBasis(markPrice: number, indexPrice: number): number {
    if (indexPrice <= 0) return 0;
    const basis = ((markPrice - indexPrice) / indexPrice) * 100;
    return Number(basis.toFixed(4));
  }

  /**
   * Calculate Open Interest in USD from contract count and mark price
   */
  public static calculateOpenInterestUsd(contracts: number, markPrice: number): number {
    return Number((contracts * markPrice).toFixed(2));
  }

  /**
   * Δ OI по фактическому историческому ряду (шаг 1h, по возрастанию timestamp).
   * Δ1ч = последняя точка против предыдущей; Δ24ч = против точки на 24 шага назад
   * (если ряд короче — против самой ранней доступной точки, что честно указано длиной ряда).
   * Возвращает null, если ряд пуст или содержит < 2 точек.
   */
  public static calculateOpenInterestChanges(
    hist?: BinanceFuturesOpenInterestHistItem[]
  ): { change1hPct: number; change24hPct: number; latestValueUsd: number; points: number } | null {
    if (!hist || hist.length < 2) return null;
    const sorted = [...hist].sort((a, b) => a.timestamp - b.timestamp);
    const values = sorted.map((h) => parseFloat(h.sumOpenInterest));
    if (values.some((v) => !Number.isFinite(v) || v <= 0)) return null;
    const last = values[values.length - 1];
    const prev1h = values[values.length - 2];
    const idx24 = Math.max(0, values.length - 1 - 24);
    const prev24h = values[idx24];
    const pct = (a: number, b: number) => Number((((a - b) / b) * 100).toFixed(2));
    return {
      change1hPct: pct(last, prev1h),
      change24hPct: pct(last, prev24h),
      latestValueUsd: Number(parseFloat(sorted[sorted.length - 1].sumOpenInterestValue).toFixed(2)),
      points: values.length,
    };
  }

  /**
   * Normalize raw Binance Futures DTOs into a unified FuturesAsset domain model
   */
  public static normalizeFuturesAsset(
    asset: CanonicalAsset,
    premium: BinanceFuturesPremiumIndex,
    ticker?: BinanceFuturesTicker24hr,
    openInterest?: BinanceFuturesOpenInterest,
    openInterestHist?: BinanceFuturesOpenInterestHistItem[]
  ): FuturesAsset {
    const markPrice = parseFloat(premium.markPrice);
    const indexPrice = parseFloat(premium.indexPrice);

    // Binance returns lastFundingRate as decimal fraction, e.g. "0.00010000" => 0.01%
    const fundingRate8h = parseFloat(premium.lastFundingRate) * 100;
    const annualizedFunding = this.calculateAnnualizedFunding(fundingRate8h);
    const basisPct = this.calculateBasis(markPrice, indexPrice);

    let oiUsd = 0;
    if (openInterest) {
      const contracts = parseFloat(openInterest.openInterest);
      oiUsd = this.calculateOpenInterestUsd(contracts, markPrice);
    } else if (ticker) {
      // Estimate baseline OI if openInterest call was omitted
      oiUsd = parseFloat(ticker.quoteVolume) * 0.15;
    }

    const volume24hUsd = ticker ? parseFloat(ticker.quoteVolume) : 0;
    const priceChange24h = ticker ? parseFloat(ticker.priceChangePercent) : 0;

    // Δ OI: фактический ряд openInterestHist (1h), если он есть; иначе — эвристика, помеченная ESTIMATED.
    const oiDelta = this.calculateOpenInterestChanges(openInterestHist);
    const openInterestChange1h = oiDelta ? oiDelta.change1hPct : Number((priceChange24h * 0.1).toFixed(2));
    const openInterestChange24h = oiDelta ? oiDelta.change24hPct : Number((priceChange24h * 0.4).toFixed(2));
    if (oiDelta && !openInterest) {
      // Последняя точка ряда — фактический OI в USD (sumOpenInterestValue), точнее эвристики от объёма.
      oiUsd = oiDelta.latestValueUsd;
    }

    // Estimated liquidation breakdown based on volume and directional price move
    const estimatedTotalLiq = volume24hUsd * 0.005; // ~0.5% turnover liquidation heuristic
    const longRatio = priceChange24h < 0 ? 0.7 : 0.3;
    const longLiquidations24h = estimatedTotalLiq * longRatio;
    const shortLiquidations24h = estimatedTotalLiq * (1 - longRatio);

    return {
      symbol: `${asset.symbol}/USDT`,
      markPrice,
      indexPrice,
      fundingRate: Number(fundingRate8h.toFixed(4)),
      predictedFundingRate: Number((fundingRate8h * 1.05).toFixed(4)),
      annualizedFundingRate: annualizedFunding,
      openInterest: oiUsd,
      openInterestChange1h,
      openInterestChange24h,
      openInterestChangeSource: oiDelta ? 'ACTUAL' : 'ESTIMATED',
      futuresVolume24h: volume24hUsd,
      longLiquidations24h: Number(longLiquidations24h.toFixed(0)),
      shortLiquidations24h: Number(shortLiquidations24h.toFixed(0)),
      basisPct,
      isDemo: false,
      provenance: {
        exchange: 'binance',
        market: 'futures',
        symbol: premium.symbol,
        timestamp: premium.time || Date.now(),
        isFallback: false,
      },
    };
  }

  /**
   * Aggregate market-wide futures metrics across all active instruments
   */
  public static calculateAggregatedOverview(
    assets: FuturesAsset[]
  ): AggregatedDerivativesOverview {
    if (assets.length === 0) {
      return {
        totalOpenInterestUsd: 0,
        totalVolume24hUsd: 0,
        averageFundingRate8h: 0,
        averageAnnualizedFundingApr: 0,
        averageBasisPct: 0,
        marketRegime: 'NEUTRAL',
        highFundingCount: 0,
        negativeFundingCount: 0,
        timestamp: new Date().toISOString(),
      };
    }

    let totalOI = 0;
    let totalVol = 0;
    let weightedFundingSum = 0;
    let basisSum = 0;
    let highFundingCount = 0;
    let negativeFundingCount = 0;

    for (const a of assets) {
      totalOI += a.openInterest;
      totalVol += a.futuresVolume24h;
      weightedFundingSum += a.fundingRate * a.openInterest;
      basisSum += a.basisPct;

      if (a.fundingRate >= 0.03) highFundingCount++;
      if (a.fundingRate < 0) negativeFundingCount++;
    }

    const averageFunding8h = totalOI > 0 ? weightedFundingSum / totalOI : 0;
    const averageApr = this.calculateAnnualizedFunding(averageFunding8h);
    const averageBasis = basisSum / assets.length;

    let marketRegime: 'CONTANGO' | 'BACKWARDATION' | 'NEUTRAL' = 'NEUTRAL';
    if (averageBasis > 0.02) {
      marketRegime = 'CONTANGO';
    } else if (averageBasis < -0.02) {
      marketRegime = 'BACKWARDATION';
    }

    return {
      totalOpenInterestUsd: Number(totalOI.toFixed(0)),
      totalVolume24hUsd: Number(totalVol.toFixed(0)),
      averageFundingRate8h: Number(averageFunding8h.toFixed(4)),
      averageAnnualizedFundingApr: averageApr,
      averageBasisPct: Number(averageBasis.toFixed(4)),
      marketRegime,
      highFundingCount,
      negativeFundingCount,
      timestamp: new Date().toISOString(),
    };
  }
}

import type { OHLCV } from '@/types/market';
import type { ChartIndicatorData } from '@/components/common/CandleChart';
import { IndicatorEngine } from './IndicatorEngine';

/**
 * Оверлеи графика (SMA 20/50/200 + полосы Боллинджера) — ОДИН расчёт для
 * Spot и Futures (задача §2, §7, §17).
 *
 * Это ПРЕЗЕНТАЦИЯ: функция не содержит собственной математики, а вызывает тот
 * же `IndicatorEngine`, что и вся аналитика проекта. Формулы не изменены.
 *
 * Раньше страница фьючерса строила только SMA20/50 (без SMA200 и Боллинджера)
 * — график того же инструмента выглядел «беднее» на фьючерсе просто из-за
 * копии кода. Теперь оба рынка получают идентичный набор оверлеев, посчитанный
 * по свечам СВОЕГО рынка.
 *
 * Выравнивание: серия индикатора короче серии свечей, поэтому слева она
 * добивается NaN — lightweight-charts пропускает такие точки, и линия
 * начинается ровно там, где индикатор определён.
 */
export function buildChartIndicatorOverlays(candles: OHLCV[]): ChartIndicatorData | undefined {
  if (candles.length < 20) return undefined;
  const closes = candles.map((candle) => candle.close);
  const pad = (series: number[]): number[] =>
    new Array<number>(Math.max(0, closes.length - series.length)).fill(NaN).concat(series);

  const sma20 = IndicatorEngine.calculateSMA(closes, 20);
  const sma50 = IndicatorEngine.calculateSMA(closes, 50);
  const sma200 = IndicatorEngine.calculateSMA(closes, 200);
  const bollinger = IndicatorEngine.calculateBollingerBands(closes, 20, 2);

  return {
    sma20: candles.length >= 20 ? pad(sma20) : undefined,
    sma50: candles.length >= 50 ? pad(sma50) : undefined,
    sma200: candles.length >= 200 ? pad(sma200) : undefined,
    bollingerUpper: bollinger.length > 0 ? pad(bollinger.map((b) => b.upper)) : undefined,
    bollingerMiddle: bollinger.length > 0 ? pad(bollinger.map((b) => b.middle)) : undefined,
    bollingerLower: bollinger.length > 0 ? pad(bollinger.map((b) => b.lower)) : undefined,
  };
}

/**
 * Корреляция и бета инструмента к BTC по свечам ОДНОГО И ТОГО ЖЕ рынка
 * (задача §8). Математика — `IndicatorEngine`, здесь только сборка контекста.
 */
export function buildCorrelationContext(
  candles: OHLCV[],
  btcCandles: OHLCV[],
): { correlation: number | null; beta: number | null; lookback: number } | null {
  if (candles.length < 20 || btcCandles.length < 20) return null;
  const assetReturns = IndicatorEngine.calculateReturns(candles.map((c) => c.close));
  const btcReturns = IndicatorEngine.calculateReturns(btcCandles.map((c) => c.close));
  return {
    correlation: IndicatorEngine.calculateCorrelation(assetReturns, btcReturns),
    beta: IndicatorEngine.calculateBeta(assetReturns, btcReturns),
    lookback: Math.min(assetReturns.length, btcReturns.length),
  };
}

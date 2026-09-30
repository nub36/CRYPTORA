/**
 * CRYPTORA — Strategy Lab · индикаторы (RESEARCH ONLY, полная точность)
 * ---------------------------------------------------------------------------
 * Собственные детерминированные реализации EMA/ATR для Lab. Специально НЕ
 * переиспользуется production `IndicatorEngine.calculateATR`: он округляет
 * результат `Number(x.toFixed(4))`, что уничтожает точность low-price активов
 * (PEPE-подобные, например 0.00000123 → 0.0000). §18 требует не округлять
 * стратегические значения до display-precision до завершения расчётов, поэтому
 * Lab считает индикаторы сам, БЕЗ модификации production-файла.
 *
 * Все функции возвращают массив, ВЫРОВНЕННЫЙ по индексу входа: значение под
 * индексом i соответствует бару i, во время прогрева стоит `null`. Так фронтенд
 * отдаёт серии в существующий CandleChart без сдвигов.
 *
 * No look-ahead: значение под индексом i зависит только от баров ≤ i.
 */

/** EMA по массиву цен. result[i] использует только prices[0..i]. */
export function emaAligned(prices: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(prices.length).fill(null);
  if (period <= 0 || prices.length < period) return out;

  const k = 2 / (period + 1);
  // Инициализация первой точки простым средним первых `period` значений —
  // та же схема, что в production IndicatorEngine.calculateEMA (без округления).
  let sum = 0;
  for (let i = 0; i < period; i++) sum += prices[i];
  let prev = sum / period;
  out[period - 1] = prev;

  for (let i = period; i < prices.length; i++) {
    prev = prices[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/**
 * ATR (Wilder) БЕЗ округления. result[i] использует только бары ≤ i.
 *
 * TR[i] = max(high-low, |high-prevClose|, |low-prevClose|); TR[0] = high-low.
 * Первый ATR — среднее TR[0..period-1], затем сглаживание Уайлдера.
 */
export function atrAligned(
  candles: ReadonlyArray<{ high: number; low: number; close: number }>,
  period: number
): (number | null)[] {
  const n = candles.length;
  const out: (number | null)[] = new Array(n).fill(null);
  if (period <= 0 || n <= period) return out;

  const tr: number[] = new Array(n);
  tr[0] = candles[0].high - candles[0].low;
  for (let i = 1; i < n; i++) {
    const prevClose = candles[i - 1].close;
    tr[i] = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - prevClose),
      Math.abs(candles[i].low - prevClose)
    );
  }

  let sum = 0;
  for (let i = 0; i < period; i++) sum += tr[i];
  let prev = sum / period;
  // Первый ATR соответствует бару с индексом period-1.
  out[period - 1] = prev;
  for (let i = period; i < n; i++) {
    prev = (prev * (period - 1) + tr[i]) / period;
    out[i] = prev;
  }
  return out;
}

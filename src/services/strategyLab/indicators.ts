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

/** Wilder RSI по источнику цен. Значения выровнены по свечам; прогрев null. */
export function rsiAligned(prices: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(prices.length).fill(null);
  if (period <= 0 || prices.length <= period) return out;
  let gain = 0; let loss = 0;
  for (let i = 1; i <= period; i += 1) { const change = prices[i] - prices[i - 1]; if (change > 0) gain += change; else loss -= change; }
  let avgGain = gain / period; let avgLoss = loss / period;
  const value = () => avgLoss === 0 ? (avgGain === 0 ? 50 : 100) : avgGain === 0 ? 0 : 100 - 100 / (1 + avgGain / avgLoss);
  out[period] = value();
  for (let i = period + 1; i < prices.length; i += 1) { const change = prices[i] - prices[i - 1]; avgGain = (avgGain * (period - 1) + Math.max(change, 0)) / period; avgLoss = (avgLoss * (period - 1) + Math.max(-change, 0)) / period; out[i] = value(); }
  return out;
}

export interface ConfirmedFractalEvent { kind: 'HIGH' | 'LOW'; sourceIndex: number; sourceCandleTime: number; confirmationIndex: number; knownAt: number; price: number; }

/** Williams 5-bar fractals. Events are exposed only at confirmation index i+2. */
export function confirmedFractals(candles: ReadonlyArray<{ high: number; low: number; time: number; closeTime: number }>): ConfirmedFractalEvent[] {
  const events: ConfirmedFractalEvent[] = [];
  for (let i = 2; i < candles.length - 2; i += 1) {
    const c = candles[i];
    if (c.high > candles[i - 1].high && c.high > candles[i - 2].high && c.high > candles[i + 1].high && c.high > candles[i + 2].high) events.push({ kind: 'HIGH', sourceIndex: i, sourceCandleTime: c.time, confirmationIndex: i + 2, knownAt: candles[i + 2].closeTime, price: c.high });
    if (c.low < candles[i - 1].low && c.low < candles[i - 2].low && c.low < candles[i + 1].low && c.low < candles[i + 2].low) events.push({ kind: 'LOW', sourceIndex: i, sourceCandleTime: c.time, confirmationIndex: i + 2, knownAt: candles[i + 2].closeTime, price: c.low });
  }
  return events;
}

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

/**
 * Проверки корректности рыночных данных.
 *
 * Задача — не дать «мусору» биржи превратиться в сигнал и не выдавать старое за
 * свежее. Проверки строгие и явные: любое нарушение возвращается как код
 * проблемы, а не проглатывается.
 *
 * Здесь НЕТ торговой математики: только валидация формы и целостности свечей.
 */
import type { ArchiveCandle } from './strategy/types';

export type DataIssueCode =
  | 'EMPTY_SERIES'
  | 'NOT_AN_ARRAY'
  | 'BAD_ROW_SHAPE'
  | 'NON_FINITE'
  | 'NON_POSITIVE_PRICE'
  | 'NEGATIVE_VOLUME'
  | 'OHLC_INCONSISTENT'
  | 'NON_MONOTONIC_TIME'
  | 'DUPLICATE_TIME'
  | 'UNEXPECTED_INTERVAL'
  | 'TOO_FEW_BARS'
  | 'SERIES_TOO_OLD';

export interface DataIssue {
  code: DataIssueCode;
  message: string;
  /** Индекс элемента, если проблема локализуема. */
  index?: number;
}

export interface ValidateOptions {
  /** Ожидаемый шаг между openTime, мс. */
  intervalMs?: number;
  /** Минимальное число баров. */
  minBars?: number;
  /** Максимальный возраст последнего бара относительно nowMs, мс. */
  maxAgeMs?: number;
  nowMs?: number;
}

/** Валидация серии ArchiveCandle (уже нормализованной). */
export function validateCandleSeries(
  candles: readonly ArchiveCandle[] | null | undefined,
  opts: ValidateOptions = {},
): DataIssue[] {
  if (!Array.isArray(candles)) return [{ code: 'NOT_AN_ARRAY', message: 'серия свечей не является массивом' }];
  if (candles.length === 0) return [{ code: 'EMPTY_SERIES', message: 'серия свечей пуста' }];
  const issues: DataIssue[] = [];

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]!;
    const values = [c.open, c.high, c.low, c.close, c.volume, c.openTime, c.closeTime];
    if (values.some((v) => !Number.isFinite(v))) {
      issues.push({ code: 'NON_FINITE', message: 'нечисловое значение в свече', index: i });
      continue;
    }
    if (!(c.open > 0 && c.high > 0 && c.low > 0 && c.close > 0)) {
      issues.push({ code: 'NON_POSITIVE_PRICE', message: 'неположительная цена', index: i });
    }
    if (c.volume < 0) {
      issues.push({ code: 'NEGATIVE_VOLUME', message: 'отрицательный объём', index: i });
    }
    const maxOc = Math.max(c.open, c.close);
    const minOc = Math.min(c.open, c.close);
    if (!(c.high >= maxOc && c.low <= minOc && c.high >= c.low)) {
      issues.push({ code: 'OHLC_INCONSISTENT', message: 'нарушен порядок OHLC (high/low)', index: i });
    }
    if (i > 0) {
      const prev = candles[i - 1]!;
      if (c.openTime < prev.openTime) {
        issues.push({ code: 'NON_MONOTONIC_TIME', message: 'время свечей не возрастает', index: i });
      } else if (c.openTime === prev.openTime) {
        issues.push({ code: 'DUPLICATE_TIME', message: 'дубликат openTime', index: i });
      } else if (opts.intervalMs && c.openTime - prev.openTime !== opts.intervalMs) {
        issues.push({
          code: 'UNEXPECTED_INTERVAL',
          message: `шаг между барами ${c.openTime - prev.openTime} мс вместо ${opts.intervalMs} мс`,
          index: i,
        });
      }
    }
  }

  if (opts.minBars && candles.length < opts.minBars) {
    issues.push({
      code: 'TOO_FEW_BARS',
      message: `баров ${candles.length}, требуется не меньше ${opts.minBars}`,
    });
  }
  if (opts.maxAgeMs && opts.nowMs) {
    const last = candles[candles.length - 1]!;
    const age = opts.nowMs - last.closeTime;
    if (age > opts.maxAgeMs) {
      issues.push({
        code: 'SERIES_TOO_OLD',
        message: `последний бар старше ${Math.round(opts.maxAgeMs / 60000)} мин (возраст ${Math.round(age / 60000)} мин)`,
      });
    }
  }
  return issues;
}

/**
 * Валидация сырой строки Binance /api/v3/klines.
 *
 * Формат (12+ полей): openTime, open, high, low, close, volume, closeTime,
 * quoteVolume, trades, takerBuyBase, takerBuyQuote, ignore.
 */
export function validateKlinesRow(row: unknown): DataIssue[] {
  if (!Array.isArray(row)) return [{ code: 'BAD_ROW_SHAPE', message: 'строка klines не является массивом' }];
  if (row.length < 6) return [{ code: 'BAD_ROW_SHAPE', message: `в строке klines ${row.length} полей < 6` }];
  const issues: DataIssue[] = [];
  const nums = [0, 1, 2, 3, 4, 5].map((i) => Number(row[i]));
  if (nums.some((n) => !Number.isFinite(n))) {
    issues.push({ code: 'NON_FINITE', message: 'нечисловое поле в строке klines' });
    return issues;
  }
  const [openTime, open, high, low, close, volume] = nums as [number, number, number, number, number, number, number];
  if (!(open > 0 && high > 0 && low > 0 && close > 0)) {
    issues.push({ code: 'NON_POSITIVE_PRICE', message: 'неположительная цена в строке klines' });
  }
  if (volume < 0) issues.push({ code: 'NEGATIVE_VOLUME', message: 'отрицательный объём в строке klines' });
  if (!(high >= Math.max(open, close) && low <= Math.min(open, close) && high >= low)) {
    issues.push({ code: 'OHLC_INCONSISTENT', message: 'нарушен порядок OHLC в строке klines' });
  }
  if (!(openTime > 0)) issues.push({ code: 'NON_FINITE', message: 'некорректный openTime' });
  return issues;
}

/** Человекочитаемая сводка проблем (для статуса API и логов). */
export function describeIssues(issues: readonly DataIssue[], limit = 3): string {
  if (issues.length === 0) return '';
  return issues.slice(0, limit).map((i) => `${i.code}: ${i.message}`).join('; ')
    + (issues.length > limit ? ` (+ ещё ${issues.length - limit})` : '');
}

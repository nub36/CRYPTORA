import { describe, expect, it } from 'vitest';
import { formatChartPriceLabel } from '@/components/common/CandleChart';

/**
 * Формат ПОДПИСЕЙ оси цены графика.
 *
 * Контракт задачи: компактный режим включается только на узком экране, меняет
 * исключительно текст метки и НЕ меняет исходные рыночные значения, свечи,
 * расчёты и precision источника. Поэтому тест проверяет две вещи:
 *  1) desktop-формат (PR #32) байт-в-байт не изменился;
 *  2) компактный формат — это то же самое число, просто без заведомо лишних
 *     нулей (и с единицами для величин >= 1e6, которые на практике встречаются
 *     только в метке последнего ОБЪЁМА).
 */
describe('formatChartPriceLabel — desktop (PR #32) format is unchanged', () => {
  it('keeps thousands grouping and two decimals from 1000', () => {
    expect(formatChartPriceLabel(3450.6)).toBe('3,450.60');
    expect(formatChartPriceLabel(110_250)).toBe('110,250.00');
    expect(formatChartPriceLabel(11_320_428)).toBe('11,320,428.00');
  });

  it('keeps 4 decimals from 1 and 6 decimals below 1', () => {
    expect(formatChartPriceLabel(1)).toBe('1.0000');
    expect(formatChartPriceLabel(12.5)).toBe('12.5000');
    expect(formatChartPriceLabel(0.12)).toBe('0.120000');
    expect(formatChartPriceLabel(0.09453)).toBe('0.094530');
  });

  it('is the default: an explicit `false` and an omitted flag agree', () => {
    for (const value of [0.1, 0.09453, 12.5, 3450.6, 11_320_428]) {
      expect(formatChartPriceLabel(value, false)).toBe(formatChartPriceLabel(value));
    }
  });
});

describe('formatChartPriceLabel — compact mobile labels', () => {
  it('only removes trailing zeros; the numeric value is identical', () => {
    const cases: Array<[number, string]> = [
      [0.12, '0.12'],
      [0.1, '0.1'],
      [0.09453, '0.09453'],
      [0.000123, '0.000123'],
      [1, '1'],
      [12.5, '12.5'],
      [3450.6, '3,450.6'],
      [3450.65, '3,450.65'],
    ];
    for (const [value, expected] of cases) {
      const compact = formatChartPriceLabel(value, true);
      expect(compact).toBe(expected);
      // Честность: компактная подпись парсится в ТО ЖЕ число, что и полная.
      expect(Number(compact.replace(/,/g, ''))).toBe(Number(formatChartPriceLabel(value).replace(/,/g, '')));
    }
  });

  it('never invents precision the desktop format did not have', () => {
    for (const value of [0.123456789, 0.0000001234, 7.123456, 1234.56789]) {
      const full = formatChartPriceLabel(value);
      const compact = formatChartPriceLabel(value, true);
      // Компактная строка — подстрока-«обрезка» хвостовых нулей полной формы.
      expect(full.startsWith(compact) || full.replace(/0+$/, '') === compact).toBe(true);
    }
  });

  it('shortens the >= 1e6 labels (in practice the last-volume label) with explicit units', () => {
    expect(formatChartPriceLabel(11_320_428, true)).toBe('11.32M');
    expect(formatChartPriceLabel(6_233_220, true)).toBe('6.23M');
    expect(formatChartPriceLabel(1_000_000, true)).toBe('1M');
    expect(formatChartPriceLabel(250_000_000, true)).toBe('250M');
    expect(formatChartPriceLabel(4_120_000_000, true)).toBe('4.12B');
    expect(formatChartPriceLabel(2_500_000_000_000, true)).toBe('2.5T');
  });

  it('leaves realistic instrument prices in full precision even in compact mode', () => {
    // Ни один инструмент терминала не стоит >= 1e6 USDT, поэтому компактные
    // единицы не могут «съесть» цену: BTC печатается полностью.
    expect(formatChartPriceLabel(110_250.4, true)).toBe('110,250.4');
    expect(formatChartPriceLabel(999_999.99, true)).toBe('999,999.99');
  });

  it('returns an empty label instead of NaN/Infinity text', () => {
    expect(formatChartPriceLabel(Number.NaN, true)).toBe('');
    expect(formatChartPriceLabel(Number.POSITIVE_INFINITY)).toBe('');
  });
});

import { describe, expect, it } from 'vitest';
import {
  formatInstrumentPrice,
  instrumentPriceDecimals,
  priceDecimalsFromTickSize,
} from '@/utils/formatters';
import { formatChartPriceLabel } from '@/components/common/CandleChart';

/**
 * ТОЧНОСТЬ ЦЕНЫ НИЗКОСТОИМОСТНЫХ ИНСТРУМЕНТОВ (задача §14).
 *
 * Скриншот владельца: MEW USD-M стоит 0.000478, а карточки страницы
 * показывали «$0.0005» — `formatCurrency` режет всё в диапазоне 0.0001…1 до
 * четырёх знаков. Для фьючерса это не косметика: 0.0005 ≠ 0.000478 (ошибка
 * ~4.6%), по такой цене нельзя считать ни базис, ни спред.
 *
 * Контракт канонического форматтера:
 *   • точность берётся из tickSize биржи, если он известен;
 *   • иначе — по значащим цифрам (не менее 5), максимум 8 знаков (предел Binance);
 *   • никакой научной нотации и никаких «хвостовых» нулей сверх нужного;
 *   • значения >= 1 по-прежнему печатаются с двумя знаками.
 */
describe('formatInstrumentPrice — низкая цена не округляется в ноль', () => {
  it('печатает цену MEW как на бирже', () => {
    expect(formatInstrumentPrice(0.000478)).toBe('$0.000478');
    expect(formatInstrumentPrice(0.00047812)).toBe('$0.00047812');
    expect(formatInstrumentPrice(0.0000012345)).toBe('$0.00000123');
  });

  it('не использует научную нотацию даже на очень малых значениях', () => {
    for (const value of [0.000478, 0.0000001, 0.00000005, 1e-8]) {
      expect(formatInstrumentPrice(value)).not.toMatch(/e[-+]/i);
    }
  });

  it('не оставляет лишних хвостовых нулей', () => {
    expect(formatInstrumentPrice(0.00047800)).toBe('$0.000478');
    expect(formatInstrumentPrice(0.5)).toBe('$0.5');
    expect(formatInstrumentPrice(0.25)).toBe('$0.25');
  });

  it('сохраняет привычный вид «крупных» цен', () => {
    expect(formatInstrumentPrice(68412.5)).toBe('$68,412.50');
    expect(formatInstrumentPrice(3450.6)).toBe('$3,450.60');
    expect(formatInstrumentPrice(12)).toBe('$12.00');
    expect(formatInstrumentPrice(0)).toBe('$0.00');
  });

  it('уважает знак и отсутствие значения', () => {
    expect(formatInstrumentPrice(-0.000478)).toBe('-$0.000478');
    expect(formatInstrumentPrice(null)).toBe('$—');
    expect(formatInstrumentPrice(Number.NaN)).toBe('$—');
    expect(formatInstrumentPrice(0.000478, { withSymbol: false })).toBe('0.000478');
  });

  it('берёт точность из tickSize биржи, когда он известен', () => {
    expect(priceDecimalsFromTickSize('0.00001000')).toBe(5);
    expect(priceDecimalsFromTickSize('0.010')).toBe(2);
    expect(priceDecimalsFromTickSize(0.1)).toBe(1);
    expect(priceDecimalsFromTickSize('0')).toBeNull();
    expect(priceDecimalsFromTickSize(undefined)).toBeNull();

    // tickSize=0.00001 → ровно 5 знаков, без «додумывания» шестого.
    expect(formatInstrumentPrice(0.0004784, { tickSize: '0.00001000' })).toBe('$0.00048');
    expect(instrumentPriceDecimals(0.0004784, { tickSize: '0.00001000' })).toBe(5);
  });
});

describe('formatChartPriceLabel — подпись правой шкалы у дешёвых контрактов', () => {
  it('печатает цену MEW без лишних нулей и без округления до нуля', () => {
    expect(formatChartPriceLabel(0.000478)).toBe('0.000478');
    expect(formatChartPriceLabel(0.000478, true)).toBe('0.000478');
  });

  it('расширяет точность там, где шести знаков не хватает на значащие цифры', () => {
    expect(formatChartPriceLabel(0.0000012345)).toBe('0.00000123');
    expect(formatChartPriceLabel(0.0000012345, true)).toBe('0.00000123');
    // Прежний контракт PR #32 для «обычных» значений не изменился.
    expect(formatChartPriceLabel(0.12)).toBe('0.120000');
    expect(formatChartPriceLabel(0.09453)).toBe('0.094530');
  });
});

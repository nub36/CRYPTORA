import {
  activeStopLabel, exitReasonLabel, formatBytes, formatPrice, formatSignedR, formatUtc,
  formatPct, signalState, statusLabel,
} from '../src/format';
import { makeSignal } from './support/fixtures';

// ru-RU в ICU использует неразрывный пробел как разделитель разрядов —
// сравниваем после нормализации, а не «подгоняем» формат под тест.
const norm = (s: string) => s.replace(/[\u00A0\u202F]/g, ' ');

describe('format', () => {
  it('показывает цену с точностью по масштабу, без потери значимых знаков', () => {
    expect(norm(formatPrice(63980.09))).toBe('63 980,09');
    expect(formatPrice(0.00012345)).toBe('0,00012345');
    expect(formatPrice(null)).toBe('—');
    expect(formatPrice(undefined)).toBe('—');
    expect(formatPrice(Number.NaN)).toBe('—');
  });

  it('время выводится в UTC, независимо от часового пояса устройства', () => {
    expect(formatUtc('2026-10-05T11:02:00.000Z')).toBe('05.10.2026 11:02 UTC');
    expect(formatUtc(null)).toBe('—');
    expect(formatUtc('не дата')).toBe('—');
  });

  it('R и проценты подписываются, а не «додумываются»', () => {
    expect(formatSignedR(1.234)).toBe('+1.23 R');
    expect(formatSignedR(-0.5)).toBe('-0.5 R');
    expect(formatSignedR(null)).toBe('—');
    expect(formatPct(2.3456)).toBe('+2.35 %');
    expect(formatPct(-1)).toBe('-1 %');
  });

  it('статусы и причины выхода переводятся, неизвестные — как есть', () => {
    expect(statusLabel('FILLED')).toBe('В позиции');
    expect(statusLabel('WEIRD')).toBe('WEIRD');
    expect(exitReasonLabel('TP1_THEN_BE')).toBe('TP1 → безубыток');
    expect(exitReasonLabel(null)).toBeNull();
    expect(exitReasonLabel('SOMETHING_NEW')).toBe('SOMETHING_NEW');
  });

  it('состояние сигнала выводится из статуса, а не из цены', () => {
    expect(signalState({ status: 'ACTIVE' })).toBe('waitingEntry');
    expect(signalState({ status: 'FILLED' })).toBe('inPosition');
    expect(signalState({ status: 'TARGET_REACHED' })).toBe('closed');
  });

  it('действующий стоп показывается только когда сервер его подтвердил', () => {
    const withoutStop = makeSignal({ progress: { ...makeSignal().progress, currentStop: null } });
    expect(norm(activeStopLabel(withoutStop))).toBe('60 901,53 (первоначальный)');

    const be = makeSignal({
      progress: { ...makeSignal().progress, currentStop: 61300.17, currentStopBasis: 'BE_AT_ENTRY', breakevenArmed: true, breakevenArmedAt: '2026-10-05T13:00:00.000Z', tp1Hit: true, tp1HitAt: '2026-10-05T12:30:00.000Z' },
    });
    expect(norm(activeStopLabel(be))).toBe('61 300,17 (безубыток)');

    // Стоп не подтверждён и позиции нет — прочерк, а не цена входа.
    const active = makeSignal({ status: 'ACTIVE', initialStopLoss: 60901.53, entry: null });
    expect(activeStopLabel(active)).toBe('—');
  });

  it('размер показывается только для положительного числа', () => {
    expect(formatBytes(0)).toBe('—');
    expect(formatBytes(null)).toBe('—');
    expect(formatBytes(1536)).toBe('1.5 КБ');
  });
});

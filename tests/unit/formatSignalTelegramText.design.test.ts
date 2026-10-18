import { describe, expect, it } from 'vitest';
import { formatSignalTelegramText, SIGNAL_TELEGRAM_DISCLAIMER } from '../../server/services/notificationChannels.js';

const base = {
  symbol: 'BTC/USDT', strategyId: 'V3_4_HTF_ZONE_MITIGATION_QUALITY', strategyVersion: '3.4',
  direction: 'LONG', entryMin: '60123.12345678', entryMax: '60124.00000001', stopLoss: '59000.00000009',
  targets: ['62000.12345678', '64000.98765432'], status: 'ACTIVE', createdAt: '2026-10-01T12:34:00Z',
};

describe('formatSignalTelegramText HTML design', () => {
  it.each([
    ['NEW_SIGNAL', '🟢 Новый сигнал'], ['FILL', '✅ Вход в сделку'],
    ['TP1', '🎯 Первая цель достигнута'], ['BREAKEVEN', '🛡️ Безубыток'],
    ['TP2', '🏆 Вторая цель достигнута'], ['STOP_LOSS', '🔴 Stop Loss'],
    ['CANCELLED', '⚪ Сигнал отменён'], ['CLOSED', '🏁 Сделка закрыта'],
  ])('formats %s with its specified title', (event, title) => {
    expect(formatSignalTelegramText(base, event)).toContain(`<b>${title}</b>`);
  });

  it('maps the named strategy and preserves exact decimal strings', () => {
    const text = formatSignalTelegramText(base, 'NEW_SIGNAL');
    expect(text).toContain('V3.4 · HTF Zone');
    expect(text).toContain('<b>Вход:</b> <code>60123.12345678 – 60124.00000001</code>');
    expect(text).toContain('<b>SL:</b> <code>59000.00000009</code>');
    expect(text).toContain('<b>TP1:</b> <code>62000.12345678</code>');
    expect(text).toContain('<b>TP2:</b> <code>64000.98765432</code>');
  });

  it('keeps every available digit for number and string prices in rendered HTML', () => {
    const text = formatSignalTelegramText({
      symbol: 'BTC/USDT', entryMin: 0.000012345678, entryMax: 0.000012345678,
      stopLoss: 4.9835, targets: ['4.983500', 1.2345678e-8],
    }, 'NEW_SIGNAL');
    expect(text).toContain('<b>Вход:</b> <code>0.000012345678</code>');
    expect(text).toContain('<b>SL:</b> <code>4.9835</code>');
    expect(text).toContain('<b>TP1:</b> <code>4.983500</code>');
    expect(text).toContain('<b>TP2:</b> <code>0.000000012345678</code>');
  });

  it('omits null, undefined, NaN and infinities instead of emitting fake prices', () => {
    const text = formatSignalTelegramText({
      symbol: 'ETH/USDT', entryMin: null, entryMax: undefined,
      stopLoss: Number.NaN, targets: [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY],
    }, 'NEW_SIGNAL');
    expect(text).not.toContain('NaN');
    expect(text).not.toContain('Infinity');
    expect(text).not.toContain('<b>Вход:</b>');
    expect(text).not.toContain('<b>SL:</b>');
    expect(text).not.toContain('<b>TP1:</b>');
    expect(text).not.toContain('<b>TP2:</b>');
  });

  it('escapes dynamic HTML and has a readable unknown strategy fallback', () => {
    const text = formatSignalTelegramText({ ...base, symbol: '<BTC & "USDT">', strategyId: 'FUTURE_STRATEGY_V9' }, 'NEW_SIGNAL');
    expect(text).toContain('&lt;BTC &amp; &quot;USDT&quot;&gt;');
    expect(text).toContain('FUTURE STRATEGY V9');
    expect(text).not.toContain('<BTC');
  });

  it('includes disclaimer and event timestamp, omits unsupported price/status facts', () => {
    const text = formatSignalTelegramText({ symbol: 'ETH/USDT', createdAt: '2026-10-01T12:34:00Z' }, 'NEW_SIGNAL');
    expect(text).toContain(SIGNAL_TELEGRAM_DISCLAIMER);
    expect(text).toContain('Время');
    expect(text).not.toContain('Entry:');
    expect(text).not.toContain('SL:');
    expect(text).not.toContain('TP1:');
    expect(text).not.toContain('Статус:');
    expect(text).not.toContain('NaN');
  });
});

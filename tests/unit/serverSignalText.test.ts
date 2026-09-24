/**
 * serverSignalText — человеческие формулировки серверных сигналов.
 * Проверяет словарь (§5), честность статусов (§10) и запрет выдуманных данных.
 */

import { describe, it, expect } from 'vitest';
import {
  directionText,
  directionHint,
  entryZoneText,
  formatSignalPrice,
  isKnownServerStatus,
  serverStatusHint,
  serverStatusLabel,
  serverStatusTone,
  statusHasTrade,
  stopSign,
  targetLabel,
  targetShortLabel,
  timeframeMismatchNote,
  timeframeText,
} from '@/utils/serverSignalText';

describe('направление и стоп', () => {
  it('LONG/SHORT словами и пояснением', () => {
    expect(directionText('LONG')).toBe('LONG');
    expect(directionText('SHORT')).toBe('SHORT');
    expect(directionHint('LONG')).toContain('рост');
    expect(directionHint('SHORT')).toContain('снижение');
  });

  it('знак стопа зависит от направления, не захардкожен', () => {
    expect(stopSign('LONG')).toBe('<');
    expect(stopSign('SHORT')).toBe('>');
  });
});

describe('зона входа', () => {
  it('две цены → коридор, одна → точка', () => {
    expect(entryZoneText(100, 102, 'LIMIT_CORRIDOR')).toContain('–');
    expect(entryZoneText(100, 100, 'LIMIT_CORRIDOR')).not.toContain('–');
    expect(entryZoneText(100, 102, 'MARKET_NEXT_OPEN')).toContain('открытию следующего бара');
    expect(entryZoneText(null, null, null)).toBe('—');
  });
});

describe('таймфреймы', () => {
  it('рассогласование графика и сигнала сообщается честно', () => {
    expect(timeframeMismatchNote('1h', '15m')).toContain('График открыт в 15m');
    expect(timeframeMismatchNote('1h', '1h')).toBeNull();
    // регистронезависимо: сервер '1d' и графический тип '1D'
    expect(timeframeMismatchNote('1d', '1D')).toBeNull();
    expect(timeframeMismatchNote(null, '1h')).toBeNull();
  });

  it('timeframeText возвращает значение сервера или прочерк', () => {
    expect(timeframeText('1h')).toBe('1h');
    expect(timeframeText('')).toBe('—');
    expect(timeframeText(undefined)).toBe('—');
  });
});

describe('статусы (§10 — не лгать пользователю)', () => {
  it('известный домен отображается человеком', () => {
    expect(serverStatusLabel('ACTIVE')).toBe('ОЖИДАЕТ ВХОДА');
    expect(serverStatusTone('TARGET_REACHED')).toBe('green');
    expect(serverStatusTone('INVALIDATED')).toBe('red');
    expect(isKnownServerStatus('FILLED')).toBe(true);
    expect(serverStatusHint('FILLED')).toContain('закрытым свечам');
  });

  it('неизвестный статус не подменяется нейтральным словом', () => {
    expect(isKnownServerStatus('WAT')).toBe(false);
    expect(serverStatusLabel('WAT')).toContain('неизвестное состояние');
    expect(serverStatusTone('WAT')).toBe('neutral');
  });

  it('сделка есть только у терминальных состояний с исходом', () => {
    expect(statusHasTrade('TARGET_REACHED')).toBe(true);
    expect(statusHasTrade('INVALIDATED')).toBe(true);
    expect(statusHasTrade('CLOSED')).toBe(true);
    expect(statusHasTrade('ACTIVE')).toBe(false);
    expect(statusHasTrade('EXPIRED')).toBe(false);
  });
});

describe('форматирование цен и целей', () => {
  it('отсутствие данных — прочерк, не ноль', () => {
    expect(formatSignalPrice(null)).toBe('—');
    expect(formatSignalPrice(undefined)).toBe('—');
    expect(formatSignalPrice(Number.NaN)).toBe('—');
  });

  it('нумерация целей с 1, без «TP» в мобильном виде', () => {
    expect(targetLabel(0)).toBe('Цель 1');
    expect(targetLabel(2)).toBe('Цель 3');
    expect(targetShortLabel(1)).toBe('Ц2');
  });
});

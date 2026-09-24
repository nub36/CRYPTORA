/**
 * CRYPTORA — BUG C: статус сканирования обязан быть честным.
 *
 * СИМПТОМ НА ПРОДЕ. Плашка на `/signals` читала состояние БРАУЗЕРНОГО движка
 * (`LiveSignalEngine.getStatus()`) и рисовала «LIVE-скан · каждые 60с» даже
 * когда все три стратегии в PostgreSQL выключены (`enabled = false`,
 * `status = 'OFF'`). Пользователь видел «система ищет сигналы», хотя сервер не
 * сканировал ничего.
 *
 * ПОЧЕМУ ЭТО БЫЛО ЛОЖЬЮ. Браузерный движок — это UI-компонент: он «работает»,
 * пока открыта вкладка, независимо от того, сканирует ли сервер. Статус
 * сканирования — состояние сервера, и только сервер может его сообщить.
 *
 * Тест проверяет чистую функцию «состояние сервера → что показать»: именно она
 * гарантирует, что выключенный сканер никогда не назван LIVE.
 */

import { describe, expect, it, vi, afterEach } from 'vitest';
import { render } from '@testing-library/react';

import { describeScannerStatus, plural, ScannerStatusChip } from '@/components/signals/ScannerStatusChip';
import type { ServerScannerState } from '@/hooks/useServerScanner';

const qa = (id: string) => document.querySelector(`[data-qa="${id}"]`);

function state(overrides: Partial<ServerScannerState> = {}): ServerScannerState {
  return {
    phase: 'ready',
    strategies: [],
    enabledCount: 0,
    errorCount: 0,
    scanIntervalSeconds: null,
    lastScanAt: null,
    lastError: null,
    error: null,
    monitor: null,
    requestCount: 1,
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('describeScannerStatus — выключенный сканер не называется LIVE', () => {
  it('0 включённых стратегий ⇒ «Сканирование сигналов выключено»', () => {
    const view = describeScannerStatus(state({ enabledCount: 0 }));
    expect(view.tone).toBe('off');
    expect(view.title).toBe('Сканирование сигналов выключено');
    expect(view.title.toUpperCase()).not.toContain('LIVE');
  });

  it('N включённых стратегий ⇒ фактический статус с интервалом', () => {
    const view = describeScannerStatus(
      state({ enabledCount: 2, scanIntervalSeconds: 60, lastScanAt: '2026-09-24T08:00:00.000Z' })
    );
    expect(view.tone).toBe('on');
    expect(view.title).toBe('Сканирование включено: 2 стратегии');
    expect(view.detail).toContain('каждые 60 с');
    expect(view.detail).toContain('последний скан');
  });

  it('одна стратегия склоняется правильно', () => {
    const view = describeScannerStatus(state({ enabledCount: 1, scanIntervalSeconds: 15 }));
    expect(view.title).toBe('Сканирование включено: 1 стратегия');
  });

  it('ошибка стратегии показывается отдельно от «LIVE»', () => {
    const view = describeScannerStatus(
      state({ enabledCount: 1, errorCount: 1, lastError: 'scan failed: rate limit' })
    );
    expect(view.tone).toBe('error');
    expect(view.title).toContain('с ошибкой');
    expect(view.detail).toBe('scan failed: rate limit');
    expect(view.title.toUpperCase()).not.toContain('LIVE');
  });

  it('включённая стратегия в ERROR не попадает в «включено» и не зовётся выключенной', () => {
    // `deriveStatus` на сервере: enabled=true + lastError ⇒ status='ERROR'.
    // Счётчик «включённых» обязан её видеть, иначе плашка соврёт «выключено».
    const view = describeScannerStatus(
      state({ enabledCount: 1, errorCount: 1, lastError: 'scan failed: exchangeInfo' })
    );
    expect(view.tone).toBe('error');
    expect(view.title).toContain('с ошибкой: 1');
    expect(view.title).not.toContain('выключено');
  });

  it('0 включённых, но есть ошибка сканирования — это неисправность, не «выключено»', () => {
    const view = describeScannerStatus(state({ enabledCount: 0, errorCount: 2 }));
    expect(view.tone).toBe('error');
    expect(view.title).toContain('Сканирование не работает');
    expect(view.title).not.toContain('выключено');
  });

  it('0 включённых и 0 ошибок — единственное «выключено» без упоминания ошибок', () => {
    const view = describeScannerStatus(state({ enabledCount: 0, errorCount: 0 }));
    expect(view.tone).toBe('off');
    expect(view.detail).not.toContain('ошибк');
  });

  it('недоступность запроса ≠ выключенный сканер', () => {
    const view = describeScannerStatus(
      state({ phase: 'error', error: { code: 'NETWORK', message: 'сервер не ответил' } })
    );
    expect(view.tone).toBe('unknown');
    expect(view.title).toBe('Статус сканирования недоступен');
    expect(view.detail).toBe('сервер не ответил');
    expect(view.title).not.toContain('выключено');
  });

  it('загрузка не утверждает ничего о сканировании', () => {
    const view = describeScannerStatus(state({ phase: 'loading' }));
    expect(view.tone).toBe('unknown');
    expect(view.title).not.toContain('LIVE');
    expect(view.title).not.toContain('выключено');
  });
});

describe('plural — русское склонение', () => {
  it('1 стратегия, 2 стратегии, 5 стратеги, 11 стратегий', () => {
    expect(plural(1, 'стратегия', 'стратегии', 'стратеги')).toBe('стратегия');
    expect(plural(2, 'стратегия', 'стратегии', 'стратеги')).toBe('стратегии');
    expect(plural(5, 'стратегия', 'стратегии', 'стратеги')).toBe('стратеги');
    expect(plural(11, 'стратегия', 'стратегии', 'стратеги')).toBe('стратеги');
    expect(plural(21, 'стратегия', 'стратегии', 'стратеги')).toBe('стратегия');
  });
});

describe('ScannerStatusChip — разметка', () => {
  it('выключенный сканер помечен data-state="off"', () => {
    render(<ScannerStatusChip state={state({ enabledCount: 0 })} />);
    const chip = qa('signals-scanner-status');
    expect(chip).not.toBeNull();
    expect(chip?.getAttribute('data-state')).toBe('off');
    expect(chip?.getAttribute('data-enabled-count')).toBe('0');
    expect(chip?.textContent).toContain('Сканирование сигналов выключено');
  });

  it('включённый сканер помечен data-state="on" и несёт фактический счётчик', () => {
    render(<ScannerStatusChip state={state({ enabledCount: 3, scanIntervalSeconds: 60 })} />);
    const chip = qa('signals-scanner-status');
    expect(chip?.getAttribute('data-state')).toBe('on');
    expect(chip?.getAttribute('data-enabled-count')).toBe('3');
  });

  it('на экране нет технической метки LIVE-скана', () => {
    render(<ScannerStatusChip state={state({ enabledCount: 0 })} />);
    expect(document.body.textContent).not.toContain('LIVE-скан');
  });
});

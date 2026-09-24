/**
 * useServerSignals — загрузка серверной ленты с защитой от гонок.
 *
 * Ключевой сценарий §17: быстрый переход BTC → SOL не должен показать сигналы
 * BTC, если ответ для BTC долетел после ответа для SOL. Отменённый запрос не
 * считается ошибкой источника.
 */

import { describe, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { SignalDto, SignalFilters, SignalsPageDto } from '@/services/strategyOps';
import { useServerSignals } from '@/hooks/useServerSignals';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makePage(symbol: string, count: number, total = count): SignalsPageDto {
  const signals: SignalDto[] = Array.from({ length: count }, (_, i) => ({
    id: `${symbol}-${i}`,
    strategyId: 'V3_0_HTF_LIQUIDATION_TRAP',
    strategyVersion: '3.0',
    engineSetupId: null,
    symbol,
    timeframe: '1h',
    direction: 'LONG',
    signalCandleTs: '2026-09-01T04:00:00.000Z',
    entryType: 'LIMIT_CORRIDOR',
    validForBars: null,
    exitRule: null,
    entryMin: 100,
    entryMax: 101,
    stopLoss: 99,
    targets: [102],
    tp1: 102,
    tp2: null,
    status: 'ACTIVE',
    createdAt: '2026-09-01T04:05:00.000Z',
    updatedAt: '2026-09-01T04:05:00.000Z',
    fillPrice: null,
    filledAt: null,
    fillStop: null,
    fillTargets: null,
    closedAt: null,
    closePrice: null,
    closeReason: null,
    resultR: null,
    netResultR: null,
    pnlResultPct: null,
    barsHeld: null,
    metadata: null,
    hash: 'h',
    previousHash: 'p',
    outcomeHash: null,
    chainVersion: 2,
  }));
  return {
    signals,
    count: signals.length,
    total,
    limit: 20,
    offset: 0,
    maxLimit: 200,
    ordering: 'created_at_desc',
    appliedFilters: { strategyId: null, status: null, open: null, symbol, direction: null },
    statuses: ['ACTIVE', 'FILLED', 'TARGET_REACHED', 'INVALIDATED', 'CLOSED', 'EXPIRED', 'CANCELLED', 'UNRESOLVED'],
    openStatuses: ['ACTIVE', 'FILLED'],
    source: 'server',
  };
}

describe('useServerSignals: гонки (§17)', () => {
  it('устаревший ответ не перезаписывает более поздний символ', async () => {
    const btc = deferred<SignalsPageDto>();
    const sol = deferred<SignalsPageDto>();
    const fetchPage = vi.fn((filters: SignalFilters) =>
      filters.symbol === 'SOL/USDT' ? sol.promise : btc.promise
    );

    const { result, rerender } = renderHook(
      (props: { symbol: string }) => useServerSignals({ symbol: props.symbol }, { fetchPage }),
      { initialProps: { symbol: 'BTC/USDT' } }
    );

    // BTC-запрос в полёте; резко переключаемся на SOL.
    rerender({ symbol: 'SOL/USDT' });
    await waitFor(() => expect(result.current.phase).toBe('loading'));

    // SOL отвечает первым.
    await act(async () => sol.resolve(makePage('SOL/USDT', 2)));
    await waitFor(() => expect(result.current.phase).toBe('ready'));
    expect(result.current.signals.every((s) => s.symbol === 'SOL/USDT')).toBe(true);

    // Запоздалый BTC-ответ обязан быть проигнорирован.
    await act(async () => btc.resolve(makePage('BTC/USDT', 5)));
    // Даём микрозадачам улечься.
    await act(async () => {});
    expect(result.current.signals.every((s) => s.symbol === 'SOL/USDT')).toBe(true);
    expect(result.current.signals).toHaveLength(2);
  });

  it('отмена запроса не считается ошибкой источника', async () => {
    const first = deferred<SignalsPageDto>();
    const second = deferred<SignalsPageDto>();
    let calls = 0;
    const fetchPage = vi.fn((_filters: SignalFilters, init?: RequestInit) => {
      calls += 1;
      const d = calls === 1 ? first : second;
      // Эмулируем настоящий fetch: прерывание по сигналу даёт AbortError.
      init?.signal?.addEventListener('abort', () => {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        d.reject(err);
      });
      return d.promise;
    });

    const { result, rerender } = renderHook(
      (props: { symbol: string }) => useServerSignals({ symbol: props.symbol }, { fetchPage }),
      { initialProps: { symbol: 'BTC/USDT' } }
    );

    rerender({ symbol: 'SOL/USDT' });
    // Первый запрос прерван (AbortError) — это не ошибка.
    await act(async () => second.resolve(makePage('SOL/USDT', 1)));
    await waitFor(() => expect(result.current.phase).toBe('ready'));
    expect(result.current.error).toBeNull();
  });
});

describe('useServerSignals: состояния', () => {
  it('ошибка источника → фаза error с кодом, лента не подставляется', async () => {
    const fetchPage = vi.fn(() => {
      const err = Object.assign(new Error('status must be one of'), { status: 400, code: 'INVALID_STATUS' });
      return Promise.reject(err);
    });
    const { result } = renderHook(() => useServerSignals({ symbol: 'BTC/USDT' }, { fetchPage }));
    await waitFor(() => expect(result.current.phase).toBe('error'));
    expect(result.current.error?.code).toBe('INVALID_STATUS');
    expect(result.current.error?.status).toBe(400);
    expect(result.current.signals).toHaveLength(0);
  });

  it('пустая лента — это готовое состояние с нулём сигналов, а не ошибка', async () => {
    const fetchPage = vi.fn(() => Promise.resolve(makePage('BTC/USDT', 0, 0)));
    const { result } = renderHook(() => useServerSignals({ symbol: 'BTC/USDT' }, { fetchPage }));
    await waitFor(() => expect(result.current.phase).toBe('ready'));
    expect(result.current.signals).toHaveLength(0);
    expect(result.current.total).toBe(0);
    expect(result.current.error).toBeNull();
  });

  it('loadMore догружает следующую страницу по offset', async () => {
    const page1 = makePage('BTC/USDT', 2, 5);
    const page2 = { ...makePage('BTC/USDT', 2, 5), offset: 2, signals: makePage('BTC/USDT', 2, 5).signals.map((s) => ({ ...s, id: `${s.id}-p2` })) };
    const fetchPage = vi.fn((filters: SignalFilters) =>
      Promise.resolve((filters.offset ?? 0) === 0 ? page1 : page2)
    );
    const { result } = renderHook(() => useServerSignals({ symbol: 'BTC/USDT', limit: 2 }, { fetchPage }));
    await waitFor(() => expect(result.current.phase).toBe('ready'));
    expect(result.current.signals).toHaveLength(2);
    expect(result.current.hasMore).toBe(true);

    await act(async () => result.current.loadMore());
    await waitFor(() => expect(result.current.signals).toHaveLength(4));
    expect(fetchPage).toHaveBeenCalledWith(expect.objectContaining({ offset: 2 }), expect.anything());
    expect(result.current.total).toBe(5);
  });
});

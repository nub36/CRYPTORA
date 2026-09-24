/**
 * useSignalChartCandles — свечи ТОЛЬКО выбранного инструмента и таймфрейма.
 *
 * Проверяет транспорт/выбор свечей на уровне хука с управляемым провайдером
 * (тот же приём, что в useServerSignals.test.tsx). Живые байты свечей здесь не
 * нужны: цель — доказать выбор символа, смену при переключении, защиту от
 * «протухшего» ответа (гонка) и отсутствие веера запросов (нет N×candles).
 *
 * Сценарии ревью #17 (шаг 4):
 *   • выбранный символ+таймфрейм → ровно один запрос с верными аргументами;
 *   • BTC → SOL действительно меняет свечи (не показывает BTC);
 *   • SOL → BTC возвращает BTC;
 *   • быстрый BTC → SOL → BTC: запоздалый ответ не побеждает (нет stale);
 *   • число запросов ограничено выбранными парами (нет веера по вселенной).
 */

import { describe, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { OHLCV, Timeframe } from '@/types/market';
import type { MarketDataProvider } from '@/services/data/MarketDataProvider';
import { useSignalChartCandles } from '@/hooks/useSignalChartCandles';

function candles(close: number, base = 1_790_000_000): OHLCV[] {
  return Array.from({ length: 5 }, (_, i) => ({
    time: base + i * 3600,
    open: close - 10,
    high: close + 10,
    low: close - 20,
    close,
    volume: 100 + i,
  }));
}

/** Отложенный промпт: разрешаем вручную, чтобы управлять порядком ответов. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface StubProvider {
  getCandles: ReturnType<typeof vi.fn>;
  /** Заглушить ответ для конкретного символа управляемым промптом. */
  pending: Map<string, ReturnType<typeof deferred<OHLCV[]>>>;
}

function makeStub(): StubProvider & MarketDataProvider {
  const pending = new Map<string, ReturnType<typeof deferred<OHLCV[]>>>();
  const getCandles = vi.fn((symbol: string, timeframe: Timeframe, _limit: number) => {
    const key = `${symbol}_${timeframe}`;
    if (!pending.has(key)) {
      const d = deferred<OHLCV[]>();
      pending.set(key, d);
      // Ответ по умолчанию — свечи с узнаваемой ценой символа.
      const price = symbol === 'BTC' ? 65_000 : symbol === 'SOL' ? 140 : 3_200;
      Promise.resolve().then(() => d.resolve(candles(price)));
    }
    return pending.get(key)!.promise;
  });
  return { getCandles, pending } as unknown as StubProvider & MarketDataProvider;
}

describe('useSignalChartCandles: выбранный символ, смена, гонки, нет веера', () => {
  it('загружает свечи ровно одним запросом для выбранного символа и таймфрейма', async () => {
    const provider = makeStub();
    const { result } = renderHook(() =>
      useSignalChartCandles(provider, { symbol: 'BTC', timeframe: '1h', realtime: false })
    );

    await waitFor(() => expect(result.current.phase).toBe('ready'));
    expect(provider.getCandles).toHaveBeenCalledTimes(1);
    expect(provider.getCandles).toHaveBeenCalledWith('BTC', '1h', 500);
    // Свечи выбранного инструмента (узнаваемая цена BTC).
    expect(result.current.candles.length).toBeGreaterThan(0);
    expect(result.current.candles[0].close).toBe(65_000);
    expect(result.current.requestCount).toBe(1);
  });

  it('BTC → SOL меняет свечи; старые свечи сбрасываются сразу', async () => {
    const provider = makeStub();
    const { result, rerender } = renderHook(
      ({ symbol }: { symbol: string }) =>
        useSignalChartCandles(provider, { symbol, timeframe: '1h', realtime: false }),
      { initialProps: { symbol: 'BTC' } }
    );
    await waitFor(() => expect(result.current.phase).toBe('ready'));
    expect(result.current.candles[0].close).toBe(65_000);

    rerender({ symbol: 'SOL' });
    await waitFor(() => expect(result.current.phase).toBe('ready'));
    // Теперь показаны свечи SOL (не BTC).
    expect(result.current.candles[0].close).toBe(140);
    // По одному запросу на каждый выбранный символ — нет веера.
    expect(provider.getCandles).toHaveBeenCalledTimes(2);
    const called = provider.getCandles.mock.calls.map((c) => c[0]);
    expect(called).toEqual(['BTC', 'SOL']);
  });

  it('SOL → BTC возвращает свечи BTC', async () => {
    const provider = makeStub();
    const { result, rerender } = renderHook(
      ({ symbol }: { symbol: string }) =>
        useSignalChartCandles(provider, { symbol, timeframe: '1h', realtime: false }),
      { initialProps: { symbol: 'SOL' } }
    );
    await waitFor(() => expect(result.current.phase).toBe('ready'));
    expect(result.current.candles[0].close).toBe(140);

    rerender({ symbol: 'BTC' });
    await waitFor(() => expect(result.current.phase).toBe('ready'));
    expect(result.current.candles[0].close).toBe(65_000);
  });

  it('гонка: запоздалый ответ для старого символа не побеждает (нет stale)', async () => {
    const provider = makeStub();
    const { result, rerender } = renderHook(
      ({ symbol }: { symbol: string }) =>
        useSignalChartCandles(provider, { symbol, timeframe: '1h', realtime: false }),
      { initialProps: { symbol: 'BTC' } }
    );

    // BTC-запрос ещё в полёте; резко переключаемся на SOL.
    rerender({ symbol: 'SOL' });
    await waitFor(() => expect(result.current.phase).toBe('ready'));
    expect(result.current.candles[0].close).toBe(140);

    // Запоздалый BTC-ответ (если бы долетел) обязан быть проигнорирован:
    // разрешаем его вручную и проверяем, что состояние не изменилось.
    const btcPending = provider.pending.get('BTC_1h');
    if (btcPending) {
      await act(async () => {
        btcPending.resolve(candles(65_000));
      });
    }
    expect(result.current.candles[0].close).toBe(140);
  });

  it('быстрый цикл BTC → SOL → BTC даёт ограниченное число запросов (нет веера)', async () => {
    const provider = makeStub();
    const { result, rerender } = renderHook(
      ({ symbol }: { symbol: string }) =>
        useSignalChartCandles(provider, { symbol, timeframe: '1h', realtime: false }),
      { initialProps: { symbol: 'BTC' } }
    );
    await waitFor(() => expect(result.current.phase).toBe('ready'));

    rerender({ symbol: 'SOL' });
    rerender({ symbol: 'BTC' });
    await waitFor(() => expect(result.current.phase).toBe('ready'));

    // Запрошены только BTC и SOL — по разу на символ, никакого перебора вселенной.
    const called = provider.getCandles.mock.calls.map((c) => c[0]);
    expect(new Set(called)).toEqual(new Set(['BTC', 'SOL']));
    expect(called.length).toBeLessThanOrEqual(4);
    // Финальное состояние — свечи последнего выбранного символа.
    expect(result.current.candles[0].close).toBe(65_000);
  });

  it('переключение таймфрейма запрашивает тот же символ с новым интервалом', async () => {
    const provider = makeStub();
    const { result, rerender } = renderHook(
      ({ timeframe }: { timeframe: Timeframe }) =>
        useSignalChartCandles(provider, { symbol: 'BTC', timeframe, realtime: false }),
      { initialProps: { timeframe: '1h' as Timeframe } }
    );
    await waitFor(() => expect(result.current.phase).toBe('ready'));

    rerender({ timeframe: '4h' });
    await waitFor(() => expect(result.current.phase).toBe('ready'));

    const calls = provider.getCandles.mock.calls;
    expect(calls[0]).toEqual(['BTC', '1h', 500]);
    expect(calls[calls.length - 1]).toEqual(['BTC', '4h', 500]);
  });
});

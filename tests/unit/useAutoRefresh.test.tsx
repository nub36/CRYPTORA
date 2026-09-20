/**
 * useAutoRefresh — Б1 (v0.8.51): авто-обновление страниц.
 *
 * Контракт: немедленный вызов на монтировании; тик каждые delayMs (следующий —
 * после завершения предыдущего); пауза запросов в фоновой вкладке (document.hidden);
 * внеочередной рефреш при возврате видимости и на сетевой 'online'; cleanup на unmount.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAutoRefresh } from '@/hooks/useAutoRefresh';

function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, value: hidden });
}

describe('useAutoRefresh', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setHidden(false);
  });

  afterEach(() => {
    vi.useRealTimers();
    setHidden(false);
  });

  it('вызывает callback немедленно при монтировании', async () => {
    const cb = vi.fn(async () => {});
    renderHook(() => useAutoRefresh(cb, 10_000));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('повторяет вызов каждые delayMs', async () => {
    const cb = vi.fn(async () => {});
    renderHook(() => useAutoRefresh(cb, 5_000));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(cb).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(cb).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(cb).toHaveBeenCalledTimes(5);
  });

  it('в фоновой вкладке запросы не выполняются; возврат видимости — внеочередной рефреш', async () => {
    const cb = vi.fn(async () => {});
    renderHook(() => useAutoRefresh(cb, 1_000));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(cb).toHaveBeenCalledTimes(1);

    setHidden(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(cb).toHaveBeenCalledTimes(1); // пауза — ни одного фонового запроса

    setHidden(false);
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(cb).toHaveBeenCalledTimes(2); // немедленно, без ожидания тика
  });

  it("сетевой 'online' → немедленный внеочередной рефреш", async () => {
    const cb = vi.fn(async () => {});
    renderHook(() => useAutoRefresh(cb, 60_000));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(cb).toHaveBeenCalledTimes(1);

    await act(async () => {
      window.dispatchEvent(new Event('online'));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('медленный callback не порождает наложенных вызовов', async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    const cb = vi.fn(async () => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((r) => setTimeout(r, 1_500));
      concurrent--;
    });
    renderHook(() => useAutoRefresh(cb, 1_000));

    // t=0 стартует вызов 1; тики на 1с/2с/3с… приходят, пока вызов 1 ещё активен
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });
    // Последовательный цикл: следующий вызов планируется после завершения предыдущего.
    expect(maxConcurrent).toBe(1);
    expect(cb).toHaveBeenCalled();
  });

  it('отказ callback не останавливает цикл', async () => {
    const cb = vi.fn(async () => {
      throw new Error('source down');
    });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      renderHook(() => useAutoRefresh(cb, 1_000));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_500);
      });
      expect(cb.mock.calls.length).toBeGreaterThanOrEqual(3); // цикл жив
    } finally {
      errSpy.mockRestore();
    }
  });

  it('после unmount вызовы прекращаются', async () => {
    const cb = vi.fn(async () => {});
    const { unmount } = renderHook(() => useAutoRefresh(cb, 1_000));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const callsAtUnmount = cb.mock.calls.length;
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(cb.mock.calls.length).toBe(callsAtUnmount);
  });

  it('enabled=false — цикл не запускается', async () => {
    const cb = vi.fn(async () => {});
    renderHook(() => useAutoRefresh(cb, 1_000, { enabled: false }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(cb).not.toHaveBeenCalled();
  });
});

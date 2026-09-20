/**
 * Н8 (v0.8.52): guard от наложения сканов LiveSignalEngine + пауза в фоновой вкладке.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { LiveSignalEngine } from '@/services/signals/live/LiveSignalEngine';

function makeDeferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

afterEach(() => {
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
});

describe('LiveSignalEngine — scan guard (Н8)', () => {
  it('сканы не наслаиваются: второй тик во время первого — no-op; после завершения цикл жив', async () => {
    const gate = makeDeferred<any[]>();
    const provider = { getCandles: vi.fn(() => gate.promise) } as any;
    const e = new LiveSignalEngine({ provider });

    const first = (engine_scan(e));
    const callsAfterStart = provider.getCandles.mock.calls.length;
    expect(callsAfterStart).toBeGreaterThan(0); // первый скан пошёл

    // Второй вызов во время незавершённого первого — мгновенный no-op.
    await engine_scan(e);
    expect(provider.getCandles.mock.calls.length).toBe(callsAfterStart);

    gate.resolve([]);
    await first;

    // После завершения скан снова выполняется.
    await engine_scan(e);
    expect(provider.getCandles.mock.calls.length).toBeGreaterThan(callsAfterStart);
  });

  it('в фоновой вкладке скан не выполняется', async () => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    const provider = { getCandles: vi.fn() } as any;
    const e = new LiveSignalEngine({ provider });
    await engine_scan(e);
    expect(provider.getCandles).not.toHaveBeenCalled();
  });
});

/** scan() приватный — тестируем контракт через any-приведение. */
function engine_scan(e: LiveSignalEngine): Promise<void> {
  return (e as unknown as { scan(): Promise<void> }).scan();
}

/**
 * Н8 (v0.9.0): guard сканов LiveSignalEngine.
 * In-flight дедупликация — their v0.8.49 currentScan; пауза document.hidden — наша часть.
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

function engine_scan(e: LiveSignalEngine, manual = false): Promise<void> {
  return (e as unknown as { scan(manual?: boolean): Promise<void> }).scan(manual);
}

afterEach(() => {
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
});

describe('LiveSignalEngine — scan guard (Н8)', () => {
  it('сканы не наслаиваются: вызов во время скана возвращает тот же in-flight promise', async () => {
    const gate = makeDeferred<any[]>();
    const provider = { getCandles: vi.fn(() => gate.promise) } as any;
    const e = new LiveSignalEngine({ provider });
    e.start(); // их runScan прерывает таймерный скан при !running

    const first = engine_scan(e); // таймерный скан (running=true) — идёт
    await new Promise((r) => setTimeout(r, 0)); // runScan доходит до провайдера асинхронно
    const callsAfterStart = provider.getCandles.mock.calls.length;
    expect(callsAfterStart).toBeGreaterThan(0); // первый скан пошёл

    const second = engine_scan(e); // НЕ создаёт второй скан — тот же currentScan
    expect(provider.getCandles.mock.calls.length).toBe(callsAfterStart);

    gate.resolve([]);
    await Promise.all([first, second]);
    e.stop();

    // После завершения новый вызов выполняет новый скан.
    e.start();
    await engine_scan(e);
    expect(provider.getCandles.mock.calls.length).toBeGreaterThan(callsAfterStart);
    e.stop();
  });

  it('в фоновой вкладке таймерный скан не выполняется (ручной — выполняется)', async () => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    const provider = { getCandles: vi.fn(async () => []) } as any;
    const e = new LiveSignalEngine({ provider });
    e.start();

    await engine_scan(e); // таймерный — в фоне пропускается (Н8)
    expect(provider.getCandles).not.toHaveBeenCalled();

    await engine_scan(e, true); // ручной (кнопка «сканировать») — доводится до конца
    expect(provider.getCandles).toHaveBeenCalled();
    e.stop();
  });
});

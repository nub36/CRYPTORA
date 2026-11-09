/**
 * Серверный проход по символу и правило публикации.
 *
 * Правило взято из CRYPTORA (`LiveSignalEngine.scanSymbol`): сигналом считается
 * только сетап ПОСЛЕДНЕГО закрытого 1H-бара, прошедший геометрию. Всё остальное
 * окно — ретроспектива и в базу не пишется.
 */
import { describe, it, expect } from 'vitest';
import { runV34Scan, selectPublishableSetups } from '../src/engine';
import { runV34LiveReplay } from '../src/signals/v34LiveReplay';
import { makeSyntheticSeries } from './fixtures/synthetic';
import type { ArchiveCandle } from '../src/strategy/types';
import type { OHLCV } from '../src/signals/ohlcv';
import { DATA_FRESHNESS, V34_CANDLE_LIMITS } from '../src/config';

function toOhlcv(candles: readonly ArchiveCandle[], exchange = 'Binance', isFallback = false): OHLCV[] {
  return candles.map((c) => ({
    time: Math.floor(c.openTime / 1000),
    open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume,
    provenance: { exchange, isFallback },
  }));
}

/** «Сейчас» — сразу после закрытия последнего сгенерированного бара. */
function nowAfter(candles: readonly ArchiveCandle[], extraMs = 1000): number {
  return candles[candles.length - 1]!.closeTime + extraMs;
}

describe('runV34Scan', () => {
  it('возвращает сетапы окна и провенанс источника', () => {
    const { h1, h4 } = makeSyntheticSeries({ seed: 10, bars1h: 900 });
    const res = runV34Scan({ symbol: 'ASSET-A', h1Raw: toOhlcv(h1), h4Raw: toOhlcv(h4), nowMs: nowAfter(h1) });
    expect(res.dataError).toBeNull();
    expect(res.replay.records.length).toBeGreaterThan(0);
    expect(res.closedBars['1h']).toBe(h1.length);
    expect(res.closedBars['4h']).toBe(h4.length);
    expect(res.source).toEqual({ exchange: 'Binance', isFallback: false });
    expect(res.lastClosedBarOpenTime).toBe(h1[h1.length - 1]!.openTime);
  });

  it('публикуются только сетапы последнего закрытого бара и только валидной геометрии', () => {
    const { h1, h4 } = makeSyntheticSeries({ seed: 10, bars1h: 900 });
    const res = runV34Scan({ symbol: 'ASSET-A', h1Raw: toOhlcv(h1), h4Raw: toOhlcv(h4), nowMs: nowAfter(h1) });
    const full = runV34LiveReplay({ symbol: 'ASSET-A', h1, h4 });

    expect(res.publishable).toEqual(selectPublishableSetups(full, h1[h1.length - 1]!.openTime));
    for (const rec of res.publishable) {
      expect(rec.setupOpenTime).toBe(res.lastClosedBarOpenTime);
      expect(rec.publishable).toBe(true);
      expect(rec.meta?.targetQualityRejectReason).toBeUndefined();
    }
  });

  it('формирующийся бар отбрасывается: он не влияет ни на сетапы, ни на «последний бар»', () => {
    const { h1, h4 } = makeSyntheticSeries({ seed: 10, bars1h: 900 });
    const last = h1[h1.length - 1]!;
    const forming: OHLCV = {
      time: Math.floor(last.openTime / 1000) + 3600,
      open: last.close, high: last.close * 1.5, low: last.close * 0.5, close: last.close * 1.4, volume: 1e6,
      provenance: { exchange: 'Binance', isFallback: false },
    };
    const nowMs = Math.floor(last.openTime / 1000) * 1000 + 3600_000 + 1000; // внутри формирующегося бара
    const res = runV34Scan({
      symbol: 'ASSET-A', h1Raw: [...toOhlcv(h1), forming], h4Raw: toOhlcv(h4), nowMs,
    });
    expect(res.lastClosedBarOpenTime).toBe(last.openTime);
    expect(res.closedBars['1h']).toBe(h1.length);
    expect(res.replay).toEqual(runV34LiveReplay({ symbol: 'ASSET-A', h1, h4 }));
  });

  it('пустой ответ биржи → явная ошибка данных, а не «сетапов нет»', () => {
    const res = runV34Scan({ symbol: 'ASSET-A', h1Raw: [], h4Raw: [], nowMs: Date.now() });
    expect(res.dataError).toContain('нет закрытых 1H-свечей');
    expect(res.publishable).toEqual([]);
    expect(res.notes.length).toBeGreaterThan(0);
  });

  it('слишком короткое окно → ошибка данных с числом баров', () => {
    const { h1, h4 } = makeSyntheticSeries({ seed: 3, bars1h: 40 });
    const res = runV34Scan({ symbol: 'ASSET-A', h1Raw: toOhlcv(h1), h4Raw: toOhlcv(h4), nowMs: nowAfter(h1) });
    expect(res.dataError).toContain('недостаточно закрытых 1H-баров');
    expect(res.publishable).toEqual([]);
  });

  it('отсутствие 4H-серии → ошибка данных', () => {
    const { h1 } = makeSyntheticSeries({ seed: 10, bars1h: 400 });
    const res = runV34Scan({ symbol: 'ASSET-A', h1Raw: toOhlcv(h1), h4Raw: [], nowMs: nowAfter(h1) });
    expect(res.dataError).toContain('4H');
  });

  it('старый последний бар отмечается как устаревший (не выдаётся за свежий)', () => {
    const { h1, h4 } = makeSyntheticSeries({ seed: 10, bars1h: 900 });
    const now = nowAfter(h1, DATA_FRESHNESS.maxBarAgeMs + 60 * 60_000);
    const res = runV34Scan({ symbol: 'ASSET-A', h1Raw: toOhlcv(h1), h4Raw: toOhlcv(h4), nowMs: now });
    expect(res.lastBarAgeMs).toBeGreaterThan(DATA_FRESHNESS.maxBarAgeMs);
    expect(res.notes.some((n) => n.includes('устарели'))).toBe(true);
  });

  it('лимиты окна совпадают с продуктовыми (1000 / 1000)', () => {
    expect(V34_CANDLE_LIMITS).toEqual({ '1h': 1000, '4h': 1000 });
  });

  it('детерминизм: один и тот же вход дважды даёт тот же выход', () => {
    const { h1, h4 } = makeSyntheticSeries({ seed: 33, bars1h: 900 });
    const args = { symbol: 'ASSET-A', h1Raw: toOhlcv(h1), h4Raw: toOhlcv(h4), nowMs: nowAfter(h1) };
    expect(JSON.stringify(runV34Scan(args))).toBe(JSON.stringify(runV34Scan(args)));
  });
});

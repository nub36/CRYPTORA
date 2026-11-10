/**
 * РАЗРЫВ ИСТОРИИ СВЕЧЕЙ — не повод останавливать стратегию.
 *
 * Оригинальная логика CRYPTORA относится к пропускам как к диагностике:
 * `countGaps` считает разрывы и пишет их в статус символа, а replay продолжает
 * работать на том, что есть (`src/services/signals/live/LiveSignalEngine.ts`,
 * `toClosedArchive` + `countGaps`). Новый продукт обязан вести себя так же:
 * одна отсутствующая 1H-свеча не должна обнулять окно и блокировать ведение
 * уже открытых сделок.
 *
 * Тест сравнивает ДВА независимых пути на одних и тех же обезличенных данных:
 *   1. новый: сырые свечи → адаптер (`runV34Scan` → `toClosedArchive`) →
 *      реплей;
 *   2. оригинальный: те же свечи → `ohlcvToArchive` из CRYPTORA → та же
 *      фильтрация закрытых баров (как в `LiveSignalEngine`) → ОРИГИНАЛЬНЫЙ
 *      `runV34LiveReplay` из `src/services/signals/live/replays/`.
 *
 * Совпадение должно быть поле-в-поле: записи, исходы, пороги качества, число
 * пропусков и отбор публикуемых сетапов.
 */
import { describe, it, expect } from 'vitest';
import { ohlcvToArchive as ohlcvOriginal } from '@/services/signals/live/ohlcvAdapter';
import { runV34LiveReplay as runV34Original } from '@/services/signals/live/replays/v34LiveReplay';
import { makeSyntheticSeries } from './fixtures/synthetic';
import type { ArchiveCandle } from '../src/strategy/types';
import { runV34Scan, selectPublishableSetups } from '../src/engine';
import { toClosedArchive, type OHLCV } from '../src/signals/ohlcv';
import { runV34LiveReplay } from '../src/signals/v34LiveReplay';
import type { ReplayOutput } from '../src/signals/replayTypes';

/** ArchiveCandle → сырые свечи в том виде, в котором их отдаёт биржа (секунды). */
function toRaw(candles: readonly ArchiveCandle[]): OHLCV[] {
  return candles.map((c) => ({
    time: Math.floor(c.openTime / 1000),
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
    provenance: { exchange: 'Synthetic', isFallback: false },
  }));
}

/**
 * Эталонная подготовка серии — ровно как в оригинальном `LiveSignalEngine`:
 * адаптер CRYPTORA, фильтр закрытых баров, сортировка, дедупликация по openTime.
 */
function closedLikeOriginal(raw: readonly OHLCV[], tf: '1h' | '4h', nowMs: number): ArchiveCandle[] {
  const conv = raw
    .map((c) => ohlcvOriginal(c as never, tf, nowMs))
    .filter((c) => c.isClosed);
  conv.sort((a, b) => a.openTime - b.openTime);
  const out: ArchiveCandle[] = [];
  for (const c of conv) {
    const last = out[out.length - 1];
    if (last && last.openTime === c.openTime) out[out.length - 1] = c;
    else out.push(c);
  }
  return out;
}

function plain<T>(x: T): unknown {
  return JSON.parse(JSON.stringify(x));
}

/** Выкидываем одну 1H-свечу в середине окна: последний закрытый бар не меняется. */
function dropMiddle(candles: readonly ArchiveCandle[], index: number): ArchiveCandle[] {
  return candles.filter((_c, i) => i !== index);
}

describe('пропуск свечи: новый адаптер ↔ оригинальный replay', () => {
  for (const seed of [1, 10, 33, 47] as const) {
    it(`seed=${seed}: разрыв в 1H-истории даёт тот же replay, что у оригинала`, () => {
      const { h1, h4 } = makeSyntheticSeries({ seed, bars1h: 900 });
      // Дырка в середине: 1H-бар отсутствует, 4H-серия остаётся как есть.
      const h1Gapped = dropMiddle(h1, Math.floor(h1.length / 2));
      const h4Gapped = h4;
      const nowMs = h1[h1.length-1]!.closeTime + 1;

      const scan = runV34Scan({ symbol: 'ASSETAUSDT', h1Raw: toRaw(h1Gapped), h4Raw: toRaw(h4Gapped), nowMs });

      // Разрыв — диагностика, а не ошибка данных и не повод пропустить символ.
      expect(scan.dataError).toBeNull();
      expect(scan.gaps1h).toBe(1);
      expect(scan.closedBars['1h']).toBe(h1Gapped.length);

      // Эталон: те же свечи, но подготовленные оригинальными функциями CRYPTORA.
      const ref1h = closedLikeOriginal(toRaw(h1Gapped), '1h', nowMs);
      const ref4h = closedLikeOriginal(toRaw(h4Gapped), '4h', nowMs);
      const original: ReplayOutput = runV34Original({ symbol: 'ASSETAUSDT', h1: ref1h, h4: ref4h });

      // Полное совпадение результата стратегии.
      expect(plain(scan.replay)).toEqual(plain(original));
      expect(plain(runV34LiveReplay({ symbol: 'ASSETAUSDT', h1: ref1h, h4: ref4h }))).toEqual(plain(original));

      // И совпадение решения о публикации: только последний закрытый бар + geometry.
      const lastClosed = ref1h[ref1h.length - 1]!.openTime;
      expect(scan.lastClosedBarOpenTime).toBe(lastClosed);
      expect(plain(scan.publishable)).toEqual(plain(selectPublishableSetups(original, lastClosed)));
    });
  }

  it('разрыв не мешает ведению уже открытых сделок (окно то же, что у оригинала)', () => {
    const { h1, h4 } = makeSyntheticSeries({ seed: 10, bars1h: 900 });
    // Три дырки в разных местах истории — окно всё ещё пригодно.
    const h1Gapped = h1.filter((_c, i) => i !== 40 && i !== 200 && i !== 400);
    const nowMs = h1[h1.length - 1]!.closeTime + 1;
    const scan = runV34Scan({ symbol: 'ASSETAUSDT', h1Raw: toRaw(h1Gapped), h4Raw: toRaw(h4), nowMs });

    expect(scan.dataError).toBeNull();
    expect(scan.gaps1h).toBe(3);
    expect(plain(scan.closedH1)).toEqual(
      plain(closedLikeOriginal(toRaw(h1Gapped), '1h', nowMs)),
    );
    // Ведение использует ровно эту закрытую серию, значит исходы считаются так же.
    expect(scan.closedH1.length).toBeGreaterThan(60);
  });

  it('устаревший последний закрытый бар помечается, а не выдаётся за свежий', () => {
    const { h1, h4 } = makeSyntheticSeries({ seed: 10, bars1h: 300 });
    const lastClosed = h1[h1.length - 1]!;
    // Часы ушли на 5 часов вперёд: последний закрытый бар старше допустимого.
    const nowMs = lastClosed.closeTime + 5 * 3_600_000;
    const scan = runV34Scan({ symbol: 'ASSETAUSDT', h1Raw: toRaw(h1), h4Raw: toRaw(h4), nowMs });

    expect(scan.lastBarAgeMs).not.toBeNull();
    expect(scan.lastBarAgeMs!).toBeGreaterThan(2 * 3_600_000);
    expect(scan.notes.some((n) => n.toLowerCase().includes('устар'))).toBe(true);
    // Это предупреждение, а не «нет данных»: окно по-прежнему оценивается.
    expect(scan.dataError).toBeNull();
    expect(scan.lastClosedBarOpenTime).toBe(lastClosed.openTime);
  });

  it('адаптер не теряет и не дублирует бары вокруг разрыва', () => {
    const { h1 } = makeSyntheticSeries({ seed: 5, bars1h: 120 });
    const gapped = h1.filter((_c, i) => i !== 60);
    const raw = toRaw(gapped);
    const nowMs = h1[h1.length - 1]!.closeTime + 1;
    const closed = toClosedArchive(raw, '1h', nowMs);
    expect(closed).toHaveLength(gapped.length);
    expect(new Set(closed.map((c) => c.openTime)).size).toBe(closed.length);
    // Вокруг дырки шаг ровно 2 часа.
    const i = closed.findIndex((c, idx) => idx > 0 && c.openTime - closed[idx - 1]!.openTime !== 3_600_000);
    expect(i).toBeGreaterThan(0);
    expect(closed[i]!.openTime - closed[i - 1]!.openTime).toBe(7_200_000);
  });
});

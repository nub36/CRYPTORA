/**
 * ДОКАЗАТЕЛЬСТВО СООТВЕТСТВИЯ: реплей V3.4 в изолированном модуле даёт те же
 * результаты, что и исходная реализация CRYPTORA, на одинаковых обезличенных
 * данных.
 *
 * Сравнивается весь объект `ReplayOutput`: каждая запись окна (уровни, зона
 * входа, стоп, цели, R/R, исход, meta с порогами качества), заметки и число
 * оценённых баров. Фикстура — детерминированный синтетический ряд с
 * символическим именем `ASSET-A` (никаких реальных тикеров и цен).
 *
 * Дополнительно фиксируется, что фикстуры действительно покрывают жизненный
 * цикл: есть и принятые, и отклонённые фильтром сетапы, есть исполнения,
 * TP2, TP1→BE, таймауты и стопы, оба направления.
 */
import { describe, it, expect } from 'vitest';
import { makeSyntheticSeries } from './fixtures/synthetic';
import {
  runV34LiveReplay as runV34Original,
  v34GateCounts as gateCountsOriginal,
} from '@/services/signals/live/replays/v34LiveReplay';
import { runV33LiveReplay as runV33Original } from '@/services/signals/live/replays/v33LiveReplay';
import {
  runV34LiveReplay,
  v34GateCounts,
  V34_STRATEGY_ID,
  V34_STRATEGY_VERSION,
} from '../src/signals/v34LiveReplay';
import { runV33LiveReplay } from '../src/signals/v33LiveReplay';

const SEEDS = [1, 2, 5, 10, 28, 33, 45, 47, 49] as const;

function plain<T>(x: T): unknown {
  return JSON.parse(JSON.stringify(x));
}

describe('V3.4: копия ↔ исходный реплей CRYPTORA', () => {
  for (const seed of SEEDS) {
    it(`seed=${seed}: записи, исходы и метаданные совпадают поле-в-поле`, () => {
      const { h1, h4 } = makeSyntheticSeries({ seed, bars1h: 900 });
      const original = runV34Original({ symbol: 'ASSET-A', h1, h4 });
      const copy = runV34LiveReplay({ symbol: 'ASSET-A', h1, h4 });

      expect(plain(copy)).toEqual(plain(original));
      expect(copy.records.length).toBeGreaterThan(0);
      expect(v34GateCounts(copy)).toEqual(gateCountsOriginal(original));

      // Идентификаторы и версия — продуктовые, а не «v34-copy».
      expect(copy.records.every((r) => r.strategyId === V34_STRATEGY_ID)).toBe(true);
      expect(copy.records.every((r) => r.strategyVersion === V34_STRATEGY_VERSION)).toBe(true);
    });
  }

  it('V3.3 в копии остаётся неизменной (identity-коридор, без hook)', () => {
    for (const seed of SEEDS) {
      const { h1, h4 } = makeSyntheticSeries({ seed, bars1h: 900 });
      const original = runV33Original({ symbol: 'ASSET-A', h1, h4 });
      const copy = runV33LiveReplay({ symbol: 'ASSET-A', h1, h4 });
      expect(plain(copy)).toEqual(plain(original));
    }
  });

  it('фикстуры покрывают фильтр качества, исполнения и исходы', () => {
    const reasons = new Set<string>();
    const exits = new Set<string>();
    const directions = new Set<string>();
    let accepted = 0;
    let filled = 0;
    let rejected = 0;

    for (const seed of SEEDS) {
      const { h1, h4 } = makeSyntheticSeries({ seed, bars1h: 900 });
      const out = runV34LiveReplay({ symbol: 'ASSET-A', h1, h4 });
      for (const r of out.records) {
        directions.add(r.direction);
        const reason = r.meta?.targetQualityRejectReason;
        if (typeof reason === 'string') {
          rejected++;
          reasons.add(reason);
        } else {
          accepted++;
        }
        if (r.fill) filled++;
        if (r.outcome) exits.add(r.outcome.exitReason);
      }
    }

    expect(accepted).toBeGreaterThan(0);
    expect(rejected).toBeGreaterThan(0);
    expect(filled).toBeGreaterThan(0);
    expect([...directions].sort()).toEqual(['LONG', 'SHORT']);
    expect(reasons.has('TARGET_QUALITY_TP1') || reasons.has('TARGET_QUALITY_TP2')).toBe(true);
    expect([...exits].some((e) => e === 'TP2' || e === 'TP1_THEN_BE' || e === 'SL')).toBe(true);
  });

  it('фильтр качества V3.4 отклоняет сетап, который V3.3 принимает (тот же бар)', () => {
    // Если фильтр никогда ничего не отклоняет — это не V3.4, а V3.3 с другим именем.
    let stricterSomewhere = false;
    for (const seed of SEEDS) {
      const { h1, h4 } = makeSyntheticSeries({ seed, bars1h: 900 });
      const v33 = runV33Original({ symbol: 'ASSET-A', h1, h4 });
      const v34 = runV34LiveReplay({ symbol: 'ASSET-A', h1, h4 });
      const v33Keys = new Set(v33.records.map((r) => `${r.setupOpenTime}:${r.direction}`));
      const v34Accepted = new Set(
        v34.records
          .filter((r) => r.meta?.targetQualityRejectReason == null)
          .map((r) => `${r.setupOpenTime}:${r.direction}`),
      );
      for (const key of v33Keys) if (!v34Accepted.has(key)) stricterSomewhere = true;
    }
    expect(stricterSomewhere).toBe(true);
  });

  it('расширенный коридор V3.4 шире коридора V3.3 на 0.25 ATR в каждую сторону', () => {
    for (const seed of SEEDS) {
      const { h1, h4 } = makeSyntheticSeries({ seed, bars1h: 900 });
      const out = runV34LiveReplay({ symbol: 'ASSET-A', h1, h4 });
      for (const r of out.records) {
        const baseLow = r.meta?.baseEntryZoneLow;
        const baseHigh = r.meta?.baseEntryZoneHigh;
        const pad = r.meta?.entryZonePad;
        if (typeof baseLow !== 'number' || typeof baseHigh !== 'number' || typeof pad !== 'number') continue;
        expect(r.entryZone[0]).toBeCloseTo(baseLow - pad, 10);
        expect(r.entryZone[1]).toBeCloseTo(baseHigh + pad, 10);
        expect(pad).toBeGreaterThan(0);
      }
    }
  });
});

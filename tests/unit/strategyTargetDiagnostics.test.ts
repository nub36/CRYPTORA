/**
 * Тесты ЧИСТОЙ диагностической математики (аудит TP/SL).
 *
 * Здесь НЕ проверяются и НЕ переопределяются ожидаемые значения стратегий:
 * `shared/diagnostics/targetGeometry.js` не содержит формул стратегий и не
 * импортирует их. Проверяется только арифметика R, классификация геометрии,
 * классификация исходов и разрешение цены — то, на чём строится отчёт аудита.
 */
import { describe, it, expect } from 'vitest';
import {
  analyzeSignalGeometry,
  analyzeSignalBatch,
  groupStats,
  summarize,
  percentile,
  thresholdShares,
  classifyOutcome,
  summarizeOutcomes,
  priceResolution,
} from '../../shared/diagnostics/targetGeometry.js';

const LONG = {
  id: 'l1', symbol: 'BTC/USDT', direction: 'LONG', timeframe: '1h', strategyVersion: '3.0',
  entryLow: 100, entryHigh: 110, stop: 90, tp1: 120, tp2: 140,
};

const SHORT = {
  id: 's1', symbol: 'BTC/USDT', direction: 'SHORT', timeframe: '1h', strategyVersion: '3.3',
  entryLow: 90, entryHigh: 100, stop: 110, tp1: 80, tp2: 60,
};

describe('R-расчёты LONG', () => {
  it('считает risk/reward/R от середины зоны', () => {
    const r = analyzeSignalGeometry(LONG);
    expect(r.ok).toBe(true);
    expect(r.entryMid).toBe(105);
    expect(r.riskMid).toBe(15);            // 105 − 90
    expect(r.reward1Mid).toBe(15);         // 120 − 105
    expect(r.reward2Mid).toBe(35);         // 140 − 105
    expect(r.r1Mid).toBeCloseTo(1, 10);
    expect(r.r2Mid).toBeCloseTo(35 / 15, 10);
  });

  it('near = нижняя граница, far = верхняя (худшее исполнение LONG)', () => {
    const r = analyzeSignalGeometry(LONG);
    expect(r.riskNear).toBe(10);           // 100 − 90
    expect(r.riskFar).toBe(20);            // 110 − 90
    expect(r.r1Near).toBeCloseTo(20 / 10, 10);
    expect(r.r1Far).toBeCloseTo(10 / 20, 10);
    expect(r.r2Near).toBeCloseTo(40 / 10, 10);
    expect(r.r2Far).toBeCloseTo(30 / 20, 10);
  });
});

describe('R-расчёты SHORT', () => {
  it('считает зеркально LONG', () => {
    const r = analyzeSignalGeometry(SHORT);
    expect(r.ok).toBe(true);
    expect(r.entryMid).toBe(95);
    expect(r.riskMid).toBe(15);            // 110 − 95
    expect(r.reward1Mid).toBe(15);         // 95 − 80
    expect(r.reward2Mid).toBe(35);         // 95 − 60
    expect(r.r1Mid).toBeCloseTo(1, 10);
  });

  it('near = верхняя граница, far = нижняя (худшее исполнение SHORT)', () => {
    const r = analyzeSignalGeometry(SHORT);
    expect(r.riskNear).toBe(10);           // 110 − 100
    expect(r.riskFar).toBe(20);            // 110 − 90
    expect(r.r1Near).toBeCloseTo(20 / 10, 10);
    expect(r.r1Far).toBeCloseTo(10 / 20, 10);
  });
});

describe('края зоны входа', () => {
  it('вырожденная зона (low = high) даёт одинаковые near/mid/far', () => {
    const r = analyzeSignalGeometry({ ...LONG, entryLow: 100, entryHigh: 100 });
    expect(r.ok).toBe(true);
    expect(r.zoneWidth).toBe(0);
    expect(r.r1Mid).toBe(r.r1Near);
    expect(r.r1Near).toBe(r.r1Far);
  });

  it('перевёрнутая зона фиксируется как структурное нарушение', () => {
    const r = analyzeSignalGeometry({ ...LONG, entryLow: 110, entryHigh: 100 });
    expect(r.structural).toContain('ENTRY_ZONE_INVERTED');
    expect(r.ok).toBe(false);
  });

  it('очень широкая зона помечается как качество, а не повреждение', () => {
    const r = analyzeSignalGeometry({ ...LONG, entryLow: 100, entryHigh: 130, stop: 90, tp1: 200, tp2: 300 });
    expect(r.ok).toBe(true);
    expect(r.quality).toContain('WIDE_ENTRY_ZONE');
  });
});

describe('цели и стоп не с той стороны', () => {
  it('LONG: TP1 ниже входа', () => {
    const r = analyzeSignalGeometry({ ...LONG, tp1: 99 });
    expect(r.structural).toContain('TP1_ON_WRONG_SIDE');
    expect(r.ok).toBe(false);
  });

  it('SHORT: TP1 выше входа', () => {
    const r = analyzeSignalGeometry({ ...SHORT, tp1: 101 });
    expect(r.structural).toContain('TP1_ON_WRONG_SIDE');
  });

  it('LONG: стоп выше входа даёт STOP_ON_WRONG_SIDE и NON_POSITIVE_RISK', () => {
    const r = analyzeSignalGeometry({ ...LONG, stop: 120 });
    expect(r.structural).toContain('STOP_ON_WRONG_SIDE');
    expect(r.structural).toContain('NON_POSITIVE_RISK');
    expect(r.r1Mid).toBeNull();
  });

  it('SHORT: стоп ниже входа', () => {
    const r = analyzeSignalGeometry({ ...SHORT, stop: 80 });
    expect(r.structural).toContain('STOP_ON_WRONG_SIDE');
  });

  it('нулевой риск (стоп ровно в середине зоны)', () => {
    const r = analyzeSignalGeometry({ ...LONG, stop: 105 });
    expect(r.structural).toContain('NON_POSITIVE_RISK');
    expect(r.riskMid).toBe(0);
  });
});

describe('порядок целей', () => {
  it('LONG: TP2 <= TP1', () => {
    expect(analyzeSignalGeometry({ ...LONG, tp2: 120 }).structural).toContain('TP_ORDER_INVERTED');
    expect(analyzeSignalGeometry({ ...LONG, tp2: 115 }).structural).toContain('TP_ORDER_INVERTED');
  });

  it('SHORT: TP2 >= TP1', () => {
    expect(analyzeSignalGeometry({ ...SHORT, tp2: 80 }).structural).toContain('TP_ORDER_INVERTED');
    expect(analyzeSignalGeometry({ ...SHORT, tp2: 85 }).structural).toContain('TP_ORDER_INVERTED');
  });
});

describe('NaN / null / отсутствующие уровни', () => {
  it('null уровня — MISSING_LEVEL, а не ноль', () => {
    const r = analyzeSignalGeometry({ ...LONG, tp2: null });
    expect(r.structural).toContain('MISSING_LEVEL');
    expect(r.missingLevels).toContain('tp2');
    expect(r.r2Mid).toBeNull();
  });

  it('NaN уровня — NON_FINITE_LEVEL', () => {
    const r = analyzeSignalGeometry({ ...LONG, stop: Number.NaN });
    expect(r.structural).toContain('NON_FINITE_LEVEL');
  });

  it('неизвестное направление не интерпретируется', () => {
    const r = analyzeSignalGeometry({ ...LONG, direction: 'FLAT' });
    expect(r.structural).toContain('UNKNOWN_DIRECTION');
    expect(r.r1Mid).toBeNull();
  });
});

describe('TP1 аномально близко (профиль V3.3 из продакшена)', () => {
  it('BTC SHORT со скрина: R1 ≈ 0.13, R2 ≈ 2.30', () => {
    const r = analyzeSignalGeometry({
      id: 'btc-short', symbol: 'BTC/USDT', direction: 'SHORT', timeframe: '1h', strategyVersion: '3.3',
      entryLow: 84154.2, entryHigh: 84245.9, stop: 84911.8, tp1: 84104.5, tp2: 82563.0,
    });
    expect(r.ok).toBe(true);
    expect(r.entryMid).toBeCloseTo(84200.05, 6);
    expect(r.riskMid).toBeCloseTo(711.75, 6);
    expect(r.r1Mid).toBeCloseTo(0.1343, 3);
    expect(r.r2Mid).toBeCloseTo(2.3001, 3);
    // Раннер считает R от ХУДШЕЙ границы — там TP1 ещё ближе.
    expect(r.r1Far).toBeCloseTo(0.0656, 3);
    expect(r.quality).toContain('TP1_VERY_CLOSE');
  });
});

describe('низкие цены и точность', () => {
  it('R не теряет знаков на PEPE-подобных уровнях', () => {
    const r = analyzeSignalGeometry({
      id: 'pepe', symbol: '1000PEPE/USDT', direction: 'LONG', timeframe: '1h', strategyVersion: '3.3',
      entryLow: 0.00000812, entryHigh: 0.00000818, stop: 0.00000798, tp1: 0.00000840, tp2: 0.00000905,
    });
    expect(r.ok).toBe(true);
    expect(r.entryMid).toBeCloseTo(0.00000815, 12);
    expect(r.riskMid).toBeCloseTo(0.00000017, 12);
    expect(r.r1Mid).toBeCloseTo(0.00000025 / 0.00000017, 6);
    expect(r.r2Mid).toBeCloseTo(0.0000009 / 0.00000017, 6);
  });

  it('priceResolution различает «6 значащих цифр» и «округлено до 6 знаков»', () => {
    expect(priceResolution(0.00000812, 3).ok).toBe(true);
    expect(priceResolution(0.00000812, 3).significantDigits).toBe(3);
    // 0.000008 — то, что осталось бы от PEPE после форматирования в 6 знаков.
    expect(priceResolution(0.000008, 3).ok).toBe(false);
    expect(priceResolution(0, 3).ok).toBe(false);
    expect(priceResolution(Number.NaN, 3).ok).toBe(false);
  });
});

describe('статистика выборки', () => {
  it('percentile линейно интерполирует', () => {
    const s = [1, 2, 3, 4];
    expect(percentile(s, 0)).toBe(1);
    expect(percentile(s, 1)).toBe(4);
    expect(percentile(s, 0.5)).toBeCloseTo(2.5, 10);
    expect(percentile([], 0.5)).toBeNull();
  });

  it('пустая выборка даёт null, а не ноль', () => {
    const s = summarize([]);
    expect(s.count).toBe(0);
    expect(s.median).toBeNull();
    expect(s.mean).toBeNull();
  });

  it('доли ниже порогов считаются от валидной выборки', () => {
    const sh = thresholdShares([0.1, 0.2, 0.4, 0.9, 1.5]);
    expect(sh.n).toBe(5);
    expect(sh.below[0]).toMatchObject({ threshold: 0.25, count: 2 });
    expect(sh.below[1]).toMatchObject({ threshold: 0.5, count: 3 });
    expect(sh.below[2]).toMatchObject({ threshold: 1.0, count: 4 });
    expect(sh.atLeastOneR.count).toBe(1);
    expect(thresholdShares([]).atLeastOneR.pct).toBeNull();
  });
});

describe('пакетный разбор и разрезы', () => {
  const batch = analyzeSignalBatch([
    LONG,
    SHORT,
    { ...LONG, id: 'l2', tp1: 99 },                       // структурно сломан
    { ...SHORT, id: 's2', symbol: 'ETH/USDT', tp1: 94 },  // валиден, R1 маленький
  ]);

  it('разделяет валидные и повреждённые', () => {
    expect(batch.total).toBe(4);
    expect(batch.structurallyValid).toBe(3);
    expect(batch.structurallyBroken).toBe(1);
    expect(batch.anomalyCounts.TP1_ON_WRONG_SIDE).toBe(1);
  });

  it('агрегаты считаются только по валидным', () => {
    expect(batch.r1Mid.count).toBe(3);
  });

  it('группировка по версии не смешивает V3.0 и V3.3', () => {
    const g = groupStats(batch.results, (r) => String(r.strategyVersion));
    const v33 = g.find((x) => x.key === '3.3');
    const v30 = g.find((x) => x.key === '3.0');
    expect(v33?.total).toBe(2);
    expect(v30?.total).toBe(2);
    expect(v30?.structurallyValid).toBe(1);
  });
});

describe('классификация исходов ядра', () => {
  it('TP1 выводится из литерала выхода, а не выдумывается', () => {
    expect(classifyOutcome('TP2')).toMatchObject({ tp1: true, tp2: true, sl: false, trade: true });
    expect(classifyOutcome('TP1_THEN_BE')).toMatchObject({ tp1: true, tp2: false, sl: false, trade: true });
    expect(classifyOutcome('TP1_THEN_SL')).toMatchObject({ tp1: true, sl: true, trade: true });
    expect(classifyOutcome('TP1_THEN_TIMEOUT')).toMatchObject({ tp1: true, sl: false, trade: true });
    expect(classifyOutcome('SL')).toMatchObject({ tp1: false, sl: true, trade: true });
    expect(classifyOutcome('TIMEOUT')).toMatchObject({ tp1: false, sl: false, trade: true });
  });

  it('безсделковые исходы не попадают в знаменатель', () => {
    for (const reason of ['EXPIRED', 'CANCELLED', 'REJECTED_GEOMETRY']) {
      expect(classifyOutcome(reason).trade).toBe(false);
      expect(classifyOutcome(reason).tp1).toBeNull();
    }
  });

  it('неизвестная причина остаётся неизвестной', () => {
    expect(classifyOutcome('WHATEVER').known).toBe(false);
    expect(classifyOutcome(null).known).toBe(false);
  });

  it('hit-rate считается от разрешённых сделок', () => {
    const s = summarizeOutcomes([
      { status: 'TARGET_REACHED', closeReason: 'TP2' },
      { status: 'CLOSED', closeReason: 'TP1_THEN_BE' },
      { status: 'INVALIDATED', closeReason: 'SL' },
      { status: 'INVALIDATED', closeReason: 'SL' },
      { status: 'EXPIRED', closeReason: 'EXPIRED' },
      { status: 'ACTIVE', closeReason: null },
    ]);
    expect(s.total).toBe(6);
    expect(s.open).toBe(1);
    expect(s.noTrade).toBe(1);
    expect(s.resolvedTrades).toBe(4);
    expect(s.tp1HitRatePct).toBeCloseTo(50, 10);
    expect(s.tp2HitRatePct).toBeCloseTo(25, 10);
    expect(s.slRatePct).toBeCloseTo(50, 10);
  });

  it('без разрешённых сделок hit-rate = null, а не 0 %', () => {
    const s = summarizeOutcomes([{ status: 'ACTIVE', closeReason: null }]);
    expect(s.tp1HitRatePct).toBeNull();
    expect(s.slRatePct).toBeNull();
  });
});

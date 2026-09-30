/**
 * CRYPTORA — счётное ядро исследования конфликтов позиций.
 *
 * ЧТО ЗДЕСЬ ЗАЩИЩАЕТСЯ
 * --------------------
 * 1. Равенство `traceTrade` и ЗАМОРОЖЕННОЙ `manageTrade` (V3.3 и V3.0) на
 *    детерминированных сценариях всех исходов. Это единственное основание
 *    считать контрфакты политик C и D корректными: tracer не альтернативная
 *    математика, а доказуемо тот же автомат плюс досрочное закрытие.
 * 2. Семантика досрочного закрытия: до TP1 закрывается вся позиция, после TP1 —
 *    только остаток, и уже зафиксированные 50 % остаются в результате.
 * 3. Классификация состояния первой сделки (BEFORE_TP1 / AFTER_TP1,
 *    OPEN_FULL / OPEN_REMAINDER, ORIGINAL_STOP / PROTECTED_BE).
 * 4. Поведение каждой политики на минимальной паре «первая + встречная».
 *
 * Свечи здесь синтетические НАМЕРЕННО: это регрессия на границы автомата, а
 * не основание для выводов. Выводы делаются только на закреплённом реальном
 * датасете в scripts/audit-signal-conflicts.mts.
 */

import { describe, it, expect } from 'vitest';
import type { ArchiveCandle, ArchiveDirection } from '@/services/strategyArchive/types';
import { V33_CONSTANTS, manageTrade as manageV33 } from '@/services/strategyArchive/definitions/v3_3-htf-zone-mitigation/v33Core';
import { V30_CONSTANTS, manageTrade as manageV30 } from '@/services/strategyArchive/definitions/v3_0-htf-liquidation-trap/v30Core';
import {
  traceTrade, verifyTracer, stateAt, runPolicy, metricsOf, overlapsOf, maxConcurrent,
  V33_ID, buildTradesFromDump, type Trade, type ProdDump,
} from '../../scripts/lib/conflictPolicies';

const HOUR = 3_600_000;
const T0 = Date.parse('2026-01-01T00:00:00Z');

function bar(i: number, o: number, h: number, l: number, c: number): ArchiveCandle {
  return {
    openTime: T0 + i * HOUR, closeTime: T0 + (i + 1) * HOUR - 1,
    open: o, high: h, low: l, close: c, volume: 1000, isClosed: true,
  };
}

/** LONG 100 / стоп 90 / TP1 110 / TP2 130: TP1 на баре 1, TP2 на баре 3. */
const TP2_BARS: ArchiveCandle[] = [
  bar(0, 100, 105, 98, 104),
  bar(1, 104, 112, 103, 111),
  bar(2, 111, 115, 108, 112),
  bar(3, 112, 131, 110, 130),
];

const LONG_TRADE = { direction: 'LONG' as ArchiveDirection, entry: 100, stop0: 90, tp1: 110, tp2: 130 };

const V33 = { timeoutBars: V33_CONSTANTS.TIMEOUT_BARS, makerBps: V33_CONSTANTS.MAKER_BPS, takerBps: V33_CONSTANTS.TAKER_BPS };
const V30 = { timeoutBars: V30_CONSTANTS.TIMEOUT_BARS, makerBps: V30_CONSTANTS.MAKER_BPS, takerBps: V30_CONSTANTS.TAKER_BPS };

function flat(n: number, from: number, price: number): ArchiveCandle[] {
  return Array.from({ length: n }, (_, k) => bar(from + k, price, price + 1, price - 1, price));
}

describe('traceTrade == замороженная manageTrade', () => {
  const cases: { name: string; dir: ArchiveDirection; entry: number; stop: number; tp1: number; tp2: number; bars: ArchiveCandle[] }[] = [
    { name: 'TP2 после TP1', dir: 'LONG', entry: 100, stop: 90, tp1: 110, tp2: 130, bars: TP2_BARS },
    {
      name: 'SL без TP1', dir: 'LONG', entry: 100, stop: 90, tp1: 110, tp2: 130,
      bars: [bar(0, 100, 102, 96, 97), bar(1, 97, 98, 89, 91)],
    },
    {
      name: 'TP1 затем безубыток', dir: 'LONG', entry: 100, stop: 90, tp1: 110, tp2: 130,
      bars: [bar(0, 100, 111, 99, 110), bar(1, 110, 112, 108, 109), bar(2, 109, 110, 95, 99)],
    },
    {
      name: 'TP1 и SL на одном баре (стоп раньше целей)', dir: 'LONG', entry: 100, stop: 90, tp1: 110, tp2: 130,
      bars: [bar(0, 100, 115, 88, 95)],
    },
    {
      name: 'TP2 без отдельного касания TP1', dir: 'LONG', entry: 100, stop: 90, tp1: 110, tp2: 130,
      bars: [bar(0, 100, 135, 99, 133)],
    },
    {
      name: 'SHORT TP2', dir: 'SHORT', entry: 100, stop: 110, tp1: 90, tp2: 70,
      bars: [bar(0, 100, 101, 89, 91), bar(1, 91, 93, 88, 90), bar(2, 90, 92, 69, 71)],
    },
    {
      name: 'SHORT SL', dir: 'SHORT', entry: 100, stop: 110, tp1: 90, tp2: 70,
      bars: [bar(0, 100, 105, 98, 104), bar(1, 104, 111, 103, 110)],
    },
    {
      name: 'таймаут без TP1', dir: 'LONG', entry: 100, stop: 90, tp1: 110, tp2: 130,
      bars: flat(60, 0, 100),
    },
  ];

  for (const c of cases) {
    for (const [label, cfg, manage] of [['V3.3', V33, manageV33], ['V3.0', V30, manageV30]] as const) {
      it(`${label}: ${c.name}`, () => {
        const t = traceTrade({
          direction: c.dir, entry: c.entry, stop0: c.stop, tp1: c.tp1, tp2: c.tp2,
          bars: c.bars, ...cfg,
        });
        const r = manage(c.dir, c.entry, c.stop, c.tp1, c.tp2, c.bars);
        expect(t, 'tracer вернул null').not.toBeNull();
        expect(r, 'ядро вернуло null').not.toBeNull();
        expect(t!.exit).toBe(r!.exit);
        expect(t!.grossR).toBeCloseTo(r!.grossR, 12);
        expect(t!.netR).toBeCloseTo(r!.grossR - r!.feeR(cfg.makerBps, cfg.takerBps), 12);
        expect(t!.barsHeld).toBe(r!.barsHeld);
        expect(t!.hitTp1).toBe(r!.hitTp1);
        expect(t!.hitTp2).toBe(r!.hitTp2);
      });
    }
  }

  it('стоп раньше целей: при касании TP1 и стопа на одном баре исход SL', () => {
    const t = traceTrade({ ...LONG_TRADE, bars: [bar(0, 100, 115, 88, 95)], ...V33 })!;
    expect(t.exit).toBe('SL');
    expect(t.hitTp1).toBe(false);
    expect(t.grossR).toBeCloseTo(-1, 12);
  });
});

describe('досрочное закрытие (контрфакт политик C и D)', () => {
  it('до TP1 закрывается ВСЯ позиция', () => {
    const t = traceTrade({ ...LONG_TRADE, bars: TP2_BARS, ...V33, closeAt: { bar: 1, price: 105 } })!;
    expect(t.exit).toBe('CLOSED_ON_OPPOSITE');
    expect(t.hitTp1).toBe(false);
    // весь объём по 105 при риске 10 ⇒ +0.5 R
    expect(t.grossR).toBeCloseTo(0.5, 12);
    expect(t.exitBar).toBe(1);
  });

  it('после TP1 закрывается только ОСТАТОК, зафиксированные 50 % сохраняются', () => {
    const t = traceTrade({ ...LONG_TRADE, bars: TP2_BARS, ...V33, closeAt: { bar: 2, price: 111 } })!;
    expect(t.exit).toBe('CLOSED_REMAINDER_ON_OPPOSITE');
    expect(t.hitTp1).toBe(true);
    // 0.5 * (110-100)/10  +  0.5 * (111-100)/10 = 0.5 + 0.55
    expect(t.grossR).toBeCloseTo(1.05, 12);
  });

  it('закрытие проверяется ДО правил бара: встречная входит по открытию', () => {
    // На баре 3 цена дошла бы до TP2, но встречный сигнал закрывает остаток раньше.
    const early = traceTrade({ ...LONG_TRADE, bars: TP2_BARS, ...V33, closeAt: { bar: 3, price: 112 } })!;
    const full = traceTrade({ ...LONG_TRADE, bars: TP2_BARS, ...V33 })!;
    expect(full.exit).toBe('TP2');
    expect(early.exit).toBe('CLOSED_REMAINDER_ON_OPPOSITE');
    expect(early.grossR).toBeLessThan(full.grossR);
  });

  it('закрытие после фактического выхода не меняет сделку', () => {
    const t = traceTrade({ ...LONG_TRADE, bars: TP2_BARS, ...V33, closeAt: { bar: 9, price: 999 } })!;
    expect(t.exit).toBe('TP2');
  });
});

/* ── сборка Trade для проверок состояния и политик ────────────────────── */

function mkTrade(o: {
  id: string; direction: ArchiveDirection; fillIndex: number; entry: number; stop: number;
  tp1: number; tp2: number; bars: ArchiveCandle[]; publishedAtBar: number;
}): Trade {
  const base = traceTrade({
    direction: o.direction, entry: o.entry, stop0: o.stop, tp1: o.tp1, tp2: o.tp2,
    bars: o.bars, ...V33,
  })!;
  return {
    id: o.id, strategyId: V33_ID, symbol: 'SOL/USDT', direction: o.direction,
    publishedAt: T0 + (o.publishedAtBar + 1) * HOUR - 1,
    setupOpenTime: T0 + o.publishedAtBar * HOUR,
    fillIndex: o.fillIndex, fillTime: o.bars[0]!.openTime, fillPrice: o.entry,
    stop: o.stop, tp1: o.tp1, tp2: o.tp2,
    timeoutBars: V33.timeoutBars, makerBps: V33.makerBps, takerBps: V33.takerBps,
    bars: o.bars, base,
  };
}

const FIRST = mkTrade({
  id: 'FIRST', direction: 'LONG', fillIndex: 0, entry: 100, stop: 90, tp1: 110, tp2: 130,
  bars: TP2_BARS, publishedAtBar: -1,
});

describe('stateAt — состояние первой сделки в произвольный момент', () => {
  it('до TP1: OPEN_FULL, оригинальный стоп, realized 0', () => {
    const st = stateAt(FIRST, TP2_BARS[0]!.closeTime)!;
    expect(st.state).toBe('BEFORE_TP1');
    expect(st.size).toBe('OPEN_FULL');
    expect(st.protection).toBe('ORIGINAL_STOP');
    expect(st.realizedR).toBe(0);
    expect(st.unrealizedR).toBeCloseTo(0.4, 12);   // close 104 при риске 10
    expect(st.nextTarget).toBe(110);
  });

  it('на баре TP1: остаток 50 %, но безубыток ещё НЕ взведён', () => {
    const st = stateAt(FIRST, TP2_BARS[1]!.closeTime)!;
    expect(st.state).toBe('AFTER_TP1');
    expect(st.size).toBe('OPEN_REMAINDER');
    expect(st.protection).toBe('ORIGINAL_STOP');
    expect(st.realizedR).toBeCloseTo(0.5, 12);
    expect(st.unrealizedR).toBeCloseTo(0.55, 12);  // 0.5 * (111-100)/10
    expect(st.nextTarget).toBe(130);
  });

  it('со следующего бара после TP1 стоп в безубытке', () => {
    const st = stateAt(FIRST, TP2_BARS[2]!.closeTime)!;
    expect(st.protection).toBe('PROTECTED_BE');
  });

  it('вне интервала жизни позиции состояния нет', () => {
    expect(stateAt(FIRST, TP2_BARS[0]!.openTime - 1)).toBeNull();
    expect(stateAt(FIRST, TP2_BARS[3]!.closeTime + HOUR)).toBeNull();
  });
});

describe('политики на минимальной паре «первая + встречная»', () => {
  /** Встречный SHORT публикуется на баре 1 и исполняется на баре 2. */
  const OPPOSITE = mkTrade({
    id: 'OPP', direction: 'SHORT', fillIndex: 2, entry: 111, stop: 121, tp1: 101, tp2: 91,
    bars: [bar(2, 111, 115, 108, 112), bar(3, 112, 131, 110, 130)], publishedAtBar: 1,
  });
  const pair = [FIRST, OPPOSITE];

  it('A_BASELINE: обе сделки живут независимо, пересечение остаётся', () => {
    const run = runPolicy('A_BASELINE', pair);
    expect(run.applied).toHaveLength(2);
    expect(run.rejected).toHaveLength(0);
    expect(metricsOf(run).oppositeOverlaps).toBe(1);
    expect(maxConcurrent(run.applied)).toBe(2);
  });

  it('B_BLOCK_OPPOSITE: встречная не публикуется, первая не тронута', () => {
    const run = runPolicy('B_BLOCK_OPPOSITE', pair);
    expect(run.applied).toHaveLength(1);
    expect(run.applied[0]!.trade.id).toBe('FIRST');
    expect(run.applied[0]!.result.exit).toBe('TP2');
    expect(run.rejected[0]!.reason).toBe('BLOCKED_OPPOSITE_OPEN');
    expect(metricsOf(run).oppositeOverlaps).toBe(0);
  });

  it('C_EXIT_ON_OPPOSITE: первая обрезается по цене входа встречной', () => {
    const run = runPolicy('C_EXIT_ON_OPPOSITE', pair);
    expect(run.applied).toHaveLength(2);
    const first = run.applied.find((a) => a.trade.id === 'FIRST')!;
    expect(first.result.exit).toBe('CLOSED_REMAINDER_ON_OPPOSITE');
    expect(first.truncatedBy).toBe('OPP');
    expect(first.result.grossR).toBeCloseTo(1.05, 12);
  });

  it('D: TP1 уже взят ⇒ ведёт себя как C', () => {
    const run = runPolicy('D_EXIT_REMAINDER_AFTER_TP1', pair);
    const first = run.applied.find((a) => a.trade.id === 'FIRST')!;
    expect(first.result.exit).toBe('CLOSED_REMAINDER_ON_OPPOSITE');
    expect(run.applied).toHaveLength(2);
    expect(run.deferred).toHaveLength(0);
  });

  it('D: TP1 НЕ взят ⇒ встречная откладывается, первая остаётся целой', () => {
    // Первая сделка, которая идёт в TP2 без промежуточного бара с TP1 до входа
    // встречной: встречная исполняется на баре 1, TP1 ещё не случился.
    const slowBars = [bar(0, 100, 105, 98, 104), bar(1, 104, 106, 103, 105), bar(2, 105, 131, 104, 130)];
    const slow = mkTrade({
      id: 'SLOW', direction: 'LONG', fillIndex: 0, entry: 100, stop: 90, tp1: 110, tp2: 130,
      bars: slowBars, publishedAtBar: -1,
    });
    const opp = mkTrade({
      id: 'OPP2', direction: 'SHORT', fillIndex: 1, entry: 104, stop: 114, tp1: 94, tp2: 84,
      bars: [bar(1, 104, 106, 103, 105), bar(2, 105, 131, 104, 130)], publishedAtBar: 0,
    });
    const run = runPolicy('D_EXIT_REMAINDER_AFTER_TP1', [slow, opp]);
    expect(run.applied).toHaveLength(1);
    expect(run.applied[0]!.trade.id).toBe('SLOW');
    expect(run.applied[0]!.truncatedBy).toBeNull();
    expect(run.deferred).toHaveLength(1);
    expect(run.deferred[0]!.id).toBe('OPP2');
    expect(run.rejected[0]!.reason).toBe('DEFERRED_TP1_NOT_REACHED');
  });

  it('E_SAME_DIRECTION_DEDUP: встречная другого направления НЕ блокируется', () => {
    const run = runPolicy('E_SAME_DIRECTION_DEDUP', pair);
    expect(run.applied).toHaveLength(2);
    expect(run.rejected).toHaveLength(0);
  });

  it('E_SAME_DIRECTION_DEDUP: второй LONG при открытом LONG отклоняется', () => {
    const second = mkTrade({
      id: 'SECOND_LONG', direction: 'LONG', fillIndex: 2, entry: 111, stop: 101, tp1: 121, tp2: 141,
      bars: [bar(2, 111, 115, 108, 112), bar(3, 112, 131, 110, 130), bar(4, 130, 145, 128, 143)],
      publishedAtBar: 1,
    });
    const dup = [FIRST, second];
    expect(overlapsOf(runPolicy('A_BASELINE', dup).applied, false)).toHaveLength(1);
    const run = runPolicy('E_SAME_DIRECTION_DEDUP', dup);
    expect(run.applied).toHaveLength(1);
    expect(run.rejected[0]!.reason).toBe('BLOCKED_SAME_DIRECTION_OPEN');
    expect(metricsOf(run).sameDirDuplicates).toBe(0);
  });
});

describe('verifyTracer — страховка всего исследования', () => {
  it('на корректной сделке расхождений нет', () => {
    const res = verifyTracer([FIRST]);
    expect(res.checked).toBe(1);
    expect(res.mismatches).toEqual([]);
  });

  it('подменённый результат немедленно ловится', () => {
    const broken: Trade = { ...FIRST, base: { ...FIRST.base, grossR: FIRST.base.grossR + 1 } };
    const res = verifyTracer([broken]);
    expect(res.mismatches).toHaveLength(1);
    expect(res.mismatches[0]).toContain('≠ tracer');
  });
});

describe('метрики', () => {
  it('maxConcurrent считает одновременные позиции, а не сделки', () => {
    const run = runPolicy('A_BASELINE', [FIRST]);
    expect(maxConcurrent(run.applied)).toBe(1);
    const m = metricsOf(run);
    expect(m.trades).toBe(1);
    expect(m.tp2).toBe(1);
    expect(m.tp1).toBe(1);
    expect(m.sl).toBe(0);
    expect(m.expectancy).toBeCloseTo(m.netR, 12);
  });
});

describe('buildTradesFromDump — вход из боевого READ-ONLY дампа', () => {
  it('восстанавливает сделку по строке БД и окну свечей', () => {
    const dump = {
      generatedAt: '2026-09-30T00:00:00Z',
      signals: [{
        id: 'sig-1', strategyId: V33_ID, symbol: 'SOL/USDT', timeframe: '1h',
        direction: 'LONG' as ArchiveDirection,
        signalCandleTs: new Date(T0 - HOUR).toISOString(),
        createdAt: new Date(T0 - 1).toISOString(),
        entryMin: 99, entryMax: 100, stopLoss: 90, targets: [110, 130],
        status: 'FILLED', fillPrice: 100, filledAt: new Date(T0).toISOString(),
      }],
      candles: { 'SOL/USDT|1h': TP2_BARS },
    };
    const { trades, skipped } = buildTradesFromDump(dump as ProdDump);
    expect(skipped).toEqual([]);
    expect(trades).toHaveLength(1);
    expect(trades[0].base.exit).toBe('TP2');
    // Публикация берётся из created_at, а не из закрытия бара сетапа.
    expect(trades[0].publishedAt).toBe(T0 - 1);
  });

  it('строку без исполнения и строку вне окна свечей пропускает с причиной', () => {
    const base = {
      strategyId: V33_ID, symbol: 'SOL/USDT', timeframe: '1h',
      direction: 'LONG' as ArchiveDirection,
      signalCandleTs: new Date(T0).toISOString(), createdAt: null,
      entryMin: 99, entryMax: 100, stopLoss: 90, targets: [110, 130], status: 'FILLED',
    };
    const { trades, skipped } = buildTradesFromDump({
      generatedAt: 'x',
      signals: [
        { ...base, id: 'no-fill', fillPrice: null, filledAt: null },
        { ...base, id: 'out-of-window', fillPrice: 100, filledAt: new Date(T0 - 99 * HOUR).toISOString() },
      ],
      candles: { 'SOL/USDT|1h': TP2_BARS },
    });
    expect(trades).toHaveLength(0);
    expect(skipped[0]).toContain('нет исполнения');
    expect(skipped[1]).toContain('вне окна свечей');
  });
});

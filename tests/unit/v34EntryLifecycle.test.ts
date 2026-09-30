/**
 * V3.4 — РЕАЛЬНЫЙ ЖИЗНЕННЫЙ ЦИКЛ ВХОДА.
 *
 * Обязательные проверки из постановки (нумерация сохранена):
 *   1  close бара-триггера внутри зоны → НЕ исполнено
 *   2  после публикации цена не касается зоны → WAITING
 *   3  последующая минута касается зоны → FILLED
 *   4  LONG, касание ровно по границе
 *   5  SHORT, касание ровно по границе
 *   6  гэп ВНУТРЬ зоны
 *   7  гэп СКВОЗЬ зону
 *   8  касания не было → истечение
 *   9  TP до входа не считается TP
 *  10  SL до входа не считается убытком сделки
 *  11  после входа работает существующий цикл TP1
 *  12  после входа работает существующий цикл TP2
 *  13  историческая регрессия V3.3 не изменилась
 *  14  отсутствие заглядывания в будущее
 *
 * Плюс инварианты изоляции: V3.0/V3.3 не ходят в новый модуль, а V3.4 без
 * минутных свечей не исполняется по часовым (fail-closed).
 */
import { describe, expect, it } from 'vitest';
import type { ArchiveCandle } from '@/services/strategyArchive/types';
import type { AnalyticalSetup } from '@/services/signals/SignalsAuditLedger';
import {
  entryEligibleFrom, entryExpiresAt, partialHourFromFill, resolveV34Entry,
  touchesZone, v34FillPrice, V34_ENTRY_EXPIRY_BARS, V34_EXEC_TF_MS,
} from '@/services/signals/live/v34EntryLifecycle';
import { trackPublishedSetup } from '@/services/signals/live/lifecycle';
import { V33_STRATEGY_ID } from '@/services/signals/live/replays/v33LiveReplay';
import { V34_STRATEGY_ID } from '@/services/signals/live/replays/v34LiveReplay';
import { V30_STRATEGY_ID } from '@/services/signals/live/replays/v30LiveReplay';
import { V33_CONSTANTS } from '@/services/strategyArchive/definitions/v3_3-htf-zone-mitigation/v33Core';

/* ─────────────────────────────────────────────────────────── строители ── */

const MIN = 60_000;
const HOUR = V34_EXEC_TF_MS;
/** Бар-триггер: ровный час, чтобы времена читались глазами. */
const SETUP_OPEN = Date.UTC(2026, 0, 5, 12, 0, 0);
const SETUP_CLOSE = SETUP_OPEN + HOUR;      // 13:00 — момент, когда сетап опубликован
const PUBLISHED_AT = SETUP_CLOSE + 20_000;  // публикация через 20 с после закрытия бара

function m(openTime: number, o: number, h: number, l: number, c: number, closed = true): ArchiveCandle {
  return { openTime, open: o, high: h, low: l, close: c, volume: 100, closeTime: openTime + MIN - 1, isClosed: closed };
}
function hour(openTime: number, o: number, h: number, l: number, c: number): ArchiveCandle {
  return { openTime, open: o, high: h, low: l, close: c, volume: 1000, closeTime: openTime + HOUR - 1, isClosed: true };
}
/** Серия спокойных минут, не задевающая ни зону, ни стоп, ни цель. */
function calmMinutes(from: number, count: number, price: number): ArchiveCandle[] {
  return Array.from({ length: count }, (_, i) => m(from + i * MIN, price, price + 0.1, price - 0.1, price));
}

/** LONG-заготовка: зона 100–102, стоп 95, TP1 110, TP2 130. */
const LONG = {
  direction: 'LONG' as const,
  zoneLow: 100, zoneHigh: 102, stop: 95, tp1: 110,
  setupOpenTime: SETUP_OPEN, publishedAtMs: PUBLISHED_AT,
};
/** SHORT-заготовка: зона 100–102, стоп 107, TP1 92, TP2 80. */
const SHORT = {
  direction: 'SHORT' as const,
  zoneLow: 100, zoneHigh: 102, stop: 107, tp1: 92,
  setupOpenTime: SETUP_OPEN, publishedAtMs: PUBLISHED_AT,
};

function setup(over: Partial<AnalyticalSetup> = {}): AnalyticalSetup {
  return {
    id: 'test-setup',
    strategyId: V34_STRATEGY_ID,
    strategyVersion: '3.4.0',
    symbol: 'BTC/USDT',
    direction: 'LONG',
    timeframe: '1h',
    setupOpenTime: SETUP_OPEN,
    entryType: 'LIMIT_CORRIDOR',
    entryZone: [100, 102],
    invalidationLevel: 95,
    targets: [110, 130],
    riskRewardRatio: 2,
    confirmingFactors: [],
    invalidationFactors: [],
    exitRule: 'test',
    validForBars: V34_ENTRY_EXPIRY_BARS,
    createdAt: new Date(PUBLISHED_AT).toISOString(),
    latencyBars: 0,
    status: 'ACTIVE',
    prevHash: 'GENESIS',
    auditHash: 'GENESIS',
    ...over,
  } as AnalyticalSetup;
}

/* ══════════════════════════════════════════════════ 1. триггер не входит ══ */

describe('1. бар-триггер не может исполнить сам себя', () => {
  it('close триггера внутри зоны не даёт FILLED', () => {
    // Минуты САМОГО бара-триггера целиком внутри зоны 100–102.
    const triggerMinutes = Array.from({ length: 60 }, (_, i) => m(SETUP_OPEN + i * MIN, 101, 101.5, 100.5, 101));
    const res = resolveV34Entry({ ...LONG, m1: triggerMinutes });
    expect(res.state).toBe('WAITING_FOR_ENTRY');
    expect(res.fill).toBeNull();
    expect(res.observedBars).toBe(0);           // ни одна минута триггера не рассмотрена
  });

  it('eligibleFrom не раньше закрытия бара-триггера И не раньше публикации', () => {
    expect(entryEligibleFrom(LONG)).toBe(PUBLISHED_AT);
    // публикация раньше закрытия бара (теоретически невозможна) — берётся закрытие
    expect(entryEligibleFrom({ ...LONG, publishedAtMs: SETUP_OPEN + 10 })).toBe(SETUP_CLOSE);
  });

  it('минута, начавшаяся до публикации, отбрасывается целиком', () => {
    // 13:00 — минута уже внутри зоны, но она стартовала ДО публикации (13:00:20)
    const m1 = [m(SETUP_CLOSE, 101, 101.5, 100.5, 101), ...calmMinutes(SETUP_CLOSE + MIN, 30, 105)];
    const res = resolveV34Entry({ ...LONG, m1 });
    expect(res.state).toBe('WAITING_FOR_ENTRY');
  });

  it('незакрытая минутная свеча игнорируется', () => {
    const m1 = [m(SETUP_CLOSE + MIN, 101, 101.5, 100.5, 101, false)];
    expect(resolveV34Entry({ ...LONG, m1 }).state).toBe('WAITING_FOR_ENTRY');
  });
});

/* ═══════════════════════════════════════════════════ 2. ожидание входа ══ */

describe('2. после публикации цена не касается зоны → WAITING', () => {
  it('цена держится выше зоны — состояние WAITING_FOR_ENTRY', () => {
    const m1 = calmMinutes(SETUP_CLOSE + MIN, 45, 105);
    const res = resolveV34Entry({ ...LONG, m1 });
    expect(res.state).toBe('WAITING_FOR_ENTRY');
    expect(res.fill).toBeNull();
    expect(res.decidedAt).toBeNull();
    expect(res.observedBars).toBe(45);
  });

  it('в lifecycle это UNCHANGED, а не выдуманный исход', () => {
    const h1 = [hour(SETUP_OPEN, 105, 106, 104, 105)];
    const r = trackPublishedSetup(setup(), h1, { m1: calmMinutes(SETUP_CLOSE + MIN, 45, 105) });
    expect(r.kind).toBe('UNCHANGED');
  });
});

/* ═════════════════════════════════════════════════════ 3. вход по 1m ══ */

describe('3. последующая минута касается зоны → FILLED', () => {
  it('исполнение по первой коснувшейся минуте', () => {
    const m1 = [
      ...calmMinutes(SETUP_CLOSE + MIN, 5, 105),
      m(SETUP_CLOSE + 6 * MIN, 104, 104.2, 101.5, 102.5),   // опустилась в зону
      ...calmMinutes(SETUP_CLOSE + 7 * MIN, 5, 101),
    ];
    const res = resolveV34Entry({ ...LONG, m1 });
    expect(res.state).toBe('FILLED');
    expect(res.fill).toEqual({ price: 102, barOpenTime: SETUP_CLOSE + 6 * MIN });  // min(open 104, zoneHigh 102)
    expect(res.observedBars).toBe(6);
  });

  it('исполняет ПЕРВАЯ подходящая минута, а не лучшая', () => {
    const m1 = [
      m(SETUP_CLOSE + MIN, 103, 103.2, 101.9, 102),          // первое касание
      m(SETUP_CLOSE + 2 * MIN, 101, 101.1, 100.0, 100.2),    // было бы выгоднее
    ];
    expect(resolveV34Entry({ ...LONG, m1 }).fill?.barOpenTime).toBe(SETUP_CLOSE + MIN);
  });
});

/* ════════════════════════════════════════════ 4–5. касание по границе ══ */

describe('4. LONG: касание ровно по границе', () => {
  it('low == zoneHigh считается касанием, цена входа = zoneHigh', () => {
    const m1 = [m(SETUP_CLOSE + MIN, 104, 104.5, 102, 103)];  // low ровно 102
    const res = resolveV34Entry({ ...LONG, m1 });
    expect(res.state).toBe('FILLED');
    expect(res.fill!.price).toBe(102);
  });

  it('low на тик выше zoneHigh касанием не считается', () => {
    const m1 = [m(SETUP_CLOSE + MIN, 104, 104.5, 102.0001, 103)];
    expect(resolveV34Entry({ ...LONG, m1 }).state).toBe('WAITING_FOR_ENTRY');
  });

  it('условие касания симметрично: high == zoneLow тоже касание', () => {
    expect(touchesZone({ high: 100, low: 98 }, 100, 102)).toBe(true);
    expect(touchesZone({ high: 99.9999, low: 98 }, 100, 102)).toBe(false);
  });
});

describe('5. SHORT: касание ровно по границе', () => {
  it('high == zoneLow считается касанием, цена входа = zoneLow', () => {
    const m1 = [m(SETUP_CLOSE + MIN, 98, 100, 97.5, 99)];     // high ровно 100
    const res = resolveV34Entry({ ...SHORT, m1 });
    expect(res.state).toBe('FILLED');
    expect(res.fill!.price).toBe(100);
  });

  it('high на тик ниже zoneLow касанием не считается', () => {
    const m1 = [m(SETUP_CLOSE + MIN, 98, 99.9999, 97.5, 99)];
    expect(resolveV34Entry({ ...SHORT, m1 }).state).toBe('WAITING_FOR_ENTRY');
  });
});

/* ══════════════════════════════════════════════════════ 6–7. гэпы ══ */

describe('6. гэп ВНУТРЬ зоны', () => {
  it('LONG: открытие внутри зоны → вход по открытию', () => {
    const m1 = [m(SETUP_CLOSE + MIN, 101, 101.4, 100.8, 101.2)];
    expect(resolveV34Entry({ ...LONG, m1 }).fill!.price).toBe(101);
  });

  it('SHORT: открытие внутри зоны → вход по открытию', () => {
    const m1 = [m(SETUP_CLOSE + MIN, 101, 101.4, 100.8, 101.2)];
    expect(resolveV34Entry({ ...SHORT, m1 }).fill!.price).toBe(101);
  });

  it('вход по открытию, а не по грани, даже если свеча дошла до дальней границы', () => {
    const m1 = [m(SETUP_CLOSE + MIN, 101, 102, 100, 100.5)];
    expect(resolveV34Entry({ ...LONG, m1 }).fill!.price).toBe(101);
    expect(resolveV34Entry({ ...SHORT, m1 }).fill!.price).toBe(101);
  });
});

describe('7. гэп СКВОЗЬ зону', () => {
  it('LONG: гэп НИЖЕ зоны с возвратом в неё → вход по открытию (рынок лучше лимита)', () => {
    // открытие 98 ниже zoneLow=100 (и выше стопа 95), свеча дотягивается до 100.5
    const m1 = [m(SETUP_CLOSE + MIN, 98, 100.5, 97, 100.2)];
    const res = resolveV34Entry({ ...LONG, m1 });
    expect(res.state).toBe('FILLED');
    expect(res.fill!.price).toBe(98);
  });

  it('SHORT: гэп ВЫШЕ зоны с возвратом в неё → вход по открытию', () => {
    // открытие 104 выше zoneHigh=102 (и ниже стопа 107), свеча опускается до 101.5
    const m1 = [m(SETUP_CLOSE + MIN, 104, 105, 101.5, 101.8)];
    const res = resolveV34Entry({ ...SHORT, m1 });
    expect(res.state).toBe('FILLED');
    expect(res.fill!.price).toBe(104);
  });

  it('свеча целиком ЗА зоной с выгодной стороны касанием НЕ считается', () => {
    // LONG: high 99 < zoneLow 100 — пересечения диапазонов нет.
    // Осознанное следствие заданного условия касания; см. докблок модуля.
    const below = [m(SETUP_CLOSE + MIN, 98, 99, 97, 98.5)];
    expect(resolveV34Entry({ ...LONG, m1: below }).state).toBe('WAITING_FOR_ENTRY');
    // SHORT: low 103 > zoneHigh 102
    const above = [m(SETUP_CLOSE + MIN, 104, 105, 103, 104.5)];
    expect(resolveV34Entry({ ...SHORT, m1: above }).state).toBe('WAITING_FOR_ENTRY');
  });

  it('уход за зону с выгодной стороны на практике поглощается стопом', () => {
    // LONG: свеча целиком ниже зоны и доходит до стопа 95 ⇒ инвалидация, а не зависание
    const m1 = [m(SETUP_CLOSE + MIN, 98, 99, 94.9, 95.2)];
    expect(resolveV34Entry({ ...LONG, m1 }).state).toBe('INVALIDATED');
  });

  it('LONG: свеча накрыла зону сверху вниз → вход ровно по zoneHigh', () => {
    const m1 = [m(SETUP_CLOSE + MIN, 106, 106.2, 99, 99.5)];
    expect(resolveV34Entry({ ...LONG, m1 }).fill!.price).toBe(102);
  });

  it('SHORT: свеча накрыла зону снизу вверх → вход ровно по zoneLow', () => {
    const m1 = [m(SETUP_CLOSE + MIN, 96, 103, 95.5, 102.5)];
    expect(resolveV34Entry({ ...SHORT, m1 }).fill!.price).toBe(100);
  });

  it('формула цены входа покрывает все пять случаев без ветвлений', () => {
    expect(v34FillPrice('LONG', 101, 100, 102)).toBe(101);   // внутри
    expect(v34FillPrice('LONG', 104, 100, 102)).toBe(102);   // выше зоны
    expect(v34FillPrice('LONG', 98, 100, 102)).toBe(98);     // ниже зоны
    expect(v34FillPrice('SHORT', 101, 100, 102)).toBe(101);
    expect(v34FillPrice('SHORT', 98, 100, 102)).toBe(100);
    expect(v34FillPrice('SHORT', 104, 100, 102)).toBe(104);
  });
});

/* ══════════════════════════════════════════════════════ 8. истечение ══ */

describe('8. касания не было → истечение', () => {
  it('окно наблюдено целиком и касания не было → EXPIRED', () => {
    const expiresAt = entryExpiresAt(LONG);
    expect(expiresAt).toBe(SETUP_OPEN + (V34_ENTRY_EXPIRY_BARS + 1) * HOUR);
    const total = Math.ceil((expiresAt - SETUP_CLOSE) / MIN) + 5;   // с запасом за границу
    const m1 = calmMinutes(SETUP_CLOSE + MIN, total, 105);
    const res = resolveV34Entry({ ...LONG, m1 });
    expect(res.state).toBe('EXPIRED');
    expect(res.reason).toBe('ENTRY_WINDOW_EXPIRED');
    expect(res.fill).toBeNull();
  });

  it('свеча ЗА границей окна не может исполнить вход', () => {
    const expiresAt = entryExpiresAt(LONG);
    const m1 = [
      ...calmMinutes(SETUP_CLOSE + MIN, 10, 105),
      m(expiresAt, 101, 101.5, 100.5, 101),        // касание, но уже поздно
      m(expiresAt + MIN, 101, 101.5, 100.5, 101),
    ];
    const res = resolveV34Entry({ ...LONG, m1 });
    expect(res.state).toBe('EXPIRED');
    expect(res.fill).toBeNull();
  });

  it('неполные данные не превращаются в EXPIRED', () => {
    // окно ещё не наблюдено до конца — честный ответ «ждём»
    const m1 = calmMinutes(SETUP_CLOSE + MIN, 30, 105);
    expect(resolveV34Entry({ ...LONG, m1 }).state).toBe('WAITING_FOR_ENTRY');
  });

  it('lifecycle отдаёт EXPIRED без сделки и без R', () => {
    const expiresAt = entryExpiresAt(LONG);
    const total = Math.ceil((expiresAt - SETUP_CLOSE) / MIN) + 5;
    const h1 = [hour(SETUP_OPEN, 105, 106, 104, 105)];
    const r = trackPublishedSetup(setup(), h1, { m1: calmMinutes(SETUP_CLOSE + MIN, total, 105) });
    expect(r.kind).toBe('RESOLVED');
    if (r.kind !== 'RESOLVED') throw new Error('unreachable');
    expect(r.fill).toBeNull();
    expect(r.outcome.status).toBe('EXPIRED');
    expect(r.outcome.resultR).toBeNull();
    expect(r.outcome.netResultR).toBeNull();
  });
});

/* ════════════════════════════════════════════ 9. TP до входа — не TP ══ */

describe('9. TP до входа не считается TP', () => {
  it('LONG: цена ушла к TP1 мимо зоны → MISSED, а не TARGET_REACHED', () => {
    const m1 = [
      ...calmMinutes(SETUP_CLOSE + MIN, 3, 105),
      m(SETUP_CLOSE + 4 * MIN, 106, 111, 105.5, 110.5),   // пробила TP1 = 110
    ];
    const res = resolveV34Entry({ ...LONG, m1 });
    expect(res.state).toBe('MISSED');
    expect(res.reason).toBe('TARGET_BEFORE_ENTRY');
    expect(res.fill).toBeNull();
  });

  it('SHORT: цена ушла к TP1 мимо зоны → MISSED', () => {
    const m1 = [
      ...calmMinutes(SETUP_CLOSE + MIN, 3, 97),
      m(SETUP_CLOSE + 4 * MIN, 96, 96.5, 91, 91.5),       // пробила TP1 = 92
    ];
    expect(resolveV34Entry({ ...SHORT, m1 }).state).toBe('MISSED');
  });

  it('в lifecycle MISSED — это сделка, которой НЕ БЫЛО: нет fill, нет R', () => {
    const h1 = [hour(SETUP_OPEN, 105, 106, 104, 105)];
    const m1 = [
      ...calmMinutes(SETUP_CLOSE + MIN, 3, 105),
      m(SETUP_CLOSE + 4 * MIN, 106, 111, 105.5, 110.5),
    ];
    const r = trackPublishedSetup(setup(), h1, { m1 });
    expect(r.kind).toBe('RESOLVED');
    if (r.kind !== 'RESOLVED') throw new Error('unreachable');
    expect(r.fill).toBeNull();
    expect(r.outcome.exitReason).toBe('MISSED');
    expect(r.outcome.status).toBe('CANCELLED');       // «сделки не было»
    expect(r.outcome.status).not.toBe('TARGET_REACHED');
    expect(r.outcome.resultR).toBeNull();
    expect(r.outcome.pnlResultPct).toBeNull();
  });

  it('если зона задета той же минутой, что и цель — это вход, а не MISSED', () => {
    const m1 = [m(SETUP_CLOSE + MIN, 103, 111, 101, 110.5)];
    const res = resolveV34Entry({ ...LONG, m1 });
    expect(res.state).toBe('FILLED');
    expect(res.fill!.price).toBe(102);
  });
});

/* ══════════════════════════════════════════ 10. SL до входа — не убыток ══ */

describe('10. SL до входа не считается убытком сделки', () => {
  it('LONG: стоп пробит до касания зоны → INVALIDATED без R', () => {
    const m1 = [
      ...calmMinutes(SETUP_CLOSE + MIN, 2, 97),
      m(SETUP_CLOSE + 3 * MIN, 97, 97.2, 94.5, 94.8),   // пробила стоп 95, зону 100–102 не трогала
    ];
    const res = resolveV34Entry({ ...LONG, m1 });
    expect(res.state).toBe('INVALIDATED');
    expect(res.reason).toBe('STOP_BEFORE_ENTRY');
    expect(res.fill).toBeNull();
  });

  it('SHORT: стоп пробит до касания зоны → INVALIDATED', () => {
    const m1 = [m(SETUP_CLOSE + MIN, 104, 107.5, 103.5, 107)];
    // та же минута задевает и зону? нет: low 103.5 > zoneHigh 102 ⇒ касания нет
    expect(resolveV34Entry({ ...SHORT, m1 }).state).toBe('INVALIDATED');
  });

  it('стоп и зона в одной минуте → инвалидация (сомнение против сделки)', () => {
    const m1 = [m(SETUP_CLOSE + MIN, 103, 103.5, 94, 96)];
    const res = resolveV34Entry({ ...LONG, m1 });
    expect(res.state).toBe('INVALIDATED');
    expect(res.fill).toBeNull();
  });

  it('в lifecycle это CANCELLED со STOP_BEFORE_ENTRY и без R', () => {
    const h1 = [hour(SETUP_OPEN, 105, 106, 104, 105)];
    const m1 = [m(SETUP_CLOSE + MIN, 97, 97.2, 94.5, 94.8)];
    const r = trackPublishedSetup(setup(), h1, { m1 });
    expect(r.kind).toBe('RESOLVED');
    if (r.kind !== 'RESOLVED') throw new Error('unreachable');
    expect(r.fill).toBeNull();
    expect(r.outcome.status).toBe('CANCELLED');
    expect(r.outcome.exitReason).toBe('STOP_BEFORE_ENTRY');
    expect(r.outcome.status).not.toBe('INVALIDATED');   // не «стоп по сделке»
    expect(r.outcome.resultR).toBeNull();
  });
});

/* ══════════════════════════════════════ 11–12. цикл TP1/TP2 после входа ══ */

describe('11. после входа работает существующий цикл TP1', () => {
  it('TP1 → безубыток: исход CLOSED c exitReason TP1_THEN_BE', () => {
    // вход в 13:01 по 102; TP1 = 110 берётся в том же часе, затем возврат к входу
    const fillMinute = SETUP_CLOSE + MIN;
    const m1 = [
      m(fillMinute, 104, 104.2, 101.5, 102.5),
      ...Array.from({ length: 50 }, (_, i) => m(fillMinute + (i + 1) * MIN, 103, 111, 102.8, 110.5)),
    ];
    const h1 = [
      hour(SETUP_OPEN, 105, 106, 104, 105),
      // следующий час возвращается ровно к цене входа ⇒ стоп в безубытке срабатывает
      hour(SETUP_CLOSE + HOUR, 110, 111, 101, 101.5),
    ];
    const r = trackPublishedSetup(setup(), h1, { m1 });
    expect(r.kind).toBe('RESOLVED');
    if (r.kind !== 'RESOLVED') throw new Error('unreachable');
    expect(r.fill!.price).toBe(102);
    expect(r.outcome.exitReason).toBe('TP1_THEN_BE');
    expect(r.outcome.status).toBe('CLOSED');
    expect(r.outcome.resultR).not.toBeNull();
  });

  it('до входа цикл сопровождения не запускается вовсе', () => {
    // зона не задета, но часовые бары «дошли» бы и до TP, и до SL
    const h1 = [
      hour(SETUP_OPEN, 105, 106, 104, 105),
      hour(SETUP_CLOSE, 105, 131, 94, 130),
    ];
    const r = trackPublishedSetup(setup(), h1, { m1: calmMinutes(SETUP_CLOSE + MIN, 30, 105) });
    expect(r.kind).toBe('UNCHANGED');
  });
});

describe('12. после входа работает существующий цикл TP2', () => {
  it('TP2 → TARGET_REACHED с положительным R', () => {
    const fillMinute = SETUP_CLOSE + MIN;
    const m1 = [m(fillMinute, 104, 104.2, 101.5, 102.5), ...calmMinutes(fillMinute + MIN, 50, 103)];
    const h1 = [
      hour(SETUP_OPEN, 105, 106, 104, 105),
      hour(SETUP_CLOSE + HOUR, 103, 131, 102.5, 130.5),   // TP2 = 130
    ];
    const r = trackPublishedSetup(setup(), h1, { m1 });
    expect(r.kind).toBe('RESOLVED');
    if (r.kind !== 'RESOLVED') throw new Error('unreachable');
    expect(r.outcome.exitReason).toBe('TP2');
    expect(r.outcome.status).toBe('TARGET_REACHED');
    expect(r.outcome.resultR!).toBeGreaterThan(0);
  });

  it('SL после входа — это настоящий убыток сделки (INVALIDATED с R)', () => {
    const fillMinute = SETUP_CLOSE + MIN;
    const m1 = [m(fillMinute, 104, 104.2, 101.5, 102.5), ...calmMinutes(fillMinute + MIN, 50, 103)];
    const h1 = [
      hour(SETUP_OPEN, 105, 106, 104, 105),
      hour(SETUP_CLOSE + HOUR, 102, 102.5, 94, 94.5),
    ];
    const r = trackPublishedSetup(setup(), h1, { m1 });
    expect(r.kind).toBe('RESOLVED');
    if (r.kind !== 'RESOLVED') throw new Error('unreachable');
    expect(r.outcome.status).toBe('INVALIDATED');
    expect(r.outcome.exitReason).toBe('SL');
    expect(r.outcome.resultR).toBeCloseTo(-1, 10);
  });

  it('первый бар сопровождения — остаток часа от минуты входа, без движения ДО входа', () => {
    const fillMinute = SETUP_CLOSE + 30 * MIN;
    const m1 = [
      // минуты ДО входа уходят глубоко к стопу — они не должны попасть в сопровождение
      ...Array.from({ length: 30 }, (_, i) => m(SETUP_CLOSE + i * MIN, 96, 96.2, 94.0, 96)),
      m(fillMinute, 101, 101.5, 100.8, 101),
      ...calmMinutes(fillMinute + MIN, 29, 101),
    ];
    const partial = partialHourFromFill(m1, fillMinute);
    expect(partial).not.toBeNull();
    expect(partial!.openTime).toBe(SETUP_CLOSE);          // начало часа входа
    expect(partial!.open).toBe(101);                      // открытие = минута входа
    expect(partial!.low).toBeGreaterThan(100);            // провал к 94 не попал
    expect(partial!.closeTime).toBe(SETUP_CLOSE + HOUR - 1);
  });
});

/* ══════════════════════════════════ 13. регрессия V3.3 и изоляция V3.4 ══ */

describe('13. историческая семантика V3.0/V3.3 не изменилась', () => {
  const h1 = [
    hour(SETUP_OPEN, 105, 106, 104, 105),
    hour(SETUP_CLOSE, 101, 103, 99, 102),          // open внутри зоны ⇒ старый фил
    hour(SETUP_CLOSE + HOUR, 102, 131, 101, 130),
  ];

  it('V3.3 исполняется по открытию следующего часа, как и раньше', () => {
    const r = trackPublishedSetup(setup({ strategyId: V33_STRATEGY_ID }), h1);
    expect(r.kind).toBe('RESOLVED');
    if (r.kind !== 'RESOLVED') throw new Error('unreachable');
    expect(r.fill!.price).toBe(101);                         // min(open 101, zoneHigh 102)
    expect(r.fill!.barOpenTime).toBe(SETUP_CLOSE);
  });

  it('передача минутных свечей на V3.3 НИЧЕГО не меняет', () => {
    const withM1 = trackPublishedSetup(setup({ strategyId: V33_STRATEGY_ID }), h1, {
      m1: calmMinutes(SETUP_CLOSE + MIN, 300, 105),
    });
    const withoutM1 = trackPublishedSetup(setup({ strategyId: V33_STRATEGY_ID }), h1);
    expect(withM1).toEqual(withoutM1);
  });

  it('V3.0 тоже не затронут', () => {
    const a = trackPublishedSetup(setup({ strategyId: V30_STRATEGY_ID }), h1);
    const b = trackPublishedSetup(setup({ strategyId: V30_STRATEGY_ID }), h1, { m1: calmMinutes(SETUP_CLOSE, 200, 105) });
    expect(a).toEqual(b);
    expect(a.kind).toBe('RESOLVED');
  });

  it('V3.4 на тех же данных БЕЗ минуток не исполняется (fail-closed)', () => {
    const r = trackPublishedSetup(setup(), h1);
    expect(r.kind).toBe('SKIP');
    if (r.kind !== 'SKIP') throw new Error('unreachable');
    expect(r.reason).toContain('минутных');
  });

  it('V3.4 и V3.3 на одних данных дают РАЗНЫЙ вход — в этом и смысл', () => {
    const v33 = trackPublishedSetup(setup({ strategyId: V33_STRATEGY_ID }), h1);
    // у V3.4 после публикации цена в зону не возвращается
    const v34 = trackPublishedSetup(setup(), h1, { m1: calmMinutes(SETUP_CLOSE + MIN, 30, 105) });
    expect(v33.kind).toBe('RESOLVED');
    expect(v34.kind).toBe('UNCHANGED');
  });

  it('константы сопровождения у V3.4 те же, что у V3.3', () => {
    expect(V34_ENTRY_EXPIRY_BARS).toBe(V33_CONSTANTS.CORRIDOR_EXPIRY_BARS);
    expect(V34_EXEC_TF_MS).toBe(3_600_000);
  });
});

/* ═══════════════════════════════════════════════════ 14. no-lookahead ══ */

describe('14. отсутствие заглядывания в будущее', () => {
  const m1 = [
    ...calmMinutes(SETUP_CLOSE + MIN, 5, 105),
    m(SETUP_CLOSE + 6 * MIN, 104, 104.2, 101.5, 102.5),      // решение здесь
    m(SETUP_CLOSE + 7 * MIN, 102, 140, 90, 139),             // экстремальные данные после
    ...calmMinutes(SETUP_CLOSE + 8 * MIN, 60, 120),
  ];

  it('обрезка серии сразу после решающей минуты даёт тот же результат', () => {
    const full = resolveV34Entry({ ...LONG, m1 });
    const truncated = resolveV34Entry({ ...LONG, m1: m1.slice(0, 6) });
    expect(full.state).toBe('FILLED');
    expect(truncated).toEqual(full);
  });

  it('любой префикс до решения даёт WAITING, любой после — тот же FILLED', () => {
    for (let n = 0; n <= 5; n++) {
      expect(resolveV34Entry({ ...LONG, m1: m1.slice(0, n) }).state).toBe('WAITING_FOR_ENTRY');
    }
    const decided = resolveV34Entry({ ...LONG, m1: m1.slice(0, 6) });
    for (let n = 6; n <= m1.length; n++) {
      expect(resolveV34Entry({ ...LONG, m1: m1.slice(0, n) })).toEqual(decided);
    }
  });

  it('добавление будущих минут не меняет ни INVALIDATED, ни MISSED', () => {
    const stopFirst = [m(SETUP_CLOSE + MIN, 97, 97.2, 94.5, 94.8)];
    const missFirst = [m(SETUP_CLOSE + MIN, 106, 111, 105.5, 110.5)];
    const future = calmMinutes(SETUP_CLOSE + 2 * MIN, 200, 101);
    expect(resolveV34Entry({ ...LONG, m1: [...stopFirst, ...future] }))
      .toEqual(resolveV34Entry({ ...LONG, m1: stopFirst }));
    expect(resolveV34Entry({ ...LONG, m1: [...missFirst, ...future] }))
      .toEqual(resolveV34Entry({ ...LONG, m1: missFirst }));
  });

  it('первый бар сопровождения не содержит минут будущих часов', () => {
    const partial = partialHourFromFill(m1, SETUP_CLOSE + 6 * MIN);
    expect(partial!.closeTime).toBeLessThan(SETUP_CLOSE + HOUR);
    const nextHourMinutes = calmMinutes(SETUP_CLOSE + HOUR, 60, 999);
    const withNext = partialHourFromFill([...m1, ...nextHourMinutes], SETUP_CLOSE + 6 * MIN);
    expect(withNext).toEqual(partial);
  });
});

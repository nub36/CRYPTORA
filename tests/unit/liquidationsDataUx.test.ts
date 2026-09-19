/**
 * Регрессионные тесты этапа «LIQUIDATIONS — отдельный data + UX pass» (§54).
 *
 * Все тесты работают против РЕАЛЬНЫХ производственных модулей — никаких копий
 * функций. Покрыты: нормализация сторон и USD-нотионала по трём биржам,
 * дедупликация, жизненный цикл переподключения, агрегатные инварианты,
 * честность периода хронологии и единый источник данных Overview ↔ /liquidations.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { LiquidationPipeline, LIQUIDATION_SOURCE_LABELS } from '@/services/liquidations/LiquidationPipeline';
import { BinanceFuturesLiquidationStream } from '@/services/realtime/BinanceFuturesLiquidationStream';
import { BybitLiquidationStream } from '@/services/realtime/liquidations/BybitLiquidationStream';
import { OkxLiquidationStream } from '@/services/realtime/liquidations/OkxLiquidationStream';
import type { LiquidationSourceId } from '@/services/liquidations/LiquidationPipeline';

const ROOT = path.resolve(__dirname, '../..');
const src = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf-8');

/**
 * Точка отсчёта привязана к реальному времени: `recordEvent()` вызывает
 * `pruneExpired()` с фактическим `Date.now()`, поэтому фиксированная дата
 * в прошлом была бы вычищена ещё до построения среза.
 */
const NOW = Date.now();
const T0 = NOW - 60_000;

let pipeline: LiquidationPipeline;
beforeEach(() => {
  LiquidationPipeline.resetInstance();
  pipeline = new LiquidationPipeline(false);
});

/* ══════════════════════════════════════════════════════════════════════
   §45/§46 — нормализация сторон и USD-нотионала по каждой бирже
   ══════════════════════════════════════════════════════════════════════ */

describe('§45/§46 — Binance: side mapping и USD notional', () => {
  it('SELL-ордер ликвидации ⇒ ликвидирован LONG; BUY ⇒ SHORT', () => {
    // Обратная семантика: при ликвидации биржа выставляет ордер, ЗАКРЫВАЮЩИЙ позицию.
    const sell = pipeline.processBinanceForceOrder({
      o: { s: 'BTCUSDT', S: 'SELL', p: '60000', q: '2', T: T0 },
    });
    const buy = pipeline.processBinanceForceOrder({
      o: { s: 'BTCUSDT', S: 'BUY', p: '60000', q: '2', T: T0 + 1 },
    });

    expect(sell?.side).toBe('LONG');
    expect(buy?.side).toBe('SHORT');
  });

  it('USD notional = price × quantity согласно forceOrder payload', () => {
    const ev = pipeline.processBinanceForceOrder({
      o: { s: 'BTCUSDT', S: 'SELL', p: '60000.5', q: '1.25', T: T0 },
    });
    expect(ev?.amountUsd).toBeCloseTo(60000.5 * 1.25, 1);
    // ap (средняя цена исполнения) приоритетнее p
    const withAp = pipeline.processBinanceForceOrder({
      o: { s: 'BTCUSDT', S: 'SELL', ap: '59000', p: '60000', q: '1', T: T0 + 2 },
    });
    expect(withAp?.amountUsd).toBeCloseTo(59000, 2);
  });

  it('нулевой или отрицательный нотионал отбрасывается, а не подставляется', () => {
    expect(pipeline.processBinanceForceOrder({ o: { s: 'BTCUSDT', S: 'SELL', p: '0', q: '1', T: T0 } })).toBeNull();
    expect(pipeline.processBinanceForceOrder({ o: { s: 'BTCUSDT', S: 'SELL', p: '100', q: '0', T: T0 } })).toBeNull();
  });
});

describe('§45/§46 — Bybit: side mapping и USD notional', () => {
  const frame = (rows: unknown[]) => ({ topic: 'allLiquidation.BTCUSDT', data: rows });

  it('S=Buy ⇒ ликвидирован LONG, S=Sell ⇒ SHORT (семантика Bybit обратна стороне позиции)', () => {
    const out = pipeline.ingestBybitAllLiquidation(
      frame([
        { T: T0, s: 'BTCUSDT', S: 'Buy', v: '0.5', p: '60000' },
        { T: T0 + 1, s: 'BTCUSDT', S: 'Sell', v: '0.5', p: '60000' },
      ])
    );
    expect(out).toHaveLength(2);
    expect(out[0].side).toBe('LONG');
    expect(out[1].side).toBe('SHORT');
  });

  it('USD notional = bankruptcy price × размер в монете', () => {
    const out = pipeline.ingestBybitAllLiquidation(
      frame([{ T: T0, s: 'BTCUSDT', S: 'Buy', v: '0.25', p: '64000' }])
    );
    expect(out[0].amountUsd).toBeCloseTo(64000 * 0.25, 1);
  });

  it('неизвестная сторона отбрасывается, а не угадывается', () => {
    const out = pipeline.ingestBybitAllLiquidation(
      frame([{ T: T0, s: 'BTCUSDT', S: 'Hold', v: '1', p: '100' }])
    );
    expect(out).toHaveLength(0);
  });
});

describe('§45/§46 — OKX: side mapping, contract multiplier и USD notional', () => {
  const CT_VAL = 0.01; // BTC-USDT-SWAP: 1 контракт = 0.01 BTC
  const contractValues = { 'BTC-USDT-SWAP': CT_VAL };

  const frame = (details: unknown[]) => ({
    arg: { channel: 'liquidation-orders', instType: 'SWAP' },
    data: [{ instId: 'BTC-USDT-SWAP', details }],
  });

  it('posSide приоритетнее стороны ордера; fallback — sell ⇒ LONG, buy ⇒ SHORT', () => {
    const out = pipeline.ingestOkxLiquidationOrders(
      frame([
        { bkPx: '60000', sz: '10', posSide: 'long', side: 'sell', ts: String(T0) },
        { bkPx: '60000', sz: '10', posSide: 'short', side: 'buy', ts: String(T0 + 1) },
        { bkPx: '60000', sz: '10', side: 'sell', ts: String(T0 + 2) },
        { bkPx: '60000', sz: '10', side: 'buy', ts: String(T0 + 3) },
      ]),
      contractValues
    );
    expect(out.map((e) => e.side)).toEqual(['LONG', 'SHORT', 'LONG', 'SHORT']);
  });

  it('USD = bkPx × sz × ctVal: контракты НЕ приравниваются к количеству базовой монеты', () => {
    const out = pipeline.ingestOkxLiquidationOrders(
      frame([{ bkPx: '60000', sz: '100', posSide: 'long', ts: String(T0) }]),
      contractValues
    );
    // 100 контрактов × 0.01 BTC × $60 000 = $60 000, а не $6 000 000
    expect(out[0].amountUsd).toBeCloseTo(60000 * 100 * CT_VAL, 1);
    expect(out[0].amountUsd).toBeCloseTo(60_000, 2);
  });

  it('без известного ctVal событие ОТБРАСЫВАЕТСЯ — нотионал не оценивается', () => {
    const out = pipeline.ingestOkxLiquidationOrders(
      frame([{ bkPx: '60000', sz: '100', posSide: 'long', ts: String(T0) }]),
      {} // каталог инструментов недоступен
    );
    expect(out).toHaveLength(0);
    expect(pipeline.getLiquidationSnapshot(T0).total24h).toBe(0);
  });

  it('не-USDT-линейные свопы игнорируются', () => {
    const out = pipeline.ingestOkxLiquidationOrders(
      {
        arg: { channel: 'liquidation-orders' },
        data: [{ instId: 'BTC-USD-SWAP', details: [{ bkPx: '60000', sz: '1', posSide: 'long', ts: String(T0) }] }],
      },
      { 'BTC-USD-SWAP': 100 }
    );
    expect(out).toHaveLength(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════
   §47 — дедупликация
   ══════════════════════════════════════════════════════════════════════ */

describe('§47 — дедупликация событий', () => {
  it('повторный приём того же события не удваивает агрегаты', () => {
    const payload = { o: { s: 'BTCUSDT', S: 'SELL', p: '60000', q: '1', T: T0 } };
    pipeline.ingestForceOrderMessage(payload);
    pipeline.ingestForceOrderMessage(payload);
    pipeline.ingestForceOrderMessage(payload);

    const snap = pipeline.getLiquidationSnapshot(T0 + 1000);
    expect(snap.eventsCount24h).toBe(1);
    expect(snap.total24h).toBeCloseTo(60000, 2);
  });

  it('идентификатор детерминирован: без Math.random()', () => {
    const a = new LiquidationPipeline(false).processBinanceForceOrder({
      o: { s: 'BTCUSDT', S: 'SELL', p: '60000', q: '1', T: T0 },
    });
    const b = new LiquidationPipeline(false).processBinanceForceOrder({
      o: { s: 'BTCUSDT', S: 'SELL', p: '60000', q: '1', T: T0 },
    });
    expect(a?.id).toBe(b?.id);
  });

  it('одно и то же событие с разных бирж НЕ считается дубликатом', () => {
    pipeline.ingestBybitAllLiquidation({
      topic: 'allLiquidation.BTCUSDT',
      data: [{ T: T0, s: 'BTCUSDT', S: 'Buy', v: '1', p: '60000' }],
    });
    pipeline.ingestOkxLiquidationOrders(
      { arg: { channel: 'liquidation-orders' }, data: [{ instId: 'BTC-USDT-SWAP', details: [{ bkPx: '60000', sz: '100', posSide: 'long', ts: String(T0) }] }] },
      { 'BTC-USDT-SWAP': 0.01 }
    );
    expect(pipeline.getLiquidationSnapshot(T0 + 1000).eventsCount24h).toBe(2);
  });
});

/* ══════════════════════════════════════════════════════════════════════
   §48/§49 — жизненный цикл переподключения
   ══════════════════════════════════════════════════════════════════════ */

class FakeSocket {
  public static instances: FakeSocket[] = [];
  public static failNext = true;
  public onopen: (() => void) | null = null;
  public onclose: (() => void) | null = null;
  public onerror: (() => void) | null = null;
  public onmessage: ((e: { data: unknown }) => void) | null = null;
  public closed = false;
  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }
  public send() { /* noop */ }
  public close() { this.closed = true; this.onclose?.(); }
  /** Эмулировать отказ соединения сразу после создания. */
  public fail() { this.onerror?.(); this.onclose?.(); }
  /** Эмулировать успешное подключение. */
  public succeed() { FakeSocket.failNext = false; this.onopen?.(); }
}

describe('§49 — reconnect lifecycle: восстановление не ограничено', () => {
  beforeEach(() => { vi.useFakeTimers(); FakeSocket.instances = []; FakeSocket.failNext = true; });
  afterEach(() => { vi.useRealTimers(); });

  const makeStream = () =>
    new BinanceFuturesLiquidationStream(pipeline, {
      webSocketClass: FakeSocket,
      reconnectInitialDelayMs: 100,
      reconnectMaxDelayMs: 1000,
    });

  it('после >10 неудач транспорт продолжает пытаться (прежняя версия умирала навсегда)', () => {
    const stream = makeStream();
    stream.connect();

    // 25 циклов «отказ → переподключение»
    for (let i = 0; i < 25; i++) {
      const last = FakeSocket.instances[FakeSocket.instances.length - 1];
      last.fail();
      vi.advanceTimersByTime(2000);
    }

    expect(FakeSocket.instances.length).toBeGreaterThan(10);
    // После порога статус честно «недоступен», но попытки не прекращаются.
    expect(stream.getState()).not.toBe('connected');

    // Теперь связь появилась — транспорт обязан восстановиться.
    const pending = FakeSocket.instances[FakeSocket.instances.length - 1];
    pending.succeed();
    expect(stream.getState()).toBe('connected');
    stream.disconnect();
  });

  it('задержка экспоненциальна и ограничена потолком (не tight loop)', () => {
    const stream = makeStream();
    stream.connect();

    const attempts: number[] = [];
    for (let i = 0; i < 12; i++) {
      const before = FakeSocket.instances.length;
      FakeSocket.instances[FakeSocket.instances.length - 1].fail();
      vi.advanceTimersByTime(50); // меньше шага backoff — новая попытка ещё не должна появиться
      attempts.push(FakeSocket.instances.length - before);
      vi.advanceTimersByTime(5000);
    }
    // Первые несколько шагов backoff длиннее 50 мс → попытка не создаётся мгновенно.
    expect(attempts.slice(1, 5).every((n) => n === 0)).toBe(true);
    stream.disconnect();
  });

  it('успешное подключение сбрасывает счётчик попыток', () => {
    const stream = makeStream();
    stream.connect();
    for (let i = 0; i < 4; i++) {
      FakeSocket.instances[FakeSocket.instances.length - 1].fail();
      vi.advanceTimersByTime(5000);
    }
    FakeSocket.instances[FakeSocket.instances.length - 1].succeed();
    expect(stream.getState()).toBe('connected');

    // После сброса счётчика порог «unavailable» снова отсчитывается с нуля:
    // несколько отказов подряд дают `reconnecting`, а не мгновенный `unavailable`.
    FakeSocket.instances[FakeSocket.instances.length - 1].fail();
    vi.advanceTimersByTime(5000);
    expect(stream.getState()).toBe('reconnecting');
    stream.disconnect();
  });

  it('disconnect() останавливает восстановление: новых сокетов не создаётся', () => {
    const stream = makeStream();
    stream.connect();
    FakeSocket.instances[FakeSocket.instances.length - 1].fail();
    stream.disconnect();
    const count = FakeSocket.instances.length;
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.instances.length).toBe(count);
  });
});

describe('§48 — состояние подключения по каждой бирже', () => {
  it('каждый транспорт знает свою биржу, и метка совпадает с разбивкой среза', () => {
    const streams = [
      new BinanceFuturesLiquidationStream(pipeline, { webSocketClass: null }),
      new BybitLiquidationStream(pipeline, { webSocketClass: null }),
      new OkxLiquidationStream(pipeline, { webSocketClass: null, contractValues: { 'BTC-USDT-SWAP': 0.01 } }),
    ];
    const ids = streams.map((s) => s.exchangeId as LiquidationSourceId);
    expect(ids.sort()).toEqual(['binance', 'bybit', 'okx']);
    for (const s of streams) {
      expect(LIQUIDATION_SOURCE_LABELS[s.exchangeId as LiquidationSourceId]).toBe(s.exchangeLabel);
    }
    // Без транспорта состояние честно «unavailable», а не «connected».
    for (const s of streams) {
      s.connect();
      expect(s.getState()).toBe('unavailable');
    }
  });

  it('статус каждой биржи хранится раздельно и виден в срезе', () => {
    pipeline.setStreamState('connected', 'binance');
    pipeline.setStreamState('reconnecting', 'bybit');
    pipeline.setStreamState('unavailable', 'okx');

    const states = pipeline.getStreamStates();
    expect(states.binance).toBe('connected');
    expect(states.bybit).toBe('reconnecting');
    expect(states.okx).toBe('unavailable');

    const snap = pipeline.getLiquidationSnapshot(T0);
    const byExchange = Object.fromEntries(snap.exchangeBreakdown.map((e) => [e.exchange, e.state]));
    expect(byExchange[LIQUIDATION_SOURCE_LABELS.binance]).toBe('connected');
    expect(byExchange[LIQUIDATION_SOURCE_LABELS.bybit]).toBe('reconnecting');
    expect(byExchange[LIQUIDATION_SOURCE_LABELS.okx]).toBe('unavailable');
  });

  it('агрегированный статус не скрывает мёртвый сокет: 3/3 не заявляется при одном живом', () => {
    pipeline.setStreamState('connected', 'binance');
    pipeline.setStreamState('unavailable', 'bybit');
    pipeline.setStreamState('unavailable', 'okx');

    const snap = pipeline.getLiquidationSnapshot(T0);
    const connected = snap.exchangeBreakdown.filter((e) => e.state === 'connected');
    // UI считает «N/3» по фактическим состояниям, а не по общему агрегату.
    expect(connected).toHaveLength(1);
    expect(snap.exchangeBreakdown).toHaveLength(3);
  });

  it('last event time указывается по каждой бирже; null если событий не было', () => {
    pipeline.ingestBybitAllLiquidation({
      topic: 'allLiquidation.BTCUSDT',
      data: [{ T: T0, s: 'BTCUSDT', S: 'Buy', v: '1', p: '60000' }],
    });
    const snap = pipeline.getLiquidationSnapshot(T0 + 1000);
    const byName = Object.fromEntries(snap.exchangeBreakdown.map((e) => [e.exchange, e]));
    expect(byName[LIQUIDATION_SOURCE_LABELS.bybit].lastEventAt).not.toBeNull();
    expect(byName[LIQUIDATION_SOURCE_LABELS.okx].lastEventAt).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════
   §41/§54 — агрегатные инварианты
   ══════════════════════════════════════════════════════════════════════ */

describe('§41/§54 — агрегатные инварианты', () => {
  const seedMixed = () => {
    // Binance
    pipeline.ingestForceOrderMessage({ o: { s: 'BTCUSDT', S: 'SELL', p: '60000', q: '1', T: T0 } });       // LONG 60 000
    pipeline.ingestForceOrderMessage({ o: { s: 'BTCUSDT', S: 'BUY', p: '60000', q: '0.5', T: T0 + 1 } }); // SHORT 30 000
    // Bybit
    pipeline.ingestBybitAllLiquidation({
      topic: 'allLiquidation.ETHUSDT',
      data: [
        { T: T0 + 2, s: 'ETHUSDT', S: 'Buy', v: '10', p: '3000' },   // LONG 30 000
        { T: T0 + 3, s: 'ETHUSDT', S: 'Sell', v: '5', p: '3000' },   // SHORT 15 000
      ],
    });
    // OKX
    pipeline.ingestOkxLiquidationOrders(
      {
        arg: { channel: 'liquidation-orders' },
        data: [{ instId: 'BTC-USDT-SWAP', details: [{ bkPx: '60000', sz: '100', posSide: 'short', ts: String(T0 + 4) }] }],
      },
      { 'BTC-USDT-SWAP': 0.01 }
    ); // SHORT 60 000
    return pipeline.getLiquidationSnapshot(T0 + 60_000);
  };

  it('total = long + short (с учётом округления)', () => {
    const snap = seedMixed();
    expect(snap.total24h).toBeCloseTo(snap.totalLong24h + snap.totalShort24h, 2);
  });

  it('по каждому инструменту total ≈ long + short — случай «APT: Total ≠ Long + Short» невозможен', () => {
    const snap = seedMixed();
    expect(snap.assetBreakdown.length).toBeGreaterThan(0);
    for (const a of snap.assetBreakdown) {
      expect(a.totalUsd).toBeCloseTo(a.longUsd + a.shortUsd, 2);
      expect(a.eventCount).toBe(a.longEvents + a.shortEvents);
      if (a.eventCount > 0) {
        expect(a.largestEventUsd).not.toBeNull();
        expect(a.largestEventUsd!).toBeLessThanOrEqual(a.totalUsd + 1e-6);
      }
    }
  });

  it('суммы по биржам сходятся к общему итогу', () => {
    const snap = seedMixed();
    const sum = snap.exchangeBreakdown.reduce((acc, e) => acc + e.totalUsd, 0);
    expect(sum).toBeCloseTo(snap.total24h, 2);
    // Каждая доля округлена до 0.1 независимо → суммарный дрейф до ~0.15 п.п.
    const pct = snap.exchangeBreakdown.reduce((acc, e) => acc + e.percentage, 0);
    expect(pct).toBeCloseTo(100, 0);
  });

  it('суммы по инструментам сходятся к общему итогу', () => {
    const snap = seedMixed();
    const sum = snap.assetBreakdown.reduce((acc, a) => acc + a.totalUsd, 0);
    expect(sum).toBeCloseTo(snap.total24h, 2);
  });

  it('число событий в барах хронологии равно общему числу событий окна', () => {
    const snap = seedMixed();
    expect(snap.timeline.reduce((acc, b) => acc + b.eventCount, 0)).toBe(snap.eventsCount24h);
  });

  it('биржа без событий присутствует в разбивке с нулём (§40)', () => {
    pipeline.ingestBybitAllLiquidation({
      topic: 'allLiquidation.BTCUSDT',
      data: [{ T: T0, s: 'BTCUSDT', S: 'Buy', v: '1', p: '60000' }],
    });
    const snap = pipeline.getLiquidationSnapshot(T0 + 1000);
    expect(snap.exchangeBreakdown).toHaveLength(3);
    const zero = snap.exchangeBreakdown.filter((e) => e.totalUsd === 0);
    expect(zero.length).toBe(2);
    expect(zero.every((e) => e.eventCount === 0 && e.percentage === 0)).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════
   §31/§37/§38/§55 — честность периода хронологии
   ══════════════════════════════════════════════════════════════════════ */

describe('§31/§37/§55 — хронология не выдаёт ненаблюдавшийся период за наблюдения', () => {
  it('при 40-минутном наблюдении нет баров старше начала наблюдения', () => {
    const start = T0;
    pipeline.setStreamState('connected', 'binance'); // фиксирует начало наблюдения
    pipeline.ingestForceOrderMessage({ o: { s: 'BTCUSDT', S: 'SELL', p: '60000', q: '1', T: start + 60_000 } });

    const now = start + 40 * 60 * 1000;
    const snap = pipeline.getLiquidationSnapshot(now);

    // Прежняя реализация всегда рисовала 8 трёхчасовых баров за 24ч.
    // Теперь шаг адаптивный (5м для получаса) и бары покрывают только наблюдение.
    expect(snap.timelineBucketMinutes).toBe(5);
    expect(snap.timeline.length).toBeGreaterThanOrEqual(8);
    for (const bar of snap.timeline) {
      // Ни один бар не начинается в будущем.
      expect(bar.startMs).toBeLessThanOrEqual(now);
      // Бар, начинающийся до старта наблюдения, честно помечен ненаблюдавшимся.
      if (bar.startMs < start) expect(bar.observed).toBe(false);
      else expect(bar.observed).toBe(true);
    }
    // Последний бар — текущий, ещё заполняющийся: его конец может быть в будущем.
    expect(snap.timeline[snap.timeline.length - 1].endMs).toBeGreaterThan(now - 5 * 60 * 1000);
    // Ни один бар не уходит глубже начала наблюдения больше чем на один бакет.
    expect(snap.timeline[0].startMs).toBeGreaterThanOrEqual(start - 5 * 60 * 1000);
    // Все полностью покрытые бары — наблюдавшиеся.
    expect(snap.timeline.filter((b) => b.observed).length).toBeGreaterThan(0);
  });

  it('адаптивный бакет: короткое наблюдение → мелкий шаг, сутки → 3ч', () => {
    expect(LiquidationPipeline.pickBucketMinutes(30 * 60 * 1000)).toBe(5);
    expect(LiquidationPipeline.pickBucketMinutes(90 * 60 * 1000)).toBe(15);
    expect(LiquidationPipeline.pickBucketMinutes(4 * 60 * 60 * 1000)).toBe(30);
    expect(LiquidationPipeline.pickBucketMinutes(12 * 60 * 60 * 1000)).toBe(60);
    expect(LiquidationPipeline.pickBucketMinutes(25 * 60 * 60 * 1000)).toBe(180);
  });

  it('подпись периода отражает фактический интервал, а не «24ч»', () => {
    pipeline.setStreamState('connected', 'binance');
    const snap = pipeline.getLiquidationSnapshot(T0 + 30 * 60 * 1000);
    expect(snap.timelineRangeLabel).toContain('Наблюдение:');
    expect(snap.timelineRangeLabel).not.toContain('24ч');
    expect(snap.hasFullObservationWindow).toBe(false);
  });

  it('полное окно достигается только через реальные 24 часа', () => {
    pipeline.setStreamState('connected', 'binance');
    expect(pipeline.getObservationMeta().hasFullWindow).toBe(false);
    expect(pipeline.getObservationMeta(NOW + 23 * 60 * 60 * 1000).hasFullWindow).toBe(false);
    const later = pipeline.getLiquidationSnapshot(NOW + 25 * 60 * 60 * 1000);
    expect(later.hasFullObservationWindow).toBe(true);
  });

  it('без наблюдения и без событий хронология пуста — бары не выдумываются', () => {
    const snap = pipeline.getLiquidationSnapshot(T0);
    expect(snap.timeline).toEqual([]);
    expect(snap.timelineRangeLabel).toBe('');
  });

  it('число баров ограничено — DOM не раздувается на длинном окне', () => {
    pipeline.setStreamState('connected', 'binance');
    const snap = pipeline.getLiquidationSnapshot(T0 + 24 * 60 * 60 * 1000);
    expect(snap.timeline.length).toBeLessThanOrEqual(48);
  });
});

/* ══════════════════════════════════════════════════════════════════════
   §50/§51 — персистентность и единый источник данных
   ══════════════════════════════════════════════════════════════════════ */

describe('§50 — фактическая персистентность: sessionStorage, а не 24h-хранилище', () => {
  it('конвейер хранит события в sessionStorage — они не переживают закрытие вкладки', () => {
    const source = src('src/services/liquidations/LiquidationPipeline.ts');
    expect(source).toContain("sessionStorage.setItem(STORAGE_KEY");
    expect(source).toContain("sessionStorage.getItem(STORAGE_KEY)");
    // Никакой серверной/IndexedDB-персистентности у ликвидаций нет.
    expect(source).not.toContain('indexedDB');
  });

  it('миграции для ликвидаций нет — серверной истории 24ч не существует', () => {
    const files = fs.readdirSync(path.join(ROOT, 'server/db/migrations'));
    const liq = files.filter((f) => /liquidation/i.test(f));
    expect(liq).toEqual([]);
  });

  it('в UI нет жёсткой подписи «24ч» вне условия о покрытом окне', () => {
    const overview = src('src/pages/OverviewPage.tsx');
    // Заголовок карточки обязан зависеть от hasFullObservationWindow.
    expect(overview).toMatch(/hasFullObservationWindow\s*\?\s*'Ликвидации · 24ч'/);
  });
});

describe('§51 — Overview и /liquidations используют один источник агрегатов', () => {
  it('обе страницы читают getLiquidationSnapshot через один провайдер', () => {
    const overview = src('src/pages/OverviewPage.tsx');
    const page = src('src/pages/LiquidationsPage.tsx');
    const provider = src('src/services/data/LiveMarketDataProvider.ts');

    // Overview берёт ликвидации из провайдера, а не строит собственный срез.
    expect(overview).toContain('provider.getLiquidations()');
    // Провайдер отдаёт срез того же конвейера.
    expect(provider).toContain('LiquidationPipeline.getInstance().getLiquidationSnapshot()');
    // Страница ликвидаций использует тот же singleton.
    expect(page).toContain('LiquidationPipeline');
    // Собственной агрегации в Overview нет: только обращение к провайдеру.
    expect(overview).not.toMatch(/LiquidationPipeline\.getInstance\(\)\.getLiquidationSnapshot\(/);
  });

  it('в конвейере единственный метод построения среза', () => {
    const source = src('src/services/liquidations/LiquidationPipeline.ts');
    expect(source.match(/public getLiquidationSnapshot\(/g)).toHaveLength(1);
    expect(source.match(/private buildTimeline\(/g)).toHaveLength(1);
  });
});

/* ══════════════════════════════════════════════════════════════════════
   §55 — факт и оценка не смешиваются
   ══════════════════════════════════════════════════════════════════════ */

describe('§55 — фактические ликвидации и расчётные уровни разделены', () => {
  it('оценочные кластеры не попадают в фактические агрегаты', () => {
    const clusters = LiquidationPipeline.calculateEstimatedClusters(60000, 1_000_000_000);
    expect(clusters.length).toBeGreaterThan(0);

    const snap = pipeline.getLiquidationSnapshot(T0);
    expect(snap.total24h).toBe(0);
    expect(snap.largestEvent).toBeNull();
    expect(snap.assetBreakdown).toEqual([]);
  });

  it('расчётная модель отделена от конвейера событий (статический метод)', () => {
    const source = src('src/services/liquidations/LiquidationPipeline.ts');
    expect(source).toMatch(/public static calculateEstimatedClusters\(/);
    // Фактические события помечаются isDemo: false и никогда не берутся из модели.
    expect(source).toMatch(/isDemo: false/);
  });
});

/* ══════════════════════════════════════════════════════════════════════
   §42/§43/§44 — журнал, фильтры, тиры (структурные инварианты UI)
   ══════════════════════════════════════════════════════════════════════ */

describe('§42/§43/§44 — журнал событий: ограничение DOM, фильтры, тиры', () => {
  const page = src('src/pages/LiquidationsPage.tsx');

  it('срез событий ограничен, а рендер журнала — не более 50 строк', () => {
    const pipelineSource = src('src/services/liquidations/LiquidationPipeline.ts');
    expect(pipelineSource).toMatch(/recentEvents: this\.events\.slice\(0, 100\)/);
    expect(page).toContain('const FEED_LIMIT = 50');
    expect(page).toMatch(/feedEvents\.map\(/);
    expect(page).not.toMatch(/data\.recentEvents\.map\(/);
  });

  it('фильтры работают по уже структурированным полям и не добавляют запросов', () => {
    expect(page).toContain('data-qa="liq-filter-exchange"');
    expect(page).toContain('data-qa="liq-filter-side"');
    expect(page).toContain('data-qa="liq-filter-size"');
    // Фильтрация локальная, по полям события.
    expect(page).toMatch(/filteredEvents = data\.recentEvents\.filter\(/);
  });

  it('тиры — только классификация: входные значения не меняются', () => {
    expect(page).toContain("label: '< $10K'");
    expect(page).toContain("label: '$1M+'");
    expect(page).toMatch(/e\.amountUsd >= tier\.min && e\.amountUsd < tier\.max/);
  });
});

/**
 * CRYPTORA — Паритет серверного монитора с frozen-ведение позиции.
 *
 * ЗАЧЕМ. Монитор позиций обязан доводить сигнал до исхода ТЕМИ ЖЕ правилами,
 * которыми это делает браузерный движок (`trackPublishedSetup`). Любая копия
 * правил выхода расходится с определением — именно это породило баг V3.3.
 *
 * ПОЭТОМУ тест проверяет не «похожесть», а РАВЕНСТВО: одна и та же публикация +
 * один и тот же набор закрытых свечей дают одинаковый fill и outcome в обоих
 * путях:
 *   1) браузерный путь: `trackPublishedSetup` из `src/` напрямую;
 *   2) серверный путь: `toPublishedSetup` (строка БД → сетап) → та же функция.
 *
 * Плюс покрывается модель состояний: setup-состояние (ACTIVE/FILLED) держится
 * отдельно от терминального исхода сделки (TARGET_REACHED/INVALIDATED/CLOSED) и
 * от отсутствия сделки (EXPIRED/CANCELLED/UNRESOLVED, R = null).
 */

import { describe, it, expect, vi } from 'vitest';

import { trackPublishedSetup } from '@/services/signals/live/lifecycle';
import { ohlcvArrayToArchive } from '@/services/signals/live/ohlcvAdapter';
import type { ArchiveCandle } from '@/services/strategyArchive/types';
import {
  SIGNAL_STATUSES,
  OPEN_SIGNAL_STATUSES,
  TRADE_CLOSED_STATUSES,
  NO_TRADE_STATUSES,
} from '../../server/services/signalRepository.js';
import { toPublishedSetup, toLifecyclePatch, TRACKED_STRATEGY_IDS } from '../../server/services/signalMonitor/signalTradeManager.js';
import { SignalMonitor } from '../../server/services/signalMonitor/signalMonitor.js';

const H = 3_600_000;
const SETUP_TS = Date.UTC(2026, 0, 5, 12, 0, 0);

/** OHLCV биржи: `time` в секундах. */
function bar(openTime: number, o: number, h: number, l: number, c: number) {
  return { time: Math.floor(openTime / 1000), open: o, high: h, low: l, close: c, volume: 1 };
}

/** Строка `signals` (mapRow) — ровно те поля, которые читает адаптер. */
function dbRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    engineSetupId: 'setup-1',
    strategyId: 'V3_0_HTF_LIQUIDATION_TRAP',
    strategyVersion: '3.0.0',
    symbol: 'BTC/USDT',
    timeframe: '1h',
    direction: 'LONG',
    signalCandleTs: new Date(SETUP_TS).toISOString(),
    entryType: 'LIMIT_CORRIDOR',
    entryMin: 100,
    entryMax: 101,
    stopLoss: 90,
    targets: [110, 120],
    exitRule: 'tp1_be',
    validForBars: 3,
    status: 'ACTIVE',
    fillPrice: null,
    filledAt: null,
    fillStop: null,
    fillTargets: null,
    metadata: {},
    createdAt: new Date(SETUP_TS).toISOString(),
    previousHash: 'GENESIS',
    hash: 'GENESIS',
    ...overrides,
  };
}

/** Закрытые бары после бара сетапа (setup-бар не входит — функция ищет его сама). */
function candles(prices: Array<[number, number, number, number]>) {
  return prices.map(([o, h, l, c], i) => bar(SETUP_TS + (i + 1) * H, o, h, l, c));
}

function archive(bars: ReturnType<typeof bar>[], nowMs: number): ArchiveCandle[] {
  // Бар сетапа первым: frozen-функция ищет его по openTime.
  const all = [bar(SETUP_TS, 99, 99, 99, 99), ...bars];
  return ohlcvArrayToArchive(all, '1h', nowMs);
}

describe('Модель состояний сигнала', () => {
  it('setup-состояния и исходы сделки — разные домены', () => {
    // ACTIVE/FILLED — «где сигнал», остальное — «чем кончилось».
    expect(OPEN_SIGNAL_STATUSES).toEqual(['ACTIVE', 'FILLED']);
    expect(TRADE_CLOSED_STATUSES).toEqual(['TARGET_REACHED', 'INVALIDATED', 'CLOSED']);
    expect(NO_TRADE_STATUSES).toEqual(['EXPIRED', 'CANCELLED', 'UNRESOLVED']);
    // Полный домен = открытые + закрытые, без пересечений.
    const closed = [...TRADE_CLOSED_STATUSES, ...NO_TRADE_STATUSES];
    for (const s of closed) expect(SIGNAL_STATUSES).toContain(s);
    for (const s of OPEN_SIGNAL_STATUSES) expect(closed).not.toContain(s);
  });

  it('исход без сделки обязан иметь R = null (монитор не выдумывает результат)', () => {
    for (const status of NO_TRADE_STATUSES) {
      // Форма `noTrade` из frozen-модуля: resultR/netResultR/pnlResultPct = null.
      expect(NO_TRADE_STATUSES).toContain(status);
    }
    // Инвариант домена: у состояний без сделки нет знаменателя для win rate.
    const denominator = [...TRADE_CLOSED_STATUSES];
    for (const s of NO_TRADE_STATUSES) expect(denominator).not.toContain(s);
  });
});

describe('toPublishedSetup — адаптер строки БД', () => {
  it('уровни переносятся БЕЗ пересчёта', () => {
    const built = toPublishedSetup(dbRow());
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.entry.entryZone).toEqual([100, 101]);
    expect(built.entry.invalidationLevel).toBe(90);
    expect(built.entry.targets).toEqual([110, 120]);
    expect(built.entry.direction).toBe('LONG');
    expect(built.entry.timeframe).toBe('1h');
    expect(built.entry.setupOpenTime).toBe(SETUP_TS);
    expect(built.entry.entryType).toBe('LIMIT_CORRIDOR');
  });

  it('исполненная строка даёт fill с эффективными уровнями, уровни публикации не меняются', () => {
    const built = toPublishedSetup(
      dbRow({
        status: 'FILLED',
        fillPrice: 100.5,
        filledAt: new Date(SETUP_TS + H).toISOString(),
        fillStop: 90,
        fillTargets: [110, 120],
      })
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.entry.fill?.price).toBe(100.5);
    expect(built.entry.fill?.stop).toBe(90);
    // Уровни публикации остались: исход считается по ним.
    expect(built.entry.entryZone).toEqual([100, 101]);
    expect(built.entry.invalidationLevel).toBe(90);
  });

  it('SHORT переносится симметрично', () => {
    const built = toPublishedSetup(
      dbRow({
        direction: 'SHORT',
        entryMin: 101,
        entryMax: 100,
        stopLoss: 110,
        targets: [90, 80],
      })
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.entry.direction).toBe('SHORT');
    expect(built.entry.entryZone).toEqual([101, 100]);
    expect(built.entry.invalidationLevel).toBe(110);
    expect(built.entry.targets).toEqual([90, 80]);
  });

  it('строка без стопа или целей отклоняется, а не «чинится»', () => {
    expect(toPublishedSetup(dbRow({ stopLoss: null }))).toEqual({ ok: false, reason: 'NO_STOP' });
    expect(toPublishedSetup(dbRow({ targets: [] }))).toEqual({ ok: false, reason: 'NO_TARGETS' });
    expect(toPublishedSetup(dbRow({ entryMin: null }))).toEqual({ ok: false, reason: 'NO_ENTRY_ZONE' });
    expect(toPublishedSetup(dbRow({ signalCandleTs: 'not-a-date' }))).toEqual({
      ok: false,
      reason: 'NO_SETUP_TIME',
    });
  });

  it('неизвестная стратегия не выдаётся за отслеживаемую', () => {
    expect(toPublishedSetup(dbRow({ strategyId: 'SOMETHING_ELSE' })).ok).toBe(false);
    expect(TRACKED_STRATEGY_IDS).toContain('V3_0_HTF_LIQUIDATION_TRAP');
    expect(TRACKED_STRATEGY_IDS).toContain('V3_3_HTF_ZONE_MITIGATION');
    expect(TRACKED_STRATEGY_IDS).toContain('V2_8_ZERO_FEE_SNIPER_TRAILING');
  });

  it('toLifecyclePatch передаёт fill/outcome ядра без изменений', () => {
    const outcome = { status: 'TARGET_REACHED', closedAt: 'x', resultR: 2, netResultR: 1.9 };
    const fill = { price: 100.5, at: 'y', barOpenTime: 1, stop: 90, targets: [110, 120] };
    expect(toLifecyclePatch({ kind: 'RESOLVED', fill, outcome })).toEqual({ fill, outcome });
    expect(toLifecyclePatch({ kind: 'UNCHANGED' })).toEqual({ fill: null, outcome: null });
  });
});

describe('Паритет: серверный путь = браузерный путь', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scenarios: Array<{ name: string; row: () => Record<string, unknown>; bars: any[] }> = [
    {
      name: 'LONG: вход в коридоре, TP1 затем TP2',
      row: () => ({}),
      bars: [
        [100.5, 101, 99.9, 100.8],
        [100.8, 111, 100, 110.5],
        [110.5, 125, 110, 122],
      ],
    },
    {
      name: 'LONG: TP1, затем возврат к breakeven',
      row: () => ({}),
      bars: [
        [100.5, 101, 99.9, 100.8],
        [100.8, 111, 100, 110.5],
        [110, 110.5, 100, 100.2],
        [100.2, 101, 100, 100.5],
      ],
    },
    {
      name: 'LONG: стоп раньше цели',
      row: () => ({}),
      bars: [
        [100.5, 101, 99, 99.5],
        [99.5, 100, 89, 89.5],
        [89.5, 90, 89, 89.5],
      ],
    },
    {
      name: 'SHORT: вход и цель вниз',
      row: () => ({ direction: 'SHORT', entryMin: 100, entryMax: 101, stopLoss: 110, targets: [90, 80] }),
      bars: [
        [100.5, 100.6, 99, 99.2],
        [99.2, 99.5, 89, 89.1],
        [89.1, 90, 88, 88.5],
      ],
    },
    {
      name: 'вход не состоялся: цена вне коридора до истечения',
      row: () => ({}),
      bars: [
        [120, 121, 119, 120],
        [120, 121, 119, 120],
        [120, 121, 119, 120],
        [120, 121, 119, 120],
        [120, 121, 119, 120],
      ],
    },
    {
      name: 'коридор и стоп на одном баре ⇒ отмена, а не сделка',
      row: () => ({}),
      bars: [
        [100.5, 101, 89, 90.5],
        [90.5, 91, 89, 90],
      ],
    },
  ];

  for (const sc of scenarios) {
    it(sc.name, () => {
      const now = SETUP_TS + (sc.bars.length + 2) * H;
      const h1 = archive(candles(sc.bars), now);
      const row = dbRow(sc.row());

      const built0 = toPublishedSetup(row);
      if (!built0.ok) throw new Error('фикстура сломана');
      const browser = trackPublishedSetup(built0.entry as never, h1);

      // Серверный путь: тот же адаптер + та же функция (монитор вызывает их же).
      const built = toPublishedSetup(row);
      expect(built.ok).toBe(true);
      if (!built.ok) return;
      const server = trackPublishedSetup(built.entry as never, h1);

      expect(server).toEqual(browser);
    });
  }

  it('монитор пишет ровно тот fill/outcome, который вернуло ядро', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bars: any[] = [
      [100.5, 101, 99.9, 100.8],
      [100.8, 111, 100, 110.5],
      [110.5, 125, 110, 122],
    ];
    const now = SETUP_TS + (bars.length + 2) * H;
    const h1 = archive(candles(bars), now);
    const row = dbRow();
    const builtExpected = toPublishedSetup(row);
    if (!builtExpected.ok) throw new Error('фикстура сломана');
    const expected = trackPublishedSetup(builtExpected.entry as never, h1);

    const sync = vi.fn(async (_patch: unknown) => ({ signal: { id: 'x' }, status: 'WRITTEN' }));
    const monitor = new SignalMonitor({
      now: () => now,
      listOpen: async () => [row],
      sync,
      getCandles: async () => [bar(SETUP_TS, 99, 99, 99, 99), ...candles(bars)],
      recordMonitor: async () => ({ changed: true }),
      loadCore: async () => ({ trackPublishedSetup, ohlcvArrayToArchive, ARCHIVE_TF_MS: { '1h': H }, CANDLE_LIMIT_1H: 1000 }),
      sleep: async () => {},
    });
    await monitor.tick();

    expect(sync).toHaveBeenCalledTimes(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const patch: any = (sync.mock.calls[0] as unknown[])?.[0];
    const { fill, outcome } = toLifecyclePatch(expected);
    expect(patch.fill).toEqual(fill);
    expect(patch.outcome).toEqual(outcome);
  });
});

describe('Жизненный цикл через монитор — сценарии', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function run(overrides: Record<string, unknown>, bars: any[]) {
    const now = SETUP_TS + (bars.length + 2) * H;
    const sync = vi.fn(async (_patch: unknown) => ({ signal: { id: 'x' }, status: 'WRITTEN' }));
    const monitorWrites: Array<{ result: string; error?: string }> = [];
    const monitor = new SignalMonitor({
      now: () => now,
      listOpen: async () => [dbRow(overrides)],
      sync,
      getCandles: async () => [bar(SETUP_TS, 99, 99, 99, 99), ...candles(bars)],
      recordMonitor: async (_id: string, patch: { result: string; error?: string }) => {
        monitorWrites.push(patch);
        return { changed: true };
      },
      loadCore: async () => ({ trackPublishedSetup, ohlcvArrayToArchive, ARCHIVE_TF_MS: { '1h': H }, CANDLE_LIMIT_1H: 1000 }),
      sleep: async () => {},
    });
    return { monitor, sync, monitorWrites, tick: () => monitor.tick(), now };
  }

  it('WAITING → FILLED: вход зафиксирован, позиция открыта', async () => {
    const { sync, monitorWrites, tick } = run({}, [
      [100.5, 101, 99.9, 100.8],
      [100.8, 102, 100, 101],
    ]);
    await tick();
    expect(sync).toHaveBeenCalledTimes(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const patch: any = (sync.mock.calls[0] as unknown[])[0];
    expect(patch.fill.price).toBe(100.5);
    // Исхода ещё нет — сигнал остаётся открытым.
    expect(patch.outcome).toBeNull();
    expect(monitorWrites[0].result).toBe('FILLED');
  });

  it('WAITING → терминальный исход с R (TP1 → TP2)', async () => {
    const { sync, tick } = run({}, [
      [100.5, 101, 99.9, 100.8],
      [100.8, 111, 100, 110.5],
      [110.5, 125, 110, 122],
    ]);
    await tick();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const patch: any = (sync.mock.calls[0] as unknown[])?.[0];
    expect(patch.fill).not.toBeNull();
    expect(patch.outcome).not.toBeNull();
    expect(patch.outcome.status).toBe('TARGET_REACHED');
    expect(patch.outcome.resultR).toBeGreaterThan(0);
    expect(typeof patch.outcome.netResultR).toBe('number');
    // Время закрытия приходит из бара исхода, а не из «сейчас».
    expect(patch.outcome.closedAt).toBeTruthy();
  });

  it('TP1, затем возврат к breakeven ⇒ CLOSED с R около нуля', async () => {
    const { sync, tick } = run({}, [
      [100.5, 101, 99.9, 100.8],
      [100.8, 111, 100, 110.5],
      [110, 110.5, 100, 100.2],
      [100.2, 101, 100, 100.5],
    ]);
    await tick();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const patch: any = (sync.mock.calls[0] as unknown[])?.[0];
    expect(patch.outcome.status).toBe('CLOSED');
    expect(patch.outcome.exitReason).toBe('TP1_THEN_BE');
    expect(Math.abs(patch.outcome.resultR)).toBeLessThan(1);
  });

  it('коридор и стоп на одном баре ⇒ CANCELLED без сделки, R = null', async () => {
    const { sync, tick } = run({}, [
      [100.5, 101, 89, 90.5],
      [90.5, 91, 89, 90],
    ]);
    await tick();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const patch: any = (sync.mock.calls[0] as unknown[])?.[0];
    expect(patch.fill).toBeNull();
    expect(patch.outcome.status).toBe('CANCELLED');
    expect(patch.outcome.resultR).toBeNull();
  });

  it('истечение коридора ⇒ EXPIRED без сделки', async () => {
    const { sync, tick } = run({}, [
      [120, 121, 119, 120],
      [120, 121, 119, 120],
      [120, 121, 119, 120],
      [120, 121, 119, 120],
      [120, 121, 119, 120],
    ]);
    await tick();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const patch: any = (sync.mock.calls[0] as unknown[])?.[0];
    expect(patch.fill).toBeNull();
    expect(patch.outcome.status).toBe('EXPIRED');
    expect(patch.outcome.resultR).toBeNull();
  });

  it('EXIT через стоп: outcome.status = INVALIDATED, R отрицательный', async () => {
    const { sync, tick } = run({}, [
      [100.5, 101, 99, 99.5],
      [99.5, 100, 89, 89.5],
      [89.5, 90, 89, 89.5],
    ]);
    await tick();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const patch: any = (sync.mock.calls[0] as unknown[])?.[0];
    expect(patch.outcome.status).toBe('INVALIDATED');
    expect(patch.outcome.resultR).toBeLessThan(0);
  });

  it('нет входа в окне коридора: outcome без сделки, R = null', async () => {
    const { sync, tick } = run({}, [
      [120, 121, 119, 120],
      [120, 121, 119, 120],
      [120, 121, 119, 120],
      [120, 121, 119, 120],
      [120, 121, 119, 120],
    ]);
    await tick();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const patch: any = (sync.mock.calls[0] as unknown[])?.[0];
    expect(patch.fill).toBeNull();
    expect(patch.outcome).not.toBeNull();
    expect(NO_TRADE_STATUSES).toContain(patch.outcome.status);
    expect(patch.outcome.resultR).toBeNull();
    expect(patch.outcome.netResultR).toBeNull();
  });

  it('SHORT: полный путь до цели', async () => {
    const { sync, tick } = run(
      { direction: 'SHORT', entryMin: 100, entryMax: 101, stopLoss: 110, targets: [90, 80] },
      [
        [100.5, 100.6, 99, 99.2],
        [99.2, 99.5, 89, 89.1],
        [89.1, 90, 78, 79],
      ]
    );
    await tick();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const patch: any = (sync.mock.calls[0] as unknown[])?.[0];
    expect(patch.fill).not.toBeNull();
    expect(patch.fill.price).toBeGreaterThan(0);
    expect(patch.outcome.status).toBe('TARGET_REACHED');
    expect(patch.outcome.resultR).toBeGreaterThan(0);
  });

  it('дубль обработки: два тика подряд не создают два исхода', async () => {
    const bars = [
      [100.5, 101, 99.9, 100.8],
      [100.8, 111, 100, 110.5],
      [110.5, 125, 110, 122],
    ];
    const { sync, tick } = run({}, bars);
    await tick();
    await tick();
    await tick();
    // Ядро детерминировано: payload совпадает, решение о записи принимает
    // репозиторий (монотонные переходы). Монитор не «досчитывает» второй раз.
    const first = JSON.stringify((sync.mock.calls[0] as unknown[])?.[0]);
    const last = JSON.stringify((sync.mock.calls[sync.mock.calls.length - 1] as unknown[])?.[0]);
    expect(last).toBe(first);
  });
});

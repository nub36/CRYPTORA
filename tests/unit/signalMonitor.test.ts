/**
 * CRYPTORA — Серверный монитор позиций.
 *
 * Проверяется НАСТОЯЩИЙ `SignalMonitor` из
 * server/services/signalMonitor/signalMonitor.js — не его копия. Сетевые
 * зависимости (список открытых сигналов, запись в БД, свечи) инъецируются, но
 * ведение позиции НЕ подменяется: монитор обращается к настоящему
 * `trackPublishedSetup` через `loadStrategyCore`.
 *
 * Тесты про поведение, которое требовалось в задаче:
 *   • группировка открытых сигналов (нет веера N×candles);
 *   • общий запрос свечей на группу и дедуп повторных тиков;
 *   • таймаут и ретрай с backoff при отказе рынка;
 *   • stale-data: отсутствие данных не создаёт ложного исхода;
 *   • восстановление после рестарта (состояние в БД, не в памяти).
 */

import { describe, it, expect, vi } from 'vitest';

import { trackPublishedSetup } from '@/services/signals/live/lifecycle';
import { ohlcvToArchive, ohlcvArrayToArchive } from '@/services/signals/live/ohlcvAdapter';
import { ARCHIVE_TF_MS } from '@/services/strategyArchive/types';
import { CANDLE_LIMIT_1H } from '@/services/signals/live/LiveSignalEngine';

import {
  SignalMonitor,
  groupOpenSignals,
  computeLookbackBars,
  MAX_LOOKBACK_BARS,
  LOOKBACK_MARGIN_BARS,
  MONITOR_TICK_MS,
} from '../../server/services/signalMonitor/signalMonitor.js';

const H = 3_600_000;
/** Бар сетапа: 2026-01-01T00:00:00.000Z. */
const SETUP_TS = Date.UTC(2026, 0, 1, 0, 0, 0);
const SETUP_ISO = new Date(SETUP_TS).toISOString();

/** Строка `signals` в форме mapRow() — ровно те поля, которые читает монитор. */
function openRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sig-1',
    engineSetupId: 'setup-1',
    strategyId: 'V3_0_HTF_LIQUIDATION_TRAP',
    strategyVersion: '3.0.0',
    symbol: 'BTC/USDT',
    timeframe: '1h',
    direction: 'LONG',
    signalCandleTs: SETUP_ISO,
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
    closeStatus: null,
    exitReason: null,
    exitPrice: null,
    closedAt: null,
    resultR: null,
    netResultR: null,
    metadata: {},
    createdAt: SETUP_ISO,
    ...overrides,
  };
}

/**
 * Свеча в ТОЙ форме, в которой её отдаёт биржа и `MarketDataFetcher`
 * (OHLCV, `time` в секундах). Закрытость бар получает не от флага, а от
 * сравнения `closeTime < nowMs` — ровно та семантика, что в браузерном движке.
 */
function candle(openTime: number, o: number, h: number, l: number, c: number) {
  return { time: Math.floor(openTime / 1000), open: o, high: h, low: l, close: c, volume: 10 };
}

/**
 * Ядро стратегий в тестах — НАСТОЯЩЕЕ: frozen-`trackPublishedSetup` из `src/`
 * плюс адаптер свечей из `src/`. Именно этот компонент и есть предмет проверки;
 * если монитор начнёт считать исход сам, тесты это покажут.
 */
const CORE = {
  trackPublishedSetup,
  ohlcvToArchive,
  ohlcvArrayToArchive,
  ARCHIVE_TF_MS,
  CANDLE_LIMIT_1H,
};

/**
 * Монитор с инъецированными зависимостями.
 *
 * `candlesFor` — карта «обменный символ|таймфрейм → свечи», чтобы тест мог
 * посчитать, сколько раз каждый ключ был ЗАПРОШЕН (это и есть проверка веера).
 */
function makeMonitor(opts: {
  rows?: unknown[];
  candlesFor?: Record<string, ReturnType<typeof candle>[]>;
  candlesError?: Error;
  loadCoreError?: Error;
} = {}) {
  const candleRequests: Array<{ symbol: string; timeframe: string; limit: number }> = [];
  const syncs: unknown[] = [];
  const monitorWrites: Array<{ id: unknown; patch: { result: string; error?: string } }> = [];

  const monitor = new SignalMonitor({
    now: () => SETUP_TS + 40 * H,
    listOpen: async () => opts.rows ?? [],
    sync: async (patch) => {
      syncs.push(patch);
      return { signal: { id: 'sig-1', outcomeHash: 'h' }, status: 'WRITTEN' };
    },
    getCandles: async (symbol, timeframe, limit) => {
      candleRequests.push({ symbol, timeframe, limit });
      if (opts.candlesError) throw opts.candlesError;
      const key = `${symbol}|${timeframe}`;
      return (opts.candlesFor ?? {})[key] ?? [];
    },
    recordMonitor: async (id, patch) => {
      monitorWrites.push({ id, patch });
      return { changed: true };
    },
    loadCore: opts.loadCoreError
      ? async () => {
          throw opts.loadCoreError;
        }
      : async () => CORE,
    sleep: async () => {},
    tickMs: MONITOR_TICK_MS,
  });

  return { monitor, candleRequests, syncs, monitorWrites };
}

describe('groupOpenSignals — группировка по символу × таймфрейму', () => {
  it('пять открытых BTC/USDT 1h образуют ОДНУ группу', () => {
    const rows = Array.from({ length: 5 }, (_, i) =>
      openRow({ id: `sig-${i}`, signalCandleTs: new Date(SETUP_TS - i * H).toISOString() })
    );
    const { groups } = groupOpenSignals(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0].symbol).toBe('BTC/USDT');
    expect(groups[0].timeframe).toBe('1h');
    expect(groups[0].rows).toHaveLength(5);
    expect(groups[0].exchangeSymbol).toBe('BTCUSDT');
  });

  it('разные символы и таймфреймы дают разные группы', () => {
    const rows = [
      openRow({ id: 'a', symbol: 'BTC/USDT', timeframe: '1h' }),
      openRow({ id: 'b', symbol: 'BTC/USDT', timeframe: '4h' }),
      openRow({ id: 'c', symbol: 'SOL/USDT', timeframe: '1h' }),
    ];
    const { groups } = groupOpenSignals(rows);
    expect(groups).toHaveLength(3);
    expect(new Set(groups.map((g) => `${g.symbol}|${g.timeframe}`)).size).toBe(3);
  });

  it('строки без символа/таймфрейма не создают группу', () => {
    const { groups, total } = groupOpenSignals([openRow({ symbol: '' }), openRow({ timeframe: '' })]);
    expect(groups).toHaveLength(0);
    expect(total).toBe(2);
  });

  it('самые старые сетапы идут первыми', () => {
    const { groups } = groupOpenSignals([
      openRow({ id: 'new', symbol: 'SOL/USDT', signalCandleTs: new Date(SETUP_TS + H).toISOString() }),
      openRow({ id: 'old', symbol: 'BTC/USDT', signalCandleTs: new Date(SETUP_TS - 5 * H).toISOString() }),
    ]);
    expect(groups[0].rows[0].id).toBe('old');
  });
});

describe('computeLookbackBars — окно не больше окна ядра', () => {
  it('свежий сетап ⇒ ровно столько баров, сколько нужно + запас', () => {
    const now = SETUP_TS + 10 * H;
    const bars = computeLookbackBars([openRow()], now, H);
    expect(bars).toBe(10 + LOOKBACK_MARGIN_BARS);
  });

  it('очень старый сетап ⇒ окно обрезается по максимуму ядра', () => {
    const now = SETUP_TS + 100_000 * H;
    expect(computeLookbackBars([openRow()], now, H)).toBe(MAX_LOOKBACK_BARS);
  });

  it('некорректные входные данные не дают NaN', () => {
    expect(computeLookbackBars([], SETUP_TS, H)).toBe(MAX_LOOKBACK_BARS);
    expect(computeLookbackBars([{ signalCandleTs: 'not-a-date' }], SETUP_TS, H)).toBe(MAX_LOOKBACK_BARS);
    expect(computeLookbackBars([openRow()], SETUP_TS, 0)).toBe(MAX_LOOKBACK_BARS);
  });
});

describe('SignalMonitor.tick — бюджет запросов', () => {
  it('нет открытых сигналов ⇒ ни одного запроса свечей и ни одной записи', async () => {
    const { monitor, candleRequests, syncs, monitorWrites } = makeMonitor({ rows: [] });
    const res = await monitor.tick();
    expect(candleRequests).toHaveLength(0);
    expect(syncs).toHaveLength(0);
    expect(monitorWrites).toHaveLength(0);
    expect(res.openSignals).toBe(0);
    expect(res.groups).toBe(0);
  });

  it('5 открытых сигналов BTC/USDT 1h ⇒ ОДИН запрос свечей (нет веера N×candles)', async () => {
    // Пять разных сетапов по одному инструменту и таймфрейму: разные бары,
    // разные уровни — но ОДНА серия свечей на всю группу.
    const rows = Array.from({ length: 5 }, (_, i) =>
      openRow({
        id: `sig-${i}`,
        signalCandleTs: new Date(SETUP_TS - i * H).toISOString(),
        entryMin: 100 + i,
        entryMax: 101 + i,
        targets: [110 + i, 120 + i],
      })
    );
    // Свечи покрывают ВСЕ пять баров сетапа плюс последующие.
    const bars = Array.from({ length: 16 }, (_, i) =>
      candle(SETUP_TS - 6 * H + i * H, 100.5, 102, 99, 100.5)
    );
    const { monitor, candleRequests, syncs } = makeMonitor({
      rows,
      candlesFor: { 'BTCUSDT|1h': bars },
    });
    const res = await monitor.tick();
    expect(candleRequests).toHaveLength(1);
    expect(candleRequests[0].symbol).toBe('BTCUSDT');
    expect(candleRequests[0].timeframe).toBe('1h');
    // Каждый сигнал обработан отдельно, но серия запрошена один раз.
    expect(syncs).toHaveLength(5);
    expect(res.openSignals).toBe(5);
    expect(res.groups).toBe(1);
  });

  it('разные группы ⇒ один запрос на группу, а не на сигнал', async () => {
    const rows = [
      openRow({ id: 'btc-1', symbol: 'BTC/USDT' }),
      openRow({ id: 'btc-2', symbol: 'BTC/USDT', signalCandleTs: new Date(SETUP_TS - H).toISOString() }),
      openRow({ id: 'sol-1', symbol: 'SOL/USDT' }),
      openRow({ id: 'sol-2', symbol: 'SOL/USDT', signalCandleTs: new Date(SETUP_TS - H).toISOString() }),
    ];
    const bars = Array.from({ length: 10 }, (_, i) => candle(SETUP_TS + i * H, 100.5, 102, 99, 100.5));
    const { monitor, candleRequests } = makeMonitor({
      rows,
      candlesFor: { 'BTCUSDT|1h': bars, 'SOLUSDT|1h': bars },
    });
    await monitor.tick();
    expect(candleRequests).toHaveLength(2);
    expect(candleRequests.map((r) => r.symbol).sort()).toEqual(['BTCUSDT', 'SOLUSDT']);
  });

  it('повторный тик с тем же окном ⇒ монотонный отказ, повторного исхода нет', async () => {
    const rows = [openRow()];
    const bars = Array.from({ length: 10 }, (_, i) => candle(SETUP_TS + i * H, 100.5, 102, 99, 100.5));

    // Фейк репозитория с поведением `syncSignalLifecycle`: заполненная строка не
    // переписывается, терминальная не переоткрывается. Без этого монитор мог бы
    // «обновлять» закрытый исход новыми значениями.
    const stored = new Map<string, unknown>();
    const outcomes: string[] = [];
    const sync = vi.fn(async (patch) => {
      const key = `${patch.strategyId}|${patch.symbol}|${patch.timeframe}|${patch.signalCandleTs}`;
      const prev = stored.get(key) as { filled?: boolean; terminal?: boolean } | undefined;
      if (prev?.terminal) {
        outcomes.push('ALREADY_CLOSED');
        return { signal: prev, status: 'ALREADY_CLOSED' };
      }
      if (prev?.filled && !patch.outcome) {
        outcomes.push('ALREADY_FILLED');
        return { signal: prev, status: 'ALREADY_FILLED' };
      }
      const next = { ...patch, filled: true, terminal: Boolean(patch.outcome) };
      stored.set(key, next);
      outcomes.push(patch.outcome ? 'WRITTEN_OUTCOME' : 'WRITTEN_FILL');
      return { signal: next, status: 'WRITTEN' };
    });

    const monitor = new SignalMonitor({
      now: () => SETUP_TS + 40 * H,
      listOpen: async () => rows,
      sync,
      getCandles: async () => bars,
      recordMonitor: async () => ({ changed: true }),
      loadCore: async () => CORE,
      sleep: async () => {},
    });

    await monitor.tick();
    await monitor.tick();
    await monitor.tick();

    // Три тика, одна и та же строка: ровно одна запись в «хранилище».
    expect(stored.size).toBe(1);
    // Первый тик записал вход, остальные — монотонные отказы, а не новые значения.
    expect(outcomes[0]).toBe('WRITTEN_FILL');
    expect(outcomes.slice(1)).toEqual(['ALREADY_FILLED', 'ALREADY_FILLED']);
  });

  it('формирующийся бар не попадает в окно (граница look-ahead)', async () => {
    // Сейчас — середина бара N+3: бары 0..2 закрыты, последний в ответе — нет.
    const now = SETUP_TS + 3 * H + 30 * 60_000;
    const rows = [openRow()];
    const bars = Array.from({ length: 3 }, (_, i) => candle(SETUP_TS + i * H, 100.5, 102, 99, 100.5));
    // Последний бар «доживает» до текущего момента и потому формируется.
    bars.push(candle(SETUP_TS + 3 * H, 200, 300, 50, 250));

    const seen: number[] = [];
    const monitor = new SignalMonitor({
      now: () => now,
      listOpen: async () => rows,
      sync: async (patch) => {
        // fill.price обязан прийти из ЗАКРЫТОГО бара, а не из формирующегося.
        if (patch.fill) seen.push(patch.fill.price);
        return { signal: { id: 'x' }, status: 'WRITTEN' };
      },
      getCandles: async () => bars,
      recordMonitor: async () => ({ changed: true }),
      loadCore: async () => CORE,
      sleep: async () => {},
    });
    await monitor.tick();
    // 200/300/50/250 сформировавшего бара не должны участвовать в расчёте.
    for (const price of seen) {
      expect(price).not.toBe(200);
      expect(price).not.toBe(250);
    }
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe(100.5);
  });
});

describe('SignalMonitor.tick — отказ рынка и устаревшие данные', () => {
  it('рынок недоступен ⇒ строка помечена ERROR, исход НЕ записан', async () => {
    const rows = [openRow()];
    const { monitor, syncs, monitorWrites } = makeMonitor({
      rows,
      candlesError: new Error('network down'),
    });
    await monitor.tick();
    expect(syncs).toHaveLength(0);
    expect(monitorWrites).toHaveLength(1);
    expect(monitorWrites[0].patch).toMatchObject({ result: 'ERROR', error: 'network down' });
    expect(monitor.stats.consecutiveFailures).toBeGreaterThan(0);
  });

  it('два отказа подряд ⇒ статус монитора stale', async () => {
    const { monitor } = makeMonitor({ rows: [openRow()], candlesError: new Error('boom') });
    await monitor.tick();
    expect(monitor.stats.stale).toBe(false);
    await monitor.tick();
    expect(monitor.stats.stale).toBe(true);
  });

  it('таймаут запроса свечей не подвешивает тик', async () => {
    const rows = [openRow()];
    const monitor = new SignalMonitor({
      now: () => SETUP_TS + 40 * H,
      listOpen: async () => rows,
      sync: async () => ({ signal: { id: 'x' }, status: 'WRITTEN' }),
      // Зависающий рынок: таймаут обязан обрезать запрос (уменьшен для теста).
      getCandles: () => new Promise(() => {}),
      requestTimeoutMs: 20,
      recordMonitor: async () => ({ changed: true }),
      loadCore: async () => CORE,
      sleep: async () => {},
    });
    const res = await monitor.tick();
    expect(res.errors).toBe(1);
    expect(monitor.stats.lastSummary?.errors ?? 0).toBeGreaterThan(0);
  });

  it('нет закрытых свечей ⇒ SKIP, а не «нет данных = нет исхода»', async () => {
    const rows = [openRow()];
    const { monitor, syncs, monitorWrites } = makeMonitor({ rows, candlesFor: { 'BTCUSDT|1h': [] } });
    await monitor.tick();
    expect(syncs).toHaveLength(0);
    expect(monitorWrites[0].patch.result).toBe('SKIP');
  });

  it('недоступность ядра стратегий не роняет монитор', async () => {
    const { monitor, candleRequests } = makeMonitor({
      rows: [openRow()],
      loadCoreError: new Error('bundle missing'),
    });
    await expect(monitor.tick()).resolves.toBeTruthy();
    expect(candleRequests).toHaveLength(0);
    expect(monitor.stats.lastError).toContain('bundle missing');
  });
});

describe('SignalMonitor — восстановление после рестарта', () => {
  it('новый экземпляр читает открытые сигналы из БД и продолжает с того же места', async () => {
    const rows = [openRow()];
    const bars = Array.from({ length: 10 }, (_, i) => candle(SETUP_TS + i * H, 100.5, 102, 99, 100.5));
    const first = makeMonitor({ rows, candlesFor: { 'BTCUSDT|1h': bars } });
    await first.monitor.tick();

    // «Рестарт процесса»: монитор создаётся заново. Состояние берётся из БД
    // (инъекция listOpen), поэтому поведение воспроизводимо.
    const second = makeMonitor({ rows, candlesFor: { 'BTCUSDT|1h': bars } });
    await second.monitor.tick();
    expect(second.candleRequests).toHaveLength(1);
    expect(second.syncs.length).toBe(first.syncs.length);
  });

  it('ошибка записи в БД не останавливает монитор', async () => {
    const rows = [openRow()];
    const bars = Array.from({ length: 10 }, (_, i) => candle(SETUP_TS + i * H, 100.5, 102, 99, 100.5));
    const monitor = new SignalMonitor({
      now: () => SETUP_TS + 40 * H,
      listOpen: async () => rows,
      sync: async () => ({ signal: { id: 'x' }, status: 'WRITTEN' }),
      getCandles: async () => bars,
      recordMonitor: async () => {
        throw new Error('db write failed');
      },
      loadCore: async () => CORE,
      sleep: async () => {},
    });
    await expect(monitor.tick()).resolves.toBeTruthy();
    expect(monitor.stats.errors.length).toBeGreaterThan(0);
  });
});

describe('signalMonitorStatus — диагностика без синглтона', () => {
  it('до старта возвращает честный «не запущен», а не броадкаст LIVE', async () => {
    const { signalMonitorStatus } = await import('../../server/services/signalMonitor/signalMonitor.js');
    // Синглтон мог остаться от предыдущих тестов в этом же воркере — в любом
    // случае ответ обязан содержать флаг запуска, а не утверждение о рынке.
    const s = signalMonitorStatus();
    expect(s).toHaveProperty('running');
    expect(typeof s.running).toBe('boolean');
    expect(s).toHaveProperty('lastError');
    expect(s).toHaveProperty('lastSummary');
  });
});

describe('SignalMonitor — неизвестный стратегический ряд', () => {
  it('строка без обязательных уровней ⇒ SKIP, запись жизненного цикла не выполняется', async () => {
    const rows = [openRow({ stopLoss: null })];
    const bars = Array.from({ length: 10 }, (_, i) => candle(SETUP_TS + i * H, 100.5, 102, 99, 100.5));
    const { monitor, syncs, monitorWrites } = makeMonitor({ rows, candlesFor: { 'BTCUSDT|1h': bars } });
    await monitor.tick();
    expect(syncs).toHaveLength(0);
    expect(monitorWrites[0].patch.result).toBe('SKIP');
    expect(String(monitorWrites[0].patch.error)).toContain('NO_STOP');
  });
});

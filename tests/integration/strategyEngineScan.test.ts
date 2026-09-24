/** @vitest-environment node */
/**
 * CRYPTORA — Сквозной контракт скана: планировщик → движок → НАСТОЯЩЕЕ ядро →
 * рыночные данные (F-01, F-09, F-10, F-13).
 *
 * Отличие от tests/unit/strategyEngineOrchestration.test.ts: здесь ядро не
 * подставное, а собранное esbuild из `src/` — то самое, которое исполняется на
 * сервере. Подставляется только HTTP (Binance klines), поэтому тест
 * детерминирован, не зависит от сети и не трогает БД (`persist: false`).
 *
 * Что доказывается:
 *  • движок вызывает существующий `scanNow()`, и после успешного скана
 *    состояние планировщика/ядра продвинулось (scanCount, lastScanFinishedAt,
 *    закрытые бары, lastError = null) — раньше скан падал с TypeError, а
 *    статус выглядел живым;
 *  • серии, которые ядро просит у провайдера, уходят в Binance в формате биржи:
 *    interval=1d (а не '1D' ⇒ HTTP 400) и limit=1000/1000/400 (а не 300);
 *  • предзагрузка движка и запрос ядра попадают в ОДИН кэш-ключ: повторных
 *    HTTP-запросов на ту же серию нет (нет веера N×свечи);
 *  • отказ рыночных данных — это ошибка скана, а не «сетапов нет».
 *
 * Окружение node обязательно: сборка бандла esbuild в jsdom падает на
 * собственном инварианте TextEncoder (см. strategyEngineCore.test.ts, F-03).
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';

import { loadStrategyCore } from '../../server/services/strategyEngine/strategyCoreBundle.js';
import { MarketDataFetcher, BINANCE_MAX_KLINES } from '../../server/services/strategyEngine/marketDataFetcher.js';
import { runStrategyScan, scanStrategySafely } from '../../server/services/strategyEngine/strategyEngine.js';

let core: any = null;
let loadError: string | null = null;

beforeAll(async () => {
  try {
    core = await loadStrategyCore();
  } catch (e) {
    loadError = e instanceof Error ? e.message : String(e);
  }
}, 180_000);

const V30 = 'V3_0_HTF_LIQUIDATION_TRAP';
const V28 = 'V2_8_ZERO_FEE_SNIPER_TRAILING';

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/**
 * Детерминированная синтетическая серия (без Math.random — RULES §2).
 * Форма ответа — сырой Binance klines: [openTime, o, h, l, c, v, closeTime, …].
 *
 * Последний бар — формирующийся (как отдаёт эндпоинт): ядро обязано само
 * отсечь его через `ohlcvToArchive(..., nowMs)`, иначе был бы look-ahead.
 */
const klines = (interval: '1h' | '4h' | '1d', limit: number, nowMs: number) => {
  const stepMs = interval === '1d' ? DAY_MS : interval === '4h' ? 4 * HOUR_MS : HOUR_MS;
  const currentOpen = Math.floor(nowMs / stepMs) * stepMs;
  const first = currentOpen - (limit - 1) * stepMs;
  const out: number[][] = [];
  for (let i = 0; i < limit; i++) {
    const openTime = first + i * stepMs;
    const price = (k: number) =>
      100 * (1 + 0.012 * Math.sin(k / 9) + 0.004 * Math.sin(k / 2.7) + 0.00006 * k);
    const open = price(i);
    const close = price(i + 1);
    const high = Math.max(open, close) * 1.004;
    const low = Math.min(open, close) * 0.996;
    const volume = 120 + 40 * Math.abs(Math.sin(i / 6));
    out.push([
      openTime,
      Number(open.toFixed(4)),
      Number(high.toFixed(4)),
      Number(low.toFixed(4)),
      Number(close.toFixed(4)),
      Number(volume.toFixed(4)),
      openTime + stepMs - 1,
      Number((volume * close).toFixed(2)),
      500,
      Number((volume * 0.4).toFixed(4)),
      Number((volume * 0.4 * close).toFixed(2)),
      0,
    ]);
  }
  return out;
};

/**
 * Подставной транспорт Binance: записывает каждый запрос и отдаёт синтетику
 * нужной длины. `failFor` имитирует недоступность источника.
 */
const makeTransport = (opts: { failFor?: RegExp } = {}) => {
  const requests: Array<{ symbol: string; interval: string; limit: number }> = [];
  const fetchFn = (async (url: string) => {
    const q = new URL(url).searchParams;
    const symbol = q.get('symbol')!;
    const interval = q.get('interval')! as '1h' | '4h' | '1d';
    const limit = Number(q.get('limit'));
    requests.push({ symbol, interval, limit });
    if (opts.failFor?.test(symbol)) {
      return { ok: false, status: 503, json: async () => ({ msg: 'Service unavailable' }) };
    }
    return { ok: true, status: 200, json: async () => klines(interval, limit, Date.now()) };
  }) as any;
  const fetcher = new MarketDataFetcher({ fetchFn });
  return { fetcher, requests, stats: () => fetcher.stats };
};

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  core?.LiveSignalEngine?.resetInstance?.();
  core?.SignalsAuditLedger?.resetInstance?.();
});

const withCore = (name: string, fn: () => Promise<void>, timeout = 120_000) =>
  it(
    name,
    async (ctx) => {
      if (!core) {
        ctx.skip();
        return;
      }
      await fn();
    },
    timeout
  );

describe('Скан настоящим ядром: контракт F-01', () => {
  it('ядро загружено — иначе контракты ниже непроверяемы', () => {
    if (loadError) throw new Error(`Ядро стратегий не загрузилось: ${loadError}`);
    expect(core).toBeTruthy();
  });

  withCore('успешный скан вызывает scanNow() и продвигает состояние ядра', async () => {
    const spy = vi.spyOn(core.LiveSignalEngine.prototype, 'scanNow');
    const { fetcher } = makeTransport();

    const result = await runStrategyScan({
      strategyId: V30,
      symbols: ['BTCUSDT'],
      fetcher,
      persist: false,
    });

    expect(spy, 'движок обязан вызвать scanNow() настоящего ядра').toHaveBeenCalledTimes(1);
    expect(result.evaluated).toBe(true);
    expect(result.symbolsScanned).toBe(1);

    // Состояние планировщика/рантайма после успешного скана.
    expect(result.scan.scanCount).toBe(1);
    expect(result.scan.lastScanFinishedAt, 'время окончания скана обязано появиться').toBeTruthy();
    expect(result.scan.lastScanDurationMs).toBeGreaterThanOrEqual(0);
    expect(result.scan.lastError, 'успешный скан не оставляет ошибку').toBeNull();
    expect(result.scan.execTimeframe).toBe('1h');

    const status = core.LiveSignalEngine.getInstance().getStatus();
    expect(status.scanning, 'движок не должен остаться в состоянии сканирования').toBe(false);
    expect(status.scanCount).toBe(1);
    expect(status.perSymbol.BTCUSDT.pair, 'пара для БД/UI выводится из биржевого символа').toBe('BTC/USDT');
    expect(status.perSymbol.BTCUSDT.closedBars['1h'], 'закрытые 1h-бары посчитаны').toBeGreaterThan(0);
    expect(status.perSymbol.BTCUSDT.lastError, 'синтетика достаточна для оценки').toBeNull();
    expect(result.scan.evaluatedBars, 'реплей действительно оценил бары').toBeGreaterThan(0);
  });

  withCore('scanOnce() не вызывается и не существует: фантомный метод не вернулся', async () => {
    expect(core.LiveSignalEngine.prototype.scanOnce).toBeUndefined();
    const { fetcher } = makeTransport();
    // Если бы движок звал несуществующий метод, скан упал бы с TypeError.
    const result = await runStrategyScan({ strategyId: V30, symbols: ['BTCUSDT'], fetcher, persist: false });
    expect(result.scan.lastError).toBeNull();
  });

  withCore('повторный скан без нового закрытого бара не переоценивает окно', async () => {
    const { fetcher, requests } = makeTransport();
    const first = await runStrategyScan({ strategyId: V30, symbols: ['BTCUSDT'], fetcher, persist: false });
    const httpAfterFirst = requests.length;

    const second = await runStrategyScan({ strategyId: V30, symbols: ['BTCUSDT'], fetcher, persist: false });
    expect(second.scan.scanCount).toBe(1); // каждый скан — новый экземпляр ядра
    expect(second.setupsFound).toBe(first.setupsFound);
    expect(second.scan.evaluatedBars).toBe(first.scan.evaluatedBars);
    // Кэш фетчера живой (TTL 60s) ⇒ второй скан не добавляет HTTP-запросов.
    expect(requests.length, 'повторный скан не должен тянуть те же серии').toBe(httpAfterFirst);
  });
});

describe('Рыночные данные: интервалы, лимиты, веер запросов (F-09, F-10)', () => {
  withCore('V3.0: 1h и 4h по 1000 баров, ровно по одному запросу на серию', async () => {
    const { fetcher, requests } = makeTransport();
    await runStrategyScan({ strategyId: V30, symbols: ['BTCUSDT'], fetcher, persist: false });

    expect(requests).toEqual([
      { symbol: 'BTCUSDT', interval: '1h', limit: 1000 },
      { symbol: 'BTCUSDT', interval: '4h', limit: 1000 },
    ]);
    // Ядро просит те же серии через provider — из кэша, без нового HTTP.
    const unique = new Set(requests.map((r) => `${r.symbol}|${r.interval}|${r.limit}`));
    expect(unique.size, 'нет веера дублей на одну серию').toBe(requests.length);
  });

  withCore("V2.8: дневной контекст ядра ('1D') уходит как interval=1d с лимитом 400", async () => {
    const { fetcher, requests } = makeTransport();
    await runStrategyScan({ strategyId: V28, symbols: ['BTCUSDT'], fetcher, persist: false });

    expect(requests).toEqual([
      { symbol: 'BTCUSDT', interval: '1h', limit: 1000 },
      { symbol: 'BTCUSDT', interval: '4h', limit: 1000 },
      { symbol: 'BTCUSDT', interval: '1d', limit: 400 },
    ]);
    expect(requests.map((r) => r.interval)).not.toContain('1D');
  });

  withCore('лимиты запросов совпадают с константами ядра и не превышают потолок Binance', async () => {
    const { fetcher, requests } = makeTransport();
    await runStrategyScan({ strategyId: V28, symbols: ['BTCUSDT'], fetcher, persist: false });

    const byInterval = Object.fromEntries(requests.map((r) => [r.interval, r.limit]));
    expect(byInterval['1h']).toBe(core.CANDLE_LIMIT_1H);
    expect(byInterval['4h']).toBe(core.CANDLE_LIMIT_4H);
    expect(byInterval['1d']).toBe(core.CANDLE_LIMIT_1D);
    for (const r of requests) {
      expect(r.limit, 'неограниченный запрос невозможен').toBeLessThanOrEqual(BINANCE_MAX_KLINES);
      expect(r.limit).toBeGreaterThan(0);
      expect(Number.isInteger(r.limit)).toBe(true);
    }
  });

  withCore('несколько символов: по одному запросу на (символ, серию), без N×дублей', async () => {
    const { fetcher, requests } = makeTransport();
    await runStrategyScan({
      strategyId: V30,
      symbols: ['BTCUSDT', 'ETHUSDT'],
      fetcher,
      persist: false,
    });

    expect(requests).toHaveLength(4); // 2 символа × (1h, 4h)
    expect(new Set(requests.map((r) => `${r.symbol}|${r.interval}`)).size).toBe(4);
    expect(requests.map((r) => r.symbol).sort()).toEqual(['BTCUSDT', 'BTCUSDT', 'ETHUSDT', 'ETHUSDT']);
  });

  withCore('символ в форме пары из strategy_settings не ломает запрос к бирже', async () => {
    const { fetcher, requests } = makeTransport();
    const result = await runStrategyScan({
      strategyId: V30,
      symbols: ['btc/usdt'],
      fetcher,
      persist: false,
    });

    expect(requests.every((r) => r.symbol === 'BTCUSDT')).toBe(true);
    expect(result.symbols).toEqual(['BTCUSDT']);
  });
});

describe('Отказ рыночных данных — честная ошибка, а не «сетапов нет»', () => {
  withCore('runStrategyScan бросает MARKET_DATA_UNAVAILABLE до вызова ядра', async () => {
    const spy = vi.spyOn(core.LiveSignalEngine.prototype, 'scanNow');
    const { fetcher, requests } = makeTransport({ failFor: /BTCUSDT/ });

    await expect(
      runStrategyScan({ strategyId: V30, symbols: ['BTCUSDT'], fetcher, persist: false })
    ).rejects.toMatchObject({ code: 'MARKET_DATA_UNAVAILABLE' });

    expect(spy, 'ядро не сканирует без данных').not.toHaveBeenCalled();
    expect(requests.length).toBeGreaterThan(0);
  });

  withCore('scanStrategySafely возвращает ok:false и оставляет движок согласованным', async () => {
    const bad = makeTransport({ failFor: /BTCUSDT/ });
    const failed = await scanStrategySafely({
      strategyId: V30,
      symbols: ['BTCUSDT'],
      fetcher: bad.fetcher,
      persist: false,
    });
    if (failed.ok) throw new Error('ожидался отказ скана при недоступных рыночных данных');
    expect(failed.error).toMatch(/Market data unavailable/);
    expect((failed as Record<string, unknown>).setupsFound, 'на ошибке сводка не выдумывается').toBeUndefined();

    // Следующий скан с живым источником проходит — состояние не «залипло».
    const good = makeTransport();
    const ok = await scanStrategySafely({
      strategyId: V30,
      symbols: ['BTCUSDT'],
      fetcher: good.fetcher,
      persist: false,
    });
    if (!ok.ok) throw new Error(`ожидался успешный скан: ${ok.error}`);
    expect(ok.scan.lastError).toBeNull();
    expect(ok.scan.evaluatedBars).toBeGreaterThan(0);
  });

  withCore('частичный отказ (один символ из двух) тоже виден как ошибка скана', async () => {
    const { fetcher } = makeTransport({ failFor: /ETHUSDT/ });
    await expect(
      runStrategyScan({
        strategyId: V30,
        symbols: ['BTCUSDT', 'ETHUSDT'],
        fetcher,
        persist: false,
      })
    ).rejects.toMatchObject({ code: 'MARKET_DATA_UNAVAILABLE' });
  });
});

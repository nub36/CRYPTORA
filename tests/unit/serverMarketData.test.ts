/** @vitest-environment node */
/**
 * CRYPTORA — Граница рыночных данных серверного движка (F-09, F-10) и паритет
 * с замороженным ядром стратегий.
 *
 * Сервер исполняет ТО ЖЕ ядро, что и браузер, поэтому расхождение транспорта
 * молча меняло бы результаты стратегий:
 *  • таймфрейм '1D', ушедший в Binance как есть, — это HTTP 400, который ядро
 *    глотает внутри scanSymbol(): «нет данных» выглядело как «нет сетапов»;
 *  • потерянный `limit` означал окно в 300 баров там, где стратегия требует
 *    1000 — другая выборка, другие сетапы при том же коде.
 *
 * Здесь проверяются: нормализация всех реальных интервалов, нормализация
 * символа, границы лимита, кэш/дедупликация in-flight, проброс limit через
 * провайдер-адаптер, честные ошибки (без статического фолбэка) и ПАРИТЕТ
 * значений с константами ядра (`CANDLE_LIMIT_*`, `EXEC_TIMEFRAME`).
 */

import { describe, it, expect, beforeEach } from 'vitest';

import {
  MarketDataFetcher,
  toBinanceInterval,
  toExchangeSymbol,
  normalizeCandleLimit,
  BINANCE_INTERVAL_BY_TIMEFRAME,
  BINANCE_MAX_KLINES,
  CANDLE_LIMIT,
  DEFAULT_CANDLE_LIMIT,
  CACHE_TTL_MS,
  REQUEST_TIMEOUT_MS,
  getMarketDataFetcher,
  resetMarketDataFetcher,
} from '../../server/services/strategyEngine/marketDataFetcher.js';

// Константы ЯДРА (заморожены): паритет проверяется против источника, а не
// против копии в этом тесте.
import {
  CANDLE_LIMIT_1H,
  CANDLE_LIMIT_4H,
  CANDLE_LIMIT_1D,
  EXEC_TIMEFRAME,
} from '@/services/signals/live/LiveSignalEngine';
import { PRODUCT_STRATEGIES } from '../../server/services/strategyCatalog.js';

/** Сырой ответ Binance /api/v3/klines: [openTime, o, h, l, c, v, closeTime, …]. */
const kline = (openTime: number, close = 100) => [
  openTime, String(close), String(close + 1), String(close - 1), String(close), '12.5',
  openTime + 3_599_999, '1250.0', 42, '5.0', '500.0', '0',
];

interface Request {
  url: string;
  symbol: string;
  interval: string;
  limit: number;
}

/** Подставной транспорт: пишет запросы, отдаёт `limit` свечей. */
const makeTransport = (opts: { status?: number; payload?: unknown; fail?: boolean } = {}) => {
  const requests: Request[] = [];
  const fetchFn = (async (url: string) => {
    if (opts.fail) throw new Error('network unreachable');
    const q = new URL(url).searchParams;
    requests.push({
      url,
      symbol: q.get('symbol')!,
      interval: q.get('interval')!,
      limit: Number(q.get('limit')),
    });
    const payload =
      opts.payload ??
      Array.from({ length: Number(q.get('limit')) }, (_, i) => kline(1_758_000_000_000 + i * 3_600_000));
    return { ok: (opts.status ?? 200) === 200, status: opts.status ?? 200, json: async () => payload };
  }) as any;
  return { fetcher: new MarketDataFetcher({ fetchFn }), requests };
};

beforeEach(() => {
  resetMarketDataFetcher();
});

/* -------------------------------------------------------------------------- */
/* F-09: таймфреймы на границе провайдера                                      */
/* -------------------------------------------------------------------------- */

describe('Нормализация таймфреймов (F-09)', () => {
  it("дневной и недельный литералы ядра приводятся к формату биржи: '1D' → '1d', '1W' → '1w'", () => {
    expect(toBinanceInterval('1D')).toBe('1d');
    expect(toBinanceInterval('1W')).toBe('1w');
  });

  it('все реальные интервалы продукта отображаются явно (таблица, а не lowercase)', () => {
    const expected: Record<string, string> = {
      '1m': '1m', '5m': '5m', '15m': '15m', '30m': '30m',
      '1h': '1h', '2h': '2h', '4h': '4h', '6h': '6h', '8h': '8h', '12h': '12h',
      '1D': '1d', '1d': '1d', '3d': '3d', '1W': '1w', '1w': '1w',
    };
    expect(BINANCE_INTERVAL_BY_TIMEFRAME).toEqual(expected);
    for (const [tf, interval] of Object.entries(expected)) {
      expect(toBinanceInterval(tf), tf).toBe(interval);
    }
  });

  it("blanket-lowercase невозможен: месячный '1M' отклоняется, а не превращается в минуту", () => {
    // У Binance '1M' — месяц, а '1m' — минута. Приведение регистра молча
    // поменяло бы смысл серии, поэтому разрешён только явный список.
    expect(() => toBinanceInterval('1M')).toThrow(/Unsupported timeframe/);
    expect(BINANCE_INTERVAL_BY_TIMEFRAME).not.toHaveProperty('1M');
  });

  it('неизвестный таймфрейм — ошибка, а не тихая подмена серии', () => {
    for (const tf of ['15M', '2D', '4H', '1y', '', 'h1', null, undefined]) {
      expect(() => toBinanceInterval(tf as any), String(tf)).toThrow(/Unsupported timeframe/);
    }
  });

  it('нормализация живёт на границе провайдера, а не в стратегиях', () => {
    // Стратегии продолжают оперировать своими таймфреймами ('1D' — литерал
    // ArchiveTimeframe), а транспорт приводит их к бирже.
    const { fetcher, requests } = makeTransport();
    return Promise.all([
      fetcher.getCandles('BTCUSDT', '1D', { limit: 400 }),
      fetcher.getCandles('BTCUSDT', '1d', { limit: 400 }),
    ]).then(() => {
      expect(requests).toHaveLength(1); // один кэш-ключ на обе формы
      expect(requests[0].interval).toBe('1d');
    });
  });
});

/* -------------------------------------------------------------------------- */
/* Символ на границе провайдера                                                */
/* -------------------------------------------------------------------------- */

describe('Нормализация символа', () => {
  it('пара, биржевой символ и base приводятся к форме Binance', () => {
    expect(toExchangeSymbol('BTCUSDT')).toBe('BTCUSDT');
    expect(toExchangeSymbol('BTC/USDT')).toBe('BTCUSDT');
    expect(toExchangeSymbol('btc-usdt')).toBe('BTCUSDT');
    expect(toExchangeSymbol('btc_usdt')).toBe('BTCUSDT');
    expect(toExchangeSymbol('BTC')).toBe('BTCUSDT');
    expect(toExchangeSymbol('1000SHIB/USDT')).toBe('1000SHIBUSDT');
  });

  it('мусор отклоняется, а не уходит в URL', () => {
    for (const bad of ['', '   ', 'BTC USD', 'BTC/USDT/EUR', 'BTC*', null, undefined, 42]) {
      expect(() => toExchangeSymbol(bad as any), String(bad)).toThrow(/Unsupported market symbol/);
    }
  });

  it('одна и та же серия в разных формах — один HTTP-запрос', async () => {
    const { fetcher, requests } = makeTransport();
    await fetcher.getCandles('BTC/USDT', '1h', { limit: 100 });
    await fetcher.getCandles('BTCUSDT', '1h', { limit: 100 });
    await fetcher.getCandles('btc', '1h', { limit: 100 });
    expect(requests).toHaveLength(1);
    expect(requests[0].symbol).toBe('BTCUSDT');
  });
});

/* -------------------------------------------------------------------------- */
/* F-10: лимит свечей                                                          */
/* -------------------------------------------------------------------------- */

describe('Лимит свечей (F-10)', () => {
  it('запрошенный лимит пробрасывается в URL целиком', async () => {
    const { fetcher, requests } = makeTransport();
    await fetcher.getCandles('BTCUSDT', '1h', { limit: 1000 });
    expect(requests[0].limit).toBe(1000);
    expect(requests[0].url).toContain('limit=1000');
  });

  it('провайдер-адаптер ядра пробрасывает третий аргумент limit', async () => {
    const { fetcher, requests } = makeTransport();
    const provider = fetcher.asProvider();
    // Именно так ядро просит данные: getCandles(symbol, timeframe, limit).
    await provider.getCandles('BTCUSDT', '1h', CANDLE_LIMIT_1H);
    await provider.getCandles('BTCUSDT', '4h', CANDLE_LIMIT_4H);
    await provider.getCandles('BTCUSDT', '1D', CANDLE_LIMIT_1D);

    expect(requests.map((r) => [r.interval, r.limit])).toEqual([
      ['1h', 1000],
      ['4h', 1000],
      ['1d', 400],
    ]);
    expect(provider.isDemo, 'серверный провайдер не демо: журнал публикуется').toBe(false);
  });

  it('неограниченный запрос невозможен: всё приводится к [1, 1000]', () => {
    expect(normalizeCandleLimit(100_000, '1h')).toBe(BINANCE_MAX_KLINES);
    expect(normalizeCandleLimit(BINANCE_MAX_KLINES, '1h')).toBe(1000);
    expect(normalizeCandleLimit(0, '1h')).toBe(1);
    expect(normalizeCandleLimit(-50, '1h')).toBe(1);
    expect(normalizeCandleLimit(999.9, '1h')).toBe(999);
    expect(normalizeCandleLimit('250', '1h')).toBe(250);
    expect(BINANCE_MAX_KLINES).toBe(1000);
  });

  it('отсутствие лимита — дефолт таймфрейма, равный требованию ядра', () => {
    expect(normalizeCandleLimit(undefined, '1h')).toBe(CANDLE_LIMIT_1H);
    expect(normalizeCandleLimit(null, '4h')).toBe(CANDLE_LIMIT_4H);
    expect(normalizeCandleLimit('', '1d')).toBe(CANDLE_LIMIT_1D);
    expect(normalizeCandleLimit(undefined, '15m')).toBe(CANDLE_LIMIT['15m']);
    expect(normalizeCandleLimit(undefined, '30m')).toBe(CANDLE_LIMIT['30m']);
    // Неизвестный интервал — общий дефолт, а не «сколько-нибудь».
    expect(normalizeCandleLimit(undefined, '3d')).toBe(DEFAULT_CANDLE_LIMIT);
  });

  it('невалидный лимит отклоняется, а не подменяется дефолтом', () => {
    for (const bad of ['abc', NaN, Infinity, {}, []]) {
      expect(() => normalizeCandleLimit(bad as any, '1h'), String(bad)).toThrow(/Invalid candle limit/);
    }
  });

  it('лимит входит в ключ кэша: короткое окно не выдаётся тому, кто просил длинное', async () => {
    const { fetcher, requests } = makeTransport();
    const short = await fetcher.getCandles('BTCUSDT', '1h', { limit: 10 });
    const long = await fetcher.getCandles('BTCUSDT', '1h', { limit: 1000 });
    expect(requests.map((r) => r.limit)).toEqual([10, 1000]);
    expect(short).toHaveLength(10);
    expect(long).toHaveLength(1000);
  });
});

/* -------------------------------------------------------------------------- */
/* Паритет с ядром и каталогом                                                 */
/* -------------------------------------------------------------------------- */

describe('Паритет серверных констант с замороженным ядром', () => {
  it('дефолты лимитов равны CANDLE_LIMIT_* ядра', () => {
    expect(CANDLE_LIMIT['1h']).toBe(CANDLE_LIMIT_1H);
    expect(CANDLE_LIMIT['4h']).toBe(CANDLE_LIMIT_4H);
    expect(CANDLE_LIMIT['1d']).toBe(CANDLE_LIMIT_1D);
    expect(CANDLE_LIMIT_1H).toBe(1000);
    expect(CANDLE_LIMIT_1D).toBe(400);
    // Ни один дефолт не превышает потолок биржи.
    for (const limit of Object.values(CANDLE_LIMIT)) {
      expect(limit).toBeLessThanOrEqual(BINANCE_MAX_KLINES);
    }
  });

  it('таймфрейм исполнения каталога = EXEC_TIMEFRAME ядра (1h, не 15m)', () => {
    expect(EXEC_TIMEFRAME).toBe('1h');
    expect(PRODUCT_STRATEGIES).toHaveLength(3);
    for (const s of PRODUCT_STRATEGIES) {
      expect(s.execTimeframe, `${s.id}: execTimeframe`).toBe(EXEC_TIMEFRAME);
      expect(s.timeframes, `${s.id}: исполнение входит в набор серий`).toContain(EXEC_TIMEFRAME);
      // Контекст — отдельные таймфреймы, а не «15m» как активная характеристика.
      expect(s.contextTimeframes, `${s.id}: контекст`).toEqual(
        s.timeframes.filter((t: string) => t !== s.execTimeframe)
      );
      for (const tf of s.timeframes) {
        // Каждая серия каталога обязана быть достижима через транспорт.
        expect(() => toBinanceInterval(tf), `${s.id}: ${tf}`).not.toThrow();
      }
    }
    expect(PRODUCT_STRATEGIES.find((s: any) => s.id === 'V2_8_ZERO_FEE_SNIPER_TRAILING')!.timeframes)
      .toEqual(['1h', '4h', '1D']);
  });

  it('TTL кэша не превышает период свечи, а таймаут запроса конечен', () => {
    expect(CACHE_TTL_MS['1h']).toBeLessThanOrEqual(3_600_000);
    expect(CACHE_TTL_MS['1d']).toBeLessThanOrEqual(86_400_000);
    expect(REQUEST_TIMEOUT_MS).toBeGreaterThan(0);
    expect(REQUEST_TIMEOUT_MS).toBeLessThan(30_000);
  });
});

/* -------------------------------------------------------------------------- */
/* Кэш, дедупликация in-flight, ошибки                                         */
/* -------------------------------------------------------------------------- */

describe('Кэш и честность ошибок', () => {
  it('повторный запрос в пределах TTL не идёт в сеть', async () => {
    let now = 1_758_000_000_000;
    const requests: Request[] = [];
    const fetcher = new MarketDataFetcher({
      nowMs: () => now,
      fetchFn: (async (url: string) => {
        const q = new URL(url).searchParams;
        requests.push({ url, symbol: q.get('symbol')!, interval: q.get('interval')!, limit: Number(q.get('limit')) });
        return { ok: true, status: 200, json: async () => [kline(now)] };
      }) as any,
    });

    await fetcher.getCandles('BTCUSDT', '1h', { limit: 10 });
    await fetcher.getCandles('BTCUSDT', '1h', { limit: 10 });
    expect(requests).toHaveLength(1);

    now += CACHE_TTL_MS['1h'] + 1;
    await fetcher.getCandles('BTCUSDT', '1h', { limit: 10 });
    expect(requests, 'после истечения TTL серия обновляется').toHaveLength(2);
  });

  it('одновременные запросы одной серии сводятся к одному HTTP (дедуп in-flight)', async () => {
    const { fetcher, requests } = makeTransport();
    await Promise.all([
      fetcher.getCandles('BTCUSDT', '1h', { limit: 500 }),
      fetcher.getCandles('BTCUSDT', '1h', { limit: 500 }),
      fetcher.getCandles('BTCUSDT', '1h', { limit: 500 }),
    ]);
    expect(requests).toHaveLength(1);
    expect(fetcher.stats.httpRequests).toBe(1);
  });

  it('ошибка эндпоинта пробрасывается наверх и не кэшируется', async () => {
    const { fetcher, requests } = makeTransport({ status: 503 });
    await expect(fetcher.getCandles('BTCUSDT', '1h', { limit: 10 })).rejects.toThrow(/HTTP 503/);
    expect(requests).toHaveLength(1);

    // Статического фолбэка нет: следующая попытка снова идёт в сеть.
    await expect(fetcher.getCandles('BTCUSDT', '1h', { limit: 10 })).rejects.toThrow(/HTTP 503/);
    expect(requests).toHaveLength(2);
  });

  it('сетевой сбой не оставляет запись в in-flight (серия восстанавливается)', async () => {
    let fail = true;
    const fetcher = new MarketDataFetcher({
      fetchFn: (async () => {
        if (fail) throw new Error('network unreachable');
        return { ok: true, status: 200, json: async () => [kline(1)] };
      }) as any,
    });
    await expect(fetcher.getCandles('BTCUSDT', '1h', { limit: 5 })).rejects.toThrow(/network unreachable/);
    expect(fetcher.stats.inFlight).toBe(0);
    fail = false;
    await expect(fetcher.getCandles('BTCUSDT', '1h', { limit: 5 })).resolves.toHaveLength(1);
  });

  it('не-массив в теле ответа — ошибка, а не пустая серия', async () => {
    const { fetcher } = makeTransport({ payload: { msg: 'Invalid symbol.' } });
    await expect(fetcher.getCandles('BTCUSDT', '1h', { limit: 5 })).rejects.toThrow(/Unexpected klines payload/);
  });

  it('ответ приводится к форме OHLCV: время в секундах, closeTime сохраняется', async () => {
    const { fetcher } = makeTransport({ payload: [kline(1_758_000_000_000, 115_200.5)] });
    const candles = await fetcher.getCandles('BTCUSDT', '1h', { limit: 1 });
    expect(candles).toHaveLength(1);
    expect(candles[0]).toEqual({
      time: 1_758_000_000,
      open: 115_200.5,
      high: 115_201.5,
      low: 115_199.5,
      close: 115_200.5,
      volume: 12.5,
      closeTime: 1_758_000_000_000 + 3_599_999,
    });
  });

  it('запрос идёт на публичный эндпоинт без ключей и подписей', async () => {
    const { fetcher, requests } = makeTransport();
    await fetcher.getCandles('BTCUSDT', '1h', { limit: 10 });
    expect(requests[0].url.startsWith('https://api.binance.com/api/v3/klines?')).toBe(true);
    expect(requests[0].url).not.toMatch(/apiKey|api_key|signature|X-MBX/i);
  });

  it('синглтон фетчера создаётся один раз и сбрасывается явно', () => {
    const a = getMarketDataFetcher();
    const b = getMarketDataFetcher();
    expect(a).toBe(b);
    resetMarketDataFetcher();
    expect(getMarketDataFetcher()).not.toBe(a);
  });
});

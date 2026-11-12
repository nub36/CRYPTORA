/**
 * GET /api/v1/candles — свечи для графика.
 *
 * Проверяется контракт, на котором держится честность приложения:
 *   • свечи приходят только с backend'а (провайдер подменён, биржи нет);
 *   • символ ограничен вселенной V3.4, интервал — 1h/4h, limit — 20..300;
 *   • сбой источника — 502 с кодом, а НЕ пустой массив (иначе «рынок пуст»);
 *   • кэш не даёт нескольким телефонам дублировать запросы к бирже;
 *   • закрытость бара вычисляет сервер, клиент её не угадывает.
 */
import { describe, it, expect, afterEach } from 'vitest';
import type { Server } from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/api';
import { loadConfig } from '../src/config';
import { DisabledPushSender } from '../src/push/fcm';
import { CandleService } from '../src/candles';
import { MarketDataError } from '../src/market';
import { StaticProvider, tempDb, type TempDb } from './helpers';

const NOW = Date.UTC(2024, 5, 1, 12, 0, 0);
const HOUR_MS = 3_600_000;
const SYMBOL = 'BTCUSDT';

/** 25 часовых баров, последний — незакрытый (начался 10 минут назад). */
function hourlyRows(): unknown[][] {
  const rows: unknown[][] = [];
  for (let i = 0; i < 24; i++) {
    const openTime = NOW - (25 - i) * HOUR_MS;
    const base = 60_000 + i * 10;
    rows.push([openTime, String(base), String(base + 15), String(base - 15), String(base + 5), String(100 + i)]);
  }
  rows.push([NOW - 600_000, '60250', '60260', '60240', '60255', '42']);
  return rows;
}

interface Harness {
  server: Server;
  base: string;
  provider: StaticProvider;
  service: CandleService;
  t: TempDb;
  setNow(ms: number): void;
  close(): Promise<void>;
}

let open: Harness[] = [];
afterEach(async () => {
  for (const h of open) await h.close();
  open = [];
});

async function harness(opts: {
  failWith?: Error | null;
  ttlMs?: number;
  rows?: unknown[][];
  now?: number;
} = {}): Promise<Harness> {
  let now = opts.now ?? NOW;
  const provider = new StaticProvider(
    { '1h': opts.rows ?? hourlyRows(), '4h': opts.rows ?? hourlyRows(), symbol: SYMBOL, now: () => now },
    opts.failWith ?? null,
  );
  const service = new CandleService(provider, { ttlMs: opts.ttlMs ?? 0, now: () => now });
  const t = tempDb();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v34-candles-'));
  const config = loadConfig({
    V34_DB_PATH: t.file,
    V34_PORT: '8080',
    V34_STATIC_DIR: path.join(dir, 'landing'),
  });
  const app = createApp({
    repo: t.repo,
    config,
    push: new DisabledPushSender(['V34_PUSH_ENABLED=true'], 'push не настроен'),
    candles: service,
    version: '0.1.0-test',
    startedAtMs: now,
    now: () => now,
  });
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  const h: Harness = {
    server,
    base: `http://127.0.0.1:${port}`,
    provider,
    service,
    t,
    setNow: (ms) => { now = ms; },
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      t.cleanup();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
  open.push(h);
  return h;
}

async function getJson(url: string): Promise<{ status: number; body: Record<string, any> }> {
  const res = await fetch(url);
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

describe('GET /api/v1/candles', () => {
  it('отдаёт серверные свечи по возрастанию с флагом закрытия', async () => {
    const h = await harness();
    const { status, body } = await getJson(`${h.base}/api/v1/candles?symbol=BTCUSDT&interval=1h&limit=20`);

    expect(status).toBe(200);
    expect(body.symbol).toBe('BTC/USDT');
    expect(body.exchangeSymbol).toBe('BTCUSDT');
    expect(body.interval).toBe('1h');
    expect(body.limit).toBe(20);
    expect(body.count).toBe(20);
    expect(Array.isArray(body.candles)).toBe(true);
    expect(body.candles).toHaveLength(20);

    const candles = body.candles as { time: number; open: number; high: number; low: number; close: number; volume: number; closed: boolean }[];
    for (let i = 1; i < candles.length; i++) {
      expect(candles[i]!.time).toBeGreaterThan(candles[i - 1]!.time);
    }
    // Последний бар — текущий час: он не закрыт, и сервер говорит это прямо.
    expect(candles[candles.length - 1]!.closed).toBe(false);
    expect(candles[0]!.closed).toBe(true);
    expect(typeof candles[0]!.open).toBe('number');
    expect(typeof candles[0]!.high).toBe('number');
    expect(typeof candles[0]!.volume).toBe('number');

    // Источник назван; торговых полей и «цены сейчас» в ответе нет.
    expect(body.source).toEqual({ id: 'binance-spot-public-klines', exchange: 'Binance', isFallback: false });
    expect(JSON.stringify(body)).not.toMatch(/order|apiKey|secret/i);

    // Без успешного скана данные честно помечены как неподтверждённые.
    expect(body.stale).toBe(true);
    expect(body.staleReason).toContain('сканов ещё не было');
    expect(typeof body.asOf).toBe('string');
  });

  it('limit=999 ограничивается 300 и провайдер получает именно 300', async () => {
    const h = await harness();
    const { status, body } = await getJson(`${h.base}/api/v1/candles?symbol=BTCUSDT&limit=999`);
    expect(status).toBe(200);
    expect(body.limit).toBe(300);
    expect(h.provider.calls.at(-1)).toEqual({ symbol: 'BTCUSDT', interval: '1h', limit: 300 });
  });

  it('по умолчанию запрашивается 120 баров 1h', async () => {
    const h = await harness();
    const { body } = await getJson(`${h.base}/api/v1/candles?symbol=BTCUSDT`);
    expect(body.limit).toBe(120);
    expect(body.interval).toBe('1h');
    expect(h.provider.calls.at(-1)).toEqual({ symbol: 'BTCUSDT', interval: '1h', limit: 120 });
  });

  it('некорректный limit — 400, а не «сколько получилось»', async () => {
    const h = await harness();
    for (const value of ['abc', '0', '2.5']) {
      const { status, body } = await getJson(`${h.base}/api/v1/candles?symbol=BTCUSDT&limit=${value}`);
      expect(status).toBe(400);
      expect(body.error).toBe('bad_limit');
    }
    expect(h.provider.calls).toHaveLength(0);
  });

  it('символ вне конфигурации V3.4 — 400 со списком допустимых', async () => {
    const h = await harness();
    const { status, body } = await getJson(`${h.base}/api/v1/candles?symbol=FAKEUSDT`);
    expect(status).toBe(400);
    expect(body.error).toBe('bad_symbol');
    expect(body.allowed).toContain('BTCUSDT');
    expect(body.allowed).toContain('ETHUSDT');
    expect(h.provider.calls).toHaveLength(0);
  });

  it('без символа — 400; неизвестный интервал — 400', async () => {
    const h = await harness();
    const noSymbol = await getJson(`${h.base}/api/v1/candles`);
    expect(noSymbol.status).toBe(400);
    expect(noSymbol.body.error).toBe('bad_symbol');

    const badInterval = await getJson(`${h.base}/api/v1/candles?symbol=BTCUSDT&interval=5m`);
    expect(badInterval.status).toBe(400);
    expect(badInterval.body.error).toBe('bad_interval');
    expect(badInterval.body.allowed).toEqual(['1h', '4h']);
  });

  it('сбой биржи — 502 с кодом и без выдуманных свечей', async () => {
    const h = await harness({
      failWith: new MarketDataError({ code: 'TIMEOUT', message: 'запрос не уложился в 10000 мс' }),
    });
    const { status, body } = await getJson(`${h.base}/api/v1/candles?symbol=BTCUSDT`);
    expect(status).toBe(502);
    expect(body.error).toBe('market_unavailable');
    expect(body.code).toBe('TIMEOUT');
    expect(body.message).toContain('биржа не отдала свечи');
    // Никакого пустого массива: «нет данных» ≠ «на рынке пусто».
    expect(body.candles).toBeUndefined();
    expect(body.count).toBeUndefined();
  });

  it('HTTP-ошибка биржи пробрасывается кодом', async () => {
    const h = await harness({
      failWith: new MarketDataError({ code: 'HTTP', message: 'HTTP 451 от биржи', status: 451 }),
    });
    const { status, body } = await getJson(`${h.base}/api/v1/candles?symbol=BTCUSDT`);
    expect(status).toBe(502);
    expect(body.code).toBe('HTTP');
  });

  it('кэш: повторный запрос в пределах TTL не идёт на биржу, после TTL — идёт', async () => {
    const h = await harness({ ttlMs: 15_000 });
    await getJson(`${h.base}/api/v1/candles?symbol=BTCUSDT&limit=20`);
    await getJson(`${h.base}/api/v1/candles?symbol=BTCUSDT&limit=20`);
    expect(h.provider.calls).toHaveLength(1);

    h.setNow(NOW + 16_000);
    await getJson(`${h.base}/api/v1/candles?symbol=BTCUSDT&limit=20`);
    expect(h.provider.calls).toHaveLength(2);
  });

  it('одновременные одинаковые запросы не дублируют биржу', async () => {
    const h = await harness({ ttlMs: 15_000 });
    await Promise.all([
      getJson(`${h.base}/api/v1/candles?symbol=BTCUSDT&limit=20`),
      getJson(`${h.base}/api/v1/candles?symbol=BTCUSDT&limit=20`),
      getJson(`${h.base}/api/v1/candles?symbol=BTCUSDT&limit=20`),
    ]);
    expect(h.provider.calls).toHaveLength(1);
  });

  it('4h-серия отдаётся с тем же контрактом', async () => {
    const h = await harness();
    const { status, body } = await getJson(`${h.base}/api/v1/candles?symbol=BTCUSDT&interval=4h&limit=20`);
    expect(status).toBe(200);
    expect(body.interval).toBe('4h');
    expect(h.provider.calls.at(-1)?.interval).toBe('4h');
  });
});

describe('GET /api/v1/meta — данные для пары и графика', () => {
  it('отдаёт витринные пары и ограничения эндпоинта свечей', async () => {
    const h = await harness();
    const { body } = await getJson(`${h.base}/api/v1/meta`);

    expect(body.universe.pairs).toEqual([
      { symbol: 'BTC/USDT', exchangeSymbol: 'BTCUSDT' },
      { symbol: 'ETH/USDT', exchangeSymbol: 'ETHUSDT' },
      { symbol: 'BNB/USDT', exchangeSymbol: 'BNBUSDT' },
      { symbol: 'SOL/USDT', exchangeSymbol: 'SOLUSDT' },
      { symbol: 'XRP/USDT', exchangeSymbol: 'XRPUSDT' },
      { symbol: 'DOGE/USDT', exchangeSymbol: 'DOGEUSDT' },
    ]);
    expect(body.candles).toMatchObject({
      endpoint: '/api/v1/candles',
      intervals: ['1h', '4h'],
      minLimit: 20,
      maxLimit: 300,
    });
    expect(body.candles.note).toContain('backend');
  });
});

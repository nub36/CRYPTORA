/**
 * Провайдер рыночных данных: только публичный GET, строгая валидация ответа,
 * честные коды ошибок и разумные повторы.
 */
import { describe, it, expect } from 'vitest';
import { BinancePublicProvider, MarketDataError, INTERVAL_MS } from '../src/market';
import { makeFixtures } from './fixtures';

interface Call { url: string; init?: RequestInit }

function mockFetch(handler: (url: string, init?: RequestInit) => Promise<Response>) {
  const calls: Call[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, init });
    return handler(u, init);
  }) as unknown as typeof fetch;
  return { impl, calls };
}

function jsonRes(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

describe('BinancePublicProvider', () => {
  it('ходит только в публичный /api/v3/klines и разбирает ответ', async () => {
    const f = makeFixtures({ bars1h: 80 });
    const { impl, calls } = mockFetch(async () => jsonRes(f.rows1h));
    const provider = new BinancePublicProvider({ fetchImpl: impl, now: () => f.nowMs });
    const candles = await provider.getKlines('ASSETAUSDT', '1h', f.rows1h.length);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(
      'https://api.binance.com/api/v3/klines?symbol=ASSETAUSDT&interval=1h&limit=' + f.rows1h.length,
    );
    // Никаких ключей/подписей в запросе.
    const headers = (calls[0]!.init?.headers ?? {}) as Record<string, string>;
    expect(Object.keys(headers).map((h) => h.toLowerCase()).some((h) => h.includes('key') || h.includes('auth'))).toBe(false);
    expect(calls[0]!.init?.method).toBeUndefined(); // GET по умолчанию

    expect(candles).toHaveLength(f.rows1h.length);
    expect(candles[0]!.time).toBe(Math.floor(Number(f.rows1h[0]![0]) / 1000));
    expect(candles[0]!.provenance).toEqual({ exchange: 'Binance', isFallback: false });
  });

  it('4xx не повторяется, а 5xx — повторяется один раз', async () => {
    const f = makeFixtures({ bars1h: 70 });
    const bad = mockFetch(async () => jsonRes({ msg: 'Invalid symbol' }, 400));
    await expect(
      new BinancePublicProvider({ fetchImpl: bad.impl, now: () => f.nowMs }).getKlines('ASSETAUSDT', '1h', 70),
    ).rejects.toBeInstanceOf(MarketDataError);
    expect(bad.calls).toHaveLength(1);

    let attempt = 0;
    const flaky = mockFetch(async () => {
      attempt++;
      return attempt === 1 ? jsonRes({ msg: 'boom' }, 503) : jsonRes(f.rows1h);
    });
    const candles = await new BinancePublicProvider({ fetchImpl: flaky.impl, now: () => f.nowMs })
      .getKlines('ASSETAUSDT', '1h', 70);
    expect(flaky.calls).toHaveLength(2);
    expect(candles.length).toBe(70);
  });

  it('таймаут запроса даёт код TIMEOUT', async () => {
    const f = makeFixtures({ bars1h: 70 });
    const hanging = mockFetch((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        const err = new Error('aborted');
        err.name = 'AbortError';
        reject(err);
      });
    }));
    const provider = new BinancePublicProvider({ fetchImpl: hanging.impl, timeoutMs: 10, now: () => f.nowMs });
    await expect(provider.getKlines('ASSETAUSDT', '1h', 70)).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('битая строка, пустая серия и обратный ход времени — отдельные коды', async () => {
    const f = makeFixtures({ bars1h: 70 });
    const now = () => f.nowMs;

    const brokenRow = f.rows1h.map((r, i) => (i === 5 ? [r[0], 'abc', '1', '1', '1', '1'] : r));
    await expect(
      new BinancePublicProvider({ fetchImpl: mockFetch(async () => jsonRes(brokenRow)).impl, now }).getKlines('ASSETAUSDT', '1h', 70),
    ).rejects.toMatchObject({ code: 'BAD_ROW' });

    await expect(
      new BinancePublicProvider({ fetchImpl: mockFetch(async () => jsonRes([])).impl, now }).getKlines('ASSETAUSDT', '1h', 70),
    ).rejects.toMatchObject({ code: 'EMPTY' });

    const unsorted = [...f.rows1h];
    [unsorted[10], unsorted[11]] = [unsorted[11]!, unsorted[10]!];
    // Обратный ход времени — невалидный ответ, а не «дырка».
    await expect(
      new BinancePublicProvider({ fetchImpl: mockFetch(async () => jsonRes(unsorted)).impl, now }).getKlines('ASSETAUSDT', '1h', 70),
    ).rejects.toMatchObject({ code: 'ORDER' });
  });

  it('пропуск свечи — диагностика, а не блокировка всего символа', async () => {
    const f = makeFixtures({ bars1h: 70 });
    const now = () => f.nowMs;
    // Одна отсутствующая 1H-свеча: оригинальная логика CRYPTORA продолжает работу
    // и считает разрыв диагностикой (`countGaps`), значит адаптер обязан отдать
    // серию, а не выбросить весь символ.
    const gapped = f.rows1h.filter((_r, i) => i !== 20);
    const rows = await new BinancePublicProvider({
      fetchImpl: mockFetch(async () => jsonRes(gapped)).impl, now,
    }).getKlines('ASSETAUSDT', '1h', 69);

    expect(rows).toHaveLength(gapped.length);
    // Пропуск виден по времени: ровно один шаг вместо 3600000 мс.
    const deltas = rows.slice(1).map((r, i) => (r.time - rows[i]!.time) * 1000);
    expect(deltas.filter((d) => d !== 3_600_000)).toEqual([7_200_000]);
  });

  it('невалидные входные параметры отклоняются до сети', async () => {
    const { impl, calls } = mockFetch(async () => jsonRes([]));
    const provider = new BinancePublicProvider({ fetchImpl: impl });
    await expect(provider.getKlines('bad symbol', '1h', 100)).rejects.toBeInstanceOf(MarketDataError);
    await expect(provider.getKlines('BTCUSDT', '1h', 5000)).rejects.toBeInstanceOf(MarketDataError);
    expect(calls).toHaveLength(0);
  });

  it('шаги интервалов соответствуют биржевым', () => {
    expect(INTERVAL_MS['1h']).toBe(3_600_000);
    expect(INTERVAL_MS['4h']).toBe(14_400_000);
  });
});

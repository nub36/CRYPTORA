/**
 * SourceHealthTracker — circuit breaker внешних REST-источников.
 *
 * Контракт (RULES §1 — честность данных): трекер ничего не подменяет и не
 * кэширует рыночные данные. Он только прекращает повторять заведомо
 * отказывающие запросы и один раз диагностирует причину в консоль.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  SourceHealthTracker,
  exchangeEndpointKey,
} from '@/services/data/adapters/sourceHealth';
import { BinanceSpotAdapter } from '@/services/data/adapters/BinanceSpotAdapter';
import { KuCoinSpotAdapter } from '@/services/data/adapters/KuCoinSpotAdapter';
import { CandleHistoryService } from '@/services/data/CandleHistoryService';
import { LiveMarketDataProvider } from '@/services/data/LiveMarketDataProvider';
import {
  AdapterNetworkError,
  AdapterSourceBlockedError,
  AdapterTimeoutError,
  SymbolNotFoundError,
} from '@/services/data/adapters/errors';
import { CANONICAL_ASSETS } from '@/services/data/registry/assetRegistry';

/** Детерминированные часы для тестов. */
function makeClock() {
  let t = 1_000_000;
  const now = () => t;
  return {
    now,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe('SourceHealthTracker — политика блокировок', () => {
  it('network: блокирует endpoint только после порога подряд идущих неудач', () => {
    const clock = makeClock();
    const onBlocked = vi.fn();
    const tracker = new SourceHealthTracker({ now: clock.now, onBlocked });

    const key = 'market/stats?symbol=KAS-USDT';
    tracker.recordFailure('kucoin', key, 'network', 'Failed to fetch');
    tracker.recordFailure('kucoin', key, 'network', 'Failed to fetch');
    expect(tracker.canAttempt(key)).toBe(true);

    tracker.recordFailure('kucoin', key, 'network', 'Failed to fetch');
    expect(tracker.canAttempt(key)).toBe(false);
    expect(tracker.isBlocked(key)).toBe(true);
    expect(tracker.retryInMs(key)).toBeGreaterThan(0);
    expect(onBlocked).toHaveBeenCalledTimes(1);
    expect(onBlocked.mock.calls[0][0]).toMatchObject({ source: 'kucoin', endpointKey: key, kind: 'network' });
  });

  it('успешный ответ полностью восстанавливает ключ', () => {
    const clock = makeClock();
    const tracker = new SourceHealthTracker({ now: clock.now });
    const key = 'ticker/24hr?symbol=BTCUSDT';

    tracker.recordFailure('binance', key, 'network');
    tracker.recordFailure('binance', key, 'network');
    tracker.recordSuccess(key);
    tracker.recordFailure('binance', key, 'network');
    tracker.recordFailure('binance', key, 'network');

    // Эпизод начался заново — порога всё ещё нет.
    expect(tracker.canAttempt(key)).toBe(true);
    expect(tracker.retryInMs(key)).toBe(0);
  });

  it('half-open: после истечения cooldown запрос разрешён; новая неудача — backoff ×2, без повторного warn', () => {
    const clock = makeClock();
    const onBlocked = vi.fn();
    const tracker = new SourceHealthTracker({ now: clock.now, onBlocked });
    const key = 'market/stats?symbol=KAS-USDT';

    for (let i = 0; i < 3; i++) tracker.recordFailure('kucoin', key, 'network');
    const firstCooldown = tracker.retryInMs(key);
    expect(firstCooldown).toBe(10 * 60 * 1000);

    clock.advance(firstCooldown + 1);
    expect(tracker.canAttempt(key)).toBe(true);

    tracker.recordFailure('kucoin', key, 'network');
    expect(tracker.canAttempt(key)).toBe(false);
    expect(tracker.retryInMs(key)).toBe(20 * 60 * 1000); // 10 мин → ×2
    expect(onBlocked).toHaveBeenCalledTimes(1); // повторного warn нет

    tracker.recordSuccess(key);
    expect(tracker.canAttempt(key)).toBe(true);
    expect(tracker.retryInMs(key)).toBe(0);
  });

  it('invalid_symbol: блокирует сразу и надолго (делистинг не лечится повторами)', () => {
    const clock = makeClock();
    const tracker = new SourceHealthTracker({ now: clock.now });
    const key = 'klines?symbol=KASUSDT';

    tracker.recordFailure('binance', key, 'invalid_symbol', 'HTTP 400');
    expect(tracker.canAttempt(key)).toBe(false);
    expect(tracker.retryInMs(key)).toBe(6 * 60 * 60 * 1000);
  });

  it('rate_limit: короткий cooldown 30 с', () => {
    const clock = makeClock();
    const tracker = new SourceHealthTracker({ now: clock.now });
    const key = 'ticker/24hr';

    tracker.recordFailure('binance', key, 'rate_limit', 'HTTP 418');
    expect(tracker.canAttempt(key)).toBe(false);
    expect(tracker.retryInMs(key)).toBe(30 * 1000);

    clock.advance(30_001);
    expect(tracker.canAttempt(key)).toBe(true);
  });

  it('по умолчанию диагностирует в console.warn ровно один раз за эпизод', () => {
    const clock = makeClock();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const tracker = new SourceHealthTracker({ now: clock.now });
      const key = 'market/stats?symbol=KAS-USDT';
      for (let i = 0; i < 5; i++) tracker.recordFailure('kucoin', key, 'network');
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain('[CRYPTORA][kucoin]');
      expect(String(warn.mock.calls[0][0])).toContain(key);
    } finally {
      warn.mockRestore();
    }
  });
});

describe('exchangeEndpointKey — ключ endpoint\'а без изменчивых параметров', () => {
  it('ресурс + symbol, без interval/limit', () => {
    expect(exchangeEndpointKey('/api/v3/klines?symbol=KASUSDT&interval=1h&limit=25')).toBe('klines?symbol=KASUSDT');
    expect(exchangeEndpointKey('/api/v3/klines?symbol=KASUSDT&interval=1d&limit=8')).toBe('klines?symbol=KASUSDT');
    expect(exchangeEndpointKey('/api/v3/ticker/24hr?symbol=BTCUSDT')).toBe('ticker/24hr?symbol=BTCUSDT');
    expect(exchangeEndpointKey('/api/v3/ticker/24hr')).toBe('ticker/24hr');
    expect(exchangeEndpointKey('/api/v1/market/stats?symbol=KAS-USDT')).toBe('market/stats?symbol=KAS-USDT');
    expect(exchangeEndpointKey('/api/v1/market/allTickers')).toBe('market/allTickers');
  });
});

describe('BinanceSpotAdapter × SourceHealthTracker', () => {
  const BINANCE_TICKER_FIXTURE = {
    symbol: 'BTCUSDT', priceChange: '1', priceChangePercent: '2.00', weightedAvgPrice: '1',
    prevClosePrice: '1', lastPrice: '65000', lastQty: '0.1', bidPrice: '1', askPrice: '1',
    openPrice: '1', highPrice: '1', lowPrice: '1', volume: '1', quoteVolume: '1',
    openTime: 1, closeTime: 2, count: 1,
  };

  it('сетевые отказы: 3 запроса доходят до fetch, 4-й блокируется без сети', async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const adapter = new BinanceSpotAdapter({ fetchFn: fetchFn as unknown as typeof fetch, health: new SourceHealthTracker() });

    await expect(adapter.fetch24hrTicker('KASUSDT')).rejects.toBeInstanceOf(AdapterNetworkError);
    await expect(adapter.fetch24hrTicker('KASUSDT')).rejects.toBeInstanceOf(AdapterNetworkError);
    await expect(adapter.fetch24hrTicker('KASUSDT')).rejects.toBeInstanceOf(AdapterNetworkError);
    expect(fetchFn).toHaveBeenCalledTimes(3);

    const err = await adapter.fetch24hrTicker('KASUSDT').catch((e) => e);
    expect(err).toBeInstanceOf(AdapterSourceBlockedError);
    expect(err.endpointKey).toBe('ticker/24hr?symbol=KASUSDT');
    expect(fetchFn).toHaveBeenCalledTimes(3); // сеть не дёргалась
  });

  it('400 «инструмент не найден»: SymbolNotFoundError и мгновенная блокировка символа', async () => {
    const fetchFn = vi.fn(async () => new Response('{"code":-1121,"msg":"Invalid symbol."}', { status: 400 }));
    const adapter = new BinanceSpotAdapter({ fetchFn: fetchFn as unknown as typeof fetch, health: new SourceHealthTracker() });

    await expect(adapter.fetchKlines('KASUSDT', '1h', 25)).rejects.toBeInstanceOf(SymbolNotFoundError);
    expect(fetchFn).toHaveBeenCalledTimes(1);

    await expect(adapter.fetchKlines('KASUSDT', '1h', 25)).rejects.toBeInstanceOf(AdapterSourceBlockedError);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('успех сбрасывает счётчик; таймауты не учитываются circuit breaker\'ом', async () => {
    const okResponse = () => new Response(JSON.stringify(BINANCE_TICKER_FIXTURE), { status: 200 });
    let fail = true;
    const fetchFn = vi.fn(async () => {
      if (fail) {
        const e = new Error('The operation was aborted');
        e.name = 'AbortError';
        throw e;
      }
      return okResponse();
    });
    const adapter = new BinanceSpotAdapter({ fetchFn: fetchFn as unknown as typeof fetch, health: new SourceHealthTracker() });

    for (let i = 0; i < 5; i++) {
      await expect(adapter.fetch24hrTicker('BTCUSDT')).rejects.toBeInstanceOf(AdapterTimeoutError);
    }
    expect(fetchFn).toHaveBeenCalledTimes(5); // таймауты не блокируют

    fail = false;
    await expect(adapter.fetch24hrTicker('BTCUSDT')).resolves.toBeTruthy();
    expect(adapter['health']?.isBlocked('ticker/24hr?symbol=BTCUSDT')).toBe(false);
  });
});

describe('KuCoinSpotAdapter × SourceHealthTracker', () => {
  it('CORS-подобный отказ блокируется после порога, диагностика с меткой kucoin', async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const onBlocked = vi.fn();
    const adapter = new KuCoinSpotAdapter({
      fetchFn: fetchFn as unknown as typeof fetch,
      health: new SourceHealthTracker({ onBlocked }),
    });

    const key = 'market/stats?symbol=KAS-USDT';
    await expect(adapter.fetch24hrStats('KAS-USDT')).rejects.toBeInstanceOf(AdapterNetworkError);
    await expect(adapter.fetch24hrStats('KAS-USDT')).rejects.toBeInstanceOf(AdapterNetworkError);
    await expect(adapter.fetch24hrStats('KAS-USDT')).rejects.toBeInstanceOf(AdapterNetworkError);
    await expect(adapter.fetch24hrStats('KAS-USDT')).rejects.toBeInstanceOf(AdapterSourceBlockedError);
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(onBlocked.mock.calls[0][0]).toMatchObject({ source: 'kucoin', endpointKey: key });
  });
});

describe('CandleHistoryService × SourceHealthTracker', () => {
  it('недоступные klines не долбятся каждым циклом обогащения', async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const service = new CandleHistoryService(
      fetchFn as unknown as typeof fetch,
      new SourceHealthTracker({ onBlocked: () => {} }) // тихий трекер — проверяем поведение, не логи
    );

    // Цикл 1: все запросы уходят в сеть и отказывают.
    const r1 = await service.getAll();
    const calls1 = fetchFn.mock.calls.length;
    expect(calls1).toBeGreaterThan(0);
    expect(r1.get('BTC')?.isLive).toBe(false);
    expect(r1.get('BTC')?.change1h).toBeNull();

    // Цикл 2: часть запросов ещё уходит (порог 3 не достигнут на первом цикле),
    // но после него ключи блокируются.
    service.resetCache();
    await service.getAll();
    const calls2 = fetchFn.mock.calls.length;
    expect(calls2).toBeGreaterThanOrEqual(calls1);

    // Цикл 3: заблокированные ключи не порождают ни одного нового запроса.
    service.resetCache();
    await service.getAll();
    expect(fetchFn.mock.calls.length).toBe(calls2);
  });

  it('боевой синглтон создаётся с включённым трекером', () => {
    // getInstance() — единственная точка, где CandleHistoryService работает в prod.
    const instance = CandleHistoryService.getInstance();
    expect(instance['health']).toBeInstanceOf(SourceHealthTracker);
  });
});

describe('LiveMarketDataProvider — P11 дедупликация warn', () => {
  const SAMPLE_TICKER = {
    symbol: 'BTCUSDT', priceChange: '1200.00', priceChangePercent: '2.00', weightedAvgPrice: '64000.00',
    prevClosePrice: '63800.00', lastPrice: '65000.00', lastQty: '0.1', bidPrice: '65000.00',
    askPrice: '65001.00', openPrice: '63800.00', highPrice: '65500.00', lowPrice: '63500.00',
    volume: '10000.00', quoteVolume: '650000000.00', openTime: 1726358400000, closeTime: 1726444800000, count: 50000,
  };

  function bulkWithout(...symbols: string[]): any[] {
    return CANONICAL_ASSETS.filter((a) => !symbols.includes(a.symbol)).map((a) => ({
      ...SAMPLE_TICKER,
      symbol: a.binanceSymbol,
    }));
  }

  function makeProvider(missing: string[]) {
    const binanceMock = new BinanceSpotAdapter();
    vi.spyOn(binanceMock, 'fetchAll24hrTickers').mockResolvedValue(bulkWithout(...missing));
    const kucoinMock = new KuCoinSpotAdapter();
    vi.spyOn(kucoinMock, 'fetch24hrStats').mockRejectedValue(new AdapterNetworkError('kucoin'));
    const candleStub = { getAll: async () => new Map() } as any;
    return new LiveMarketDataProvider({
      binanceAdapter: binanceMock,
      kucoinAdapter: kucoinMock,
      candleHistoryService: candleStub,
      cacheTtlMs: 0,
    });
  }

  it('одинаковый состав отсутствующих активов предупреждает один раз, изменение состава — снова', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const provider = makeProvider(['KAS']);

      await provider.getAssets();
      await provider.getAssets();
      const p11Warnings = () => warn.mock.calls.filter((c) => String(c[0]).startsWith('[P11]')).length;
      expect(p11Warnings()).toBe(1);

      // Состав изменился — новый warn оправдан.
      vi.spyOn(binanceFetchOf(provider), 'fetchAll24hrTickers').mockResolvedValue(bulkWithout('KAS', 'RUNE'));
      await provider.getAssets();
      expect(p11Warnings()).toBe(2);
    } finally {
      warn.mockRestore();
    }
  });

  function binanceFetchOf(provider: LiveMarketDataProvider): BinanceSpotAdapter {
    return (provider as any).binance as BinanceSpotAdapter;
  }
});

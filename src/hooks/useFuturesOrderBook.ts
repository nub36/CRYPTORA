import { useCallback, useEffect, useRef, useState } from 'react';
import type { MarketDataProvider } from '@/services/data/MarketDataProvider';
import { UnsupportedMarketSymbolError } from '@/services/data/adapters/errors';
import type { OrderBookSnapshot } from '@/types/realtime';

/**
 * Стакан USD-M-перпетуала (задача §4).
 *
 * Почему REST-поллинг, а не WebSocket: `RealtimeFeedManager` в CRYPTORA —
 * это Binance **SPOT** WS-поток. Подписать на него фьючерсный символ значит
 * показать спотовую книгу под видом фьючерсной, что прямо запрещено. Пока
 * отдельного USD-M WS-клиента нет, честный источник — `GET /fapi/v1/depth`
 * через futures-gateway, опрашиваемый раз в 5 секунд.
 *
 * Дисциплина запросов:
 *  • одновременно живёт максимум ОДИН запрос: новый цикл не стартует, пока не
 *    завершился предыдущий (нет «наслаивания» при медленном ответе);
 *  • при смене контракта/размонтировании запрос отменяется AbortController'ом,
 *    а пришедший позже ответ отбрасывается по ключу — старая книга не может
 *    перезаписать новую (§18, «cancellation of stale requests»);
 *  • при скрытой вкладке (`document.hidden`) опрос не выполняется — это
 *    экономит вес rate-limit биржи;
 *  • ошибки не затирают уже показанный снапшот: он помечается устаревшим,
 *    а не заменяется пустым/чужим.
 */
export type FuturesOrderBookStatus = 'loading' | 'ready' | 'unsupported' | 'unavailable' | 'no-data';

export interface UseFuturesOrderBookOptions {
  provider: MarketDataProvider;
  /** Базовый тикер контракта (`MEW`, `1000PEPE`) или символ контракта. */
  symbol: string;
  enabled?: boolean;
  limit?: number;
  pollMs?: number;
}

export interface UseFuturesOrderBookResult {
  orderBook: OrderBookSnapshot | null;
  status: FuturesOrderBookStatus;
  /** Время последнего успешного снапшота (мс). */
  updatedAt: number | null;
  refresh: () => void;
}

export function useFuturesOrderBook({
  provider,
  symbol,
  enabled = true,
  limit = 50,
  pollMs = 5_000,
}: UseFuturesOrderBookOptions): UseFuturesOrderBookResult {
  const [orderBook, setOrderBook] = useState<OrderBookSnapshot | null>(null);
  const [status, setStatus] = useState<FuturesOrderBookStatus>('loading');
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [manualKey, setManualKey] = useState(0);
  const requestKeyRef = useRef('');

  const refresh = useCallback(() => setManualKey((key) => key + 1), []);

  useEffect(() => {
    const fetcher = provider.getFuturesOrderBook?.bind(provider);
    if (!symbol || !enabled) return;
    if (!fetcher) {
      // Провайдер без поддержки фьючерсного стакана (QA-фикстура): честное
      // «нет данных» вместо спотовой книги.
      setOrderBook(null);
      setStatus('no-data');
      return;
    }

    const key = `${symbol}:${limit}:${manualKey}`;
    requestKeyRef.current = key;
    let disposed = false;
    let timer: number | undefined;
    let controller: AbortController | null = null;

    setOrderBook(null);
    setUpdatedAt(null);
    setStatus('loading');

    const tick = async () => {
      if (disposed || requestKeyRef.current !== key) return;
      if (typeof document !== 'undefined' && document.hidden) {
        schedule();
        return;
      }
      controller = new AbortController();
      try {
        const snapshot = await fetcher(symbol, { limit, signal: controller.signal });
        if (disposed || requestKeyRef.current !== key) return; // устаревший ответ
        if (!snapshot || (snapshot.bids.length === 0 && snapshot.asks.length === 0)) {
          setStatus('no-data');
        } else {
          setOrderBook(snapshot);
          setUpdatedAt(Date.now());
          setStatus('ready');
        }
      } catch (error) {
        if (disposed || requestKeyRef.current !== key) return;
        setStatus(error instanceof UnsupportedMarketSymbolError ? 'unsupported' : 'unavailable');
      } finally {
        if (!disposed && requestKeyRef.current === key) schedule();
      }
    };

    function schedule() {
      if (disposed) return;
      timer = window.setTimeout(() => { void tick(); }, pollMs);
    }

    void tick();

    return () => {
      disposed = true;
      if (timer !== undefined) window.clearTimeout(timer);
      controller?.abort();
    };
  }, [provider, symbol, enabled, limit, pollMs, manualKey]);

  return { orderBook, status, updatedAt, refresh };
}

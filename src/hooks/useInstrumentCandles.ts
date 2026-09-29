import { useCallback, useEffect, useRef, useState } from 'react';
import type { MarketDataProvider } from '@/services/data/MarketDataProvider';
import { UnsupportedMarketSymbolError } from '@/services/data/adapters/errors';
import type { ChartDataStatus } from '@/components/common/ChartDataState';
import type { MarketType, OHLCV, Timeframe } from '@/types/market';

/**
 * ОБЩАЯ загрузка свечей для Spot и Futures (задача §2, §18).
 *
 * Раньше каждая страница имела собственный эффект: Spot — с дедлайном,
 * слиянием WS-свечи и записью в репозиторий, Futures — с AbortController и
 * защитой от устаревшего ответа. Инварианты («рынок передаётся явно»,
 * «устаревший ответ отбрасывается», «ошибка ≠ пустой холст») повторялись в
 * двух местах и могли разъехаться. Теперь они живут здесь:
 *
 *  • `market` уходит в провайдер ЯВНО и участвует в ключе запроса, поэтому
 *    ответ одного рынка физически не может примениться к другому (RC-6/RC-8);
 *  • ответ применяется только если ключ `symbol:market:timeframe:retry`
 *    совпадает с текущим;
 *  • `abortOnChange` включает отмену предыдущего запроса через AbortSignal
 *    (страница фьючерса), `deadlineMs` — UI-дедлайн зависшего провайдера
 *    (страница спота);
 *  • `transform`/`onApplied` — точки расширения для рынка (Spot подмешивает
 *    последнюю WS-свечу и пишет историю в репозиторий), при этом сама
 *    последовательность состояний одинакова.
 *
 * Хук НЕ подставляет данные другого рынка ни при каких ошибках: любой отказ
 * даёт `unavailable`/`unsupported` и пустую серию.
 */
export interface UseInstrumentCandlesOptions {
  provider: MarketDataProvider;
  /** Базовый тикер маршрута (`BTC`, `1000PEPE`). */
  symbol: string;
  market: MarketType;
  timeframe: Timeframe;
  limit?: number;
  enabled?: boolean;
  /** UI-дедлайн на случай провайдера, который никогда не резолвит промис. */
  deadlineMs?: number;
  /** Отменять предыдущий запрос (AbortSignal) при смене ключа. */
  abortOnChange?: boolean;
  /** Преобразование ответа до записи в состояние (например, merge WS-свечи). */
  transform?: (rows: OHLCV[]) => OHLCV[];
  /** Побочный эффект после применения серии (сохранение истории). */
  onApplied?: (rows: OHLCV[]) => void;
  /** Сброс локальных буферов рынка при смене ключа запроса. */
  onRequestStart?: () => void;
}

export interface UseInstrumentCandlesResult {
  candles: OHLCV[];
  setCandles: React.Dispatch<React.SetStateAction<OHLCV[]>>;
  status: ChartDataStatus;
  retry: () => void;
  /** Текущий ключ запроса — тесты и восстановление истории сверяются с ним. */
  requestKey: string;
  retryKey: number;
}

export function useInstrumentCandles(options: UseInstrumentCandlesOptions): UseInstrumentCandlesResult {
  const {
    provider,
    symbol,
    market,
    timeframe,
    limit = 500,
    enabled = true,
    deadlineMs,
    abortOnChange = false,
    transform,
    onApplied,
    onRequestStart,
  } = options;

  const [candles, setCandles] = useState<OHLCV[]>([]);
  const [status, setStatus] = useState<ChartDataStatus>('loading');
  const [retryKey, setRetryKey] = useState(0);
  const requestKey = `${symbol}:${market}:${timeframe}:${retryKey}`;
  const activeKeyRef = useRef(requestKey);

  // Колбэки читаются через ref: пересоздание стрелочной функции на стороне
  // страницы не должно перезапускать сетевой запрос.
  const transformRef = useRef(transform);
  transformRef.current = transform;
  const appliedRef = useRef(onApplied);
  appliedRef.current = onApplied;
  const startRef = useRef(onRequestStart);
  startRef.current = onRequestStart;

  const retry = useCallback(() => setRetryKey((key) => key + 1), []);

  useEffect(() => {
    if (!symbol || !enabled) return;
    activeKeyRef.current = requestKey;
    let active = true;
    const controller = abortOnChange ? new AbortController() : null;
    let deadlineTimer: number | undefined;

    startRef.current?.();
    setCandles([]);
    setStatus('loading');

    const request = provider.getCandles(symbol, timeframe, limit, {
      market,
      ...(controller ? { signal: controller.signal } : {}),
    });

    const guarded = deadlineMs
      ? Promise.race([
          request,
          new Promise<never>((_, reject) => {
            deadlineTimer = window.setTimeout(
              () => reject(new Error(`${market} candle request exceeded ${deadlineMs}ms`)),
              deadlineMs,
            );
          }),
        ])
      : request;

    void guarded
      .then((rows) => {
        if (!active || activeKeyRef.current !== requestKey) return; // устаревший ответ
        const applied = transformRef.current ? transformRef.current(rows) : rows;
        setCandles(applied);
        setStatus(applied.length === 0 ? 'no-data' : 'ready');
        appliedRef.current?.(applied);
      })
      .catch((error: unknown) => {
        if (!active || activeKeyRef.current !== requestKey) return;
        setCandles([]);
        setStatus(error instanceof UnsupportedMarketSymbolError ? 'unsupported' : 'unavailable');
      })
      .finally(() => {
        if (deadlineTimer !== undefined) window.clearTimeout(deadlineTimer);
      });

    return () => {
      active = false;
      if (deadlineTimer !== undefined) window.clearTimeout(deadlineTimer);
      controller?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, symbol, market, timeframe, limit, enabled, deadlineMs, abortOnChange, requestKey]);

  return { candles, setCandles, status, retry, requestKey, retryKey };
}

/**
 * useSignalChartCandles — свечи ТОЛЬКО выбранного инструмента и таймфрейма.
 *
 * Это защита от главного запрета Signals V2 (§18): никакого
 * `universe.map(fetchCandles)`. Хук делает ровно один запрос на пару
 * (символ, таймфрейм) через существующий `MarketDataProvider` (у него свой
 * кэш и резервный источник), а при смене символа/таймфрейма устаревший ответ
 * отбрасывается — быстрый переход BTC → SOL → BTC не может показать свечи SOL.
 *
 * Повторяет проверенный паттерн `/coin`: флаг `active` в замыкании эффекта +
 * жёсткий дедлайн (провайдер может использовать 8 с на Binance и ещё 8 с на
 * резервном KuCoin), чтобы состояние загрузки не зависало навсегда.
 *
 * Тяжёлых синхронных расчётов индикаторов здесь нет: регрессия PR #13
 * (`IndicatorEngine.calculateVolumeProfile`) возвращаться не должна.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { OHLCV, Timeframe } from '@/types/market';
import type { KlineTick } from '@/types/realtime';
import type { MarketDataProvider } from '@/services/data/MarketDataProvider';
import { useRealtimeKline } from './useRealtimeKline';
import { mapTimeframeToBinanceInterval } from './useRealtimeKline';

export type CandlesPhase = 'idle' | 'loading' | 'ready' | 'error';

export interface SignalChartCandlesOptions {
  /** BASE-тикер ('BTC'). null/пусто — символ не выбран, запросов нет. */
  symbol: string | null;
  timeframe: Timeframe;
  /** Сколько баров просить. Провайдер клампит до лимита биржи (≤1000). */
  limit?: number;
  /** Обновлять последний бар по WebSocket (по умолчанию да). */
  realtime?: boolean;
  /** Финальный UI-дедлайн запроса, мс. */
  deadlineMs?: number;
}

export interface SignalChartCandlesState {
  candles: OHLCV[];
  /** Последний kline-тик WS (CandleChart сам валидирует символ/интервал). */
  realtimeKline: KlineTick | null;
  phase: CandlesPhase;
  errorMessage: string | null;
  /** Сколько запросов свечей реально выполнено — для проверки «нет веера». */
  requestCount: number;
  reload: () => void;
}

const DEFAULT_CANDLE_LIMIT = 500;
const DEFAULT_DEADLINE_MS = 17_000;

export function useSignalChartCandles(
  provider: MarketDataProvider,
  options: SignalChartCandlesOptions
): SignalChartCandlesState {
  const {
    symbol,
    timeframe,
    limit = DEFAULT_CANDLE_LIMIT,
    realtime = true,
    deadlineMs = DEFAULT_DEADLINE_MS,
  } = options;

  const [candles, setCandles] = useState<OHLCV[]>([]);
  const [realtimeKline, setRealtimeKline] = useState<KlineTick | null>(null);
  const [phase, setPhase] = useState<CandlesPhase>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [requestCount, setRequestCount] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  const requestCountRef = useRef(0);

  const normalized = typeof symbol === 'string' ? symbol.trim().toUpperCase() : '';

  useEffect(() => {
    if (!normalized) {
      setCandles([]);
      setRealtimeKline(null);
      setPhase('idle');
      setErrorMessage(null);
      return;
    }

    let active = true;
    let deadlineTimer: number | undefined;

    // Старые свечи сбрасываются СРАЗУ: график предыдущего инструмента не должен
    // оставаться на экране, пока грузится новый (иначе маркеры/линии «поедут»).
    setCandles([]);
    setRealtimeKline(null);
    setPhase('loading');
    setErrorMessage(null);

    const deadline = new Promise<never>((_, reject) => {
      deadlineTimer = window.setTimeout(
        () => reject(new Error('Запрос свечей превысил отведённое время')),
        deadlineMs
      );
    });

    requestCountRef.current += 1;
    setRequestCount(requestCountRef.current);

    void Promise.race([provider.getCandles(normalized, timeframe, limit), deadline])
      .then((rows) => {
        // Устаревший ответ (символ/таймфрейм успели сменить) не применяется.
        if (!active) return;
        setCandles(Array.isArray(rows) ? rows : []);
        setPhase('ready');
      })
      .catch((e: unknown) => {
        if (!active) return;
        setCandles([]);
        setPhase('error');
        setErrorMessage(e instanceof Error ? e.message : 'Источник свечей недоступен');
      })
      .finally(() => {
        if (deadlineTimer !== undefined) window.clearTimeout(deadlineTimer);
      });

    return () => {
      active = false;
      if (deadlineTimer !== undefined) window.clearTimeout(deadlineTimer);
    };
  }, [normalized, timeframe, limit, provider, deadlineMs, reloadKey]);

  // WS-тик последнего бара. Подписка живёт только для выбранного символа и
  // только когда свечи уже загружены: плодить соединения впустую не нужно.
  const handleKlineTick = useCallback(
    (tick: KlineTick) => {
      if (!normalized) return;
      if (tick.symbol.toUpperCase().replace(/USDT$/, '') !== normalized) return;
      if (tick.interval !== mapTimeframeToBinanceInterval(timeframe)) return;
      setRealtimeKline(tick);
    },
    [normalized, timeframe]
  );

  useRealtimeKline({
    symbol: normalized || undefined,
    timeframe,
    enabled: realtime && Boolean(normalized) && phase === 'ready',
    onKlineTick: handleKlineTick,
  });

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  return { candles, realtimeKline, phase, errorMessage, requestCount, reload };
}

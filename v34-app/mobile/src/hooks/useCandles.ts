/**
 * Свечи выбранной пары — только с backend'а V3.4.
 *
 * Телефон не ходит на биржу: адрес Binance, проверка ответа, кэш и лимиты —
 * забота сервера. Здесь только состояния экрана:
 *   • `loading` — первая загрузка серии;
 *   • `ready` — серия пришла (пустая серия сервером не отдаётся: он вернёт 502);
 *   • `error` — сеть/сервер; график НЕ дорисовывается из прошлых данных молча,
 *     но и не стирается: ошибка показывается рядом с последней серией.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, type ApiClient } from '../api/client';
import type { CandlesResponse } from '../api/types';

export type CandlesPhase = 'loading' | 'ready' | 'error';

export interface CandlesState {
  phase: CandlesPhase;
  data: CandlesResponse | null;
  error: { message: string; kind: string } | null;
  refreshing: boolean;
}

export interface UseCandlesResult extends CandlesState {
  refresh: () => Promise<void>;
}

export interface UseCandlesOptions {
  symbol: string | null;
  interval?: '1h' | '4h';
  limit?: number;
  pollMs?: number;
}

export function useCandles(api: ApiClient, options: UseCandlesOptions): UseCandlesResult {
  const { symbol, interval = '1h', limit = 120, pollMs = 0 } = options;
  const [state, setState] = useState<CandlesState>({
    phase: 'loading',
    data: null,
    error: null,
    refreshing: false,
  });
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const requestId = useRef(0);

  const load = useCallback(
    async (mode: 'initial' | 'refresh') => {
      if (!symbol) return;
      if (inFlight.current) return;
      inFlight.current = true;
      const id = ++requestId.current;
      if (mounted.current) {
        setState((prev) => ({
          ...prev,
          refreshing: mode === 'refresh',
          phase: mode === 'initial' ? 'loading' : prev.phase,
        }));
      }
      try {
        const data = await api.getCandles({ symbol, interval, limit });
        // Ответ на предыдущую пару не должен перерисовать текущую.
        if (!mounted.current || id !== requestId.current) return;
        setState({ phase: 'ready', data, error: null, refreshing: false });
      } catch (e) {
        if (!mounted.current || id !== requestId.current) return;
        const err = e instanceof ApiError
          ? { message: e.message, kind: e.kind }
          : { message: e instanceof Error ? e.message : 'неизвестная ошибка', kind: 'unknown' };
        setState((prev) => ({
          phase: prev.data === null ? 'error' : prev.phase,
          data: prev.data,
          error: err,
          refreshing: false,
        }));
      } finally {
        inFlight.current = false;
      }
    },
    [api, symbol, interval, limit],
  );

  useEffect(() => {
    mounted.current = true;
    // Новая пара — новая серия: старые свечи не должны оставаться на экране.
    setState({ phase: 'loading', data: null, error: null, refreshing: false });
    void load('initial');
    return () => { mounted.current = false; };
  }, [load]);

  useEffect(() => {
    if (!symbol || !pollMs || pollMs <= 0) return undefined;
    const timer = setInterval(() => { void load('refresh'); }, pollMs);
    return () => clearInterval(timer);
  }, [load, pollMs, symbol]);

  const refresh = useCallback(async () => { await load('refresh'); }, [load]);

  return { ...state, refresh };
}

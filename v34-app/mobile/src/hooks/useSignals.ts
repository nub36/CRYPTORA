/**
 * Загрузка ленты сигналов.
 *
 * Состояния явные: `loading` (первая загрузка), `ready` (данные есть, возможно
 * пустые), `error` (сеть/сервер). Данные НЕ подменяются пустым списком при
 * ошибке: пользователь должен видеть разницу между «сетапов нет» и «нет связи».
 *
 * Опрос — по таймеру, но только пока экран смонтирован; параллельные запросы
 * не дублируются.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, type ApiClient, type ListParams } from '../api/client';
import type { SignalsListResponse } from '../api/types';

export type SignalsPhase = 'loading' | 'ready' | 'error';

export interface SignalsState {
  phase: SignalsPhase;
  data: SignalsListResponse | null;
  error: { message: string; kind: string } | null;
  refreshing: boolean;
  lastLoadedAt: string | null;
}

export interface UseSignalsResult extends SignalsState {
  refresh: () => Promise<void>;
}

export interface UseSignalsOptions {
  params?: ListParams;
  /** Интервал автообновления, мс. 0 — без опроса. */
  pollMs?: number;
}

export function useSignals(api: ApiClient, options: UseSignalsOptions = {}): UseSignalsResult {
  const { params, pollMs = 0 } = options;
  const paramsKey = JSON.stringify(params ?? {});
  const [state, setState] = useState<SignalsState>({
    phase: 'loading',
    data: null,
    error: null,
    refreshing: false,
    lastLoadedAt: null,
  });
  const inFlight = useRef(false);
  const mounted = useRef(true);

  const load = useCallback(
    async (mode: 'initial' | 'refresh') => {
      if (inFlight.current) return;
      inFlight.current = true;
      if (mounted.current) {
        setState((prev) => ({
          ...prev,
          refreshing: mode === 'refresh',
          phase: mode === 'initial' && prev.data === null ? 'loading' : prev.phase,
        }));
      }
      try {
        const data = await api.getSignals(JSON.parse(paramsKey) as ListParams);
        if (!mounted.current) return;
        setState({
          phase: 'ready',
          data,
          error: null,
          refreshing: false,
          lastLoadedAt: new Date().toISOString(),
        });
      } catch (e) {
        if (!mounted.current) return;
        const err = e instanceof ApiError
          ? { message: e.message, kind: e.kind }
          : { message: e instanceof Error ? e.message : 'неизвестная ошибка', kind: 'unknown' };
        setState((prev) => ({
          // Если данные уже были показаны — оставляем их, но фиксируем ошибку
          // обновления; пустой экран при сбое не появляется.
          phase: prev.data === null ? 'error' : prev.phase,
          data: prev.data,
          error: err,
          refreshing: false,
          lastLoadedAt: prev.lastLoadedAt,
        }));
      } finally {
        inFlight.current = false;
      }
    },
    [api, paramsKey],
  );

  useEffect(() => {
    mounted.current = true;
    void load('initial');
    return () => {
      mounted.current = false;
    };
  }, [load]);

  useEffect(() => {
    if (!pollMs || pollMs <= 0) return undefined;
    const timer = setInterval(() => {
      void load('refresh');
    }, pollMs);
    return () => clearInterval(timer);
  }, [load, pollMs]);

  const refresh = useCallback(async () => {
    await load('refresh');
  }, [load]);

  return { ...state, refresh };
}

/**
 * Загрузка конфигурации сервера (пары V3.4, таймфреймы, ограничения графика).
 *
 * Список пар не хардкодится в приложении: он приходит из `/api/v1/meta`, то есть
 * из той же конфигурации, по которой сервер сканирует рынок. Если meta
 * недоступна, экран честно говорит «сервер недоступен» — подставлять локальный
 * список пар вместо ответа сервера запрещено.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, type ApiClient } from '../api/client';
import type { MetaResponse } from '../api/types';

export type MetaPhase = 'loading' | 'ready' | 'error';

export interface MetaState {
  phase: MetaPhase;
  data: MetaResponse | null;
  error: { message: string; kind: string } | null;
  refreshing: boolean;
}

export interface UseMetaResult extends MetaState {
  refresh: () => Promise<void>;
}

export interface UseMetaOptions {
  /** Интервал автообновления, мс. 0 — без опроса. */
  pollMs?: number;
}

export function useMeta(api: ApiClient, options: UseMetaOptions = {}): UseMetaResult {
  const { pollMs = 0 } = options;
  const [state, setState] = useState<MetaState>({
    phase: 'loading',
    data: null,
    error: null,
    refreshing: false,
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
        const data = await api.getMeta();
        if (!mounted.current) return;
        setState({ phase: 'ready', data, error: null, refreshing: false });
      } catch (e) {
        if (!mounted.current) return;
        const err = e instanceof ApiError
          ? { message: e.message, kind: e.kind }
          : { message: e instanceof Error ? e.message : 'неизвестная ошибка', kind: 'unknown' };
        setState((prev) => ({
          // Уже показанную конфигурацию не выбрасываем из-за сбоя обновления.
          phase: prev.data === null ? 'error' : prev.phase,
          data: prev.data,
          error: err,
          refreshing: false,
        }));
      } finally {
        inFlight.current = false;
      }
    },
    [api],
  );

  useEffect(() => {
    mounted.current = true;
    void load('initial');
    return () => { mounted.current = false; };
  }, [load]);

  useEffect(() => {
    if (!pollMs || pollMs <= 0) return undefined;
    const timer = setInterval(() => { void load('refresh'); }, pollMs);
    return () => clearInterval(timer);
  }, [load, pollMs]);

  const refresh = useCallback(async () => { await load('refresh'); }, [load]);

  return { ...state, refresh };
}

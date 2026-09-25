/**
 * useServerSignalById — точечная загрузка ОДНОГО серверного сигнала по id.
 *
 * Зачем: уведомление колокольчика ссылается на конкретный сигнал
 * (`/signals?symbol=RUNE&signal=<uuid>`), а первая страница ленты может его не
 * содержать — лента ограничена (лимит ≤ 200) и отсортирована по
 * `created_at DESC`. Догружать страницы «пока не найдётся» значит делать
 * неограниченное число запросов; сервер отдаёт строку точечно
 * (`GET /api/signals/:id`).
 *
 * Возвращается тот же `SignalDto`, что и в ленте (одна идентичность), включая
 * `provenanceStatus`: страница обязана показать карантинный статус, если строка
 * помечена как MISMATCH/UNKNOWN, а не прятать её.
 *
 * Гонки: смена id отменяет предыдущий запрос (AbortController + номер запроса) —
 * ответ по старому сигналу не может подменить новый. Отмена не считается
 * ошибкой источника.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchSignalById, isAbortError, type SignalDto } from '@/services/strategyOps';

export type FocusedSignalPhase = 'idle' | 'loading' | 'ready' | 'error';

export interface FocusedSignalError {
  code: string | null;
  message: string;
  /** HTTP-статус, если он есть у ошибки (`404` — сигнала нет). */
  status: number | null;
}

export interface ServerSignalByIdState {
  signal: SignalDto | null;
  phase: FocusedSignalPhase;
  error: FocusedSignalError | null;
  requestCount: number;
  reload: () => void;
}

export interface UseServerSignalByIdOptions {
  /** Не запрашивать (например, сигнал уже есть в загруженной странице ленты). */
  enabled?: boolean;
  /** Инъекция для тестов. */
  fetchById?: (id: string, init?: RequestInit) => Promise<SignalDto>;
}

function describeError(error: unknown): FocusedSignalError {
  if (typeof error === 'object' && error !== null) {
    const e = error as { status?: number; code?: string; message?: string };
    return {
      code: typeof e.code === 'string' ? e.code : 'NETWORK',
      message: typeof e.message === 'string' && e.message ? e.message : 'Сигнал недоступен',
      status: typeof e.status === 'number' ? e.status : null,
    };
  }
  return { code: 'NETWORK', message: 'Сигнал недоступен', status: null };
}

export function useServerSignalById(
  signalId: string | null,
  options: UseServerSignalByIdOptions = {}
): ServerSignalByIdState {
  const { enabled = true, fetchById = fetchSignalById } = options;

  const [signal, setSignal] = useState<SignalDto | null>(null);
  const [phase, setPhase] = useState<FocusedSignalPhase>('idle');
  const [error, setError] = useState<FocusedSignalError | null>(null);
  const [requestCount, setRequestCount] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  const requestIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const id = typeof signalId === 'string' && signalId.trim() ? signalId.trim() : '';

  useEffect(() => {
    if (!id || !enabled) {
      setSignal(null);
      setError(null);
      setPhase('idle');
      return;
    }

    const requestId = ++requestIdRef.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setSignal(null);
    setError(null);
    setPhase('loading');
    setRequestCount((n) => n + 1);

    void fetchById(id, { signal: controller.signal })
      .then((dto) => {
        if (requestId !== requestIdRef.current) return;
        setSignal(dto);
        setPhase('ready');
      })
      .catch((e: unknown) => {
        if (isAbortError(e)) return;
        if (requestId !== requestIdRef.current) return;
        setSignal(null);
        setError(describeError(e));
        setPhase('error');
      });

    return () => {
      controller.abort();
    };
  }, [id, enabled, fetchById, reloadKey]);

  useEffect(
    () => () => {
      requestIdRef.current++;
      abortRef.current?.abort();
    },
    []
  );

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  return { signal, phase, error, requestCount, reload };
}

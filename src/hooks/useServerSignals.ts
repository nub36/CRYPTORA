/**
 * useServerSignals — загрузка ленты серверных сигналов (`GET /api/signals`).
 *
 * Источник истины Signals V2 — серверный журнал (PostgreSQL через API), а не
 * браузерный `SignalsAuditLedger`. Хук отвечает за три вещи, которые легко
 * сделать неправильно:
 *
 *  1. ГОНКИ (§17 задачи). Быстрый переход BTC → SOL → BTC не должен показать
 *     сигналы SOL поверх BTC. Защита двухслойная: `AbortController` отменяет
 *     устаревший запрос, а монотонный `requestId` отбрасывает ответ, который
 *     всё-таки долетел после отмены. Отмена НЕ считается ошибкой источника.
 *  2. ОГРАНИЧЕННЫЕ ЗАПРОСЫ (§18). Лента запрашивается только для выбранного
 *     инструмента и только страницами (`limit`/`offset` из контракта API);
 *     «вся история одним запросом» и веер по вселенной невозможны.
 *  3. ЧЕСТНЫЕ СОСТОЯНИЯ (§16). Пустая лента — это `ready` с нулём сигналов,
 *     а не ошибка; `400` от API отдаёт код (`INVALID_*`) в `error.code`,
 *     недоступность сервера/БД — отдельное состояние `error`.
 *
 * Порядок ленты НЕ пересортировывается: сервер отдаёт `created_at DESC, id DESC`,
 * поэтому первый элемент — самый свежий сигнал.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchSignalsPage,
  isAbortError,
  type SignalDto,
  type SignalFilters,
  type SignalStatus,
  type SignalsPageDto,
} from '@/services/strategyOps';
import { useAutoRefresh } from './useAutoRefresh';

export type ServerSignalsPhase = 'idle' | 'loading' | 'ready' | 'error';

export interface ServerSignalsError {
  /** Код ошибки API (`INVALID_SYMBOL`, `INVALID_LIMIT`, …) или 'NETWORK'. */
  code: string | null;
  message: string;
  status: number | null;
}

export interface ServerSignalsQuery {
  /** Пара ('BTC/USDT') или BASE-тикер — сервер нормализует сам. null = без фильтра. */
  symbol?: string | null;
  strategy?: string | null;
  status?: SignalStatus | null;
  open?: boolean | null;
  direction?: 'LONG' | 'SHORT' | null;
  /** Размер страницы: 1..200 (сервер отклоняет выход за границы). */
  limit?: number;
}

export interface UseServerSignalsOptions {
  /** Не выполнять запросы (например, символ ещё не выбран). */
  enabled?: boolean;
  /**
   * Периодичность обновления первой страницы, мс. `useAutoRefresh` сам
   * приостанавливает цикл в фоновой вкладке и обновляет при возврате.
   * 0/undefined — без автообновления.
   */
  pollMs?: number;
  /** Инъекция для тестов (по умолчанию — настоящий клиент API). */
  fetchPage?: (filters: SignalFilters, init?: RequestInit) => Promise<SignalsPageDto>;
}

export interface ServerSignalsState {
  phase: ServerSignalsPhase;
  /** Загруженная лента (страница + догруженные страницы). */
  signals: SignalDto[];
  /** Сколько всего строк под фильтром — из ответа сервера, не из длины массива. */
  total: number;
  limit: number;
  /** Сколько строк уже загружено (offset следующей страницы). */
  loaded: number;
  /** Есть ли ещё страницы (`loaded < total`). */
  hasMore: boolean;
  loadingMore: boolean;
  error: ServerSignalsError | null;
  /** Домен состояний из ответа API — UI не хардкодит список статусов. */
  statuses: SignalStatus[];
  openStatuses: SignalStatus[];
  appliedFilters: SignalsPageDto['appliedFilters'] | null;
  /** Что реально отдал сервер: 'server'. */
  source: string | null;
  lastLoadedAt: number | null;
  /** Сколько запросов ленты выполнено (для проверки «нет веера запросов»). */
  requestCount: number;
  reload: () => void;
  loadMore: () => void;
}

const DEFAULT_LIMIT = 20;

function describeError(error: unknown): ServerSignalsError {
  if (typeof error === 'object' && error !== null) {
    const e = error as { status?: number; code?: string; message?: string };
    return {
      code: typeof e.code === 'string' ? e.code : 'NETWORK',
      message: typeof e.message === 'string' && e.message ? e.message : 'Источник сигналов недоступен',
      status: typeof e.status === 'number' ? e.status : null,
    };
  }
  return { code: 'NETWORK', message: 'Источник сигналов недоступен', status: null };
}

export function useServerSignals(
  query: ServerSignalsQuery,
  options: UseServerSignalsOptions = {}
): ServerSignalsState {
  const { enabled = true, pollMs = 0, fetchPage = fetchSignalsPage } = options;
  const limit = query.limit ?? DEFAULT_LIMIT;

  const [signals, setSignals] = useState<SignalDto[]>([]);
  const [total, setTotal] = useState(0);
  const [loaded, setLoaded] = useState(0);
  const [phase, setPhase] = useState<ServerSignalsPhase>('idle');
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<ServerSignalsError | null>(null);
  const [statuses, setStatuses] = useState<SignalStatus[]>([]);
  const [openStatuses, setOpenStatuses] = useState<SignalStatus[]>([]);
  const [appliedFilters, setAppliedFilters] = useState<SignalsPageDto['appliedFilters'] | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [lastLoadedAt, setLastLoadedAt] = useState<number | null>(null);
  const [requestCount, setRequestCount] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);

  const requestIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const loadedRef = useRef(0);
  loadedRef.current = loaded;

  // Ключ запроса: смена любого фильтра — это НОВАЯ лента (старая очищается).
  const queryKey = JSON.stringify({
    symbol: query.symbol ?? null,
    strategy: query.strategy ?? null,
    status: query.status ?? null,
    open: query.open ?? null,
    direction: query.direction ?? null,
    limit,
  });

  const buildFilters = useCallback(
    (offset: number): SignalFilters => {
      const filters: SignalFilters = { limit, offset };
      if (query.symbol) filters.symbol = query.symbol;
      if (query.strategy) filters.strategy = query.strategy;
      if (query.status) filters.status = query.status;
      if (query.direction) filters.direction = query.direction;
      if (query.open !== null && query.open !== undefined) filters.open = query.open;
      return filters;
    },
    // queryKey уже содержит все значимые поля — зависимости стабильны.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queryKey, limit]
  );

  const run = useCallback(
    async (mode: 'first' | 'more'): Promise<void> => {
      const requestId = ++requestIdRef.current;
      // Отменяем предыдущий запрос: его ответ больше не нужен и не применится.
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const offset = mode === 'more' ? loadedRef.current : 0;
      if (mode === 'first') {
        // Старая лента сбрасывается СРАЗУ: маркеры и линии предыдущего
        // инструмента не должны оставаться на экране, пока грузится новый.
        setSignals([]);
        setTotal(0);
        setLoaded(0);
        loadedRef.current = 0;
        setPhase('loading');
      } else {
        setLoadingMore(true);
      }
      setError(null);
      setRequestCount((n) => n + 1);

      try {
        const page = await fetchPage(buildFilters(offset), { signal: controller.signal });
        // Ответ устарел (ушёл более поздний запрос) — не применяем его.
        if (requestId !== requestIdRef.current) return;

        setSignals((prev) => (mode === 'more' ? [...prev, ...page.signals] : page.signals));
        const nextLoaded = offset + page.signals.length;
        setTotal(page.total);
        setLoaded(nextLoaded);
        loadedRef.current = nextLoaded;
        setStatuses(page.statuses);
        setOpenStatuses(page.openStatuses);
        setAppliedFilters(page.appliedFilters);
        setSource(page.source);
        setLastLoadedAt(Date.now());
        setPhase('ready');
      } catch (e) {
        // Отмена — штатная часть гонки, а не ошибка источника.
        if (isAbortError(e)) return;
        if (requestId !== requestIdRef.current) return;
        setError(describeError(e));
        setPhase('error');
      } finally {
        if (requestId === requestIdRef.current) setLoadingMore(false);
      }
    },
    [buildFilters, fetchPage]
  );

  // Первая загрузка при смене фильтра/символа.
  useEffect(() => {
    if (!enabled) {
      setPhase('idle');
      setSignals([]);
      setTotal(0);
      setLoaded(0);
      return;
    }
    void run('first');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey, enabled, reloadKey]);

  // Отмена при размонтировании: ответ не должен прилететь в мёртвый компонент.
  useEffect(
    () => () => {
      requestIdRef.current++;
      abortRef.current?.abort();
    },
    []
  );

  // Автообновление первой страницы — только видимая вкладка (useAutoRefresh).
  useAutoRefresh(
    useCallback(() => run('first'), [run]),
    pollMs > 0 ? pollMs : 60_000,
    { skipImmediate: true, enabled: enabled && pollMs > 0 }
  );

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);
  const loadMore = useCallback(() => {
    if (loadingMore) return;
    void run('more');
  }, [loadingMore, run]);

  return {
    phase,
    signals,
    total,
    limit,
    loaded,
    hasMore: phase === 'ready' && loaded < total,
    loadingMore,
    error,
    statuses,
    openStatuses,
    appliedFilters,
    source,
    lastLoadedAt,
    requestCount,
    reload,
    loadMore,
  };
}

/**
 * useServerSignalNotifications — питание ПРОДАКШН-колокольчика серверной лентой.
 *
 * Колокольчик и `/signals` обязаны говорить об одном и том же: и то и другое
 * читает `GET /api/signals` (PostgreSQL). Хук делает РОВНО один ограниченный
 * запрос за цикл (первая страница, `limit ≤ 200`) — никакого веера по вселенной
 * и никакой генерации сигналов на клиенте.
 *
 * Честные состояния:
 *   • первая синхронизация НЕ создаёт событий по уже существующим сигналам
 *     (кадр базы), дальше сравниваются статусы (`serverSignalNotifications`);
 *   • ошибка источника записывается в аудит (`lastError`) и НЕ очищает уже
 *     показанные уведомления: «сервер недоступен» ≠ «событий не было»;
 *   • опрос приостанавливается в фоновой вкладке (`useAutoRefresh`) — лимиты
 *     источника в фоне не сжигаются.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchSignalsPage,
  isAbortError,
  type SignalFilters,
  type SignalsPageDto,
} from '@/services/strategyOps';
import {
  serverSignalNotifications,
  type ServerNotificationAudit,
  type ServerSignalNotification,
  type ServerSignalNotificationCenter,
} from '@/services/signals/serverSignalNotifications';
import { useAutoRefresh } from './useAutoRefresh';

export interface UseServerSignalNotificationsOptions {
  /** Не выполнять запросы (контекст может включать ленту условно). */
  enabled?: boolean;
  /** Периодичность синхронизации, мс. */
  pollMs?: number;
  /** Размер страницы ленты (сервер ограничивает 200). */
  limit?: number;
  /** Инъекции для тестов. */
  fetchPage?: (filters: SignalFilters, init?: RequestInit) => Promise<SignalsPageDto>;
  center?: ServerSignalNotificationCenter;
}

export interface ServerSignalNotificationsState {
  notifications: ServerSignalNotification[];
  unreadCount: number;
  audit: ServerNotificationAudit;
  /** Сколько запросов ленты выполнено (проверка «нет веера»/«нет опроса в фоне»). */
  requestCount: number;
  markAllRead: () => void;
  clear: () => void;
  refresh: () => void;
}

const DEFAULT_POLL_MS = 60_000;
const DEFAULT_LIMIT = 50;

/** Сравнение лент по элементам: центр отдаёт новые массивы при каждом изменении. */
function sameNotifications(
  a: readonly ServerSignalNotification[],
  b: readonly ServerSignalNotification[]
): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((item, i) => item === b[i]);
}

/** Сравнение аудита по полям: лишний ререндер при неизменных счётчиках не нужен. */
function sameAudit(a: ServerNotificationAudit, b: ServerNotificationAudit): boolean {
  if (a === b) return true;
  return (
    a.lastSyncAt === b.lastSyncAt &&
    a.considered === b.considered &&
    a.eligible === b.eligible &&
    a.excludedMismatch === b.excludedMismatch &&
    a.excludedUnknown === b.excludedUnknown &&
    a.lastError === b.lastError &&
    a.quarantinedLegacy === b.quarantinedLegacy
  );
}

function describeError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'object' && error !== null) {
    const e = error as { message?: string; code?: string };
    if (typeof e.message === 'string' && e.message) return e.message;
    if (typeof e.code === 'string' && e.code) return e.code;
  }
  return 'Источник серверных сигналов недоступен';
}

export function useServerSignalNotifications(
  options: UseServerSignalNotificationsOptions = {}
): ServerSignalNotificationsState {
  const {
    enabled = true,
    pollMs = DEFAULT_POLL_MS,
    limit = DEFAULT_LIMIT,
    fetchPage = fetchSignalsPage,
    center = serverSignalNotifications,
  } = options;

  const [notifications, setNotifications] = useState<ServerSignalNotification[]>(() =>
    center.getNotifications()
  );
  const [unreadCount, setUnreadCount] = useState(() => center.getUnreadCount());
  const [audit, setAudit] = useState<ServerNotificationAudit>(() => center.getAudit());
  const [requestCount, setRequestCount] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);

  const abortRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);

  // Подписка на центр: лента одна на приложение (синглтон), компонентов может
  // быть несколько — состояние приходит из центра, а не копится у каждого.
  // Сравнение с предыдущим значением убирает лишние ререндеры: подписка
  // срабатывает и на события, которые видимого состояния не меняют.
  useEffect(() => {
    center.start();
    const sync = () => {
      const nextItems = center.getNotifications();
      setNotifications((prev) => (sameNotifications(prev, nextItems) ? prev : nextItems));
      const nextUnread = center.getUnreadCount();
      setUnreadCount((prev) => (prev === nextUnread ? prev : nextUnread));
      const nextAudit = center.getAudit();
      setAudit((prev) => (sameAudit(prev, nextAudit) ? prev : nextAudit));
    };
    sync();
    return center.subscribe(sync);
  }, [center]);

  const run = useCallback(async (): Promise<void> => {
    if (!enabled) return;
    const requestId = ++requestIdRef.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setRequestCount((n) => n + 1);

    try {
      const page = await fetchPage({ limit, offset: 0 }, { signal: controller.signal });
      if (requestId !== requestIdRef.current) return;
      center.ingest(page.signals);
    } catch (e) {
      if (isAbortError(e)) return;
      if (requestId !== requestIdRef.current) return;
      center.noteSourceError(describeError(e));
    }
  }, [center, enabled, fetchPage, limit]);

  // Первая синхронизация — при включении (и при смене ключа перезагрузки).
  useEffect(() => {
    if (!enabled) return;
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, reloadKey]);

  // Отмена при размонтировании: ответ не должен прилететь в мёртвый компонент.
  useEffect(
    () => () => {
      requestIdRef.current++;
      abortRef.current?.abort();
    },
    []
  );

  useAutoRefresh(run, pollMs, { skipImmediate: true, enabled: enabled && pollMs > 0 });

  const markAllRead = useCallback(() => center.markAllRead(), [center]);
  const clear = useCallback(() => center.clear(), [center]);
  const refresh = useCallback(() => setReloadKey((k) => k + 1), []);

  return { notifications, unreadCount, audit, requestCount, markAllRead, clear, refresh };
}

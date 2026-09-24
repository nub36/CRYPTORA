/**
 * useServerScanner — ЧЕСТНЫЙ статус сканирования сигналов с сервера.
 *
 * ЗАЧЕМ. Прежняя плашка на `/signals` читала состояние БРАУЗЕРНОГО движка
 * (`LiveSignalEngine.getInstance()?.getStatus()`) и рисовала «LIVE-скан · каждые
 * 60с» даже когда все три стратегии в PostgreSQL выключены
 * (`enabled = false`, `status = 'OFF'`). Пользователь видел «система ищет
 * сигналы», хотя сервер не сканировал ничего (BUG C).
 *
 * ПРАВИЛО. Статус сканирования — это состояние СЕРВЕРА, а не состояние
 * открытой вкладки:
 *   • 0 включённых стратегий  → «Сканирование сигналов выключено»;
 *   • N включённых            → «Сканирование включено: N стратегий · каждые Xс»;
 *   • статус ERROR            → отдельная строка ошибки (не «LIVE»);
 *   • запрос не удался        → «статус недоступен», а не «выключено».
 *
 * БЮДЖЕТ ЗАПРОСОВ (§18). Один запрос `/api/strategies` на тик; тик
 * приостанавливается в фоновой вкладке (`useAutoRefresh`) и сразу
 * перезапрашивается при возврате. Цикл не вложенный и не зависит от ленты
 * сигналов — три независимых опроса остаются тремя, а не превращаются в веер.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchStrategies, type StrategyStateDto } from '@/services/strategyOps';
import { fetchSignalMonitorState, type SignalMonitorStateDto } from '@/services/strategyOps';
import { useAutoRefresh } from './useAutoRefresh';

export type ScannerPhase = 'loading' | 'ready' | 'error';

export interface ServerScannerState {
  phase: ScannerPhase;
  /** Все стратегии каталога (сервер сам решает, какие включены). */
  strategies: StrategyStateDto[];
  enabledCount: number;
  errorCount: number;
  /** Минимальный интервал скана среди включённых стратегий, секунды. */
  scanIntervalSeconds: number | null;
  lastScanAt: string | null;
  lastError: string | null;
  /** Ошибка самого запроса (не стратегии). */
  error: { code: string | null; message: string } | null;
  /** Состояние серверного монитора открытых сигналов. */
  monitor: SignalMonitorStateDto | null;
  requestCount: number;
}

export interface UseServerScannerOptions {
  pollMs?: number;
  enabled?: boolean;
  /** Инъекция для тестов. */
  fetch?: typeof fetchStrategies;
  fetchMonitor?: typeof fetchSignalMonitorState;
}

const DEFAULT_POLL_MS = 15_000;

export function useServerScanner(options: UseServerScannerOptions = {}): ServerScannerState {
  const { pollMs = DEFAULT_POLL_MS, enabled = true, fetch = fetchStrategies, fetchMonitor = fetchSignalMonitorState } = options;

  const [phase, setPhase] = useState<ScannerPhase>('loading');
  const [strategies, setStrategies] = useState<StrategyStateDto[]>([]);
  const [error, setError] = useState<{ code: string | null; message: string } | null>(null);
  const [monitor, setMonitor] = useState<SignalMonitorStateDto | null>(null);
  const [requestCount, setRequestCount] = useState(0);

  const requestIdRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setRequestCount((n) => n + 1);
    try {
      const rows = await fetch();
      if (requestId !== requestIdRef.current) return;
      // Ответ без массива стратегий — это «неизвестно», а не «все выключены»:
      // иначе сломанный контракт показывался бы как намеренно выключенный сканер.
      setStrategies(Array.isArray(rows) ? rows : []);
      setError(null);
      setPhase('ready');
    } catch (e) {
      if (requestId !== requestIdRef.current) return;
      const err = e as { code?: string; message?: string };
      setError({ code: err.code ?? null, message: err.message ?? 'Статус сканирования недоступен' });
      setPhase('error');
    }
    // Монитор — второстепенный: его отказ не должен ломать плашку сканера.
    try {
      const m = await fetchMonitor();
      if (requestId === requestIdRef.current) setMonitor(m);
    } catch {
      /* монитор не критичен для плашки */
    }
  }, [fetch, fetchMonitor]);

  useEffect(() => {
    if (!enabled) {
      setPhase('loading');
      return;
    }
    void load();
  }, [enabled, load]);

  useAutoRefresh(load, pollMs > 0 ? pollMs : DEFAULT_POLL_MS, {
    skipImmediate: true,
    enabled: enabled && pollMs > 0,
  });

  /**
   * «Включена» — положение админ-переключателя (`enabled`), а НЕ отсутствие
   * ошибки. Иначе стратегия, которую включили и скан которой упал
   * (`enabled: true`, `status: 'ERROR'` — exactly так считает `deriveStatus`),
   * попадала в «включённых 0», и плашка врала «Сканирование сигналов
   * выключено», хотя сканер работает и падает. Ошибка показывается отдельной
   * строкой, а не подменяет выключенное состояние.
   */
  const enabledRows = strategies.filter((s) => s.enabled);
  const errorRows = strategies.filter((s) => s.status === 'ERROR');

  return {
    phase,
    strategies,
    enabledCount: enabledRows.length,
    errorCount: errorRows.length,
    scanIntervalSeconds: enabledRows.length > 0
      ? Math.min(...enabledRows.map((s) => s.scanIntervalSeconds || 60))
      : null,
    lastScanAt: enabledRows.reduce<string | null>(
      (acc, s) => (!acc || (s.lastScanAt && s.lastScanAt > acc) ? s.lastScanAt ?? acc : acc),
      null
    ),
    lastError: errorRows.find((s) => s.lastError)?.lastError ?? null,
    error,
    monitor,
    requestCount,
  };
}

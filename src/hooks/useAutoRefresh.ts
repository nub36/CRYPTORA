import { useEffect, useRef } from 'react';

export interface AutoRefreshOptions {
  /** Не вызывать callback сразу при монтировании (когда первый загрузочный эффект уже есть). */
  skipImmediate?: boolean;
  /** Выключить цикл без демонтажа (условная логика на вызывающей стороне). */
  enabled?: boolean;
}

/**
 * Б1: периодическое авто-обновление данных страницы.
 *
 * До v0.8.51 Overview/Market/Futures/Heatmaps/Screener загружали данные один раз
 * при монтировании — дальше пользователь видел застывшие таблицы до ручного F5.
 *
 * Контракт хука:
 * - немедленный вызов при монтировании (если не задан skipImmediate) и далее
 *   каждые delayMs; следующий тик планируется после завершения предыдущего
 *   вызова — наложения циклов невозможны (плюс явный in-flight guard);
 * - ПАУЗА запросов в фоновой вкладке (document.hidden): таймер продолжает идти,
 *   но запросы не выполняются — лимиты источников не сжигаются в фоне;
 * - возврат видимости вкладки или сетевой 'online' → немедленный внеочередной
 *   рефреш без ожидания ближайшего тика;
 * - callback живёт в ref: вызывающая сторона не обязана мемоизировать функцию;
 * - отказ callback'а не останавливает цикл (страницы сами держат своё
 *   состояние ошибки — см. sourceUnavailable).
 *
 * Интервалы выбирать с учётом кэшей провайдера (LiveMarketDataProvider: 10с на
 * списки, 60с–10мин на secondary-источники): 30с почти не порождают запросов.
 */
export function useAutoRefresh(
  callback: () => void | Promise<unknown>,
  delayMs: number,
  options: AutoRefreshOptions = {}
): void {
  const { skipImmediate = false, enabled = true } = options;

  const cbRef = useRef(callback);
  cbRef.current = callback;
  const inFlightRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const run = async (): Promise<void> => {
      if (typeof document !== 'undefined' && document.hidden) return;
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      try {
        await cbRef.current();
      } catch {
        // Отказ обновления не роняет цикл; страницы показывают своё честное
        // состояние недоступности источника (RULES §1 — без подстановок).
      } finally {
        inFlightRef.current = false;
      }
    };

    const schedule = (): void => {
      if (disposed) return;
      timer = setTimeout(async () => {
        await run();
        schedule();
      }, delayMs);
    };

    const handleVisibilityChange = (): void => {
      if (typeof document !== 'undefined' && !document.hidden) void run();
    };
    const handleOnline = (): void => {
      void run();
    };

    if (!skipImmediate) void run();
    schedule();

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('online', handleOnline);
    }

    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', handleOnline);
      }
    };
  }, [delayMs, enabled, skipImmediate]);
}

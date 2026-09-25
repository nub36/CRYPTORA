/**
 * Signals V2 — страница сигналов: свечной график + селектор монет + уровни.
 * Источник истины для торговых сигналов — СЕРВЕР (`GET /api/signals`, контракт
 * PR #16). Уровни (вход/стоп/цели), статусы и R отображаются как их сохранил
 * сервер: на клиенте ничего не досчитывается и не «улучшается».
 *
 * Мобильная иерархия сверху вниз (§14):
 *   1. селектор монеты (+ чипы монет с сигналами);
 *   2. честный статус сканирования (сервер, не браузер);
 *   3. сводка последнего/выбранного сигнала;
 *   4. свечной график выбранного инструмента;
 *   5. уровни выбранного сигнала (вход/стоп/все цели);
 *   6. история сигналов монеты (ограниченная, постраничная);
 *   7. сворачиваемые «Статистика» (серверная) и «Кодекс прозрачности».
 *
 * Защита от гонок (§17): смена монеты/таймфрейма отменяет устаревшие запросы
 * (AbortController + монотонный номер запроса в хуках); маркеры и линии
 * предыдущего инструмента не остаются на экране. Свечи запрашиваются только для
 * выбранного символа и таймфрейма — веера N×candles нет (§18).
 *
 * ВРЕМЯ. БД и API — UTC/ISO. Экран показывает часовой пояс браузера/ОС
 * (`Intl`), DST учитывается автоматически. Единый форматтер —
 * `utils/timePresentation`; переключателя LOCAL/UTC на экране больше нет
 * (BUG D), поэтому ось графика, перекрестие, время сигнала и время исхода не
 * могут разойтись.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BarChart3 } from 'lucide-react';
import type { Timeframe } from '@/types/market';
import { useMarketData } from '@/context/MarketDataContext';
import { useServerSignalById } from '@/hooks/useServerSignalById';
import { SignalsAuditLedger } from '@/services/signals/SignalsAuditLedger';
import { useServerSignals } from '@/hooks/useServerSignals';
import { useServerScanner } from '@/hooks/useServerScanner';
import { useSignalChartCandles } from '@/hooks/useSignalChartCandles';
import {
  resolveActiveSignal,
  symbolsWithSignals,
  toSignalUiModels,
  type SignalUiModel,
} from '@/services/signals/ui/signalUiModel';
import {
  buildSignalLevelLines,
  mapSignalMarkers,
  timeframeToSeconds,
} from '@/services/signals/ui/signalChartProjection';
import { statusHasTrade, signalBaseSymbol, signalPairText } from '@/utils/serverSignalText';
import { OPEN_SIGNAL_STATUSES } from '@/services/strategyOps';
import { SignalsCoinSelector } from '@/components/signals/SignalsCoinSelector';
import { SignalSummaryCard } from '@/components/signals/SignalSummaryCard';
import { SignalChartCard } from '@/components/signals/SignalChartCard';
import { SignalDetailsPanel } from '@/components/signals/SignalDetailsPanel';
import { SignalHistoryList } from '@/components/signals/SignalHistoryList';
import { ScannerStatusChip } from '@/components/signals/ScannerStatusChip';
import { SignalStatisticsPanel } from '@/components/signals/SignalStatisticsPanel';
import {
  SignalsLedgerAuditSection,
  type ServerSignalsStats,
} from '@/components/signals/SignalsLedgerAuditSection';
import { timeZoneLabelWithOffset } from '@/utils/timePresentation';

const DEFAULT_SYMBOL = 'BTC';
const DEFAULT_TIMEFRAME: Timeframe = '1h';
const SIGNALS_PAGE_LIMIT = 20;
/** Поллинг первой страницы серверной ленты — только видимая вкладка (хук сам гасит фон). */
const SIGNALS_POLL_MS = 60_000;
/** Поллинг статуса сканирования — отдельный ограниченный запрос (не веер). */
const SCANNER_POLL_MS = 15_000;
/** Поллинг серверной статистики — тяжёлые агрегаты, чаще минуты не нужно. */
const STATISTICS_POLL_MS = 60_000;

/**
 * Символ из URL (`?symbol=`) → BASE-тикер. Принимаются три формы, которые
 * встречаются в ссылках и уведомлениях: `RUNE`, `RUNE/USDT`, `RUNEUSDT`.
 * Пустое/нераспознанное значение = «ссылка не задаёт символ».
 */
export function deepLinkSymbol(raw: string | null): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (!value) return null;
  return signalBaseSymbol(value) || null;
}

/** Id сигнала из URL (`?signal=`) — как есть, без домысливания формата. */
export function deepLinkSignalId(raw: string | null): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  return value.length > 0 ? value : null;
}

export const SignalsPage: React.FC = () => {
  const { provider } = useMarketData();

  /**
   * Deep-link уведомления колокольчика: `/signals?symbol=RUNE&signal=<server-id>`.
   *
   * Страница ИНИЦИАЛИЗИРУЕТСЯ из URL (символ + выбранный сигнал), а действия
   * пользователя эту же ссылку поддерживают актуальной. Серверный сигнал,
   * которого нет на загруженной странице ленты, догружается точечно
   * (`useServerSignalById`) — уведомление обязано открывать именно свой сигнал.
   */
  const [searchParams, setSearchParams] = useSearchParams();

  /**
   * URL — ЕДИНСТВЕННЫЙ источник выбранного инструмента и сигнала.
   *
   * Раньше это были два `useState`, инициализированных из ссылки, а эффект
   * «смена монеты сбрасывает сигнал» на монтировании обнулял выбранный по
   * deep-link'у id: уведомление колокольчика открывало страницу, но сигнал не
   * выбирался. Теперь состояние выводится из `searchParams` напрямую, поэтому
   * переход по ссылке (`/signals?symbol=RUNE&signal=<id>`) выбирает ровно тот
   * сигнал, а действия пользователя эту же ссылку и поддерживают актуальной.
   */
  const baseSymbol = deepLinkSymbol(searchParams.get('symbol')) ?? DEFAULT_SYMBOL;
  const selectedSignalId = deepLinkSignalId(searchParams.get('signal'));
  const [chartTimeframe, setChartTimeframe] = useState<Timeframe>(DEFAULT_TIMEFRAME);

  const pair = signalPairText(baseSymbol);

  const writeDeepLink = useCallback(
    (symbol: string, signalId: string | null) => {
      const params = new URLSearchParams();
      if (symbol) params.set('symbol', symbol);
      if (signalId) params.set('signal', signalId);
      setSearchParams(params, { replace: true });
    },
    [setSearchParams]
  );

  // Смена монеты сбрасывает выбранный сигнал: линии/детали не должны «прилипать».
  const selectSymbol = useCallback(
    (raw: string) => {
      writeDeepLink(signalBaseSymbol(raw), null);
    },
    [writeDeepLink]
  );

  const selectSignal = useCallback(
    (id: string | null) => {
      writeDeepLink(baseSymbol, id);
    },
    [baseSymbol, writeDeepLink]
  );

  // ── Серверная лента выбранного инструмента ────────────────────────────
  const signalsQuery = useServerSignals(
    { symbol: pair, limit: SIGNALS_PAGE_LIMIT },
    { pollMs: SIGNALS_POLL_MS }
  );

  // ── Свечи ТОЛЬКО выбранного инструмента и таймфрейма ──────────────────
  const candlesState = useSignalChartCandles(provider, {
    symbol: baseSymbol,
    timeframe: chartTimeframe,
    limit: 500,
  });

  // ── Статус сканирования — с сервера, не из браузера (BUG C) ───────────
  const scanner = useServerScanner({ pollMs: SCANNER_POLL_MS });

  /**
   * Сигнал по deep-link'у, которого нет на загруженной странице ленты.
   * Запрос ровно один и только когда сигнал действительно не найден в странице.
   */
  const signalInPage = useMemo(
    () => (selectedSignalId ? signalsQuery.signals.some((s) => s.id === selectedSignalId) : false),
    [signalsQuery.signals, selectedSignalId]
  );
  const focusedSignal = useServerSignalById(selectedSignalId, {
    enabled: Boolean(selectedSignalId) && signalsQuery.phase === 'ready' && !signalInPage,
  });

  /**
   * Список для отображения: страница ленты + (при необходимости) сигнал из
   * deep-link'а. Дубликатов не бывает — добавляем только отсутствующий id.
   */
  const focusedSymbolMatches = useMemo(
    () =>
      focusedSignal.signal
        ? signalBaseSymbol(focusedSignal.signal.symbol).toUpperCase() === baseSymbol.toUpperCase()
        : false,
    [focusedSignal.signal, baseSymbol]
  );

  const pageSignals = useMemo(() => {
    if (!focusedSignal.signal || signalInPage || !focusedSymbolMatches) return signalsQuery.signals;
    return [...signalsQuery.signals, focusedSignal.signal];
  }, [signalsQuery.signals, focusedSignal.signal, signalInPage, focusedSymbolMatches]);

  // ── Отображение серверных сигналов в модель UI ────────────────────────
  const models: SignalUiModel[] = useMemo(() => toSignalUiModels(pageSignals), [pageSignals]);

  /**
   * Происхождение выбранного сигнала — как его отдал сервер. Показывается явно,
   * потому что от этого зависит допуск в продакшн-колокольчик: MISMATCH/UNKNOWN
   * продакшн-событием не считается, и это должно быть видно, а не скрыто.
   */
  const selectedProvenance = useMemo(() => {
    const found = selectedSignalId ? pageSignals.find((s) => s.id === selectedSignalId) : undefined;
    return found ? found.provenanceStatus : null;
  }, [pageSignals, selectedSignalId]);

  const activeSignal = useMemo(
    () => resolveActiveSignal(models, selectedSignalId),
    [models, selectedSignalId]
  );

  const signalPairs = useMemo(() => symbolsWithSignals(signalsQuery.signals), [signalsQuery.signals]);

  // ── Проекция на график: маркеры истории + линии выбранного сигнала ───
  const timeframeSec = timeframeToSeconds(chartTimeframe);
  const markers = useMemo(
    () =>
      mapSignalMarkers(models, candlesState.candles, timeframeSec, activeSignal?.id ?? null).markers,
    [models, candlesState.candles, timeframeSec, activeSignal?.id]
  );

  const { lines: levelLines } = useMemo(
    () => buildSignalLevelLines(activeSignal, { showEffective: true }),
    [activeSignal]
  );

  // ── Компактная серверная сводка для блока аудита (источник — лента) ───
  const serverStats: ServerSignalsStats | null = useMemo(() => {
    if (signalsQuery.phase !== 'ready' && signalsQuery.phase !== 'error') return null;
    return {
      loaded: signalsQuery.signals.length,
      total: signalsQuery.total,
      open: signalsQuery.signals.filter((s) =>
        (OPEN_SIGNAL_STATUSES as readonly string[]).includes(s.status)
      ).length,
      withOutcome: signalsQuery.signals.filter((s) => statusHasTrade(s.status)).length,
    };
  }, [signalsQuery]);

  // ── Браузерный журнал аудита (второстепенный источник, не смешивается) ─
  // Журнал остаётся функциональным, но больше не является драйвером частых
  // ререндеров. Раньше экран опрашивал журнал каждые 5 с И статус браузерного
  // движка каждые 5 с, а ленту — каждые 60 с: три независимых таймера
  // перерисовывали родителя и сбрасывали строку поиска в модалке выбора монеты
  // (BUG A). Теперь сводка журнала пересчитывается по его собственной подписке
  // (событие записи), а не по таймеру.
  const ledger = useMemo(() => {
    try {
      return SignalsAuditLedger.getInstance();
    } catch {
      return null;
    }
  }, []);
  const [ledgerTick, setLedgerTick] = useState(0);
  useEffect(() => {
    if (!ledger) return;
    const unsubscribe = ledger.subscribe(() => setLedgerTick((t) => t + 1));
    return unsubscribe;
  }, [ledger]);

  const ledgerSummary = useMemo(
    () => (ledger ? ledger.getSummary() : null),
    [ledger, ledgerTick]
  );
  const integrityVerified = useMemo(() => {
    if (!ledger) return null;
    try {
      return ledger.verifyIntegrity();
    } catch {
      return null;
    }
  }, [ledger, ledgerTick]);

  // ── Состояния экрана (§16: причины различаются явно) ──────────────────
  // Стратегии выключены — это НЕ «нет сигналов»: сервер просто не публикует.
  const scannerOff = scanner.phase === 'ready' && scanner.enabledCount === 0;
  // Лента загрузилась и пуста.
  const showEmpty = signalsQuery.phase === 'ready' && signalsQuery.signals.length === 0;
  // Запрос ленты упал — никогда не называем это «сигналов нет».
  const showApiError = signalsQuery.phase === 'error';
  // Свечи выбранной монеты недоступны — рынок, а не сигналы.
  const showMarketError = candlesState.phase === 'error';

  return (
    <div className="mx-auto max-w-[1920px] space-y-4 px-3 py-3 sm:px-4">
      {/* Заголовок + источник + часовой пояс пользователя */}
      <div className="flex flex-col justify-between gap-2 border-b border-surface-border pb-3 sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-brand-cyan" aria-hidden="true" />
            <h1 className="ui-h1">Сигналы</h1>
          </div>
          <p className="ui-helper mt-1">
            Торговые сигналы серверного движка: свечи, уровни входа/стопа/целей и статус — только то, что
            сохранил сервер. Не является финансовой рекомендацией.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <ScannerStatusChip state={scanner} />
          <span
            className="rounded border border-surface-border bg-surface-elevated px-2 py-1 text-[11px] text-slate-400"
            data-qa="signals-timezone-label"
            title="Время на экране — ваш часовой пояс. В базе и API время хранится в UTC."
          >
            {timeZoneLabelWithOffset('BROWSER')}
          </span>
        </div>
      </div>

      {/* 1. Селектор монеты */}
      <SignalsCoinSelector
        symbol={baseSymbol}
        pair={pair}
        signalPairs={signalPairs}
        onSelect={selectSymbol}
      />

      {/*
        Deep-link: честное состояние точечной загрузки сигнала из уведомления.
        Страница НЕ подставляет другой сигнал «похожего» вида и не молчит об
        ошибке — либо выбран ровно тот сигнал, либо показана причина.
      */}
      {selectedSignalId && !signalInPage && focusedSignal.phase === 'loading' && (
        <p className="ui-helper" data-qa="signals-deeplink-loading">
          Загружаем сигнал из ссылки…
        </p>
      )}
      {selectedSignalId && focusedSignal.phase === 'ready' && !focusedSymbolMatches && (
        <div
          className="space-y-1 rounded-lg border border-amber-500/30 bg-surface p-3"
          data-qa="signals-deeplink-symbol-mismatch"
        >
          <div className="font-sans text-sm font-bold text-white">Ссылка не соответствует инструменту</div>
          <p className="ui-helper leading-relaxed">
            Сигнал из ссылки относится к другому инструменту, чем выбранный. Показываем ленту выбранного
            инструмента: сигнал не подставляется в чужой график и не «переезжает» на другую монету.
          </p>
        </div>
      )}
      {selectedSignalId && !signalInPage && focusedSignal.phase === 'error' && (
        <div
          className="space-y-1 rounded-lg border border-rose-500/30 bg-surface p-3"
          data-qa="signals-deeplink-error"
        >
          <div className="font-sans text-sm font-bold text-white">Сигнал из ссылки не загружен</div>
          <p className="ui-helper leading-relaxed">
            {focusedSignal.error?.message ?? 'Сервер не отдал сигнал по указанному id.'}
            {focusedSignal.error?.status === 404
              ? ' Такой строки нет в серверной БД: ссылка могла быть собрана по локальному событию браузера.'
              : ''}
          </p>
        </div>
      )}

      {/*
        ЕДИНСТВЕННОЕ пустое/ошибочное состояние ленты (BUG B).
        Раньше на экране были два разных блока про «нет сигналов»: этот и ещё
        один внутри сводки. Теперь текст один, а причина выбирается явно:
        сканер выключен / лента пуста / запрос упал / рынок недоступен.
      */}
      {(scannerOff || showEmpty || showApiError || showMarketError) && (
        <div
          data-qa="signals-empty"
          data-state={
            showApiError ? 'error' : showMarketError ? 'market-error' : scannerOff ? 'scanner-off' : 'empty'
          }
          className="space-y-1 rounded-lg border border-amber-500/30 bg-surface p-4"
        >
          {showApiError ? (
            <>
              <div className="font-sans text-sm font-bold text-white">Источник сигналов недоступен</div>
              <p className="ui-helper leading-relaxed">
                {signalsQuery.error?.message ?? 'Не удалось загрузить серверную ленту сигналов.'}
                {signalsQuery.error?.code ? ` (код: ${signalsQuery.error.code})` : ''} Сигналы не
                подставляются и не выдумываются — график ниже показывает фактические свечи выбранной монеты.
              </p>
            </>
          ) : showMarketError ? (
            <>
              <div className="font-sans text-sm font-bold text-white">Рыночные данные недоступны</div>
              <p className="ui-helper leading-relaxed">
                {candlesState.errorMessage ?? 'Не удалось загрузить свечи выбранной монеты.'} Это отказ
                источника свечей, а не отсутствие сигналов: лента сигналов загружается отдельным запросом.
              </p>
            </>
          ) : scannerOff ? (
            <>
              <div className="font-sans text-sm font-bold text-white">Сканирование сигналов выключено</div>
              <p className="ui-helper leading-relaxed">
                Ни одна стратегия не включена на сервере, поэтому новых сигналов не публикуется. Ранее
                сохранённые сигналы остаются в истории ниже и сопровождаются сервером по закрытым свечам —
                это автоматическое серверное сопровождение, а не отслеживание в реальном времени внутри
                бара. График показывает рыночные свечи выбранной монеты.
              </p>
            </>
          ) : (
            <>
              <div className="font-sans text-sm font-bold text-white">Сигналов по этому инструменту нет</div>
              <p className="ui-helper leading-relaxed">
                Стратегии публикуют сетап редко и только на фактических закрытых свечах. Пустая лента —
                норма, а не ошибка. График показывает рыночные свечи выбранной монеты.
              </p>
            </>
          )}
        </div>
      )}

      {/* 2. Сводка последнего/выбранного сигнала + происхождение (карантин 011) */}
      <SignalSummaryCard model={activeSignal} />
      {activeSignal && selectedProvenance && selectedProvenance !== 'VERIFIED' && (
        <p className="ui-helper text-amber-300" data-qa="signals-provenance-note">
          Происхождение строки: <span className="font-mono">{selectedProvenance}</span> — карантин
          происхождения (миграция 011). Такой сигнал показывается как факт серверной БД, но НЕ попадает в
          продакшн-уведомления колокольчика.
        </p>
      )}

      {/* 3. Свечной график */}
      <SignalChartCard
        symbol={baseSymbol}
        pair={pair}
        timeframe={chartTimeframe}
        onTimeframeChange={setChartTimeframe}
        candles={candlesState.candles}
        realtimeKline={candlesState.realtimeKline}
        candlePhase={candlesState.phase}
        candleError={candlesState.errorMessage}
        markers={markers}
        levelLines={levelLines}
        onMarkerSelect={selectSignal}
        selectedSignalTimeframe={activeSignal?.timeframe ?? null}
        height={320}
      />

      {/* 4. Уровни выбранного сигнала + детали */}
      <SignalDetailsPanel model={activeSignal} />

      {/* 5. История сигналов монеты */}
      <SignalHistoryList
        models={models}
        total={signalsQuery.total}
        hasMore={signalsQuery.hasMore}
        loadingMore={signalsQuery.loadingMore}
        onLoadMore={signalsQuery.loadMore}
        selectedId={activeSignal?.id ?? null}
        onSelect={selectSignal}
      />

      {/* 6. Серверная статистика — свои агрегаты, не лента страницы */}
      <SignalStatisticsPanel symbol={baseSymbol} pollMs={STATISTICS_POLL_MS} />

      {/* 7. Статистика и аудит — второстепенно, сворачиваемо */}
      <SignalsLedgerAuditSection
        serverStats={serverStats}
        ledgerSummary={ledgerSummary}
        integrityVerified={integrityVerified}
      />
    </div>
  );
};

export default SignalsPage;

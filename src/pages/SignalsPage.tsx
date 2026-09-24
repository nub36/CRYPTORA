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

import React, { useEffect, useMemo, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import type { Timeframe } from '@/types/market';
import { useMarketData } from '@/context/MarketDataContext';
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

export const SignalsPage: React.FC = () => {
  const { provider } = useMarketData();

  // ── Выбор инструмента и таймфрейма графика ─────────────────────────────
  const [baseSymbol, setBaseSymbol] = useState<string>(DEFAULT_SYMBOL);
  const [chartTimeframe, setChartTimeframe] = useState<Timeframe>(DEFAULT_TIMEFRAME);
  const [selectedSignalId, setSelectedSignalId] = useState<string | null>(null);

  const pair = signalPairText(baseSymbol);

  // Смена монеты сбрасывает выбранный сигнал: линии/детали не должны «прилипать».
  useEffect(() => {
    setSelectedSignalId(null);
  }, [baseSymbol]);

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

  // ── Отображение серверных сигналов в модель UI ────────────────────────
  const models: SignalUiModel[] = useMemo(
    () => toSignalUiModels(signalsQuery.signals),
    [signalsQuery.signals]
  );

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
        onSelect={(s) => setBaseSymbol(signalBaseSymbol(s))}
      />

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

      {/* 2. Сводка последнего/выбранного сигнала */}
      <SignalSummaryCard model={activeSignal} />

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
        onMarkerSelect={setSelectedSignalId}
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
        onSelect={setSelectedSignalId}
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

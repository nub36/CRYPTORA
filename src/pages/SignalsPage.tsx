/**
 * Signals V2 — страница сигналов: свечной график + селектор монет + уровни.
 * Источник истины для торговых сигналов — СЕРВЕР (`GET /api/signals`, контракт
 * PR #16). Уровни (вход/стоп/цели), статусы и R отображаются как их сохранил
 * сервер: на клиенте ничего не досчитывается и не «улучшается».
 *
 * Мастер-детейл архитектура рабочей станции:
 *   • Desktop: слева компактная глобальная лента (340–380px) со всеми сигналами;
 *     справа выбранный инструмент: компактная полоса цен + доминантный график
 *     сразу в первом экране + детали, история инструмента, статистика и аудит.
 *   • Mobile: компактная лента ограниченной высоты сверху, селектор, сводка
 *     и график доступны сразу в первой области видимости без 30 громоздких плашек.
 *
 * ВРЕМЯ. БД и API — UTC/ISO. Экран показывает часовой пояс браузера/ОС
 * (`Intl`), DST учитывается автоматически.
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
import { shortOffset, timeZoneLabel, timeZoneLabelWithOffset } from '@/utils/timePresentation';

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
   */
  const [searchParams, setSearchParams] = useSearchParams();

  const baseSymbol = deepLinkSymbol(searchParams.get('symbol')) ?? DEFAULT_SYMBOL;
  const selectedSignalId = deepLinkSignalId(searchParams.get('signal'));
  const [chartTimeframe, setChartTimeframe] = useState<Timeframe>(DEFAULT_TIMEFRAME);
  const [assetHistoryRequested, setAssetHistoryRequested] = useState(Boolean(selectedSignalId));

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
      setAssetHistoryRequested(true);
      writeDeepLink(signalBaseSymbol(raw), null);
    },
    [writeDeepLink]
  );

  // ── Серверные ленты: global feed is the primary surface; asset history is separate ──
  const signalsQuery = useServerSignals(
    { limit: SIGNALS_PAGE_LIMIT },
    { pollMs: SIGNALS_POLL_MS }
  );
  const assetHistoryQuery = useServerSignals(
    { symbol: pair, limit: SIGNALS_PAGE_LIMIT },
    { pollMs: SIGNALS_POLL_MS, enabled: assetHistoryRequested }
  );
  const [statisticsScope, setStatisticsScope] = useState<'global' | 'asset'>('global');
  const selectSignal = useCallback(
    (id: string | null) => {
      if (!id) {
        writeDeepLink(baseSymbol, null);
        return;
      }
      setAssetHistoryRequested(true);
      const signal = [...signalsQuery.signals, ...assetHistoryQuery.signals].find((item) => item.id === id);
      writeDeepLink(signal ? signalBaseSymbol(signal.symbol) : baseSymbol, id);
    },
    [assetHistoryQuery.signals, baseSymbol, signalsQuery.signals, writeDeepLink]
  );

  // ── Свечи ТОЛЬКО выбранного инструмента и таймфрейма ──────────────────
  const candlesState = useSignalChartCandles(provider, {
    symbol: baseSymbol,
    timeframe: chartTimeframe,
    limit: 500,
  });

  // ── Статус сканирования — с сервера, не из браузера ───────────────────
  const scanner = useServerScanner({ pollMs: SCANNER_POLL_MS });

  const signalInPage = useMemo(
    () => (selectedSignalId ? signalsQuery.signals.some((s) => s.id === selectedSignalId) : false),
    [signalsQuery.signals, selectedSignalId]
  );
  const focusedSignal = useServerSignalById(selectedSignalId, {
    enabled: Boolean(selectedSignalId) && signalsQuery.phase === 'ready' && !signalInPage,
  });

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
  const assetHistoryModels: SignalUiModel[] = useMemo(
    () => toSignalUiModels(assetHistoryQuery.signals),
    [assetHistoryQuery.signals]
  );

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
      mapSignalMarkers(models, candlesState.candles, timeframeSec, {
        selectedId: activeSignal?.id ?? null,
        showLabels: false,
      }).markers,
    [models, candlesState.candles, timeframeSec, activeSignal?.id]
  );

  const { lines: levelLines } = useMemo(
    () =>
      buildSignalLevelLines(activeSignal, {
        showEffective: true,
        showLabels: false,
        compact: true,
      }),
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

  // ── Браузерный журнал аудита ──────────────────────────────────────────
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

  // ── Состояния экрана ──────────────────────────────────────────────────
  const scannerOff = scanner.phase === 'ready' && scanner.enabledCount === 0;
  const showEmpty = signalsQuery.phase === 'ready' && signalsQuery.signals.length === 0;
  const showApiError = signalsQuery.phase === 'error';
  const showMarketError = candlesState.phase === 'error';

  return (
    <div
      className="route-shell mx-auto max-w-[1920px] space-y-3 px-3 py-3 sm:px-4"
      data-route="signals"
      data-layout="global-feed"
      data-qa="signals-page"
    >
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

        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <ScannerStatusChip state={scanner} />
          <span
            className="rounded border border-surface-border bg-surface-elevated/80 px-2 py-0.5 text-xs text-slate-400 font-mono tracking-tight"
            data-qa="signals-timezone-label"
            title={`Ваш часовой пояс: ${timeZoneLabel('BROWSER')} (${shortOffset('BROWSER')}). В базе и API время хранится в UTC.`}
          >
            {timeZoneLabelWithOffset('BROWSER')}
          </span>
        </div>
      </div>

      {/* Мастер/детейл рабочая станция: Слева лента всех сигналов, Справа выбранный инструмент и график */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[340px_minmax(0,1fr)] xl:grid-cols-[370px_minmax(0,1fr)] items-start">
        {/* ЛЕВАЯ КОЛОНКА: Компактная глобальная лента сигналов */}
        <div className="w-full min-w-0">
          <section className="terminal-section signal-feed lg:sticky lg:top-16" data-qa="signals-global-feed">
            <div className="terminal-section__header">
              <div>
                <span className="eyebrow">SERVER / PRODUCTION</span>
                <h2 className="terminal-section__title">Все сигналы</h2>
              </div>
              <span className="terminal-section__meta font-mono text-xs">
                {signalsQuery.total} всего · {signalsQuery.source ?? 'server'}
              </span>
            </div>
            <div className="max-h-60 sm:max-h-72 lg:max-h-[calc(100vh-170px)] overflow-y-auto pr-0.5">
              <SignalHistoryList
                models={models}
                total={signalsQuery.total}
                hasMore={signalsQuery.hasMore}
                loadingMore={signalsQuery.loadingMore}
                onLoadMore={signalsQuery.loadMore}
                selectedId={activeSignal?.id ?? null}
                onSelect={selectSignal}
                title="Все сигналы"
              />
            </div>
          </section>
        </div>

        {/* ПРАВАЯ КОЛОНКА: Рабочая область выбранного инструмента */}
        <div className="w-full min-w-0 space-y-3">
          {/* 1. Селектор монеты */}
          <SignalsCoinSelector
            symbol={baseSymbol}
            pair={pair}
            signalPairs={signalPairs}
            onSelect={selectSymbol}
          />

          {/* Deep-link состояния */}
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

          {/* Состояние ошибки / пустой ленты */}
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

          {/* 2. Сводка выбранного сигнала с компактной ценовой полосой */}
          <SignalSummaryCard model={activeSignal} />
          {activeSignal && selectedProvenance && selectedProvenance !== 'VERIFIED' && (
            <p className="ui-helper text-amber-300" data-qa="signals-provenance-note">
              Происхождение строки: <span className="font-mono">{selectedProvenance}</span> — карантин
              происхождения (миграция 011). Такой сигнал показывается как факт серверной БД, но НЕ попадает в
              продакшн-уведомления колокольчика.
            </p>
          )}

          {/* 3. Доминантный свечной график выбранного инструмента */}
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
            activeSignal={activeSignal}
            onMarkerSelect={selectSignal}
            selectedSignalTimeframe={activeSignal?.timeframe ?? null}
            height={380}
          />

          {/* 4. Детали и уровни выбранного сигнала */}
          <SignalDetailsPanel model={activeSignal} />

          {/* 5. История выбранного инструмента (второстепенно) */}
          <section className="terminal-section" data-qa="signals-asset-history">
            <div className="terminal-section__header">
              <div>
                <span className="eyebrow">CURRENT ASSET</span>
                <h2 className="terminal-section__title">История {pair}</h2>
              </div>
              <span className="terminal-section__meta font-mono text-xs">{assetHistoryQuery.total} записей</span>
            </div>
            <SignalHistoryList
              models={assetHistoryModels}
              total={assetHistoryQuery.total}
              hasMore={assetHistoryQuery.hasMore}
              loadingMore={assetHistoryQuery.loadingMore}
              onLoadMore={assetHistoryQuery.loadMore}
              selectedId={activeSignal?.id ?? null}
              onSelect={selectSignal}
              title={`История ${pair}`}
            />
          </section>

          {/* 6. Статистика эффективности */}
          <section className="terminal-section" data-qa="signals-statistics-scope">
            <div className="terminal-section__header">
              <div>
                <span className="eyebrow">PERFORMANCE</span>
                <h2 className="terminal-section__title">Статистика</h2>
              </div>
              <div className="scope-switch" role="group" aria-label="Statistics scope">
                <button
                  type="button"
                  className={statisticsScope === 'global' ? 'is-active' : ''}
                  onClick={() => setStatisticsScope('global')}
                >
                  ВСЕ СИГНАЛЫ
                </button>
                <button
                  type="button"
                  className={statisticsScope === 'asset' ? 'is-active' : ''}
                  onClick={() => setStatisticsScope('asset')}
                >
                  ТЕКУЩАЯ МОНЕТА
                </button>
              </div>
            </div>
            <SignalStatisticsPanel symbol={statisticsScope === 'asset' ? baseSymbol : null} pollMs={STATISTICS_POLL_MS} />
          </section>

          {/* 7. Аудит и кодекс прозрачности */}
          <SignalsLedgerAuditSection
            serverStats={serverStats}
            ledgerSummary={ledgerSummary}
            integrityVerified={integrityVerified}
          />
        </div>
      </div>
    </div>
  );
};

export default SignalsPage;

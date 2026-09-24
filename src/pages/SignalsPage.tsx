/**
 * Signals V2 — страница сигналов: свечной график + селектор монет + уровни.
 *
 * Источник истины для торговых сигналов — СЕРВЕР (`GET /api/signals`, контракт
 * PR #16). Уровни (вход/стоп/цели), статусы и R отображаются как их сохранил
 * сервер: на клиенте ничего не досчитывается и не «улучшается».
 *
 * Мобильная иерархия сверху вниз (§14):
 *   1. селектор монеты (+ чипы монет с сигналами);
 *   2. сводка последнего/выбранного сигнала;
 *   3. свечной график выбранного инструмента;
 *   4. уровни выбранного сигнала (вход/стоп/все цели);
 *   5. история сигналов монеты (ограниченная, постраничная);
 *   6. сворачиваемые «Статистика и аудит» + «Кодекс прозрачности».
 *
 * Защита от гонок (§17): смена монеты/таймфрейма отменяет устаревшие запросы
 * (AbortController + монотонный номер запроса в хуках); маркеры и линии
 * предыдущего инструмента не остаются на экране. Свечи запрашиваются только для
 * выбранного символа и таймфрейма — веера N×candles нет (§18).
 */

import React, { useEffect, useMemo, useState } from 'react';
import { BarChart3, Radio } from 'lucide-react';
import type { Timeframe } from '@/types/market';
import type { TimeDisplayMode } from '@/utils/timePresentation';
import { useMarketData } from '@/context/MarketDataContext';
import { LiveSignalEngine, type EngineStatus } from '@/services/signals/live/LiveSignalEngine';
import { SignalsAuditLedger } from '@/services/signals/SignalsAuditLedger';
import { useServerSignals } from '@/hooks/useServerSignals';
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
import {
  SignalsLedgerAuditSection,
  type ServerSignalsStats,
} from '@/components/signals/SignalsLedgerAuditSection';

const DEFAULT_SYMBOL = 'BTC';
const DEFAULT_TIMEFRAME: Timeframe = '1h';
const SIGNALS_PAGE_LIMIT = 20;
/** Поллинг первой страницы серверной ленты — только видимая вкладка (хук сам гасит фон). */
const SIGNALS_POLL_MS = 60_000;

export const SignalsPage: React.FC = () => {
  const { provider, dataMode } = useMarketData();

  // ── Выбор инструмента и таймфрейма графика ─────────────────────────────
  const [baseSymbol, setBaseSymbol] = useState<string>(DEFAULT_SYMBOL);
  const [chartTimeframe, setChartTimeframe] = useState<Timeframe>(DEFAULT_TIMEFRAME);
  const [selectedSignalId, setSelectedSignalId] = useState<string | null>(null);
  const [timeMode, setTimeMode] = useState<TimeDisplayMode>('LOCAL');

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

  // ── Компактная серверная статистика для блока аудита ──────────────────
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
  const ledger = useMemo(() => SignalsAuditLedger.getInstance(), []);
  const [ledgerTick, setLedgerTick] = useState(0);
  useEffect(() => {
    const unsubscribe = ledger.subscribe(() => setLedgerTick((t) => t + 1));
    const interval = setInterval(() => {
      ledger.reload();
      setLedgerTick((t) => t + 1);
    }, 5_000);
    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, [ledger]);

  const ledgerSummary = useMemo(() => ledger.getSummary(), [ledger, ledgerTick]);
  const integrityVerified = useMemo(() => {
    try {
      return ledger.verifyIntegrity();
    } catch {
      return null;
    }
  }, [ledger, ledgerTick]);

  // ── Статус браузерного LIVE-движка (честная подпись источника) ────────
  const [engineStatus, setEngineStatus] = useState<EngineStatus | null>(
    () => LiveSignalEngine.getInstance()?.getStatus() ?? null
  );
  useEffect(() => {
    const engine = LiveSignalEngine.getInstance();
    if (!engine) {
      setEngineStatus(null);
      return;
    }
    const refresh = () => setEngineStatus(engine.getStatus());
    refresh();
    const unsubscribe = engine.subscribe(refresh);
    const interval = setInterval(refresh, 5_000);
    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, [dataMode, ledgerTick]);

  const engineRunning = engineStatus?.running ?? false;

  // Пустое состояние: нет сигналов для отображения (пусто или ошибка — и то,
  // и другое означает «показывать нечего», но причина поясняется отдельно).
  const showEmpty = signalsQuery.phase === 'ready' && signalsQuery.signals.length === 0;
  const showApiError = signalsQuery.phase === 'error';

  return (
    <div className="mx-auto max-w-[1920px] space-y-4 px-3 py-3 sm:px-4">
      {/* Заголовок + источник + режим времени */}
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
          <div
            data-qa="signals-engine-status"
            data-state={engineRunning ? (engineStatus?.scanning ? 'scanning' : 'running') : 'stopped'}
            className={`flex items-center gap-1.5 text-[11px] font-mono ${engineRunning ? 'text-emerald-400' : 'text-slate-500'}`}
          >
            <Radio className={`h-3 w-3 ${engineRunning ? 'animate-pulse' : ''}`} aria-hidden="true" />
            <span>
              {engineRunning
                ? `LIVE-скан · каждые ${Math.round((engineStatus?.scanIntervalMs ?? 60_000) / 1000)}с`
                : dataMode === 'live'
                  ? 'Движок запускается…'
                  : 'Источник — серверная лента сигналов'}
            </span>
          </div>

          <button
            type="button"
            onClick={() => setTimeMode((m) => (m === 'LOCAL' ? 'UTC' : 'LOCAL'))}
            aria-label="Переключить локальное время и UTC"
            className="rounded border border-surface-border bg-surface-elevated px-2 py-1 text-[11px] font-mono text-slate-300 hover:text-white"
            title={timeMode === 'LOCAL' ? 'Время браузера; нажмите для UTC' : 'UTC; нажмите для локального времени'}
          >
            {timeMode}
          </button>
        </div>
      </div>

      {/* 1. Селектор монеты */}
      <SignalsCoinSelector
        symbol={baseSymbol}
        pair={pair}
        signalPairs={signalPairs}
        onSelect={(s) => setBaseSymbol(signalBaseSymbol(s))}
      />

      {/* Пустое состояние / ошибка серверной ленты — без подстановок */}
      {(showEmpty || showApiError) && (
        <div
          data-qa="signals-empty"
          data-state={showApiError ? 'error' : 'empty'}
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
          ) : (
            <>
              <div className="font-sans text-sm font-bold text-white">Сигналов по этому инструменту нет</div>
              <p className="ui-helper leading-relaxed">
                Стратегии публикуют сетап редко и только на фактических закрытых свечах. Пустая лента — норма,
                а не ошибка. График показывает рыночные свечи выбранной монеты.
              </p>
            </>
          )}
        </div>
      )}

      {/* 2. Сводка последнего/выбранного сигнала */}
      <SignalSummaryCard model={activeSignal} timeMode={timeMode} />

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
        timeMode={timeMode}
      />

      {/* 6. Статистика и аудит — второстепенно, сворачиваемо */}
      <SignalsLedgerAuditSection
        serverStats={serverStats}
        ledgerSummary={ledgerSummary}
        integrityVerified={integrityVerified}
      />
    </div>
  );
};

export default SignalsPage;

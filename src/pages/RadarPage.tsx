import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useMarketData } from '@/context/MarketDataContext';
import { DataSourceUnavailable } from '@/components/common/DataSourceUnavailable';
import { RadarEvent } from '@/types/market';
import { formatTimestamp } from '@/utils/formatters';
import { radarEventTypeLabel, radarSeverityLabel } from '@/utils/labels';
import { Badge } from '@/components/common/Badge';
import { Link } from 'react-router-dom';
import { Radio, ArrowUpRight, Sparkles, AlertCircle } from 'lucide-react';
import { RealtimeFeedManager } from '@/services/realtime/RealtimeFeedManager';
import { TickerTick, RealtimeConnectionState } from '@/types/realtime';
import { AnomalyEngineStatus } from '@/services/realtime/AnomalyEngine';
import {
  getScanUniverse,
  refreshScanUniverse,
  subscribeScanUniverse,
  isScanUniverseConfirmed,
} from '@/services/signals/scanUniverse';
import {
  releaseRadarScopedSubscriptions,
  syncRadarScopedSubscriptions,
  type ScopedSymbolReleases,
} from '@/services/realtime/radarScopedSubscriptions';
import { AiExplanationEngine, AiMarketBriefing, MarketContextFact } from '@/services/ai/AiExplanationEngine';
import { requestLlmExplanation, marketContextFactToStructured, type AiExplainResponse } from '@/services/ai/LlmExplainClient';
import { IndicatorEngine } from '@/services/indicators/IndicatorEngine';

function renderableRadarEvents(events: RadarEvent[], dataMode: 'demo' | 'live'): RadarEvent[] {
  return dataMode === 'live' ? events.filter((event) => !event.isDemo) : events;
}

function liveRadarStatusText(
  universeSize: number,
  status: AnomalyEngineStatus | null,
  sourceError: boolean,
): string {
  if (sourceError) return `ERROR · ${universeSize} symbols`;
  if (!status || universeSize === 0) return `LIVE · ${universeSize} symbols`;
  if (status.warmedSymbols < universeSize) {
    return `WARMING · ${status.warmedSymbols}/${universeSize} symbols · max ${status.maxObservations}/${status.windowSize}`;
  }
  return `LIVE · ${universeSize} symbols`;
}

export const RadarPage: React.FC = () => {
  const { provider, dataMode } = useMarketData();
  const [events, setEvents] = useState<RadarEvent[]>([]);
  const [sourceUnavailable, setSourceUnavailable] = useState(false);
  const [selectedType, setSelectedType] = useState<string>('all');
  const [selectedSeverity, setSelectedSeverity] = useState<string>('all');
  const [radarUniverse, setRadarUniverse] = useState<string[]>([]);
  const [detectorStatus, setDetectorStatus] = useState<AnomalyEngineStatus | null>(null);
  const [connectionState, setConnectionState] = useState<RealtimeConnectionState>('idle');
  const [universeChecked, setUniverseChecked] = useState(false);
  const radarLeasesRef = useRef<ScopedSymbolReleases>(new Map());
  const radarUniverseRef = useRef<string[]>([]);

  useEffect(() => {
    let active = true;
    provider
      .getRadarEvents()
      .then((data) => {
        if (!active) return;
        setEvents(renderableRadarEvents(data, dataMode));
        setSourceUnavailable(false);
      })
      .catch(() => {
        if (active) setSourceUnavailable(true);
      });

    return () => {
      active = false;
    };
  }, [provider, dataMode]);

  useEffect(() => {
    if (dataMode !== 'live') {
      releaseRadarScopedSubscriptions(radarLeasesRef.current);
      radarUniverseRef.current = [];
      setRadarUniverse([]);
      setDetectorStatus(null);
      setConnectionState('idle');
      setUniverseChecked(true);
      return;
    }

    let active = true;
    const feed = RealtimeFeedManager.getInstance();

    const refreshStatus = (symbols = radarUniverseRef.current) => {
      if (!active) return;
      setDetectorStatus(feed.getRadarDetectorStatus(symbols));
    };

    const applyUniverse = (symbols: readonly string[]) => {
      if (!active) return;
      const normalized = syncRadarScopedSubscriptions(feed, radarLeasesRef.current, symbols);
      radarUniverseRef.current = normalized;
      setRadarUniverse(normalized);
      refreshStatus(normalized);
    };

    applyUniverse(getScanUniverse());
    setUniverseChecked(false);
    void refreshScanUniverse().then((symbols) => {
      if (!active) return;
      applyUniverse(symbols);
      setUniverseChecked(true);
    });

    const unsubscribeUniverse = subscribeScanUniverse(() => {
      applyUniverse(getScanUniverse());
    });

    const unsubscribeRadar = feed.eventBus.subscribe<RadarEvent>('radar', (newEvent) => {
      if (newEvent.isDemo) return;
      setSourceUnavailable(false);
      setEvents((prev) => [newEvent, ...prev.filter((e) => e.id !== newEvent.id)]);
      refreshStatus();
    });

    const unsubscribeTicker = feed.eventBus.subscribe<TickerTick>('ticker:*', () => {
      refreshStatus();
    });

    const unsubscribeConnection = feed.eventBus.subscribe<RealtimeConnectionState>('connection', (state) => {
      setConnectionState(state);
    });

    setConnectionState(feed.getConnectionState());
    refreshStatus();

    return () => {
      active = false;
      unsubscribeUniverse();
      unsubscribeRadar();
      unsubscribeTicker();
      unsubscribeConnection();
      releaseRadarScopedSubscriptions(radarLeasesRef.current);
      radarUniverseRef.current = [];
    };
  }, [dataMode]);

  const filteredEvents = events.filter((e) => {
    if (selectedType !== 'all' && e.type !== selectedType) return false;
    if (selectedSeverity !== 'all' && e.severity !== selectedSeverity) return false;
    return true;
  });
  const liveUniverseUnconfirmed = dataMode === 'live' && universeChecked && !isScanUniverseConfirmed() && radarUniverse.length === 0;
  const liveSourceUnavailable = dataMode === 'live' && (connectionState === 'error' || liveUniverseUnconfirmed);
  const radarSourceError = sourceUnavailable || liveSourceUnavailable;
  const isFilterEmpty = events.length > 0 && filteredEvents.length === 0;
  const isWarming =
    dataMode === 'live' &&
    !radarSourceError &&
    events.length === 0 &&
    (!universeChecked || (radarUniverse.length > 0 && (!detectorStatus || detectorStatus.warmedSymbols < radarUniverse.length)));
  const isReadyNoEvents = dataMode === 'live' && universeChecked && !radarSourceError && events.length === 0 && !isWarming;
  const statusBadgeText = dataMode === 'live'
    ? liveRadarStatusText(radarUniverse.length, detectorStatus, radarSourceError)
    : 'QA-СТРИМ';

  // Брифинг по активу главной аномалии — ТОЛЬКО из фактов провайдера (цена/Δ24ч/фандинг/Δ OI/RSI по свечам);
  // если факт недоступен, поле опускается, а не подставляется (docs/AI.md).
  const topEvent = useMemo(() => (events.length ? events.find((e) => e.severity === 'HIGH') || events[0] : null), [events]);
  const [briefingFacts, setBriefingFacts] = useState<MarketContextFact | null>(null);
  useEffect(() => {
    if (!topEvent) {
      setBriefingFacts(null);
      return;
    }
    let active = true;
    const symbol = topEvent.symbol;
    (async () => {
      const [detail, futures, candles] = await Promise.allSettled([
        provider.getAssetDetail(symbol),
        provider.getFuturesList(),
        provider.getCandles(symbol, '1h'),
      ]);
      const d = detail.status === 'fulfilled' ? detail.value : null;
      if (!d) {
        if (active) setBriefingFacts(null);
        return;
      }
      const fut =
        futures.status === 'fulfilled' ? futures.value.find((f) => f.symbol.split('/')[0] === symbol) : undefined;
      const rsi =
        candles.status === 'fulfilled' && candles.value.length >= 15
          ? IndicatorEngine.computeCompleteIndicators(candles.value).rsi14
          : undefined;
      if (!active) return;
      setBriefingFacts({
        symbol,
        price: d.price,
        change24h: d.change24h,
        fundingRate8h: fut?.fundingRate,
        openInterestDelta24h: fut?.openInterestChange24h ?? undefined,
        openInterestDeltaSource: fut?.openInterestChangeSource === 'ACTUAL' || fut?.openInterestChangeSource === 'ESTIMATED' ? fut.openInterestChangeSource : undefined,
        rsi14: rsi,
        anomalies: [topEvent],
      });
    })();
    return () => {
      active = false;
    };
  }, [provider, topEvent]);
  const aiBriefing = useMemo<AiMarketBriefing | null>(
    () => (briefingFacts ? AiExplanationEngine.generateBriefing(briefingFacts) : null),
    [briefingFacts],
  );

  // LLM-слой (Этап 7): запрашивается у сервера по тем же фактам; показывается только заземлённый ответ.
  const [llm, setLlm] = useState<AiExplainResponse | null>(null);
  useEffect(() => {
    if (!briefingFacts) {
      setLlm(null);
      return;
    }
    let active = true;
    setLlm(null);
    requestLlmExplanation(marketContextFactToStructured(briefingFacts)).then((r) => {
      if (active) setLlm(r);
    });
    return () => {
      active = false;
    };
  }, [briefingFacts]);

  const emptyState = radarSourceError
    ? {
        state: 'source-error',
        title: 'Источник LIVE-радара недоступен.',
        detail: 'Проверьте соединение realtime-потока и серверный Scan Universe. Демо-события в LIVE не подставляются.',
      }
    : isFilterEmpty
      ? {
          state: 'filtered',
          title: 'Нет событий, соответствующих выбранным фильтрам.',
          detail: 'События в текущем LIVE-буфере есть; измените тип аномалии или важность, чтобы увидеть их.',
        }
      : isWarming
        ? {
            state: 'warming',
            title: 'Радар набирает окно наблюдений…',
            detail: `Подписано символов: ${radarUniverse.length}. Прогрето: ${detectorStatus?.warmedSymbols ?? 0}/${radarUniverse.length}. Максимум наблюдений: ${detectorStatus?.maxObservations ?? 0}/${detectorStatus?.windowSize ?? 20}.`,
          }
        : isReadyNoEvents
          ? {
              state: 'ready-empty',
              title: 'В текущем LIVE-окне аномалий не обнаружено.',
              detail: 'Детектор прогрет по доступной Scan Universe и ждёт фактических отклонений из ticker-потока.',
            }
          : {
              state: 'empty',
              title: 'Нет событий радара.',
              detail: dataMode === 'live'
                ? 'LIVE-буфер пуст.'
                : 'QA-поток не вернул событий для текущего сценария.',
            };

  return (
    <div className="route-shell space-y-4 max-w-[1920px] mx-auto px-3 sm:px-4 py-3.5" data-route="radar" data-layout="event-stream">
      {radarSourceError && <DataSourceUnavailable subject="LIVE-радар" />}
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-white/[0.08] gap-2">
        <div>
          <div className="flex items-center space-x-2">
            <Radio className="w-5 h-5 text-cyan-400 animate-pulse" />
            <h1 className="text-lg sm:text-xl font-bold font-sans text-white tracking-wide">
              Рыночный радар: детектор аномалий
            </h1>
            {dataMode === 'live' ? (
              <span
                data-qa="radar-live-status"
                className={`text-[11px] font-mono font-semibold px-2.5 py-0.5 rounded-full border flex items-center ${
                  radarSourceError
                    ? 'text-rose-300 bg-rose-950/30 border-rose-500/30'
                    : isWarming
                      ? 'text-amber-300 bg-amber-500/10 border-amber-500/30'
                      : 'text-cyan-300 bg-cyan-950/40 border-cyan-500/30'
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${radarSourceError ? 'bg-rose-400' : isWarming ? 'bg-amber-400 animate-pulse' : 'bg-cyan-400 animate-pulse'}`} />
                LIVE-детектор аномалий · {statusBadgeText}
              </span>
            ) : (
              <span data-qa="radar-live-status" className="text-[11px] font-mono font-semibold text-amber-300 bg-amber-500/10 px-2.5 py-0.5 rounded-full border border-amber-500/30">
                {statusBadgeText}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400 font-sans mt-0.5">
            {dataMode === 'live'
              ? 'Математический движок детекции аномалий (Z-Score объемов, ценовой импульс, расширение волатильности) в реальном времени.'
              : 'Поток зафиксированных аномалий объема, открытого интереса, фандинга и ликвидаций на QA-датасете.'}
          </p>
          {dataMode === 'live' && (
            <p data-qa="radar-source-telemetry" className="text-[11px] text-slate-500 font-mono mt-1">
              Scan Universe: {radarUniverse.length} · warmed: {detectorStatus?.warmedSymbols ?? 0}/{radarUniverse.length} · WS: {connectionState}
            </p>
          )}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2 font-sans text-xs">
          {/* Type filter */}
          <select
            aria-label="Тип аномалии"
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value)}
            className="bg-surface-elevated border border-white/[0.08] rounded-lg px-3 py-1.5 text-slate-200 focus:outline-none focus:border-cyan-400 min-h-[32px]"
          >
            <option value="all">Все типы аномалий</option>
            <option value="VOLUME_SPIKE">Всплеск объёма</option>
            <option value="OI_SPIKE">Всплеск OI</option>
            <option value="FUNDING_EXTREME">Экстремальный фандинг</option>
            <option value="LIQUIDATION_BURST">Каскад ликвидаций</option>
            <option value="PRICE_MOVE">Резкое движение цены</option>
            <option value="VOLATILITY_EXPANSION">Расширение волатильности</option>
          </select>

          {/* Severity filter */}
          <select
            aria-label="Важность аномалии"
            value={selectedSeverity}
            onChange={(e) => setSelectedSeverity(e.target.value)}
            className="bg-surface-elevated border border-white/[0.08] rounded-lg px-3 py-1.5 text-slate-200 focus:outline-none focus:border-cyan-400 min-h-[32px]"
          >
            <option value="all">Любая важность</option>
            <option value="HIGH">Только высокая</option>
            <option value="MEDIUM">Только средняя</option>
            <option value="INFO">Только информационная</option>
          </select>
        </div>
      </div>

      {/* AI Market Analyst Grounded Briefing Banner */}
      {aiBriefing && (
        <div className="bg-surface border border-cyan-500/30 rounded-xl p-4 font-sans text-xs space-y-3 shadow-panel bg-gradient-to-r from-surface to-cyan-950/20">
          <div className="flex items-center justify-between pb-2 border-b border-surface-border">
            <div className="flex items-center space-x-2 font-bold text-white">
              <Sparkles className="w-4 h-4 text-brand-cyan" />
              <span>Аналитический брифинг: {aiBriefing.headline}</span>
            </div>
            <span className="text-[11px] text-slate-400 bg-surface-elevated px-2 py-0.5 rounded border border-surface-border">
              Детерминированные правила по фактам источника · без LLM
            </span>
          </div>

          <p className="text-xs text-slate-300 font-sans leading-relaxed">
            {aiBriefing.explanation}
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1 font-sans text-[11px]">
            <div className="p-2.5 rounded bg-emerald-950/20 border border-emerald-500/20 space-y-1">
              <span className="font-bold text-emerald-400 font-sans block">Ключевые драйверы:</span>
              <ul className="list-disc list-inside text-slate-300 space-y-0.5">
                {aiBriefing.keyDrivers.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            </div>

            <div className="p-2.5 rounded bg-rose-950/20 border border-rose-500/20 space-y-1">
              <span className="font-bold text-rose-400 font-sans block">Факторы риска:</span>
              <ul className="list-disc list-inside text-slate-300 space-y-0.5">
                {aiBriefing.riskObservations.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          </div>

          {llm?.status === 'OK' && llm.explanation && (
            <div data-qa="llm-explanation" className="p-3 rounded bg-surface-elevated/60 border border-brand-cyan/20 space-y-1.5">
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-bold text-brand-cyan">Пояснение LLM по тем же фактам</span>
                <span className="ui-helper"><span className="ui-num">{llm.model}</span> · проверено стражем заземления</span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">{llm.explanation.summary}</p>
              {llm.explanation.keyObservations.length > 0 && (
                <ul className="list-disc list-inside text-[11px] text-slate-400 space-y-0.5">
                  {llm.explanation.keyObservations.map((obs, i) => (
                    <li key={i}>{obs}</li>
                  ))}
                </ul>
              )}
              <p className="text-[11px] text-slate-500">
                Текст сгенерирован языковой моделью на сервере; все числа сверены с фактами движка, торговые формулировки отклоняются.
              </p>
            </div>
          )}
          {llm?.status === 'REJECTED' && (
            <div data-qa="llm-rejected" className="text-[11px] text-amber-300/90">
              Ответ LLM отклонён стражем заземления ({llm.reason}) и не показан.
            </div>
          )}

          <div className="text-[11px] text-slate-500 font-sans flex items-center space-x-1.5 pt-1">
            <AlertCircle className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
            <span>{aiBriefing.disclaimer}</span>
          </div>
        </div>
      )}

      {/* Events Stream List */}
      <div className="space-y-3 font-sans">
        {filteredEvents.length === 0 ? (
          <div
            data-qa="radar-empty-state"
            data-state={emptyState.state}
            className="bg-surface border border-surface-border rounded-lg p-12 text-center text-slate-500 text-xs font-sans space-y-2"
          >
            <div className="text-slate-300 font-semibold">{emptyState.title}</div>
            <div>{emptyState.detail}</div>
          </div>
        ) : (
          filteredEvents.map((event) => (
            <div
              key={event.id}
              data-qa="radar-event-row"
              data-event-id={event.id}
              className="bg-surface border border-surface-border rounded-lg p-4 hover:border-slate-600 transition-all shadow-md flex flex-col md:flex-row md:items-center justify-between gap-3 group"
            >
              <div className="space-y-1.5 flex-1">
                <div className="flex items-center space-x-3">
                  <span className="text-xs text-slate-400 font-semibold">
                    {formatTimestamp(event.timestamp)}
                  </span>

                  <Link
                    to={`/coin/${event.symbol}`}
                    className="text-base font-bold text-white group-hover:text-brand-cyan transition-colors"
                  >
                    {event.symbol}
                  </Link>

                  <Badge
                    variant={
                      event.severity === 'HIGH'
                        ? 'red'
                        : event.severity === 'MEDIUM'
                        ? 'amber'
                        : 'cyan'
                    }
                    size="sm"
                  >
                    {radarSeverityLabel(event.severity)}
                  </Badge>

                  <span className="text-xs bg-slate-800 text-slate-300 px-2 py-0.5 rounded font-mono border border-slate-700">
                    {radarEventTypeLabel(event.type)}
                  </span>

                  {!event.isDemo && (
                    <span className="text-[11px] font-mono text-brand-green bg-brand-green/10 px-1.5 py-0.5 rounded border border-brand-green/30">
                      LIVE-ДЕТЕКЦИЯ
                    </span>
                  )}
                </div>

                <div className="text-sm font-bold text-brand-cyan">
                  {event.metricValue}
                </div>

                <p className="text-xs text-slate-300 font-sans leading-relaxed max-w-4xl">
                  {event.observation}
                </p>
              </div>

              <div className="self-start md:self-center flex-shrink-0">
                <Link
                  to={`/coin/${event.symbol}`}
                  className="px-3 py-1.5 bg-surface-elevated hover:bg-surface-hover text-slate-200 text-xs rounded border border-surface-border flex items-center space-x-1 transition-colors"
                >
                  <span>Анализ актива</span>
                  <ArrowUpRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

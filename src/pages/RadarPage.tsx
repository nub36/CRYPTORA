import React, { useState, useEffect, useMemo } from 'react';
import { useMarketData } from '@/context/MarketDataContext';
import { DataSourceUnavailable } from '@/components/common/DataSourceUnavailable';
import { RadarEvent } from '@/types/market';
import { formatTimestamp } from '@/utils/formatters';
import { radarEventTypeLabel, radarSeverityLabel } from '@/utils/labels';
import { Badge } from '@/components/common/Badge';
import { Link } from 'react-router-dom';
import { Radio, ArrowUpRight, Sparkles, AlertCircle } from 'lucide-react';
import { RealtimeFeedManager } from '@/services/realtime/RealtimeFeedManager';
import { AiExplanationEngine, AiMarketBriefing, MarketContextFact } from '@/services/ai/AiExplanationEngine';
import { requestLlmExplanation, marketContextFactToStructured, type AiExplainResponse } from '@/services/ai/LlmExplainClient';
import { IndicatorEngine } from '@/services/indicators/IndicatorEngine';

export const RadarPage: React.FC = () => {
  const { provider, dataMode } = useMarketData();
  const [events, setEvents] = useState<RadarEvent[]>([]);
  const [sourceUnavailable, setSourceUnavailable] = useState(false);
  const [selectedType, setSelectedType] = useState<string>('all');
  const [selectedSeverity, setSelectedSeverity] = useState<string>('all');

  useEffect(() => {
    provider
      .getRadarEvents()
      .then((data) => {
        setEvents(data);
        setSourceUnavailable(false);
      })
      .catch(() => setSourceUnavailable(true));

    if (dataMode === 'live') {
      const feed = RealtimeFeedManager.getInstance();
      const unsub = feed.eventBus.subscribe<RadarEvent>('radar', (newEvent) => {
        setEvents((prev) => [newEvent, ...prev.filter((e) => e.id !== newEvent.id)]);
      });
      return () => unsub();
    }
  }, [provider, dataMode]);

  const filteredEvents = events.filter((e) => {
    if (selectedType !== 'all' && e.type !== selectedType) return false;
    if (selectedSeverity !== 'all' && e.severity !== selectedSeverity) return false;
    return true;
  });

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

  return (
    <div className="space-y-4 max-w-[1920px] mx-auto px-3 sm:px-4 py-3.5">
      {sourceUnavailable && <DataSourceUnavailable subject="сигналы радара" />}
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-white/[0.08] gap-2">
        <div>
          <div className="flex items-center space-x-2">
            <Radio className="w-5 h-5 text-cyan-400 animate-pulse" />
            <h1 className="text-lg sm:text-xl font-bold font-sans text-white tracking-wide">
              Рыночный радар: детектор аномалий
            </h1>
            {dataMode === 'live' ? (
              <span className="text-[11px] font-mono font-semibold text-cyan-300 bg-cyan-950/40 px-2.5 py-0.5 rounded-full border border-cyan-500/30 flex items-center">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse mr-1.5" />
                LIVE-детектор аномалий
              </span>
            ) : (
              <span className="text-[11px] font-mono font-semibold text-amber-300 bg-amber-500/10 px-2.5 py-0.5 rounded-full border border-amber-500/30">
                QA
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400 font-sans mt-0.5">
            {dataMode === 'live'
              ? 'Математический движок детекции аномалий (Z-Score объемов, ценовой импульс, расширение волатильности) в реальном времени.'
              : 'Поток зафиксированных аномалий объема, открытого интереса, фандинга и ликвидаций на QA-датасете.'}
          </p>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2 font-sans text-xs">
          {/* Type filter */}
          <select
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
          <div className="bg-surface border border-surface-border rounded-lg p-12 text-center text-slate-500 text-xs font-sans">
            Нет событий, удовлетворяющих заданным критериям фильтрации радара.
          </div>
        ) : (
          filteredEvents.map((event) => (
            <div
              key={event.id}
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
                      LIVE
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

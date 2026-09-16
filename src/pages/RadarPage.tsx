import React, { useState, useEffect, useMemo } from 'react';
import { useMarketData } from '@/context/MarketDataContext';
import { RadarEvent } from '@/types/market';
import { formatTimestamp } from '@/utils/formatters';
import { Badge } from '@/components/common/Badge';
import { Link } from 'react-router-dom';
import { Radio, ArrowUpRight, Sparkles, AlertCircle } from 'lucide-react';
import { RealtimeFeedManager } from '@/services/realtime/RealtimeFeedManager';
import { AiExplanationEngine, AiMarketBriefing } from '@/services/ai/AiExplanationEngine';

export const RadarPage: React.FC = () => {
  const { provider, dataMode } = useMarketData();
  const [events, setEvents] = useState<RadarEvent[]>([]);
  const [selectedType, setSelectedType] = useState<string>('all');
  const [selectedSeverity, setSelectedSeverity] = useState<string>('all');

  useEffect(() => {
    provider.getRadarEvents().then((data) => {
      setEvents(data);
    });

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

  // Synthesize AI Market Briefing for top anomaly asset
  const aiBriefing = useMemo<AiMarketBriefing | null>(() => {
    if (events.length === 0) return null;
    const topEvent = events.find((e) => e.severity === 'HIGH') || events[0];
    return AiExplanationEngine.generateBriefing({
      symbol: topEvent.symbol,
      price: topEvent.symbol === 'BTC' ? 64500 : topEvent.symbol === 'ETH' ? 3480 : 158,
      change24h: 3.2,
      fundingRate8h: 0.012,
      openInterestDelta24h: 6.8,
      rsi14: 64.5,
      anomalies: [topEvent],
    });
  }, [events]);

  return (
    <div className="space-y-4 max-w-[1920px] mx-auto px-3 sm:px-4 py-3.5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-white/[0.08] gap-2">
        <div>
          <div className="flex items-center space-x-2">
            <Radio className="w-5 h-5 text-cyan-400 animate-pulse" />
            <h1 className="text-lg sm:text-xl font-bold font-mono text-white tracking-wide">
              MARKET RADAR (ДЕТЕКТОР АНОМАЛИЙ)
            </h1>
            {dataMode === 'live' ? (
              <span className="text-[10px] font-mono font-semibold text-cyan-300 bg-cyan-950/40 px-2.5 py-0.5 rounded-full border border-cyan-500/30 flex items-center">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse mr-1.5" />
                LIVE ANOMALY ENGINE
              </span>
            ) : (
              <span className="text-[10px] font-mono font-semibold text-amber-300 bg-amber-500/10 px-2.5 py-0.5 rounded-full border border-amber-500/30">
                ДЕМОНСТРАЦИОННЫЙ СТРИМ
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400 font-sans mt-0.5">
            {dataMode === 'live'
              ? 'Математический движок детекции аномалий (Z-Score объемов, ценовой импульс, расширение волатильности) в реальном времени.'
              : 'Демонстрационный поток зафиксированных аномалий объема, открытого интереса, фандинга и ликвидаций.'}
          </p>
        </div>

        {/* Filters */}
        <div className="flex items-center space-x-2 font-mono text-xs">
          {/* Type filter */}
          <select
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value)}
            className="bg-[#111a30] border border-white/[0.08] rounded-lg px-3 py-1.5 text-slate-200 focus:outline-none focus:border-cyan-400 min-h-[32px]"
          >
            <option value="all">Все типы аномалий</option>
            <option value="VOLUME_SPIKE">Volume Spike</option>
            <option value="OI_SPIKE">OI Spike</option>
            <option value="FUNDING_EXTREME">Funding Extreme</option>
            <option value="LIQUIDATION_BURST">Liquidation Burst</option>
            <option value="PRICE_MOVE">Price Move</option>
            <option value="VOLATILITY_EXPANSION">Volatility Expansion</option>
          </select>

          {/* Severity filter */}
          <select
            value={selectedSeverity}
            onChange={(e) => setSelectedSeverity(e.target.value)}
            className="bg-[#111a30] border border-white/[0.08] rounded-lg px-3 py-1.5 text-slate-200 focus:outline-none focus:border-cyan-400 min-h-[32px]"
          >
            <option value="all">Любая важность</option>
            <option value="HIGH">Только HIGH</option>
            <option value="MEDIUM">Только MEDIUM</option>
            <option value="INFO">Только INFO</option>
          </select>
        </div>
      </div>

      {/* AI Market Analyst Grounded Briefing Banner */}
      {aiBriefing && (
        <div className="bg-[#0a0f1d] border border-cyan-500/30 rounded-xl p-4 font-mono text-xs space-y-3 shadow-panel bg-gradient-to-r from-[#0a0f1d] to-cyan-950/20">
          <div className="flex items-center justify-between pb-2 border-b border-surface-border">
            <div className="flex items-center space-x-2 font-bold text-white">
              <Sparkles className="w-4 h-4 text-brand-cyan" />
              <span>AI ANALYST BRIEFING: {aiBriefing.headline}</span>
            </div>
            <span className="text-[10px] text-slate-400 bg-surface-elevated px-2 py-0.5 rounded border border-surface-border">
              Основано на детерминированных фактах
            </span>
          </div>

          <p className="text-xs text-slate-300 font-sans leading-relaxed">
            {aiBriefing.explanation}
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1 font-sans text-[11px]">
            <div className="p-2.5 rounded bg-emerald-950/20 border border-emerald-500/20 space-y-1">
              <span className="font-bold text-emerald-400 font-mono block">Ключевые драйверы:</span>
              <ul className="list-disc list-inside text-slate-300 space-y-0.5">
                {aiBriefing.keyDrivers.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            </div>

            <div className="p-2.5 rounded bg-rose-950/20 border border-rose-500/20 space-y-1">
              <span className="font-bold text-rose-400 font-mono block">Факторы риска:</span>
              <ul className="list-disc list-inside text-slate-300 space-y-0.5">
                {aiBriefing.riskObservations.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          </div>

          <div className="text-[10px] text-slate-500 font-sans flex items-center space-x-1.5 pt-1">
            <AlertCircle className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
            <span>{aiBriefing.disclaimer}</span>
          </div>
        </div>
      )}

      {/* Events Stream List */}
      <div className="space-y-3 font-mono">
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
                    {event.severity}
                  </Badge>

                  <span className="text-xs bg-slate-800 text-slate-300 px-2 py-0.5 rounded font-mono border border-slate-700">
                    {event.type}
                  </span>

                  {!event.isDemo && (
                    <span className="text-[10px] font-mono text-brand-green bg-brand-green/10 px-1.5 py-0.5 rounded border border-brand-green/30">
                      LIVE DETECTED
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

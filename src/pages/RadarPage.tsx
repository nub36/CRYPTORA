import React, { useState, useEffect } from 'react';
import { useMarketData } from '@/context/MarketDataContext';
import { RadarEvent } from '@/types/market';
import { formatTimestamp } from '@/utils/formatters';
import { Badge } from '@/components/common/Badge';
import { Link } from 'react-router-dom';
import { Radio, ArrowUpRight } from 'lucide-react';

export const RadarPage: React.FC = () => {
  const { provider } = useMarketData();
  const [events, setEvents] = useState<RadarEvent[]>([]);
  const [selectedType, setSelectedType] = useState<string>('all');
  const [selectedSeverity, setSelectedSeverity] = useState<string>('all');

  useEffect(() => {
    provider.getRadarEvents().then((data) => {
      setEvents(data);
    });
  }, [provider]);

  const filteredEvents = events.filter((e) => {
    if (selectedType !== 'all' && e.type !== selectedType) return false;
    if (selectedSeverity !== 'all' && e.severity !== selectedSeverity) return false;
    return true;
  });

  return (
    <div className="space-y-4 max-w-[1920px] mx-auto px-3 sm:px-4 py-3">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-surface-border gap-2">
        <div>
          <div className="flex items-center space-x-2">
            <Radio className="w-5 h-5 text-brand-cyan animate-pulse" />
            <h1 className="text-lg sm:text-xl font-bold font-mono text-white tracking-wide">
              MARKET RADAR (ДЕТЕКТОР АНОМАЛИЙ)
            </h1>
            <span className="text-[10px] font-mono font-semibold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/30">
              DEMO RADAR STREAM
            </span>
          </div>
          <p className="text-xs text-slate-400 font-sans mt-0.5">
            Автоматическое обнаружение статистических выбросов объема, открытого интереса, экстремумов фандинга и ликвидаций.
          </p>
        </div>

        {/* Filters */}
        <div className="flex items-center space-x-2 font-mono text-xs">
          {/* Type filter */}
          <select
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value)}
            className="bg-surface border border-surface-border rounded px-2.5 py-1.5 text-slate-200 focus:outline-none focus:border-brand-cyan"
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
            className="bg-surface border border-surface-border rounded px-2.5 py-1.5 text-slate-200 focus:outline-none focus:border-brand-cyan"
          >
            <option value="all">Любая важность</option>
            <option value="HIGH">Только HIGH</option>
            <option value="MEDIUM">Только MEDIUM</option>
            <option value="INFO">Только INFO</option>
          </select>
        </div>
      </div>

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

import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Radio } from 'lucide-react';
import type { RadarEvent } from '@/types/market';
import { formatTimestamp } from '@/utils/formatters';
import { radarEventTypeLabel } from '@/utils/labels';
import { Badge } from '@/components/common/Badge';

interface MarketRadarPreviewProps {
  events: readonly RadarEvent[];
  isDemoMode: boolean;
  sourceUnavailable?: boolean;
}

export const MarketRadarPreview: React.FC<MarketRadarPreviewProps> = ({
  events,
  isDemoMode,
  sourceUnavailable = false,
}) => {
  const latestEvents = events.slice(0, 4);

  return (
    <section className="self-start bg-surface border border-white/[0.08] rounded-xl p-3.5 sm:p-4 shadow-panel" data-qa="market-radar-preview" data-testid="market-radar-preview">
      <div className="flex items-center justify-between gap-2 pb-2.5 mb-3 border-b border-white/[0.06]">
        <div className="flex items-center gap-2">
          <Radio className={`w-4 h-4 ${isDemoMode ? 'text-amber-400' : 'text-cyan-400'}`} />
          <h2 className="font-bold text-sm text-white font-sans tracking-wide">Рыночный радар: последнее</h2>
          {isDemoMode && <span className="rounded border border-amber-400/25 bg-amber-400/[0.08] px-1.5 py-0.5 text-[11px] font-semibold text-amber-300">QA</span>}
        </div>
        <Link
          to="/radar"
          className="shrink-0 text-xs text-cyan-400 hover:text-cyan-300 hover:underline flex items-center gap-1 font-sans font-medium"
        >
          Все события <ArrowUpRight className="w-3.5 h-3.5" />
        </Link>
      </div>

      {latestEvents.length === 0 ? (
        <div className="rounded-lg border border-white/[0.055] bg-surface-elevated/40 px-3 py-4 text-center" data-qa="market-radar-empty" data-testid="market-radar-empty">
          <p className="text-xs font-medium text-slate-300">Новых рыночных событий пока нет</p>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
            {sourceUnavailable
              ? 'Источник событий временно недоступен. События не подменяются демонстрационными.'
              : isDemoMode
                ? 'В текущем QA-срезе новых событий нет.'
                : 'Ожидание фактических аномалий из Binance Spot WebSocket; фиктивные события не подставляются.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2.5 font-sans" data-qa="market-radar-events" data-testid="market-radar-events">
          {latestEvents.map((event) => (
            <article
              key={event.id}
              className="p-3 rounded-lg bg-surface-elevated/80 border border-white/[0.06] text-xs space-y-1.5 hover:border-cyan-500/40 transition-colors"
              data-qa="market-radar-event" data-testid="market-radar-event"
            >
              <div className="flex items-center justify-between gap-2 font-mono">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="font-bold text-white">{event.symbol}</span>
                  <Badge variant={event.severity === 'HIGH' ? 'red' : event.severity === 'MEDIUM' ? 'amber' : 'cyan'} size="xs">
                    {radarEventTypeLabel(event.type)}
                  </Badge>
                </div>
                <time className="shrink-0 text-[11px] text-slate-400 tabular-nums" dateTime={event.timestamp}>
                  {formatTimestamp(event.timestamp)}
                </time>
              </div>
              <div className="font-mono text-[11px] font-semibold text-cyan-300 tabular-nums">{event.metricValue}</div>
              <p className="text-[11px] text-slate-300 leading-tight">{event.observation}</p>
            </article>
          ))}
        </div>
      )}
    </section>
  );
};

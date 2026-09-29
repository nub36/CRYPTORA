import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Radio } from 'lucide-react';
import { Badge } from '@/components/common/Badge';
import { radarEventTypeLabel, radarSeverityLabel } from '@/utils/labels';
import type { RadarEvent } from '@/types/market';
import { InstrumentSectionCard, type InstrumentSectionStatus } from './InstrumentSectionCard';

/**
 * События Market Radar по инструменту — общая секция для Spot и Futures
 * (задача §9).
 *
 * ПОЛИТИКА ИСТОЧНИКА. Radar в CRYPTORA — серверный монитор SPOT-рынка
 * (`GET /api/radar/events`, символы вида `BTC`). Фьючерсных аномалий он не
 * считает. Поэтому на странице перпетуала секция:
 *   • либо явно подписана «Spot Radar базового актива» (`policy='spot-underlying'`)
 *     — тогда пользователь видит, что это аномалии спота, а не фьючерса;
 *   • либо не рендерится вовсе (`policy='hidden'`), если у контракта нет
 *     активной спотовой базы (например, чистый ×1000-дериватив без спота).
 * Выдавать спотовую аномалию за фьючерсную запрещено.
 */
export type RadarSourcePolicy = 'native-spot' | 'spot-underlying' | 'hidden';

export interface InstrumentRadarCardProps {
  events: RadarEvent[];
  status: InstrumentSectionStatus;
  policy: RadarSourcePolicy;
  /** Тикер, по которому запрошены события (спотовая база на фьючерсе). */
  sourceSymbol: string;
  qa?: string;
  onRetry?: () => void;
}

export const InstrumentRadarCard: React.FC<InstrumentRadarCardProps> = ({
  events,
  status,
  policy,
  sourceSymbol,
  qa = 'instrument-radar',
  onRetry,
}) => {
  if (policy === 'hidden') return null;
  const underlying = policy === 'spot-underlying';

  return (
    <InstrumentSectionCard
      title={underlying ? `Spot Radar базового актива ${sourceSymbol}` : `События Market Radar по ${sourceSymbol}`}
      icon={Radio}
      status={events.length === 0 && status === 'ready' ? 'no-data' : status}
      /* Рынок секции — ВСЕГДА spot: источник аномалий спотовый. */
      market="spot"
      qa={qa}
      sourceNote={underlying ? 'Источник: Spot Radar — аномалии базового актива, не контракта' : undefined}
      emptyMessage={`По инструменту ${sourceSymbol} активных аномалий не зафиксировано.`}
      onRetry={onRetry}
      headerRight={
        <Link to="/radar" className="flex shrink-0 items-center space-x-1 font-sans text-xs text-brand-cyan hover:underline">
          <span>Все аномалии</span>
          <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      }
    >
      <div className="space-y-2 font-sans">
        {events.map((event) => (
          <div
            key={event.id}
            className="flex items-center justify-between gap-2 rounded border border-surface-border bg-surface-elevated p-2.5 text-xs"
          >
            <div className="flex min-w-0 items-center space-x-2">
              <Badge variant={event.severity === 'HIGH' ? 'red' : event.severity === 'MEDIUM' ? 'amber' : 'cyan'} size="xs">
                {radarSeverityLabel(event.severity)}
              </Badge>
              <span className="font-semibold text-white">{radarEventTypeLabel(event.type)}</span>
              <span className="hidden truncate text-xs text-slate-400 sm:inline">{event.observation}</span>
            </div>
            <span className="whitespace-nowrap font-bold text-brand-cyan">{event.metricValue}</span>
          </div>
        ))}
      </div>
    </InstrumentSectionCard>
  );
};

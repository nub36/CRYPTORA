/**
 * DataSourcesBadge — compact provenance indicator for Coin Detail.
 * Shows which sources provide each data group.
 * Uses a hover/touch popover to avoid taking up vertical space.
 *
 * Freshness: subtle connection state dot (green=live, amber=stale, red=error).
 */
import React, { useState, useRef, useEffect } from 'react';
import { Database, ChevronDown } from 'lucide-react';
import type { RealtimeConnectionState } from '@/types/realtime';

interface DataSource {
  label: string;
  source: string;
  status: 'live' | 'derived' | 'unavailable' | 'model';
}

interface DataSourcesBadgeProps {
  spot?: string;
  derivatives?: string;
  orderBook?: string;
  liquidations?: string;
  metadata?: string; // CoinGecko
  indicators?: string;
  /** WebSocket connection state — shows a subtle dot indicator. */
  connectionState?: RealtimeConnectionState;
}

const STATUS_STYLES: Record<string, string> = {
  live: 'text-emerald-400',
  derived: 'text-blue-400',
  unavailable: 'text-slate-500',
  model: 'text-amber-400',
};

const STATUS_LABELS: Record<string, string> = {
  live: 'LIVE',
  derived: 'DERIVED',
  unavailable: 'Н/Д',
  model: 'MODEL',
};

/** Subtle dot color by connection state */
const CONN_DOT: Record<string, string> = {
  connected: 'bg-emerald-400',
  connecting: 'bg-amber-400 animate-pulse',
  reconnecting: 'bg-amber-400 animate-pulse',
  disconnected: 'bg-rose-400',
  error: 'bg-rose-400',
  idle: 'bg-slate-500',
};

const CONN_LABEL: Record<string, string> = {
  connected: 'WS подключён',
  connecting: 'Подключение...',
  reconnecting: 'Переподключение...',
  disconnected: 'WS отключён',
  error: 'Ошибка WS',
  idle: 'Ожидание',
};

export const DataSourcesBadge: React.FC<DataSourcesBadgeProps> = ({
  spot = 'Binance',
  derivatives,
  orderBook = 'Binance',
  liquidations,
  metadata,
  indicators = 'CRYPTORA',
  connectionState,
}) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const sources: DataSource[] = [
    { label: 'Спот', source: spot, status: 'live' },
    { label: 'Стакан', source: orderBook, status: 'live' },
    { label: 'Индикаторы', source: indicators, status: 'derived' },
  ];

  if (derivatives) {
    sources.push({ label: 'Деривативы', source: derivatives, status: 'live' });
  } else {
    sources.push({ label: 'Деривативы', source: 'Нет контракта', status: 'unavailable' });
  }

  if (liquidations) {
    sources.push({ label: 'Ликвидации', source: liquidations, status: 'live' });
  } else {
    sources.push({ label: 'Ликвидации', source: 'Нет потока', status: 'unavailable' });
  }

  if (metadata) {
    sources.push({ label: 'Метаданные', source: metadata, status: 'derived' });
  }

  const dotClass = connectionState ? CONN_DOT[connectionState] ?? 'bg-slate-500' : undefined;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-2 py-1 text-[11px] font-sans text-slate-400 hover:text-slate-200 bg-slate-800/50 hover:bg-slate-700/50 rounded-md border border-slate-700/40 transition-colors"
        data-qa="data-sources-button"
        title="Источники данных"
      >
        {dotClass && (
          <span className={`w-1.5 h-1.5 rounded-full inline-block ${dotClass}`} aria-hidden />
        )}
        <Database className="w-3 h-3" />
        <span>Источники</span>
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-72 bg-slate-900 border border-slate-700/60 rounded-lg shadow-xl p-3 space-y-2" data-qa="data-sources-popover">
          <h4 className="text-[11px] font-semibold text-slate-300 tracking-wide">Источники данных</h4>
          {connectionState && (
            <div className="flex items-center gap-1.5 text-[11px] pb-1 border-b border-slate-700/40">
              <span className={`w-2 h-2 rounded-full inline-block ${CONN_DOT[connectionState] ?? 'bg-slate-500'}`} />
              <span className="text-slate-400">{CONN_LABEL[connectionState] ?? connectionState}</span>
            </div>
          )}
          <div className="space-y-1.5">
            {sources.map((s) => (
              <div key={s.label} className="flex items-center justify-between text-[11px]">
                <span className="text-slate-400">{s.label}</span>
                <span className={`font-mono font-medium ${STATUS_STYLES[s.status]}`}>
                  {s.source}
                  <span className="ml-1.5 text-[11px] opacity-60">{STATUS_LABELS[s.status]}</span>
                </span>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-slate-500 pt-1 border-t border-slate-700/40">
            Индикаторы рассчитываются детерминированным движком CRYPTORA из фактических свечей.
          </p>
        </div>
      )}
    </div>
  );
};

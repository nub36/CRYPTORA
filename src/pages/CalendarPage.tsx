import React, { useEffect, useMemo, useState } from 'react';
import { CalendarService, type CalendarEvent, type CalendarEventKind, type CalendarReport } from '@/services/analytics/CalendarService';
import { Calendar, Clock, ShieldCheck, Filter } from 'lucide-react';
import { Badge } from '@/components/common/Badge';
import { DataSourceUnavailable } from '@/components/common/DataSourceUnavailable';

const KIND_LABEL: Record<CalendarEventKind, string> = { FUNDING: 'Фандинг', EXPIRY: 'Экспирация' };

function formatUntil(ms: number): string {
  if (ms <= 0) return 'сейчас';
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (h >= 48) return `через ${Math.floor(h / 24)} дн.`;
  return `через ${h}ч ${String(m).padStart(2, '0')}м`;
}

/**
 * Календарь деривативов: фактические расписания Binance Futures (фандинг, экспирации).
 * Макро-события (FOMC/CPI/NFP) не показываются — источника нет.
 */
export const CalendarPage: React.FC = () => {
  const [report, setReport] = useState<CalendarReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [kind, setKind] = useState<CalendarEventKind | 'ALL'>('ALL');

  useEffect(() => {
    let active = true;
    CalendarService.fetchReport()
      .then((r) => {
        if (active) setReport(r);
      })
      .catch(() => {
        if (active) setUnavailable(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const events = useMemo(() => (report?.events ?? []).filter((e) => kind === 'ALL' || e.kind === kind), [report, kind]);
  const next = report?.events[0] ?? null;

  return (
    <div className="space-y-6 max-w-[1920px] mx-auto px-3 sm:px-4 py-3">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-surface-border gap-2">
        <div>
          <div className="flex items-center space-x-2">
            <Calendar className="w-5 h-5 text-brand-cyan" />
            <h1 className="text-lg sm:text-xl font-bold font-sans text-white tracking-wide">Календарь деривативов</h1>
            <Badge variant="cyan" size="sm">
              Binance Futures
            </Badge>
          </div>
          <p className="text-xs text-slate-400 font-sans mt-0.5">
            Ближайшие начисления фандинга по бессрочным контрактам и экспирации срочных контрактов — из расписания биржи.
          </p>
        </div>
        <div
          data-qa="calendar-source"
          data-state={report ? 'live' : unavailable ? 'unavailable' : 'loading'}
          className={`text-xs font-mono px-2.5 py-1 rounded border ${
            report ? 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30' : 'text-slate-400 bg-white/[0.06] border-white/[0.12]'
          }`}
        >
          {report ? `BINANCE • LIVE · ${new Date(report.fetchedAt).toLocaleTimeString('ru-RU')}` : loading ? 'Загрузка…' : 'ИСТОЧНИК НЕДОСТУПЕН'}
        </div>
      </div>

      {unavailable && !loading && <DataSourceUnavailable subject="расписание деривативов (Binance Futures)" />}

      {next && report && (
        <div className="bg-surface border border-brand-cyan/30 rounded-lg p-5 space-y-3 shadow-md" data-qa="calendar-next">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-brand-cyan uppercase tracking-wide font-sans">Ближайшее событие</span>
            <div className="flex items-center space-x-1.5 text-xs font-mono text-slate-300">
              <Clock className="w-3.5 h-3.5 text-brand-cyan" />
              <span>
                {new Date(next.at).toLocaleString('ru-RU')} · {formatUntil(next.at - report.fetchedAt)}
              </span>
            </div>
          </div>
          <h3 className="text-base font-bold text-white font-sans">{next.title}</h3>
          <p className="text-xs text-slate-300 font-mono">{next.detail}</p>
        </div>
      )}

      <div className="p-4 bg-surface border border-surface-border rounded-lg text-xs font-sans text-slate-300 space-y-2">
        <div className="flex items-center space-x-2 text-white font-sans font-bold">
          <ShieldCheck className="w-4 h-4 text-brand-green" />
          <span>Что здесь показано и чего нет</span>
        </div>
        <p className="text-[11px] leading-relaxed text-slate-400">
          Только расписание, которое отдаёт биржа: моменты начисления фандинга (premiumIndex) и даты поставки срочных контрактов
          (exchangeInfo). Макроэкономические события (FOMC, CPI, NFP), разблокировки токенов и «прогнозы рынка» не показываются — у
          терминала нет их фактического источника. Терминал <strong>не выставляет ордеров</strong>.
        </p>
      </div>

      {report && (
        <div className="flex items-center gap-2 text-xs font-sans">
          <Filter className="w-3.5 h-3.5 text-slate-500" />
          {(['ALL', 'FUNDING', 'EXPIRY'] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={`px-2.5 py-1 rounded border ${
                kind === k ? 'bg-brand-cyan/15 text-brand-cyan border-brand-cyan/40' : 'bg-surface text-slate-400 border-surface-border hover:text-white'
              }`}
            >
              {k === 'ALL' ? 'Все' : KIND_LABEL[k]}
            </button>
          ))}
          <span className="text-slate-500 ml-auto">{events.length} событий</span>
        </div>
      )}

      <div className="space-y-3 font-sans">
        {events.map((event: CalendarEvent) => (
          <div key={event.id} data-qa="calendar-event" className="bg-surface border border-surface-border rounded-lg p-4 space-y-2 shadow-md">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center space-x-2.5">
                <span className="text-xs text-slate-300 font-mono tabular-nums">{new Date(event.at).toLocaleString('ru-RU')}</span>
                <Badge variant={event.kind === 'EXPIRY' ? 'amber' : 'cyan'} size="xs">
                  {KIND_LABEL[event.kind]}
                </Badge>
              </div>
              <div className="flex flex-wrap items-center gap-1 text-[11px]">
                {event.symbols.slice(0, 8).map((s) => (
                  <span key={s} className="font-bold text-white bg-surface-elevated px-1.5 py-0.5 rounded border border-surface-border font-mono">
                    {s}
                  </span>
                ))}
                {event.symbols.length > 8 && <span className="text-slate-500">+{event.symbols.length - 8}</span>}
              </div>
            </div>
            <h4 className="text-sm font-bold text-white">{event.title}</h4>
            <p className="text-xs text-slate-400 font-mono">{event.detail}</p>
          </div>
        ))}
        {!loading && report && events.length === 0 && (
          <div className="py-8 text-center text-slate-500 text-xs">Событий по выбранному фильтру нет.</div>
        )}
        {!loading && !report && <div className="py-8 text-center text-slate-500 text-xs">Данные источника не получены.</div>}
      </div>
    </div>
  );
};

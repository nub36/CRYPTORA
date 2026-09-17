import React, { useState, useMemo } from 'react';
import { CalendarService, EventCategory, EventImpact } from '@/services/analytics/CalendarService';
import { Calendar, Clock, ShieldCheck, Filter } from 'lucide-react';
import { Badge } from '@/components/common/Badge';
import { StaticDatasetNotice } from '@/components/common/StaticDatasetNotice';
import { impactLabel } from '@/utils/labels';

export const CalendarPage: React.FC = () => {
  const [selectedCategory, setSelectedCategory] = useState<EventCategory | 'ALL'>('ALL');
  const [selectedImpact, setSelectedImpact] = useState<EventImpact | 'ALL'>('ALL');

  const nextMajor = useMemo(() => CalendarService.getNextMajorEvent(), []);

  const events = useMemo(() => {
    const cat = selectedCategory !== 'ALL' ? selectedCategory : undefined;
    const imp = selectedImpact !== 'ALL' ? selectedImpact : undefined;
    return CalendarService.getEvents(cat, imp);
  }, [selectedCategory, selectedImpact]);

  return (
    <div className="space-y-6 max-w-[1920px] mx-auto px-3 sm:px-4 py-3">
      {/* Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-surface-border gap-2">
        <div>
          <div className="flex items-center space-x-2">
            <Calendar className="w-5 h-5 text-brand-cyan" />
            <h1 className="text-lg sm:text-xl font-bold font-sans text-white tracking-wide">
              Макро-календарь и события
            </h1>
            <Badge variant="cyan" size="sm">
              Трекер катализаторов
            </Badge>
          </div>
          <p className="text-xs text-slate-400 font-sans mt-0.5">
            Календарь решений центробанков (FOMC, ЕЦБ), макро-инфляции (CPI, NFP), хардфорков и крупных разблокировок токенов.
          </p>
        </div>

        <div className="text-xs font-mono text-amber-400 bg-amber-500/10 px-2.5 py-1 rounded border border-amber-500/30">
          Событийный горизонт: Сентябрь 2026
        </div>
      </div>

      <StaticDatasetNotice what="События экономического календаря" source="не подключён; даты и прогнозы могут быть неактуальны" />

      {/* Next Major Catalyst Card */}
      {nextMajor && (
        <div className="bg-gradient-to-r from-surface to-brand-cyan/10 border border-brand-cyan/40 rounded-lg p-5 font-sans text-xs space-y-3 shadow-lg">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-2 border-b border-surface-border gap-2">
            <div className="flex items-center space-x-2">
              <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping inline-block" />
              <span className="font-bold text-white tracking-wide">
                Ближайший ключевой макро-катализатор
              </span>
              <Badge variant="red" size="xs">
                Риск высокой волатильности
              </Badge>
            </div>
            <div className="text-slate-400 text-[11px] flex items-center space-x-1">
              <Clock className="w-3.5 h-3.5 text-brand-cyan" />
              <span>{new Date(nextMajor.date).toLocaleString()}</span>
            </div>
          </div>

          <div className="space-y-1">
            <h3 className="text-base font-bold text-white font-sans">{nextMajor.title}</h3>
            <p className="text-xs text-slate-300 font-sans leading-relaxed max-w-4xl">
              {nextMajor.description}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-4 pt-1 font-mono text-xs">
            {nextMajor.forecast && (
              <div className="bg-surface-elevated px-3 py-1.5 rounded border border-surface-border">
                <span className="text-slate-400 block text-[11px]">Прогноз рынка:</span>
                <span className="font-bold text-brand-cyan">{nextMajor.forecast}</span>
              </div>
            )}
            {nextMajor.previous && (
              <div className="bg-surface-elevated px-3 py-1.5 rounded border border-surface-border">
                <span className="text-slate-400 block text-[11px]">Предыдущее значение:</span>
                <span className="text-slate-300">{nextMajor.previous}</span>
              </div>
            )}
            <div className="bg-surface-elevated px-3 py-1.5 rounded border border-surface-border flex items-center space-x-1.5">
              <span className="text-slate-400 text-[11px]">Активы в фокусе:</span>
              <div className="flex space-x-1">
                {nextMajor.affectedAssets.map((asset) => (
                  <span
                    key={asset}
                    className="text-white font-bold bg-slate-800 px-1.5 py-0.5 rounded text-[11px]"
                  >
                    {asset}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Non-Execution Notice */}
      <div className="p-4 bg-surface border border-surface-border rounded-lg text-xs font-sans text-slate-300 space-y-2">
        <div className="flex items-center space-x-2 text-white font-sans font-bold">
          <ShieldCheck className="w-4 h-4 text-brand-green" />
          <span>Учет событийного риска и всплесков волатильности</span>
        </div>
        <p className="text-[11px] leading-relaxed text-slate-400">
          Календарь помогает трейдерам и аналитикам заранее планировать снижение торгового плеча и корректировать ширину стоп-лоссов перед выходом макро-новостей. Терминал <strong>не исполняет новостных торговых стратегий и не выставляет ордеров</strong>.
        </p>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-1">
        <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
          <Filter className="w-3.5 h-3.5 text-slate-400" />
          <span className="text-slate-400">Важность:</span>
          {(['ALL', 'HIGH', 'MEDIUM'] as const).map((imp) => (
            <button
              key={imp}
              onClick={() => setSelectedImpact(imp)}
              className={`px-2.5 py-1 rounded border transition-all ${
                selectedImpact === imp
                  ? 'bg-brand-cyan/20 text-brand-cyan border-brand-cyan/40 font-bold'
                  : 'bg-surface text-slate-400 border-surface-border hover:text-white'
              }`}
            >
              {imp === 'ALL' ? 'Любое' : impactLabel(imp)}
            </button>
          ))}

          <span aria-hidden className="text-slate-600 mx-1">|</span>

          <span className="text-slate-400">Категория:</span>
          {(['ALL', 'CENTRAL_BANK', 'MACRO_ECONOMICS', 'CRYPTO_CATALYST', 'TOKEN_UNLOCK'] as const).map(
            (cat) => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-2.5 py-1 rounded border transition-all ${
                  selectedCategory === cat
                    ? 'bg-brand-purple/20 text-brand-purple border-brand-purple/40 font-bold'
                    : 'bg-surface text-slate-400 border-surface-border hover:text-white'
                }`}
              >
                {cat === 'ALL' && 'Все категории'}
                {cat === 'CENTRAL_BANK' && 'ФРС / Центробанки'}
                {cat === 'MACRO_ECONOMICS' && 'Макро (CPI/NFP)'}
                {cat === 'CRYPTO_CATALYST' && 'Крипто-события'}
                {cat === 'TOKEN_UNLOCK' && 'Разлоки токенов'}
              </button>
            )
          )}
        </div>

        <div className="text-[11px] font-sans text-slate-500">
          Событий: {events.length}
        </div>
      </div>

      {/* Events List */}
      <div className="space-y-3 font-sans">
        {events.map((event) => (
          <div
            key={event.id}
            className="bg-surface border border-surface-border rounded-lg p-4 space-y-3 hover:border-slate-700 transition-all shadow-md"
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-2 border-b border-surface-border gap-2">
              <div className="flex items-center space-x-2.5">
                <span className="text-xs text-slate-400 font-semibold">
                  {new Date(event.date).toLocaleDateString()} {new Date(event.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
                <Badge
                  variant={event.impact === 'HIGH' ? 'red' : 'amber'}
                  size="xs"
                >
                  {impactLabel(event.impact).toUpperCase()} ВЛИЯНИЕ
                </Badge>
                <span className="text-[11px] bg-slate-800 text-slate-300 px-2 py-0.5 rounded border border-slate-700">
                  {event.category}
                </span>
              </div>

              <div className="flex items-center space-x-1.5 text-[11px] text-slate-400">
                <span>Активы:</span>
                {event.affectedAssets.map((asset) => (
                  <span
                    key={asset}
                    className="font-bold text-white bg-surface-elevated px-1.5 py-0.5 rounded border border-surface-border text-[11px]"
                  >
                    {asset}
                  </span>
                ))}
              </div>
            </div>

            <div className="space-y-1">
              <h4 className="text-sm font-bold text-white">{event.title}</h4>
              <p className="text-xs text-slate-300 font-sans leading-relaxed">
                {event.description}
              </p>
            </div>

            {(event.forecast || event.previous) && (
              <div className="flex items-center space-x-4 pt-1 text-[11px]">
                {event.forecast && (
                  <div>
                    <span className="text-slate-500 mr-1.5">Прогноз:</span>
                    <span className="font-bold text-brand-cyan">{event.forecast}</span>
                  </div>
                )}
                {event.previous && (
                  <div>
                    <span className="text-slate-500 mr-1.5">Пред.:</span>
                    <span className="text-slate-300">{event.previous}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

import React, { useMemo, useState } from 'react';
import { Newspaper, ShieldAlert, Bell } from 'lucide-react';
import { Badge } from '@/components/common/Badge';

/**
 * Новости — раздел без подключённого источника.
 *
 * ЧЕСТНОСТЬ (docs/DESIGN_SYSTEM.md, принцип LIVE-first): страница не показывает
 * ни выдуманных заголовков, ни «демо-ленты». Пока источник не подключён,
 * раздел открыто говорит об этом, а каркас (категории, пустое состояние)
 * уже готов к данным — подключение источника не потребует переделки вёрстки.
 *
 * Внешних запросов здесь нет: ничего не запрашивается и не подставляется.
 */

export type NewsCategory = 'ALL' | 'BTC' | 'ALT' | 'REGULATION' | 'MACRO' | 'EXCHANGES';

/** Категории ленты. Машинные коды остаются латиницей — это контракт данных. */
export const NEWS_CATEGORIES: ReadonlyArray<{ id: NewsCategory; label: string; hint: string }> = Object.freeze([
  { id: 'ALL', label: 'Все', hint: 'Вся лента без фильтра' },
  { id: 'BTC', label: 'Биткоин', hint: 'BTC: цена, хешрейт, ETF, протокол' },
  { id: 'ALT', label: 'Альткоины', hint: 'Альткоины и токеномика' },
  { id: 'REGULATION', label: 'Регулирование', hint: 'Регуляторы, законы, лицензии' },
  { id: 'MACRO', label: 'Макро', hint: 'Ставки, инфляция, ликвидность' },
  { id: 'EXCHANGES', label: 'Биржи', hint: 'Биржи, листинги, инциденты' },
]);

export const NewsPage: React.FC = () => {
  const [category, setCategory] = useState<NewsCategory>('ALL');

  // Лента пуста всегда, пока не подключён источник. Фильтр при этом работает
  // по уже структурированному полю категории и не добавляет запросов.
  const items = useMemo(() => [] as Array<{ id: string; title: string; category: NewsCategory }>, []);
  const visible = items.filter((it) => category === 'ALL' || it.category === category);

  return (
    <div className="space-y-4 max-w-[1920px] mx-auto px-3 sm:px-4 py-3.5 font-sans">
      {/* Заголовок раздела */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-white/[0.08] gap-2">
        <div className="flex items-center space-x-2">
          <h1 className="text-lg sm:text-xl font-bold text-white tracking-wide">Новости рынка</h1>
          <Badge variant="neutral" size="xs">
            источник не подключён
          </Badge>
        </div>
        <span className="text-[11px] text-slate-500 font-mono">
          категорий: {NEWS_CATEGORIES.length - 1}
        </span>
      </div>

      {/* Честное состояние раздела: источник не подключён, данные не выдумываются */}
      <div
        className="bg-surface border border-amber-500/25 rounded-xl p-4 flex items-start gap-3"
        data-qa="news-source-notice"
      >
        <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
        <div className="space-y-1 text-xs">
          <div className="font-bold text-white">Лента не заполняется: новостной источник не подключён</div>
          <div className="text-slate-400 leading-relaxed">
            CRYPTORA не показывает заголовки, которые не получены от фактического источника, —
            ни демо-ленты, ни подстановки. Подключение источника запланировано отдельным релизом;
            до этого раздел остаётся пустым и честно помеченным.
          </div>
        </div>
      </div>

      {/* Фильтры по категориям: каркас готов к данным, запросов не добавляет */}
      <div className="bg-surface border border-surface-border rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between pb-2 border-b border-surface-border">
          <div className="flex items-center space-x-2">
            <Newspaper className="w-4 h-4 text-cyan-400" />
            <span className="text-xs font-bold text-white tracking-wide">Лента по категориям</span>
          </div>
          <span className="text-[11px] font-mono text-slate-500 tabular-nums" data-qa="news-count">
            {visible.length} из {items.length}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 text-[11px]" data-qa="news-categories">
          {NEWS_CATEGORIES.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setCategory(c.id)}
              title={c.hint}
              data-qa={`news-category-${c.id.toLowerCase()}`}
              className={`px-2.5 py-1 rounded transition-colors border ${
                category === c.id
                  ? 'bg-brand-cyan text-slate-950 font-bold border-brand-cyan'
                  : 'border-surface-border text-slate-400 hover:text-white hover:bg-surface-hover'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>

        {visible.length === 0 && (
          <div className="py-10 text-center space-y-2" data-qa="news-empty">
            <Bell className="w-5 h-5 text-slate-600 mx-auto" />
            <div className="text-xs text-slate-500">
              В категории «{NEWS_CATEGORIES.find((c) => c.id === category)?.label}» нет событий:
              источник не подключён, заголовки не подставляются.
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

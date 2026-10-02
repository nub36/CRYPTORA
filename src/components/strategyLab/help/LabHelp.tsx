/**
 * CRYPTORA — Strategy Lab · «Помощь» (frontend, RESEARCH ONLY)
 * ---------------------------------------------------------------------------
 * Постоянная кнопка «Помощь» + responsive модальный справочник по Лаборатории.
 * Контент — типизированные данные (./helpContent.ts), никакого гигантского
 * JSX. Модал ЛОКАЛЕН: открытие/закрытие не трогает черновик, dirty-состояние,
 * график или результат — страница под ним остаётся смонтированной.
 *
 * Это НЕ обучение: без Next/Back, прогресса, перетаскиваемого окна и квиза
 * (отдельная будущая фаза).
 */

import React, { useMemo, useState } from 'react';
import { BookOpenText, Search, X } from 'lucide-react';
import { searchHelpArticles } from './helpContent';

export const LabHelp: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const articles = useMemo(() => searchHelpArticles(query), [query]);

  return (
    <>
      <button
        type="button"
        data-qa="lab-help-button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-md border border-cyan-500/40 bg-cyan-500/15 px-3 py-2 text-[13px] font-semibold text-cyan-200 hover:bg-cyan-500/25"
      >
        <BookOpenText className="h-4 w-4" />
        Помощь
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="lab-help-title"
          data-qa="lab-help-modal"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 sm:p-6"
          onKeyDown={(event) => {
            if (event.key === 'Escape') setOpen(false);
          }}
        >
          <div className="flex max-h-[90vh] w-full max-w-3xl min-w-0 flex-col overflow-hidden rounded-lg border border-slate-600 bg-slate-950 shadow-2xl">
            <div className="flex items-center justify-between gap-2 border-b border-slate-700 p-4">
              <h2 id="lab-help-title" className="text-base font-bold text-white">
                Помощь по Лаборатории
              </h2>
              <button
                type="button"
                data-qa="lab-help-close"
                onClick={() => setOpen(false)}
                className="rounded border border-slate-600 px-3 py-1 text-xs text-slate-200 hover:bg-slate-800"
              >
                Закрыть
              </button>
            </div>

            <div className="border-b border-slate-800 p-3">
              <label className="relative block">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden />
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Поиск: RSI, Order Block, BOS, FVG…"
                  aria-label="Поиск по справке"
                  data-qa="lab-help-search"
                  className="w-full rounded-md border border-white/[0.1] bg-surface-2 py-2 pl-8 pr-8 text-[13px] text-white outline-none focus:border-cyan-500/50"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery('')}
                    aria-label="Очистить поиск"
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-white"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </label>
            </div>

            <div className="min-h-0 overflow-y-auto overflow-x-hidden p-4" data-qa="lab-help-content">
              {articles.length === 0 ? (
                <p className="py-6 text-center text-sm text-slate-400" data-qa="lab-help-empty">
                  Ничего не найдено. Попробуйте другой запрос — например «FVG» или «стоп».
                </p>
              ) : (
                <div className="space-y-6">
                  {articles.map((article) => (
                    <article key={article.id} data-qa="lab-help-article" data-help-article={article.id} className="min-w-0">
                      <h3 className="mb-2 text-[14px] font-bold text-cyan-200">{article.title}</h3>
                      <div className="space-y-2">
                        {article.paragraphs.map((paragraph, index) => (
                          <p key={index} className="text-[12.5px] leading-relaxed text-slate-300">
                            {paragraph}
                          </p>
                        ))}
                      </div>
                      {article.bullets && article.bullets.length > 0 && (
                        <ul className="mt-2 list-disc space-y-1 pl-5 text-[12.5px] text-slate-300">
                          {article.bullets.map((bullet, index) => (
                            <li key={index}>{bullet}</li>
                          ))}
                        </ul>
                      )}
                      {(article.examples ?? []).map((example) => (
                        <figure key={example.title} className="mt-3 min-w-0">
                          <figcaption className="mb-1 text-[11px] font-semibold tracking-wider text-slate-400">
                            {example.title}
                          </figcaption>
                          <pre className="overflow-x-auto rounded-md border border-white/[0.08] bg-slate-900 p-3 font-mono text-[11.5px] leading-relaxed text-emerald-200">
                            <code>{example.code}</code>
                          </pre>
                        </figure>
                      ))}
                    </article>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default LabHelp;

import React from 'react';
import { Link, useParams } from 'react-router-dom';
import { BookOpen, ArrowLeft, Megaphone } from 'lucide-react';
import { Badge } from '@/components/common/Badge';
import { ArticlesService } from '@/services/content/ArticlesService';
import { renderMarkdown } from '@/services/content/markdown';
import { SponsorSlot } from '@/components/ads/SponsorSlot';

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('ru-RU', { year: 'numeric', month: 'long', day: 'numeric' });

/** Статьи владельца из content/articles (собраны при сборке; внешних запросов нет). */
export const ArticlesPage: React.FC = () => {
  const { slug } = useParams<{ slug?: string }>();
  const articles = ArticlesService.list();
  const article = slug ? ArticlesService.get(slug) : null;

  if (slug && !article) {
    return (
      <div className="max-w-3xl mx-auto px-3 sm:px-4 py-10 text-center text-slate-400 text-sm font-sans" data-qa="article-not-found">
        Статья не найдена.{' '}
        <Link to="/articles" className="text-brand-cyan underline">
          К списку
        </Link>
      </div>
    );
  }

  if (article) {
    return (
      <article className="max-w-3xl mx-auto px-3 sm:px-4 py-3 space-y-4 font-sans text-sm" data-qa="article">
        <Link to="/articles" className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-white">
          <ArrowLeft className="w-3.5 h-3.5" /> Все статьи
        </Link>
        <header className="space-y-2 pb-3 border-b border-surface-border">
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
            <time dateTime={article.meta.date}>{fmtDate(article.meta.date)}</time>
            {article.meta.author && <span>· {article.meta.author}</span>}
            {article.meta.sponsored && (
              <Badge variant="amber" size="xs">
                Sponsored / Partner
              </Badge>
            )}
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-white">{article.meta.title}</h1>
          {article.meta.tags && (
            <div className="flex flex-wrap gap-1">
              {article.meta.tags.map((t) => (
                <span key={t} className="text-[11px] px-1.5 py-0.5 rounded bg-surface-elevated border border-surface-border text-slate-400">
                  {t}
                </span>
              ))}
            </div>
          )}
        </header>
        <div className="space-y-3">{renderMarkdown(article.body.replace(/^#\s+.+\n?/, ''))}</div>
        <footer className="pt-3 border-t border-surface-border text-[11px] text-slate-500">
          Материал носит информационный характер и не является инвестиционной рекомендацией. CRYPTORA не исполняет сделки.
        </footer>
      </article>
    );
  }

  return (
    <div className="space-y-6 max-w-[1920px] mx-auto px-3 sm:px-4 py-3">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-surface-border gap-2">
        <div>
          <div className="flex items-center space-x-2">
            <BookOpen className="w-5 h-5 text-brand-cyan" />
            <h1 className="text-lg sm:text-xl font-bold font-sans text-white tracking-wide">Статьи</h1>
            <Badge variant="cyan" size="sm">
              {articles.length}
            </Badge>
          </div>
          <p className="text-xs text-slate-400 font-sans mt-0.5">Методология терминала и заметки о рыночной структуре. Без прогнозов и торговых рекомендаций.</p>
        </div>
      </div>

      <SponsorSlot slot="articles-list" />

      {articles.length === 0 && (
        <div className="py-10 text-center text-slate-500 text-xs font-sans" data-qa="articles-empty">
          Статей пока нет.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {articles.map((a) => (
          <Link
            key={a.slug}
            to={`/articles/${a.slug}`}
            data-qa="article-card"
            className="block bg-surface border border-surface-border rounded-lg p-4 space-y-2 hover:border-brand-cyan/40 transition-colors font-sans"
          >
            <div className="flex items-center justify-between text-[11px] text-slate-500">
              <time dateTime={a.meta.date}>{fmtDate(a.meta.date)}</time>
              {a.meta.sponsored && (
                <span className="inline-flex items-center gap-1 text-amber-300">
                  <Megaphone className="w-3 h-3" /> Sponsored / Partner
                </span>
              )}
            </div>
            <h2 className="text-sm font-bold text-white leading-snug">{a.meta.title}</h2>
            {a.meta.summary && <p className="text-xs text-slate-400 leading-relaxed">{a.meta.summary}</p>}
          </Link>
        ))}
      </div>
    </div>
  );
};

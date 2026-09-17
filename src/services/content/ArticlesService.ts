import { parseFrontmatter, type ArticleFrontmatter } from './markdown';

/**
 * Статьи владельца (ROADMAP п. 6, решение владельца: собственные материалы в репозитории, без внешних лент).
 * Источник — `content/articles/*.md` → `articlesIndex.generated.ts` (scripts/build-articles-index.mjs, prebuild). Внешних запросов нет.
 */
export interface Article {
  slug: string;
  meta: ArticleFrontmatter;
  body: string;
}

import { ARTICLE_SOURCES } from './articlesIndex.generated';

export function slugFromPath(p: string): string {
  return p.split('/').pop()!.replace(/\.md$/, '');
}

export function buildArticles(sources: Record<string, string>): Article[] {
  return Object.entries(sources)
    .filter(([p]) => !slugFromPath(p).startsWith('_'))
    .map(([p, raw]) => {
      const parsed = parseFrontmatter(raw);
      return { slug: slugFromPath(p), meta: parsed.meta, body: parsed.body };
    })
    .sort((a, b) => b.meta.date.localeCompare(a.meta.date));
}

const ARTICLES = buildArticles(ARTICLE_SOURCES);

export class ArticlesService {
  public static list(): Article[] {
    return ARTICLES;
  }
  public static get(slug: string): Article | null {
    return ARTICLES.find((a) => a.slug === slug) ?? null;
  }
}

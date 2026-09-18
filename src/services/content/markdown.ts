/**
 * Минимальный безопасный markdown → React-дерево без зависимостей и без raw-HTML.
 * Поддержка: # / ## / ### заголовки, абзацы, списки (-, *, 1.), > цитаты, ``` код, **жирный**, *курсив*, `код`, [текст](https://…).
 * Любой HTML в исходнике экранируется React-ом автоматически (мы никогда не используем dangerouslySetInnerHTML).
 */
import React from 'react';

export interface ArticleFrontmatter {
  title: string;
  date: string; // ISO
  author?: string;
  summary?: string;
  tags?: string[];
  /** Обязателен для партнёрских/рекламных материалов (docs/MONETIZATION.md). */
  sponsored?: boolean;
}

export interface ParsedArticle {
  meta: ArticleFrontmatter;
  body: string;
}

/** Парсинг фронтматтера `---\nkey: value\n---`. Только плоские строки и tags через запятую. */
export function parseFrontmatter(src: string): ParsedArticle {
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  const meta: Record<string, string> = {};
  let body = src;
  if (m) {
    body = m[2];
    for (const line of m[1].split(/\r?\n/)) {
      const kv = line.match(/^([A-Za-z_]+):\s*(.*)$/);
      if (kv) meta[kv[1]] = kv[2].trim().replace(/^"(.*)"$/, '$1');
    }
  }
  const title = meta.title || (body.match(/^#\s+(.+)$/m)?.[1] ?? 'Без названия');
  return {
    meta: {
      title,
      date: meta.date || '1970-01-01',
      author: meta.author || undefined,
      summary: meta.summary || undefined,
      tags: meta.tags ? meta.tags.split(',').map((t) => t.trim()).filter(Boolean) : undefined,
      sponsored: meta.sponsored === 'true',
    },
    body: body.trim(),
  };
}

const SAFE_HREF = /^(https?:\/\/|\/|#|mailto:)/i;

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g;
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(re)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push(text.slice(last, idx));
    const tok = m[0];
    const k = `${keyPrefix}-${i++}`;
    if (tok.startsWith('**')) out.push(React.createElement('strong', { key: k, className: 'text-white' }, tok.slice(2, -2)));
    else if (tok.startsWith('`')) out.push(React.createElement('code', { key: k, className: 'font-mono text-[0.95em] px-1 rounded bg-surface-elevated' }, tok.slice(1, -1)));
    else if (tok.startsWith('*')) out.push(React.createElement('em', { key: k }, tok.slice(1, -1)));
    else {
      const lm = tok.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/)!;
      const href = SAFE_HREF.test(lm[2]) ? lm[2] : '#';
      out.push(
        React.createElement(
          'a',
          { key: k, href, target: href.startsWith('http') ? '_blank' : undefined, rel: 'noopener noreferrer nofollow', className: 'text-brand-cyan underline underline-offset-2' },
          lm[1],
        ),
      );
    }
    last = idx + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function renderMarkdown(body: string): React.ReactNode[] {
  const lines = body.split(/\r?\n/);
  const nodes: React.ReactNode[] = [];
  let i = 0;
  let key = 0;
  const K = () => `md-${key++}`;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    if (line.startsWith('```')) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) buf.push(lines[i++]);
      i++;
      nodes.push(React.createElement('pre', { key: K(), className: 'font-mono text-[11px] p-3 rounded bg-surface-elevated border border-surface-border overflow-x-auto' }, buf.join('\n')));
      continue;
    }
    const h = line.match(/^(#{1,3})\s+(.+)$/);
    if (h) {
      const level = h[1].length;
      const cls = level === 1 ? 'text-lg font-bold text-white mt-2' : level === 2 ? 'text-base font-bold text-white mt-4' : 'text-sm font-bold text-white mt-3';
      nodes.push(React.createElement(`h${level + 1}`, { key: K(), className: cls }, renderInline(h[2], K())));
      i++;
      continue;
    }
    if (/^>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ''));
      nodes.push(React.createElement('blockquote', { key: K(), className: 'border-l-2 border-brand-cyan/50 pl-3 text-slate-400 italic' }, renderInline(buf.join(' '), K())));
      continue;
    }
    if (/^(-|\*|\d+\.)\s+/.test(line)) {
      const ordered = /^\d+\./.test(line);
      const items: React.ReactNode[] = [];
      while (i < lines.length && /^(-|\*|\d+\.)\s+/.test(lines[i])) {
        items.push(React.createElement('li', { key: K() }, renderInline(lines[i].replace(/^(-|\*|\d+\.)\s+/, ''), K())));
        i++;
      }
      nodes.push(React.createElement(ordered ? 'ol' : 'ul', { key: K(), className: `${ordered ? 'list-decimal' : 'list-disc'} list-inside space-y-1 text-slate-300` }, items));
      continue;
    }
    const buf: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,3}\s|>|```|(-|\*|\d+\.)\s)/.test(lines[i])) buf.push(lines[i++]);
    nodes.push(React.createElement('p', { key: K(), className: 'text-slate-300 leading-relaxed' }, renderInline(buf.join(' '), K())));
  }
  return nodes;
}

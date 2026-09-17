import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseFrontmatter, renderMarkdown } from '@/services/content/markdown';
import { buildArticles, ArticlesService } from '@/services/content/ArticlesService';
import { execFileSync } from 'node:child_process';

describe('markdown (owner articles)', () => {
  it('parses frontmatter and falls back to H1 title', () => {
    const a = parseFrontmatter('---\ntitle: T\ndate: 2026-09-17\ntags: a, b\nsponsored: true\n---\n# H\ntext');
    expect(a.meta).toMatchObject({ title: 'T', date: '2026-09-17', tags: ['a', 'b'], sponsored: true });
    expect(parseFrontmatter('# Only H1\nbody').meta.title).toBe('Only H1');
  });
  it('renders blocks/inline and escapes raw HTML, rejects javascript: links', () => {
    const html = renderToStaticMarkup(
      React.createElement(React.Fragment, null, renderMarkdown('## H2\n\npara **b** `c` [x](javascript:alert(1)) [ok](https://e.com)\n\n- i1\n- i2\n\n<script>alert(1)</script>')),
    );
    expect(html).toContain('<h3');
    expect(html).toContain('<strong');
    expect(html).toContain('<li>i1</li>');
    expect(html).toContain('href="#"');
    expect(html).toContain('href="https://e.com"');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('ArticlesService', () => {
  it('builds from sources, skips _prefixed, sorts by date desc', () => {
    const list = buildArticles({
      '/content/articles/_README.md': '# readme',
      '/content/articles/old.md': '---\ntitle: Old\ndate: 2025-01-01\n---\nx',
      '/content/articles/new.md': '---\ntitle: New\ndate: 2026-01-01\n---\ny',
    });
    expect(list.map((a) => a.slug)).toEqual(['new', 'old']);
  });
  it('generated index is up to date with content/articles', () => {
    expect(() => execFileSync('node', ['scripts/build-articles-index.mjs', '--check'], { stdio: 'pipe' })).not.toThrow();
  });
  it('repository articles contain no forbidden promotional wording', () => {
    for (const a of ArticlesService.list()) {
      expect(a.body).not.toMatch(/прибыльная стратегия|лучший сигнал|ожидаемая доходность|гарантир/i);
      expect(a.meta.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    expect(ArticlesService.list().length).toBeGreaterThan(0);
  });
});

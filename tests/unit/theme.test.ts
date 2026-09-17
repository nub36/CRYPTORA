import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  applyThemeToDocument,
  nextPreference,
  readStoredPreference,
  resolveTheme,
  THEME_STORAGE_KEY,
} from '@/theme/theme';

describe('theme: выбор и разрешение', () => {
  it('невалидное/пустое сохранённое значение → system', () => {
    expect(readStoredPreference(null)).toBe('system');
    expect(readStoredPreference({ getItem: () => null })).toBe('system');
    expect(readStoredPreference({ getItem: () => 'blue' })).toBe('system');
    expect(readStoredPreference({ getItem: () => 'light' })).toBe('light');
    expect(readStoredPreference({ getItem: () => { throw new Error('denied'); } })).toBe('system');
  });

  it('system следует за prefers-color-scheme, явный выбор — нет', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
    expect(resolveTheme('light', true)).toBe('light');
  });

  it('цикл переключателя dark → light → system → dark', () => {
    expect(nextPreference('dark')).toBe('light');
    expect(nextPreference('light')).toBe('system');
    expect(nextPreference('system')).toBe('dark');
  });

  it('applyThemeToDocument ставит класс, data-theme и color-scheme', () => {
    applyThemeToDocument(document, 'system', 'light');
    expect(document.documentElement.classList.contains('light')).toBe(true);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(document.documentElement.getAttribute('data-theme')).toBe('system');
    expect(document.documentElement.style.colorScheme).toBe('light');
    applyThemeToDocument(document, 'dark', 'dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('inline-скрипт index.html использует тот же ключ хранения', () => {
    const html = readFileSync('index.html', 'utf8');
    expect(html).toContain(`localStorage.getItem('${THEME_STORAGE_KEY}')`);
    expect(html).toContain("matchMedia('(prefers-color-scheme: dark)')");
  });
});

describe('theme: токены', () => {
  const css = readFileSync('src/index.css', 'utf8');
  const darkBlock = css.slice(css.indexOf(':root {'), css.indexOf('html.light {'));
  const lightBlock = css.slice(css.indexOf('html.light {'), css.indexOf('body {'));

  it('каждый цветовой токен DARK имеет пару в LIGHT', () => {
    const names = (b: string) => new Set([...b.matchAll(/--c-[a-z0-9-]+(?=:)/g)].map((m) => m[0]));
    const dark = names(darkBlock);
    const light = names(lightBlock);
    expect(dark.size).toBeGreaterThan(50);
    for (const n of dark) expect(light.has(n), `нет LIGHT-значения для ${n}`).toBe(true);
  });

  it('финансовая семантика (positive/negative/warning) не меняется между темами', () => {
    for (const v of ['--positive', '--negative', '--warning']) {
      expect(lightBlock.includes(`${v}:`)).toBe(false);
    }
  });

  it('в компонентах нет произвольных hex-фонов (bg-[#…]) — только токены', () => {
    const { execSync } = require('node:child_process') as typeof import('node:child_process');
    const out = execSync("grep -rn --include=*.tsx -E '\\-\\[#[0-9a-fA-F]{3,8}\\]' src || true").toString().trim();
    expect(out, out).toBe('');
  });
});

#!/usr/bin/env node
// Генерирует src/services/content/articlesIndex.generated.ts из content/articles/*.md (файлы с префиксом _ игнорируются).
// Запуск: npm run articles:index  (вызывается автоматически в prebuild). Тест articles.test.ts проверяет актуальность.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = 'content/articles';
const out = 'src/services/content/articlesIndex.generated.ts';
const files = readdirSync(dir).filter((f) => f.endsWith('.md') && !f.startsWith('_')).sort();
const entries = files.map((f) => `  ${JSON.stringify(f.replace(/\.md$/, ''))}: ${JSON.stringify(readFileSync(join(dir, f), 'utf8'))},`);
const body = `// АВТОГЕНЕРАЦИЯ — не редактировать. Источник: content/articles/*.md. Обновить: npm run articles:index\n/* eslint-disable */\nexport const ARTICLE_SOURCES: Record<string, string> = {\n${entries.join('\n')}\n};\n`;
if (process.argv.includes('--check')) {
  let current = '';
  try { current = readFileSync(out, 'utf8'); } catch {}
  if (current !== body) { console.error(`[articles:index] ${out} устарел — выполните npm run articles:index`); process.exit(1); }
  console.log('[articles:index] актуален'); process.exit(0);
}
writeFileSync(out, body);
console.log(`[articles:index] ${files.length} статей → ${out}`);

/**
 * CRYPTORA — Загрузка серверного ядра стратегий.
 *
 * Собирает `entry.ts` (+ его TS-зависимости из src/) в один ESM-файл через
 * esbuild и импортирует его. Так сервер переиспользует НАСТОЯЩИЕ определения
 * стратегий вместо ручного пересказа формул.
 *
 * Никакого «тихого» резервного пути: если собрать не удалось, ошибка
 * пробрасывается наверх и стратегия помечается ошибкой. Молчаливый фолбэк на
 * заглушку запрещён.
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const HERE = path.dirname(new URL(import.meta.url).pathname);
const ENTRY = path.join(HERE, 'entry.ts');
const OUT_DIR = path.join(HERE, '.generated');
const OUT_FILE = path.join(OUT_DIR, 'strategyCore.mjs');
const ROOT = path.resolve(HERE, '../../..');

let cached = null;

/**
 * Свеж ли артефакт: сравниваем mtime бандла со всеми TS-исходниками, которые
 * могли повлиять. Грубо (по всему src/services), но безопасно: лишний
 * пересбор дешевле устаревшей математики.
 */
function isFresh() {
  if (!fs.existsSync(OUT_FILE)) return false;
  const builtAt = fs.statSync(OUT_FILE).mtimeMs;
  const roots = [path.join(ROOT, 'src/services')];
  const stack = [...roots];
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) stack.push(full);
      else if (/\.tsx?$/.test(ent.name) && fs.statSync(full).mtimeMs > builtAt) return false;
    }
  }
  return fs.statSync(ENTRY).mtimeMs <= builtAt;
}

async function build() {
  const esbuild = require('esbuild');
  fs.mkdirSync(OUT_DIR, { recursive: true });
  await esbuild.build({
    entryPoints: [ENTRY],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    outfile: OUT_FILE,
    alias: { '@': path.join(ROOT, 'src') },
    external: ['react', 'react-dom'],
    logLevel: 'error',
  });
}

/**
 * @returns {Promise<{
 *   LiveSignalEngine: any, SignalsAuditLedger: any,
 *   validateSetupGeometry: Function, ohlcvToArchive: Function,
 *   ohlcvArrayToArchive: Function, ARCHIVE_TF_MS: Record<string, number>
 * }>}
 */
export async function loadStrategyCore() {
  if (cached) return cached;
  if (!isFresh()) await build();
  // cache-busting: Node кэширует модули по URL, а бандл пересобирается.
  const mod = await import(`${pathToFileURL(OUT_FILE).href}?v=${Date.now()}`);
  cached = mod;
  return mod;
}

export const __internals = { isFresh, build, OUT_FILE, OUT_DIR };

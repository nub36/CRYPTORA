/**
 * CRYPTORA — Strategy Lab · загрузка исследовательского ядра (RESEARCH ONLY)
 * ---------------------------------------------------------------------------
 * Собирает labEntry.ts (+ его TS-зависимости из src/services/strategyLab) в один
 * ESM-файл через esbuild и импортирует его. Так СЕРВЕР исполняет ровно те же
 * формулы, что описаны в src/ (единый источник истины Lab), а React их не считает.
 *
 * Изоляция:
 *   • это ОТДЕЛЬНЫЙ бандл от production strategyCoreBundle.js — production ядро
 *     не трогается;
 *   • артефакт пишется во ВРЕМЕННЫЙ каталог ОС (os.tmpdir()), а НЕ в репозиторий:
 *     ничего не попадает в git и не требует правки .gitignore;
 *   • esbuild — уже установленная транзитивная зависимость vite (нового пакета
 *     не добавляем).
 *
 * Без «тихого» фолбэка: если собрать не удалось, ошибка пробрасывается наверх и
 * endpoint честно вернёт 5xx, а не подставит заглушку.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const HERE = path.dirname(new URL(import.meta.url).pathname);
const ENTRY = path.join(HERE, 'labEntry.ts');
const ROOT = path.resolve(HERE, '../../..');
const SRC_LAB = path.join(ROOT, 'src/services/strategyLab');

const OUT_DIR = path.join(os.tmpdir(), 'cryptora-strategy-lab');
const OUT_FILE = path.join(OUT_DIR, 'labCore.mjs');

let cached = null;
let building = null;

/** Самая свежая mtime среди исходников, влияющих на бандл. */
function latestSourceMtime() {
  let latest = 0;
  const consider = (file) => {
    try {
      const m = fs.statSync(file).mtimeMs;
      if (m > latest) latest = m;
    } catch {
      /* файл мог исчезнуть между сканом и stat — пропускаем */
    }
  };
  consider(ENTRY);
  const stack = [SRC_LAB];
  while (stack.length > 0) {
    const dir = stack.pop();
    let ents;
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of ents) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) stack.push(full);
      else if (/\.tsx?$/.test(ent.name)) consider(full);
    }
  }
  return latest;
}

function isFresh() {
  if (!fs.existsSync(OUT_FILE)) return false;
  return fs.statSync(OUT_FILE).mtimeMs >= latestSourceMtime();
}

function loadEsbuild() {
  try {
    return require('esbuild');
  } catch (e) {
    throw new Error(
      'esbuild недоступен: исследовательское ядро Strategy Lab собирается из src/ через esbuild ' +
        '(транзитивная зависимость vite). Установите зависимости полностью: `npm ci`. ' +
        `Причина: ${e instanceof Error ? e.message : String(e)}`
    );
  }
}

async function build() {
  const esbuild = loadEsbuild();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const tmpFile = `${OUT_FILE}.${process.pid}.${Date.now()}.tmp`;
  try {
    await esbuild.build({
      entryPoints: [ENTRY],
      bundle: true,
      format: 'esm',
      platform: 'node',
      target: 'node20',
      outfile: tmpFile,
      alias: { '@': path.join(ROOT, 'src') },
      external: ['react', 'react-dom'],
      logLevel: 'error',
    });
    fs.renameSync(tmpFile, OUT_FILE);
  } finally {
    if (fs.existsSync(tmpFile)) fs.rmSync(tmpFile, { force: true });
  }
}

function buildOnce() {
  if (!building) {
    building = build().finally(() => {
      building = null;
    });
  }
  return building;
}

/**
 * @returns {Promise<{
 *   runLabReplay: Function,
 *   UnknownLabStrategyError: Function,
 *   LAB_STRATEGIES: any[],
 *   getLabStrategy: Function,
 *   isKnownLabStrategy: Function,
 *   defaultResearchConfig: Function,
 *   validateStrategyGraph: Function,
 *   formatGraphErrors: Function,
 *   compileGraphToDraftDefinition: Function,
 *   createEmaTrendTemplate: Function,
 *   GRAPH_LIMITS: Record<string, number>,
 *   GRAPH_SCHEMA_VERSION: number,
 *   BLOCK_GRAPH_ID: string,
 *   EMA_ATR_ID: string,
 *   LAB_TIMEFRAMES: string[],
 *   LAB_TF_SECONDS: Record<string, number>,
 *   LAB_MAX_CANDLES: number,
 * }>}
 */
export async function loadLabCore() {
  if (cached) return cached;
  if (!isFresh()) await buildOnce();
  // ?v=mtime — чтобы Node не отдал устаревший модуль из кэша после пересборки.
  const url = `${pathToFileURL(OUT_FILE).href}?v=${fs.statSync(OUT_FILE).mtimeMs}`;
  const mod = await import(url);
  cached = mod;
  return mod;
}

/** Тестовый seam: сбросить кэш загруженного модуля. */
export function __resetLabCoreForTests() {
  cached = null;
}

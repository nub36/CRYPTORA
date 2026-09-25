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

/**
 * esbuild — инструмент сборки ядра. Он приходит транзитивно через `vite`,
 * поэтому установка без dev-зависимостей (`npm ci --omit=dev`) оставляет сервер
 * без возможности собрать ядро. Сообщение об этом явное: молчаливый
 * MODULE_NOT_FOUND из require() не объясняет, что сломано и как чинить.
 */
function loadEsbuild() {
  try {
    return require('esbuild');
  } catch (e) {
    throw new Error(
      'esbuild недоступен: серверное ядро стратегий собирается из src/ через esbuild ' +
        '(транзитивная зависимость vite). Установите зависимости полностью: `npm ci`. ' +
        `Причина: ${e instanceof Error ? e.message : String(e)}`
    );
  }
}

/**
 * Сборка с АТОМАРНОЙ записью.
 *
 * esbuild пишет outfile напрямую. Если в этот момент другой процесс/воркер
 * (vitest запускает файлы параллельно, systemd может перезапустить сервис)
 * импортирует OUT_FILE, он читает наполовину записанный модуль и падает с
 * SyntaxError — при этом артефакт остаётся «свежим» по mtime, и ошибка
 * воспроизводится до ручной очистки кэша. Запись во временный файл + rename
 * (атомарен в пределах ФС) убирает это окно.
 */
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
    // Недописанный временный файл не должен оставаться: это мусор в .generated.
    if (fs.existsSync(tmpFile)) fs.rmSync(tmpFile, { force: true });
  }
}

/**
 * @returns {Promise<{
 *   LiveSignalEngine: any, SignalsAuditLedger: any,
 *   validateSetupGeometry: Function, ohlcvToArchive: Function,
 *   ohlcvArrayToArchive: Function, ARCHIVE_TF_MS: Record<string, number>
 * }>}
 */
let building = null;

/** Одна сборка на процесс: параллельные вызовы делят один Promise. */
function buildOnce() {
  if (!building) {
    building = build().finally(() => {
      building = null;
    });
  }
  return building;
}

/**
 * Одна ЗАГРУЗКА на процесс: параллельные вызовы делят один Promise.
 *
 * ПОЧЕМУ ЭТОГО НЕ ХВАТАЛО. Раньше `cached` присваивался только ПОСЛЕ
 * `await import(...)`, поэтому два одновременных вызова на холодном старте
 * оба видели `cached === null`, оба доходили до `import()` и получали РАЗНЫЕ
 * объекты модуля: URL содержит `?v=${Date.now()}` специально, чтобы Node не
 * отдал устаревший бандл из кэша модулей.
 *
 * А раз объектов модуля два — то и статические синглтоны `LiveSignalEngine` /
 * `SignalsAuditLedger` в них РАЗНЫЕ. Скан, получивший первый модуль, и скан,
 * получивший второй, перестают делить состояние — и вопрос «общее ли у этих
 * двух сканов состояние» начинает зависеть от порядка запуска, а не от кода.
 * Именно на таком неявном разделении и держится класс инцидента 2026-09-24:
 * часть сканов работала с одной статикой, часть — с другой.
 *
 * Теперь загрузка single-flight целиком: все сканы гарантированно получают
 * ОДИН объект модуля.
 */
let loading = null;

function loadOnce() {
  if (!loading) {
    loading = importCore().finally(() => {
      loading = null;
    });
  }
  return loading;
}

async function importCore() {
  if (!isFresh()) await buildOnce();

  // cache-busting: Node кэширует модули по URL, а бандл пересобирается.
  const url = () => `${pathToFileURL(OUT_FILE).href}?v=${Date.now()}`;
  try {
    return await import(url());
  } catch (firstError) {
    /**
     * Артефакт мог остаться битым от предыдущего падения процесса (запись
     * прервана, диск полон, сборка убита по таймауту). Пересобираем один раз;
     * если и это не помогло — ошибка пробрасывается наружу вместе с причиной.
     * Фолбэка на заглушку нет: молчаливая подмена ядра запрещена.
     */
    await buildOnce();
    try {
      return await import(url());
    } catch (secondError) {
      throw new Error(
        'Не удалось загрузить скомпилированное ядро стратегий после пересборки. ' +
          `Первая ошибка: ${firstError instanceof Error ? firstError.message : String(firstError)}; ` +
          `вторая: ${secondError instanceof Error ? secondError.message : String(secondError)}`,
      );
    }
  }
}

export async function loadStrategyCore() {
  if (cached) return cached;
  const mod = await loadOnce();
  cached = mod;
  return mod;
}

export const __internals = { isFresh, build, OUT_FILE, OUT_DIR };

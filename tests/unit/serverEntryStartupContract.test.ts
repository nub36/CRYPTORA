/**
 * CRYPTORA — production-entry startup contract.
 *
 * Производственный инцидент (hotfix после 5726732): server/index.js вызывал
 * getNotificationRedeliveryWorker(), НЕ импортируя эту функцию → ReferenceError
 * в рантайме («[CRYPTORA] Notification redelivery worker failed to start:
 * getNotificationRedeliveryWorker is not defined»). Воркер не стартовал, но
 * try/catch поглотил ошибку — сервер продолжал работать с мёртвой доставкой.
 *
 * Почему это не поймали existing-гейты: typecheck не проверяет server/index.js
 * (JavaScript без checkJs), а vitest не импортирует index.js (он стартует
 * серверы/пул/мониторы). Ошибка проявлялась только на реальном production-startup.
 *
 * Этот контракт закрывает КЛАСС ошибок статически, без запуска сервера:
 *  1) каждый идентификатор в теле index.js, совпадающий с именем экспорта
 *     любого локального модуля server/**, обязан быть импортирован или объявлен
 *     локально — иначе production-startup упадёт с ReferenceError;
 *  2) каждое имя, импортированное index.js из локального модуля, реально
 *     экспортируется этим модулем (иначе undefined → TypeError при вызове);
 *  3) регрессия redelivery-wiring: getNotificationRedeliveryWorker импортирован
 *     из правильного модуля и вызывается в start- и stop-путях;
 *  4) singleton-фабрика (путь, которым index.js получает воркер) возвращает
 *     один экземпляр; статус без запуска валиден.
 */

import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  NotificationRedeliveryWorker,
  getNotificationRedeliveryWorker,
  resetNotificationRedeliveryWorker,
  notificationRedeliveryStatus,
} from '../../server/services/notificationRedelivery.js';

const SERVER_DIR = path.resolve(__dirname, '../../server');
const ENTRY = path.join(SERVER_DIR, 'index.js');

/** Идентификатор JS (без флага g — для безопасного .test()). */
const IDENT_SRC = '[A-Za-z_$][A-Za-z0-9_$]*';
const IDENT = new RegExp(`^${IDENT_SRC}$`);

/** Все .js-файлы server/** (кроме .d.ts и генерации esbuild). */
function listServerJsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.endsWith('.d.ts')) continue;
    if (entry.name === '.generated') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listServerJsFiles(full, out);
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

/** Экспортируемые имена ES-модуля (по исходнику). */
function exportNames(src: string): Set<string> {
  const names = new Set<string>();
  for (const m of src.matchAll(
    /export\s+(?:default\s+)?(?:async\s+)?(?:function\s*\*?|class|const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g
  )) {
    names.add(m[1]);
  }
  for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(',')) {
      const name = part.split(/\s+as\s+/)[0].trim();
      if (IDENT.test(name)) names.add(name);
    }
  }
  return names;
}

interface ImportInfo {
  /** Спецификатор модуля. */
  module: string;
  /** Имена ДО псевдонима — проверяются против экспортов модуля. */
  exported: Set<string>;
  /** Локальные имена (после as / default / namespace) — видны в теле index.js. */
  local: Set<string>;
}

/** import-декларации index.js. */
function parseImports(src: string): ImportInfo[] {
  const out: ImportInfo[] = [];
  for (const m of src.matchAll(/import\s+([^'";]+?)\s+from\s*['"]([^'"]+)['"]/g)) {
    const clause = m[1];
    const exported = new Set<string>();
    const local = new Set<string>();

    const ns = clause.match(/\*\s+as\s+([A-Za-z_$][A-Za-z0-9_$]*)/);
    if (ns) local.add(ns[1]);

    const braced = clause.match(/\{([^}]*)\}/);
    if (braced) {
      for (const part of braced[1].split(',')) {
        const seg = part.trim();
        if (!seg) continue;
        const [orig, alias] = seg.split(/\s+as\s+/);
        if (IDENT.test(orig)) exported.add(orig);
        local.add(alias && IDENT.test(alias) ? alias : orig);
      }
    }

    // default-импорт: идентификатор до '{' или ','
    const leading = clause.split(/[{,]/)[0].trim();
    if (leading && IDENT.test(leading)) local.add(leading);

    out.push({ module: m[2], exported, local });
  }
  return out;
}

/** Тело файла: без import-строк, комментариев, строковых литералов и property-access. */
function cleanBody(src: string): string {
  return src
    .replace(/import\s+[^'";]+?\s+from\s*['"][^'"]+['"]/g, ' ')
    .replace(/import\s*['"][^'"]+['"]/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/'(?:\\.|[^'\\\n])*'/g, ' ')
    .replace(/"(?:\\.|[^"\\\n])*"/g, ' ')
    .replace(/`(?:\\.|[^`\\])*`/g, (t) => (t.match(/\$\{[^}]*\}/g) || []).join(' '))
    .replace(/\.[A-Za-z_$][A-Za-z0-9_$]*/g, ' ');
}

/** Имена, объявленные в самом index.js (переменные/функции/параметры/catch). */
function declaredNames(body: string): Set<string> {
  const names = new Set<string>();
  const addParams = (list: string): void => {
    for (const p of list.split(',')) {
      const seg = p.split('=')[0].trim();
      if (IDENT.test(seg)) names.add(seg);
    }
  };
  for (const m of body.matchAll(/(?:const|let|var|class|function)\s+\*?\s*([A-Za-z_$][A-Za-z0-9_$]*)/g)) {
    names.add(m[1]);
  }
  for (const m of body.matchAll(/function\s*\*?\s*[A-Za-z_$][A-Za-z0-9_$]*\s*\(([^)]*)\)/g)) {
    addParams(m[1]);
  }
  for (const m of body.matchAll(/\(([^()]*)\)\s*=>/g)) addParams(m[1]);
  for (const m of body.matchAll(/catch\s*\(\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*\)/g)) names.add(m[1]);
  return names;
}

/** Стандартные глобали Node (не могут быть «забытым import»). */
const JS_GLOBALS = new Set([
  'process', 'console', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
  'queueMicrotask', 'fetch', 'Response', 'URL', 'Promise', 'Error', 'Date', 'JSON', 'Math',
]);

describe('Production-entry startup contract — server/index.js', () => {
  it('каждый используемый идентификатор из экспортов локальных модулей импортирован (анти-ReferenceError)', () => {
    const entrySrc = fs.readFileSync(ENTRY, 'utf8');
    const imports = parseImports(entrySrc);
    const body = cleanBody(entrySrc);
    const declared = declaredNames(body);
    const bodyTokens = new Set(body.match(new RegExp(IDENT_SRC, 'g')) ?? []);

    const importedLocal = new Set<string>();
    for (const imp of imports) for (const n of imp.local) importedLocal.add(n);

    const allExports = new Set<string>();
    for (const f of listServerJsFiles(SERVER_DIR)) {
      for (const n of exportNames(fs.readFileSync(f, 'utf8'))) allExports.add(n);
    }

    const suspects = [...allExports].filter(
      (n) => !importedLocal.has(n) && !declared.has(n) && !JS_GLOBALS.has(n) && bodyTokens.has(n)
    );
    expect(
      suspects,
      `server/index.js использует имена локальных модулей без import — это runtime ReferenceError (см. инцидент getNotificationRedeliveryWorker): ${suspects.join(', ')}`
    ).toEqual([]);
  });

  it('каждое имя, импортированное из локального модуля, реально экспортируется им (анти-undefined)', () => {
    const entrySrc = fs.readFileSync(ENTRY, 'utf8');
    for (const imp of parseImports(entrySrc)) {
      if (!imp.module.startsWith('.')) continue; // node-builtin / пакетные import не проверяем
      const file = path.resolve(SERVER_DIR, imp.module);
      expect(fs.existsSync(file), `локальный модуль не найден: ${imp.module}`).toBe(true);
      const exported = exportNames(fs.readFileSync(file, 'utf8'));
      const missing = [...imp.exported].filter((n) => !exported.has(n));
      expect(missing, `${imp.module} не экспортирует: ${missing.join(', ')}`).toEqual([]);
    }
  });

  it('REGRESSION: redelivery-wiring — import + start() + stop() через singleton-фабрику', () => {
    const src = fs.readFileSync(ENTRY, 'utf8');
    expect(
      src,
      'getNotificationRedeliveryWorker обязан импортироваться из ./services/notificationRedelivery.js (инцидент 5726732)'
    ).toMatch(
      /import\s*\{[^}]*getNotificationRedeliveryWorker[^}]*\}\s*from\s*['"]\.\/services\/notificationRedelivery\.js['"]/
    );
    expect(src).toContain('getNotificationRedeliveryWorker().start()');
    expect(src).toContain('getNotificationRedeliveryWorker().stop()');
  });
});

describe('NotificationRedeliveryWorker singleton (путь index.js)', () => {
  afterAll(() => {
    resetNotificationRedeliveryWorker();
  });

  it('фабрика возвращает один экземпляр воркера; reset — новый; статус до старта валиден', () => {
    resetNotificationRedeliveryWorker();
    const a = getNotificationRedeliveryWorker();
    expect(getNotificationRedeliveryWorker()).toBe(a);
    expect(a).toBeInstanceOf(NotificationRedeliveryWorker);
    expect(notificationRedeliveryStatus().running).toBe(false);

    resetNotificationRedeliveryWorker();
    const b = getNotificationRedeliveryWorker();
    expect(b).not.toBe(a);
    expect(notificationRedeliveryStatus().running).toBe(false);
  });
});

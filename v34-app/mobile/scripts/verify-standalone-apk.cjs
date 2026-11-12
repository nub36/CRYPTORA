#!/usr/bin/env node
/**
 * Проверка, что APK — самостоятельный: JS bundle ВНУТРИ, Metro не нужен.
 *
 * Зачем отдельный скрипт, а не «сборка прошла — значит, ок»: ровно так и
 * появился дефект «Unable to load script». Debug-вариант собирается без bundle
 * и ищет Metro по сети; установленный на телефон APK в этом случае показывает
 * ошибку загрузки скрипта.
 *
 * Скрипт читает APK как обычный zip (без внешних зависимостей) и проверяет:
 *   1. это валидный zip и в нём есть AndroidManifest.xml;
 *   2. есть assets/index.android.bundle (JS bundle/Hermes-байткод);
 *   3. bundle не пустой и не «заглушка» (минимальный размер);
 *   4. содержимое действительно является Hermes-байткодом или JS-текстом;
 *   5. в APK есть classes.dex (код приложения), то есть это не пустая оболочка.
 *
 * Использование:
 *   node scripts/verify-standalone-apk.cjs android/app/build/outputs/apk/release/app-release.apk
 *   node scripts/verify-standalone-apk.cjs app-release.apk --min-bundle-bytes 200000
 *   node scripts/verify-standalone-apk.cjs app-release.apk --json
 *
 * Код возврата: 0 — APK самостоятельный, 1 — проверка не пройдена, 2 — ошибка
 * вызова/чтения файла.
 */
'use strict';

const fs = require('node:fs');
const zlib = require('node:zlib');

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

/** 'assets/index.android.bundle' — путь JS bundle в APK (RN/Expo). */
const BUNDLE_ENTRY = 'assets/index.android.bundle';
const MANIFEST_ENTRY = 'AndroidManifest.xml';
const DEX_ENTRY = 'classes.dex';
const DEFAULT_MIN_BUNDLE_BYTES = 100_000;

/** Магия Hermes bytecode: c6 1f bc 03. */
const HERMES_MAGIC = Buffer.from([0xc6, 0x1f, 0xbc, 0x03]);

function findEocd(buf) {
  if (buf.length < 22) return -1;
  const min = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  return -1;
}

/**
 * Читает центральный каталог zip. Возвращает список записей с размерами и
 * смещением локального заголовка. Zip64 сознательно не поддерживается: APK
 * такого размера не собирается, а молча «не увидеть» bundle было бы хуже
 * ошибки.
 */
function readZipEntries(buf) {
  const eocd = findEocd(buf);
  if (eocd < 0) throw new Error('EOCD не найден — это не zip-архив');
  const total = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (total === 0xffff || cdOffset === 0xffffffff) {
    throw new Error('zip64 не поддерживается этой проверкой');
  }
  const entries = [];
  let p = cdOffset;
  for (let i = 0; i < total; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CENTRAL_SIG) {
      throw new Error(`повреждён центральный каталог (запись ${i})`);
    }
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    if (p + 46 + nameLen > buf.length) throw new Error('имя записи выходит за пределы файла');
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    entries.push({ name, method, compressedSize, size, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Распаковывает одну запись (stored или deflate). Другие методы — ошибка. */
function extractEntry(buf, entry) {
  const p = entry.localOffset;
  if (p + 30 > buf.length || buf.readUInt32LE(p) !== LOCAL_SIG) {
    throw new Error(`повреждён локальный заголовок записи ${entry.name}`);
  }
  const nameLen = buf.readUInt16LE(p + 26);
  const extraLen = buf.readUInt16LE(p + 28);
  const start = p + 30 + nameLen + extraLen;
  const end = start + entry.compressedSize;
  if (end > buf.length) throw new Error(`данные записи ${entry.name} выходят за пределы файла`);
  const raw = buf.subarray(start, end);
  if (entry.method === 0) return Buffer.from(raw);
  if (entry.method === 8) {
    return zlib.inflateRawSync(raw, { maxOutputLength: Math.max(entry.size, 1) * 8 + 1024 });
  }
  throw new Error(`неподдерживаемый метод сжатия ${entry.method} у ${entry.name}`);
}

/** Hermes-байткод или текстовый JS — и ничего больше. */
function classifyBundle(buf) {
  if (buf.length >= 4 && buf.subarray(0, 4).equals(HERMES_MAGIC)) return 'hermes';
  const head = buf.subarray(0, Math.min(buf.length, 8192)).toString('utf8');
  if (/__d\(|use strict|var |const |let |function |global\.|import /.test(head)) return 'javascript';
  return 'unknown';
}

/**
 * Полная проверка. `buffer` — содержимое APK.
 * @returns {{ok: boolean, checks: Array<{id: string, title: string, ok: boolean, detail: string}>, bundle: null | {entry: string, size: number, kind: string}}}
 */
function inspectApk(buffer, options) {
  const opts = options || {};
  const minBundleBytes = Number.isInteger(opts.minBundleBytes) && opts.minBundleBytes >= 0
    ? opts.minBundleBytes
    : DEFAULT_MIN_BUNDLE_BYTES;
  const checks = [];
  const add = (id, title, ok, detail) => checks.push({ id, title, ok: Boolean(ok), detail });
  let entries = null;

  try {
    entries = readZipEntries(buffer);
    add('zip', 'APK — валидный zip-архив', entries.length > 0, `${entries.length} записей`);
  } catch (e) {
    add('zip', 'APK — валидный zip-архив', false, e instanceof Error ? e.message : String(e));
  }

  const find = (name) => (entries ? entries.find((entry) => entry.name === name) : null);

  add(
    'manifest',
    'AndroidManifest.xml присутствует',
    Boolean(find(MANIFEST_ENTRY)),
    MANIFEST_ENTRY,
  );
  add('dex', 'classes.dex присутствует', Boolean(find(DEX_ENTRY)), DEX_ENTRY);

  const bundleEntry = find(BUNDLE_ENTRY);
  let bundle = null;
  if (!bundleEntry) {
    add(
      'bundle',
      'JS bundle встроен в APK',
      false,
      `${BUNDLE_ENTRY} отсутствует — такой APK требует Metro (` +
        '"Unable to load script"). Соберите release-вариант (assembleRelease), а не debug.',
    );
  } else {
    try {
      const data = extractEntry(buffer, bundleEntry);
      const kind = classifyBundle(data);
      bundle = { entry: BUNDLE_ENTRY, size: data.length, kind };
      add('bundle', 'JS bundle встроен в APK', true, `${BUNDLE_ENTRY}: ${data.length} Б, ${kind}`);
      add(
        'bundle-size',
        `Размер bundle не меньше ${minBundleBytes} Б`,
        data.length >= minBundleBytes,
        `${data.length} Б (порог ${minBundleBytes} Б)`,
      );
      add(
        'bundle-js',
        'Содержимое bundle — Hermes-байткод или JS',
        kind !== 'unknown',
        kind === 'unknown' ? 'содержимое не похоже ни на Hermes, ни на JS' : `определено как ${kind}`,
      );
    } catch (e) {
      bundle = { entry: BUNDLE_ENTRY, size: 0, kind: 'unknown' };
      add('bundle', 'JS bundle встроен в APK', false, e instanceof Error ? e.message : String(e));
    }
  }

  return { ok: checks.every((c) => c.ok), checks, bundle };
}

function parseArgs(argv) {
  const args = { file: null, minBundleBytes: DEFAULT_MIN_BUNDLE_BYTES, json: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--min-bundle-bytes') {
      args.minBundleBytes = Number(argv[++i]);
    } else if (arg === '--json') {
      args.json = true;
    } else if (arg.startsWith('--')) {
      throw new Error(`неизвестный параметр ${arg}`);
    } else if (!args.file) {
      args.file = arg;
    } else {
      throw new Error(`лишний аргумент ${arg}`);
    }
  }
  if (!args.file) throw new Error('нужен путь к APK');
  if (!Number.isInteger(args.minBundleBytes) || args.minBundleBytes < 0) {
    throw new Error('--min-bundle-bytes: целое число ≥ 0');
  }
  return args;
}

function main(argv) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (e) {
    console.error(`verify-standalone-apk: ${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }
  let buffer;
  try {
    buffer = fs.readFileSync(args.file);
  } catch (e) {
    console.error(`verify-standalone-apk: не удалось прочитать ${args.file}: ${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }

  const result = inspectApk(buffer, { minBundleBytes: args.minBundleBytes });
  if (args.json) {
    console.log(JSON.stringify({ file: args.file, ...result }, null, 2));
  } else {
    console.log(`Проверка standalone APK: ${args.file}`);
    for (const check of result.checks) {
      console.log(`${check.ok ? '[OK]  ' : '[FAIL]'} ${check.title} — ${check.detail}`);
    }
    console.log(result.ok
      ? 'ИТОГ: APK самостоятельный — JS bundle внутри, Metro не требуется.'
      : 'ИТОГ: APK НЕ является самостоятельным.');
  }

  if (process.env.GITHUB_ACTIONS === 'true') {
    for (const check of result.checks) {
      const line = `title=Standalone APK: ${check.title}::${check.detail}`.replace(/[\r\n]+/g, ' ');
      console.log(check.ok ? `::notice ${line}` : `::error ${line}`);
    }
  }

  return result.ok ? 0 : 1;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = {
  BUNDLE_ENTRY,
  DEFAULT_MIN_BUNDLE_BYTES,
  HERMES_MAGIC,
  classifyBundle,
  extractEntry,
  inspectApk,
  readZipEntries,
};

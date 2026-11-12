/**
 * Standalone APK: проверка «JS bundle внутри» и защита CI от регрессии.
 *
 * Дефект, который эти тесты закрывают: установленный APK показывал
 * «Unable to load script» и требовал Metro, потому что workflow собирал
 * debug-вариант. Теперь CI собирает release, а скрипт проверки обязан находить
 * bundle в архиве. Здесь проверяется сам скрипт (на синтетических zip) и то, что
 * CI-конфигурация не вернулась к debug-сборке.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

interface VerifierCheck { id: string; ok: boolean; detail: string }
interface VerifierResult {
  ok: boolean;
  checks: VerifierCheck[];
  bundle: { entry: string; size: number; kind: string } | null;
}
interface Verifier {
  inspectApk(buffer: Buffer, options?: { minBundleBytes?: number }): VerifierResult;
  HERMES_MAGIC: Buffer;
}

const verifier = require('../scripts/verify-standalone-apk.cjs') as Verifier;

interface ZipInput { name: string; data: Buffer; method?: 0 | 8 }

/** Минимальный zip-писатель для тестов: stored и deflate. */
function buildZip(entries: ZipInput[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const method = entry.method ?? 8;
    const payload = method === 8 ? zlib.deflateRawSync(entry.data) : entry.data;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, payload);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(0, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + payload.length;
  }

  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, centralBuf, eocd]);
}

const JS_BUNDLE = Buffer.from(`var __d=function(module,exports){return module.exports};// ${'x'.repeat(500)}`);
const MANIFEST = Buffer.from('binary-android-manifest');
const DEX = Buffer.from('dex\n035\0');

function standaloneZip(bundle: Buffer = JS_BUNDLE, extra: ZipInput[] = []): Buffer {
  return buildZip([
    { name: 'AndroidManifest.xml', data: MANIFEST },
    { name: 'classes.dex', data: DEX },
    { name: 'assets/index.android.bundle', data: bundle },
    ...extra,
  ]);
}

function check(result: VerifierResult, id: string): VerifierCheck {
  const found = result.checks.find((c) => c.id === id);
  if (!found) throw new Error(`в результате нет проверки ${id}`);
  return found;
}

describe('проверка standalone APK', () => {
  it('APK с JS bundle внутри считается самостоятельным', () => {
    const result = verifier.inspectApk(standaloneZip(), { minBundleBytes: 100 });
    expect(result.ok).toBe(true);
    expect(result.bundle).toMatchObject({ entry: 'assets/index.android.bundle', kind: 'javascript' });
    for (const id of ['zip', 'manifest', 'dex', 'bundle', 'bundle-size', 'bundle-js']) {
      expect(check(result, id).ok).toBe(true);
    }
  });

  it('Hermes-байткод (release Expo) принимается как bundle', () => {
    const hermes = Buffer.concat([verifier.HERMES_MAGIC, Buffer.alloc(4096, 7)]);
    const result = verifier.inspectApk(standaloneZip(hermes), { minBundleBytes: 1000 });
    expect(result.ok).toBe(true);
    expect(result.bundle?.kind).toBe('hermes');
  });

  it('stored-запись bundle (без сжатия) тоже читается', () => {
    const zip = buildZip([
      { name: 'AndroidManifest.xml', data: MANIFEST },
      { name: 'classes.dex', data: DEX },
      { name: 'assets/index.android.bundle', data: JS_BUNDLE, method: 0 },
    ]);
    expect(verifier.inspectApk(zip, { minBundleBytes: 100 }).ok).toBe(true);
  });

  it('APK без bundle — ошибка с объяснением про Metro', () => {
    const zip = buildZip([
      { name: 'AndroidManifest.xml', data: MANIFEST },
      { name: 'classes.dex', data: DEX },
    ]);
    const result = verifier.inspectApk(zip, { minBundleBytes: 100 });
    expect(result.ok).toBe(false);
    expect(result.bundle).toBeNull();
    const bundle = check(result, 'bundle');
    expect(bundle.ok).toBe(false);
    expect(bundle.detail).toContain('Unable to load script');
    expect(bundle.detail).toContain('Metro');
  });

  it('подозрительно маленький bundle не принимается', () => {
    const result = verifier.inspectApk(standaloneZip(Buffer.from('var x=1')), { minBundleBytes: 10_000 });
    expect(result.ok).toBe(false);
    expect(check(result, 'bundle-size').ok).toBe(false);
  });

  it('мусор вместо bundle не считается JS', () => {
    const result = verifier.inspectApk(standaloneZip(Buffer.alloc(2048, 0)), { minBundleBytes: 100 });
    expect(result.ok).toBe(false);
    expect(check(result, 'bundle-js').ok).toBe(false);
    expect(result.bundle?.kind).toBe('unknown');
  });

  it('не-zip файл отклоняется без исключения', () => {
    const result = verifier.inspectApk(Buffer.from('это не apk'), { minBundleBytes: 100 });
    expect(result.ok).toBe(false);
    expect(check(result, 'zip').ok).toBe(false);
  });
});

describe('конфигурация standalone-сборки', () => {
  const mobileDir = path.resolve(__dirname, '..');
  const appConfig = fs.readFileSync(path.join(mobileDir, 'app.config.js'), 'utf8');
  const pkg = JSON.parse(fs.readFileSync(path.join(mobileDir, 'package.json'), 'utf8')) as { version: string };
  const workflow = fs.readFileSync(
    path.resolve(mobileDir, '../../.github/workflows/v34-android-apk.yml'),
    'utf8',
  );

  it('package id и версия заданы в конфигурации Expo', () => {
    expect(appConfig).toContain("package: 'com.nub36.cryptora.v34'");
    expect(appConfig).toContain('version: pkg.version');
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(appConfig).toContain('versionCode: 2');
  });

  it('адрес сервера не зашит в код — только из окружения сборки', () => {
    expect(appConfig).toContain('process.env.EXPO_PUBLIC_API_BASE_URL');
    expect(appConfig).not.toMatch(/https?:\/\/[a-z0-9.-]+\.(fi|com|org|net)/i);
    expect(appConfig).toContain("apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL || ''");
  });

  it('CI собирает release (bundle внутри), а не debug', () => {
    expect(workflow).toContain('assembleRelease');
    expect(workflow).not.toContain('assembleDebug');
    expect(workflow).toContain('apk/release/app-release.apk');
  });

  it('CI проверяет, что bundle действительно встроен', () => {
    expect(workflow).toContain('verify-standalone-apk.cjs');
    expect(workflow).toContain('--min-bundle-bytes');
  });

  it('CI запускает APK на эмуляторе без Metro', () => {
    const smoke = fs.readFileSync(path.join(mobileDir, 'scripts/emulator-smoke.sh'), 'utf8');
    expect(workflow).toContain('android-emulator-runner');
    expect(workflow).toContain('emulator-smoke.sh');
    // Скрипт обязан ловить именно тот дефект, из-за которого APK просил Metro.
    expect(smoke).toContain('adb install');
    expect(smoke).toContain('Unable to load script');
    expect(smoke).toContain('FATAL EXCEPTION');
  });
});

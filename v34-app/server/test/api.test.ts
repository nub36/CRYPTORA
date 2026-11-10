/**
 * HTTP-API продукта: контракт для Android-приложения.
 *
 * Проверяется главное: приложение получает только серверные данные, отсутствие
 * стопа не подменяется ценой входа, TP1/безубыток появляются только по
 * подтверждённым событиям, устаревание видно явно, а push-статус честный.
 */
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import { createApp, readApkManifest } from '../src/api';
import { loadConfig } from '../src/config';
import { SignalRepository, type NewSignalInput } from '../src/repository';
import { DisabledPushSender } from '../src/push/fcm';
import { tempDb, type TempDb } from './helpers';

const NOW = Date.UTC(2024, 5, 1, 12, 0, 0);

interface Harness {
  server: Server;
  base: string;
  repo: SignalRepository;
  t: TempDb;
  dir: string;
  close(): Promise<void>;
}

let open: Harness[] = [];
afterEach(async () => {
  for (const h of open) await h.close();
  open = [];
});

async function harness(opts: {
  now?: () => number;
  apkDir?: string | null;
  push?: DisabledPushSender;
  env?: Record<string, string>;
} = {}): Promise<Harness> {
  const t = tempDb();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v34-api-'));
  const config = loadConfig({
    V34_DB_PATH: t.file,
    V34_PORT: '8080',
    V34_SCAN_INTERVAL_SECONDS: '60',
    V34_STATIC_DIR: path.join(dir, 'landing'),
    V34_APK_DIR: opts.apkDir ?? undefined,
    ...(opts.env ?? {}),
  });
  const push = opts.push ?? new DisabledPushSender(['V34_PUSH_ENABLED=true'], 'push не настроен');
  const app = createApp({
    repo: t.repo,
    config,
    push,
    version: '0.1.0-test',
    startedAtMs: NOW,
    now: opts.now ?? (() => NOW),
  });
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  const h: Harness = {
    server,
    base: `http://127.0.0.1:${port}`,
    repo: t.repo,
    t,
    dir,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      t.cleanup();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
  open.push(h);
  return h;
}

function signalInput(over: Partial<NewSignalInput> = {}): NewSignalInput {
  return {
    id: 'V3_4_HTF_ZONE_MITIGATION_QUALITY-ASSETAUSDT-1717243200000',
    strategyId: 'V3_4_HTF_ZONE_MITIGATION_QUALITY',
    strategyVersion: '3.4',
    symbol: 'ASSETA/USDT',
    exchangeSymbol: 'ASSETAUSDT',
    timeframe: '1h',
    direction: 'LONG',
    setupOpenTime: Date.UTC(2024, 5, 1, 10),
    entryMin: 100,
    entryMax: 100.5,
    stopLoss: 98,
    tp1: 101,
    tp2: 103,
    riskRewardRatio: 1.5,
    dataSource: { exchange: 'Binance', isFallback: false },
    metadata: { confirmingFactors: ['тест'] },
    createdAt: new Date(NOW).toISOString(),
    ...over,
  };
}

describe('GET /api/v1/meta', () => {
  it('отдаёт подтверждённую конфигурацию V3.4 и состояние источника', async () => {
    const h = await harness();
    const res = await fetch(`${h.base}/api/v1/meta`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    const body = (await res.json()) as Record<string, any>;

    expect(body.strategy.id).toBe('V3_4_HTF_ZONE_MITIGATION_QUALITY');
    expect(body.strategy.version).toBe('3.4');
    expect(body.strategy.badge).toBe('DERIVED_NO_BACKTEST');
    expect(body.strategy.badgeLabel).toBe('Derived · no backtest');
    expect(body.strategy.qualityGates).toEqual({ entryZoneAtrPad: 0.25, tp1MinR: 0.5, tp2MinR: 1 });
    expect(body.strategy.timeframes).toEqual({ exec: '1h', context: '4h' });
    expect(body.strategy.description.short).toContain('V3.4');
    // Никаких обещаний доходности.
    expect(JSON.stringify(body.strategy)).not.toMatch(/прибыл|доходн|гарантированн/i);

    expect(body.marketData.readOnly).toBe(true);
    expect(body.marketData.apiKeysRequired).toBe(false);
    expect(body.marketData.orderPlacement).toBe(false);
    expect(body.marketData.exchange).toBe('Binance');

    expect(body.universe.symbols).toContain('BTCUSDT');
    expect(body.engine.dataStatus).toBe('unknown');
    expect(body.push.configured).toBe(false);
    expect(body.push.missing).toContain('V34_FCM_PROJECT_ID');
    expect(body.push.missing).toContain('V34_PUSH_ENABLED=true');
    expect(body.disclaimer).toContain('не инвестиционная рекомендация');
  });

  it('старый успешный скан помечается stale, а не «fresh»', async () => {
    let now = NOW;
    const h = await harness({ now: () => now });
    const id = h.repo.startScan(new Date(NOW - 600_000).toISOString(), 1);
    h.repo.finishScan(id, {
      finishedAt: new Date(NOW - 599_000).toISOString(), status: 'OK', symbolsOk: 1, signalsNew: 0, error: null,
    });
    now = NOW + 600_000; // 10 минут спустя
    const body = (await (await fetch(`${h.base}/api/v1/meta`)).json()) as Record<string, any>;
    expect(body.engine.dataStatus).toBe('stale');
    expect(body.engine.staleReason).toContain('мин назад');
  });

  it('все символы с ошибкой данных → status error', async () => {
    const h = await harness();
    const id = h.repo.startScan(new Date(NOW).toISOString(), 1);
    h.repo.finishScan(id, { finishedAt: new Date(NOW).toISOString(), status: 'FAILED', symbolsOk: 0, signalsNew: 0, error: 'HTTP 451' });
    h.repo.upsertSymbolStatus({
      exchangeSymbol: 'ASSETAUSDT', lastScanAt: new Date(NOW).toISOString(), lastSuccessAt: null,
      lastBarOpenTime: null, closed1h: 0, closed4h: 0, gaps1h: 0, dataError: 'HTTP 451', source: null, notes: [],
    });
    const body = (await (await fetch(`${h.base}/api/v1/meta`)).json()) as Record<string, any>;
    expect(body.engine.dataStatus).toBe('error');
    expect(body.engine.perSymbol[0].dataError).toContain('451');
  });
});

describe('GET /api/v1/signals', () => {
  it('отдаёт уровни, статус и события строго из БД', async () => {
    const h = await harness();
    // Свежий успешный скан: без него данные честно считаются неподтверждёнными.
    const scanId = h.repo.startScan(new Date(NOW - 5_000).toISOString(), 1);
    h.repo.finishScan(scanId, { finishedAt: new Date(NOW).toISOString(), status: 'OK', symbolsOk: 1, signalsNew: 1, error: null });
    h.repo.insertSignal(signalInput());
    h.repo.recordEvent(signalInput().id, 'NEW_SIGNAL', new Date(NOW).toISOString());

    const body = (await (await fetch(`${h.base}/api/v1/signals`)).json()) as Record<string, any>;
    expect(body.count).toBe(1);
    const item = body.items[0];
    expect(item.entryZone).toEqual({ low: 100, high: 100.5 });
    expect(item.initialStopLoss).toBe(98);
    expect(item.targets).toEqual([{ level: 1, price: 101 }, { level: 2, price: 103 }]);
    expect(item.status).toBe('ACTIVE');
    expect(item.entry).toBeNull();
    expect(item.outcome).toBeNull();
    expect(item.progress.currentStop).toBeNull();
    expect(item.progress.tp1Hit).toBe(false);
    expect(item.events.map((e: { type: string }) => e.type)).toEqual(['NEW_SIGNAL']);
    expect(item.setupAt).toBe(new Date(Date.UTC(2024, 5, 1, 10)).toISOString());
    expect(item.stale).toBe(false);
  });

  it('без единого скана данные помечаются как неподтверждённые (stale)', async () => {
    const h = await harness();
    h.repo.insertSignal(signalInput());
    const body = (await (await fetch(`${h.base}/api/v1/signals`)).json()) as Record<string, any>;
    expect(body.stale).toBe(true);
    expect(body.staleReason).toContain('сканов ещё не было');
  });

  it('отсутствующий стоп — null, а не цена входа', async () => {
    const h = await harness();
    h.repo.insertSignal(signalInput({ id: 'no-stop', stopLoss: null }));
    const body = (await (await fetch(`${h.base}/api/v1/signals`)).json()) as Record<string, any>;
    const item = body.items[0];
    expect(item.initialStopLoss).toBeNull();
    expect(item.entryZone).not.toBeNull();
    expect(item.progress.currentStop).toBeNull();
  });

  it('TP1 и безубыток появляются только по событиям; действующий стоп = цена входа', async () => {
    const h = await harness();
    const id = 'filled-tp1';
    h.repo.insertSignal(signalInput({ id }));
    h.repo.updateLifecycle(id, { status: 'FILLED', filledAt: new Date(NOW - 3600_000).toISOString(), fillPrice: 100.4 }, new Date(NOW).toISOString());
    h.repo.recordEvent(id, 'NEW_SIGNAL', new Date(NOW - 7200_000).toISOString());
    h.repo.recordEvent(id, 'FILL', new Date(NOW - 3600_000).toISOString());
    h.repo.recordEvent(id, 'TP1', new Date(NOW - 1800_000).toISOString());
    h.repo.recordEvent(id, 'BREAKEVEN', new Date(NOW - 1700_000).toISOString());

    const body = (await (await fetch(`${h.base}/api/v1/signals/${id}`)).json()) as Record<string, any>;
    const sig = body.signal;
    expect(sig.status).toBe('FILLED');
    expect(sig.entry).toEqual({ price: 100.4, at: new Date(NOW - 3600_000).toISOString() });
    expect(sig.progress.tp1Hit).toBe(true);
    expect(sig.progress.tp1HitAt).toBe(new Date(NOW - 1800_000).toISOString());
    expect(sig.progress.breakevenArmed).toBe(true);
    expect(sig.progress.currentStop).toBe(100.4);
    expect(sig.progress.currentStopBasis).toBe('BE_AT_ENTRY');
    expect(sig.progress.tp2Hit).toBe(false);
    expect(sig.initialStopLoss).toBe(98);
  });

  it('фильтры, пагинация и ошибки ввода', async () => {
    const h = await harness();
    for (let i = 0; i < 3; i++) {
      h.repo.insertSignal(signalInput({
        id: `s${i}`,
        setupOpenTime: Date.UTC(2024, 5, 1, 10 + i),
        createdAt: new Date(NOW + i * 1000).toISOString(),
        direction: i === 0 ? 'SHORT' : 'LONG',
      }));
    }
    const page1 = (await (await fetch(`${h.base}/api/v1/signals?limit=2`)).json()) as Record<string, any>;
    expect(page1.items).toHaveLength(2);
    expect(page1.nextCursor).toContain('|');
    const page2 = (await (await fetch(`${h.base}/api/v1/signals?limit=2&cursor=${encodeURIComponent(page1.nextCursor)}`)).json()) as Record<string, any>;
    expect(page2.items).toHaveLength(1);
    expect(page2.nextCursor).toBeNull();

    const shorts = (await (await fetch(`${h.base}/api/v1/signals?direction=SHORT`)).json()) as Record<string, any>;
    expect(shorts.items).toHaveLength(1);
    expect(shorts.items[0].direction).toBe('SHORT');

    const open = (await (await fetch(`${h.base}/api/v1/signals?status=ACTIVE`)).json()) as Record<string, any>;
    expect(open.items).toHaveLength(3);
    const closed = (await (await fetch(`${h.base}/api/v1/signals?status=TARGET_REACHED`)).json()) as Record<string, any>;
    expect(closed.items).toHaveLength(0);

    expect((await fetch(`${h.base}/api/v1/signals?status=NOPE`)).status).toBe(400);
    expect((await fetch(`${h.base}/api/v1/signals?direction=UP`)).status).toBe(400);
    expect((await fetch(`${h.base}/api/v1/signals?symbol=%24%24`)).status).toBe(400);
    expect((await fetch(`${h.base}/api/v1/signals?cursor=bad`)).status).toBe(400);
    expect((await fetch(`${h.base}/api/v1/signals/UNKNOWN-ID-1`)).status).toBe(404);
  });

  it('устаревшие данные помечаются и в списке, и в детали', async () => {
    const now = NOW + 3_600_000;
    const h = await harness({ now: () => now });
    h.repo.insertSignal(signalInput());
    const id = h.repo.startScan(new Date(NOW).toISOString(), 1);
    h.repo.finishScan(id, { finishedAt: new Date(NOW).toISOString(), status: 'OK', symbolsOk: 1, signalsNew: 1, error: null });
    // Успешный скан старше 3 интервалов → stale.
    const list = (await (await fetch(`${h.base}/api/v1/signals`)).json()) as Record<string, any>;
    expect(list.stale).toBe(true);
    expect(list.staleReason).toContain('мин назад');
    expect(list.items[0].stale).toBe(true);
    expect(list.items[0].staleReason).toContain('мин назад');

    const detail = (await (await fetch(`${h.base}/api/v1/signals/${signalInput().id}`)).json()) as Record<string, any>;
    expect(detail.signal.stale).toBe(true);
  });
});

describe('DTO ленты', () => {
  it('не содержит функций и служебных полей', async () => {
    const h = await harness();
    const res = await fetch(`${h.base}/api/v1/signals?limit=5`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, any>;
    expect(body).not.toHaveProperty('statusLabel');
    expect(JSON.stringify(body)).not.toContain('function');
  });
});

describe('POST /api/v1/devices', () => {
  it('регистрирует токен и честно сообщает, что push не настроен', async () => {
    const h = await harness();
    const res = await fetch(`${h.base}/api/v1/devices`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'fcm-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaa', platform: 'android' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, any>;
    expect(body.registered).toBe(true);
    expect(body.pushConfigured).toBe(false);
    expect(body.note).toContain('не настроен');
    expect(h.repo.countDevices()).toEqual({ enabled: 1, total: 1 });

    expect((await fetch(`${h.base}/api/v1/devices`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: 'short' }),
    })).status).toBe(400);
    expect((await fetch(`${h.base}/api/v1/devices`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'fcm-token-bbbbbbbbbbbbbbbbbbbbbbbbbbbb', platform: 'windows' }),
    })).status).toBe(400);
  });

  it('не возвращает токен в ответе и не даёт отвязать устройство публично', async () => {
    const h = await harness();
    const token = 'fcm-token-cccccccccccccccccccccccccccc';
    const res = await fetch(`${h.base}/api/v1/devices`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, platform: 'android' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, any>;
    expect(JSON.stringify(body)).not.toContain(token);
    expect(body.unregister).toBe('disabled');

    // Публичного DELETE больше нет: знать чужой токен недостаточно, чтобы
    // отключить устройство.
    const del = await fetch(`${h.base}/api/v1/devices/${encodeURIComponent(token)}`, { method: 'DELETE' });
    expect([404, 405]).toContain(del.status);
    expect(h.repo.countDevices()).toEqual({ enabled: 1, total: 1 });
  });

  it('держит потолок числа устройств и обновляет уже известный токен', async () => {
    const h = await harness({ env: { V34_MAX_DEVICES: '2' } });
    const reg = (token: string) => fetch(`${h.base}/api/v1/devices`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, platform: 'android' }),
    });

    expect((await reg('fcm-token-111111111111111111111111')).status).toBe(201);
    expect((await reg('fcm-token-222222222222222222222222')).status).toBe(201);
    // Известный токен обновляется даже при заполненном лимите.
    expect((await reg('fcm-token-111111111111111111111111')).status).toBe(201);
    // Новый — нет, и ответ объясняет причину.
    const overflow = await reg('fcm-token-333333333333333333333333');
    expect(overflow.status).toBe(503);
    expect(((await overflow.json()) as Record<string, any>).error).toBe('device_capacity');
    expect(h.repo.countDevices().total).toBe(2);
  });

  it('битый JSON — 400 без внутренних деталей парсера', async () => {
    const h = await harness();
    const res = await fetch(`${h.base}/api/v1/devices`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{не json',
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, any>;
    expect(body.error).toBe('bad_json');
    // Никаких «Unexpected token / at position N» наружу.
    const text = JSON.stringify(body);
    expect(text).not.toMatch(/position|Unexpected|SyntaxError|at line/i);
  });

  it('ограничивает частоту регистраций', async () => {
    const h = await harness();
    let limited = 0;
    for (let i = 0; i < 15; i++) {
      const res = await fetch(`${h.base}/api/v1/devices`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: `fcm-token-${String(i).padStart(24, '0')}` }),
      });
      if (res.status === 429) limited++;
    }
    expect(limited).toBeGreaterThan(0);
  });
});

describe('APK-манифест', () => {
  it('без файлов отдаёт available=false с причиной', async () => {
    const h = await harness();
    const body = (await (await fetch(`${h.base}/api/v1/apk`)).json()) as Record<string, any>;
    expect(body.available).toBe(false);
    expect(body.reason).toContain('каталог APK');
  });

  it('с APK и manifest.json отдаёт размер и sha256', async () => {
    const apkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v34-apk-'));
    fs.writeFileSync(path.join(apkDir, 'v34-0.1.0.apk'), Buffer.from('not-a-real-apk'));
    fs.writeFileSync(path.join(apkDir, 'manifest.json'), JSON.stringify({
      fileName: 'v34-0.1.0.apk', version: '0.1.0', sha256: 'deadbeef', builtAt: new Date(NOW).toISOString(),
      signedWithReleaseKey: false,
    }));
    const h = await harness({ apkDir });
    const body = (await (await fetch(`${h.base}/api/v1/apk`)).json()) as Record<string, any>;
    expect(body.available).toBe(true);
    expect(body.sizeBytes).toBe(14);
    expect(body.sha256).toBe('deadbeef');
    expect(body.signedWithReleaseKey).toBe(false);
    expect(body.downloadPath).toBe('/apk/v34-0.1.0.apk');
    fs.rmSync(apkDir, { recursive: true, force: true });
  });

  it('readApkManifest не выдумывает данные при отсутствии файла', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v34-apk2-'));
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ fileName: 'missing.apk' }));
    const m = readApkManifest(dir);
    expect(m.available).toBe(false);
    expect(m.reason).toContain('отсутствует');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('безопасность и 404', () => {
  it('неизвестный эндпоинт API — JSON 404, статика лендинга не перехватывает API', async () => {
    const h = await harness();
    const res = await fetch(`${h.base}/api/v1/nope`);
    expect(res.status).toBe(404);
    expect(((await res.json()) as Record<string, any>).error).toBe('not_found');
  });

  it('health отвечает по схеме', async () => {
    const h = await harness();
    const body = (await (await fetch(`${h.base}/api/v1/health`)).json()) as Record<string, any>;
    expect(body.ok).toBe(true);
    expect(body.db).toBe('ok');
    expect(body.apiVersion).toBe('v1');
    expect(body.push.configured).toBe(false);
  });
});

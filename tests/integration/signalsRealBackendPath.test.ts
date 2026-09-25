/**
 * CRYPTORA — Signals V2: НАСТОЯЩИЙ серверный путь без подмены /api/signals.
 *
 * Задача (ревью перед слиянием #17): доказать, что запись формата миграции 009
 * реально проходит полный путь
 *     PostgreSQL → сервер → GET /api/signals → фронтенд-маппинг (signalUiModel)
 * и отображает: symbol, LONG/SHORT, стратегию/версию, таймфрейм сигнала,
 * вход, стоп, лестницу целей произвольной длины, статус и временные метки.
 *
 * Это НЕ mock: поднимается настоящий embedded-postgres, прогоняются НАСТОЯЩИЕ
 * миграции настоящим раннером, запускается настоящее Express-приложение из
 * server/app.js. Сигналы вставляются настоящим `signalRepo.insertSignal`
 * (формат 009, лестница `targets`) и читаются настоящим `GET /api/signals`.
 * Единственный внешний слой (рыночные данные биржи) здесь вообще не нужен —
 * страница сигналов берёт только сохранённые строки.
 *
 * Математика стратегий НЕ пересчитывается и НЕ меняется: тест читает то, что
 * сохранил сервер, и проверяет только перенос значений в модель UI.
 *
 * Сценарии:
 *   A) LONG + лестница из 3 целей;
 *   B) SHORT;
 *   C) ноль целей (пустая лестница — цели не выдумываются);
 *   D) закрытый/терминальный статус с результатом сделки (через
 *      настоящий `syncSignalLifecycle`);
 *   E) символ без сигналов — честная пустая лента.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { execFileSync } from 'node:child_process';
import { listen, HttpClient } from '../helpers/httpHarness';

// Фронтенд-маппинг (сигналы → модель UI). Это ТОТ ЖЕ код, что рендерит /signals.
import { toSignalUiModels, symbolsWithSignals } from '@/services/signals/ui/signalUiModel';
import type { SignalDto } from '@/services/strategyOps';

const ROOT = path.resolve(__dirname, '../..');

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const a = srv.address();
      if (typeof a === 'object' && a) {
        const p = a.port;
        srv.close(() => resolve(p));
      } else srv.close(() => reject(new Error('no address')));
    });
  });
}

let pg: any = null;
let db: any = null;
let skipReason: string | null = null;
let client: HttpClient;
let closeServer: () => Promise<void>;
let signalRepo: any = null;

async function q(sql: string, params: unknown[] = []): Promise<any[]> {
  return (await db.query(sql, params)).rows;
}

beforeAll(async () => {
  let EmbeddedPostgres: any;
  try {
    EmbeddedPostgres = (await import('embedded-postgres')).default;
  } catch (e) {
    skipReason = `embedded-postgres недоступен: ${(e as Error).message}`;
    return;
  }

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cryptora-signalspath-'));
  const port = await freePort();

  try {
    pg = new EmbeddedPostgres({
      databaseDir: dataDir,
      user: 'cryptora',
      password: 'cryptora',
      port,
      persistent: false,
    });
    await pg.initialise();
    await pg.start();
    const admin = await pg.getPgClient('postgres');
    await admin.connect();
    await admin.query('CREATE DATABASE cryptora');
    await admin.end();
  } catch (e) {
    skipReason = `не удалось поднять PostgreSQL: ${(e as Error).message}`;
    pg = null;
    return;
  }

  const url = `postgresql://cryptora:cryptora@127.0.0.1:${port}/cryptora`;

  // НАСТОЯЩИЕ миграции НАСТОЯЩИМ раннером (включая 007 и 009).
  execFileSync(process.execPath, [path.join(ROOT, 'scripts/migrate.mjs')], {
    env: { ...process.env, DATABASE_URL: url },
    cwd: ROOT,
    encoding: 'utf8',
  });

  process.env.DATABASE_URL = url;
  process.env.SESSION_SECRET = 'integration-test-secret';
  process.env.NODE_ENV = 'development';
  process.env.SESSION_STORE = 'memory';

  const { createApp } = await import('../../server/app.js');
  const harness = await listen(createApp());
  client = harness.client;
  closeServer = harness.close;

  signalRepo = await import('../../server/services/signalRepository.js');

  db = await pg.getPgClient('cryptora');
  await db.connect();
}, 240_000);

afterAll(async () => {
  // Порядок важен: сначала пул приложения, потом PostgreSQL (иначе 57P01).
  try {
    if (db) await db.end();
  } catch { /* уже закрыто */ }
  try {
    if (closeServer) await closeServer();
  } catch { /* сервер уже остановлен */ }
  try {
    const { closePool } = await import('../../server/db/pool.js');
    await closePool();
  } catch { /* пул уже закрыт */ }
  try {
    if (pg) await pg.stop();
  } catch { /* БД уже остановлена */ }
});

const guard = (ctx: any) => {
  if (skipReason) {
    ctx.skip();
    return true;
  }
  return false;
};

/* ═══════════ Посев: настоящие строки формата миграции 009 ═══════════ */

async function seed(): Promise<void> {
  await db.query('DELETE FROM signals');

  // A) LONG + лестница из 3 целей (произвольная длина).
  await signalRepo.insertSignal({
    strategyId: 'V3_0_HTF_LIQUIDATION_TRAP',
    strategyVersion: '3.0',
    symbol: 'BTC/USDT',
    timeframe: '1h',
    direction: 'LONG',
    signalCandleTs: new Date('2026-09-20T10:00:00Z'),
    entryMin: 65000,
    entryMax: 65200,
    stopLoss: 64000,
    targets: [66500, 68000, 70000],
  });

  // B) SHORT с одной целью.
  await signalRepo.insertSignal({
    strategyId: 'V2_8_ZERO_FEE_SNIPER_TRAILING',
    strategyVersion: '2.8',
    symbol: 'BTC/USDT',
    timeframe: '1h',
    direction: 'SHORT',
    signalCandleTs: new Date('2026-09-20T11:00:00Z'),
    entryMin: 66000,
    entryMax: 66000,
    stopLoss: 67200,
    targets: [64000],
  });

  // C) Ноль целей: пустая лестница (цели не выдумываются ни сервером, ни UI).
  await signalRepo.insertSignal({
    strategyId: 'V3_3_HTF_ZONE_MITIGATION',
    strategyVersion: '3.3',
    symbol: 'ETH/USDT',
    timeframe: '1h',
    direction: 'LONG',
    signalCandleTs: new Date('2026-09-20T12:00:00Z'),
    entryMin: 3100,
    entryMax: 3110,
    stopLoss: 3050,
    targets: [],
  });

  // D) Сигнал, который затем станет терминальным через настоящий жизненный цикл.
  await signalRepo.insertSignal({
    strategyId: 'V3_0_HTF_LIQUIDATION_TRAP',
    strategyVersion: '3.0',
    symbol: 'BTC/USDT',
    timeframe: '1h',
    direction: 'LONG',
    signalCandleTs: new Date('2026-09-20T09:00:00Z'),
    entryMin: 64500,
    entryMax: 64700,
    stopLoss: 63800,
    targets: [65500, 66200],
  });
}

async function closeCaseD(): Promise<void> {
  await signalRepo.syncSignalLifecycle({
    strategyId: 'V3_0_HTF_LIQUIDATION_TRAP',
    symbol: 'BTC/USDT',
    timeframe: '1h',
    signalCandleTs: new Date('2026-09-20T09:00:00Z'),
    fill: { price: 64600, at: '2026-09-20T10:00:00Z' },
    outcome: {
      status: 'TARGET_REACHED',
      exitReason: 'TP2',
      exitPrice: 66200,
      resultR: 1.67,
      netResultR: 1.6,
      pnlResultPct: 2.6,
      barsHeld: 4,
      closedAt: new Date('2026-09-20T14:00:00Z'),
    },
  });
}

/* ═══════════ Путь 1: БД → сервер (формат 009 реально сохранён) ═══════════ */

describe('Настоящий серверный путь: миграция 009', () => {
  it('чистое состояние после миграций: стратегии ВЫКЛЮЧЕНЫ, лента сигналов ПУСТА (не баг)', async (ctx) => {
    if (guard(ctx)) return;
    await db.query('DELETE FROM signals');

    // 3 продуктовые стратегии, все выключены — никто ничего не включает.
    const settings = await q('SELECT strategy_id, enabled FROM strategy_settings ORDER BY strategy_id');
    expect(settings.length).toBe(3);
    expect(settings.every((s: any) => s.enabled === false)).toBe(true);

    // GET /api/signals честно отдаёт пустую ленту: 0 строк, не ошибка.
    const res = await client.get('/api/signals');
    expect(res.status).toBe(200);
    const body = res.body as any;
    expect(body.signals).toEqual([]);
    expect(body.count).toBe(0);
    expect(body.total).toBe(0);
    expect(body.source).toBe('server');

    // Фронтенд-маппинг пустой ленты: моделей нет, чипы пусты — ничего не выдумано.
    expect(toSignalUiModels(body.signals as SignalDto[])).toEqual([]);
    expect(symbolsWithSignals(body.signals as SignalDto[])).toEqual([]);
  });

  it('строки в формате 009 записаны: лестница целей, версия, цепочка, статусы', async (ctx) => {
    if (guard(ctx)) return;
    await seed();
    await closeCaseD();

    // Таблица реально содержит лестницу произвольной длины и версию.
    const rows = await q(
      'SELECT symbol, direction, targets, chain_version, strategy_version, status FROM signals ORDER BY signal_candle_ts'
    );
    expect(rows.length).toBe(4);

    const longThree = rows.find((r: any) => r.direction === 'LONG' && r.symbol === 'BTC/USDT' && r.status === 'ACTIVE');
    expect(longThree).toBeTruthy();
    expect(longThree.targets.map(Number)).toEqual([66500, 68000, 70000]);
    expect(Number(longThree.chain_version)).toBe(2);
    expect(longThree.strategy_version).toBe('3.0');

    const short = rows.find((r: any) => r.direction === 'SHORT');
    expect(short.targets.map(Number)).toEqual([64000]);

    const zeroTargets = rows.find((r: any) => r.symbol === 'ETH/USDT');
    expect(zeroTargets).toBeTruthy();

    const terminal = rows.find((r: any) => r.status === 'TARGET_REACHED');
    expect(terminal).toBeTruthy();

    // Цепочка хэшей валидна на настоящих строках.
    const chain = await signalRepo.verifyChain();
    expect(chain.breaks).toBe(0);
  });

  /* ═════════ Путь 2: сервер → GET /api/signals (настоящий контракт) ═════════ */

  it('GET /api/signals отдаёт DTO с symbol/направлением/версией/ТФ/входом/стопом/targets[]/статусом/временем', async (ctx) => {
    if (guard(ctx)) return;
    const res = await client.get('/api/signals?symbol=BTC/USDT');
    expect(res.status).toBe(200);
    const body = res.body as any;
    expect(body.source).toBe('server');
    expect(Array.isArray(body.signals)).toBe(true);
    expect(body.signals.length).toBe(3); // A, B, D (по BTC/USDT)

    const dto: SignalDto = body.signals.find((s: any) => s.direction === 'LONG' && s.status === 'ACTIVE');
    expect(dto).toBeTruthy();
    // Формат 009 дошёл до клиента как есть — без округлений и досчётов.
    expect(dto.symbol).toBe('BTC/USDT');
    expect(dto.direction).toBe('LONG');
    expect(dto.strategyId).toBe('V3_0_HTF_LIQUIDATION_TRAP');
    expect(dto.strategyVersion).toBe('3.0');
    expect(dto.timeframe).toBe('1h'); // таймфрейм ИСПОЛНЕНИЯ сигнала
    expect(dto.entryMin).toBe(65000);
    expect(dto.entryMax).toBe(65200);
    expect(dto.stopLoss).toBe(64000);
    expect(dto.targets).toEqual([66500, 68000, 70000]); // произвольная длина
    expect(typeof dto.signalCandleTs).toBe('string'); // ISO-время
    expect(dto.chainVersion).toBe(2);

    // Терминальный сигнал несёт результат сделки (посчитан ядром, не клиентом).
    const closed = body.signals.find((s: any) => s.status === 'TARGET_REACHED');
    expect(closed).toBeTruthy();
    expect(closed.resultR).toBeCloseTo(1.67, 5);
    expect(closed.netResultR).toBeCloseTo(1.6, 5);
    expect(closed.fillPrice).toBe(64600);
  });

  it('E) символ без сигналов → честная пустая лента (0 строк, не ошибка)', async (ctx) => {
    if (guard(ctx)) return;
    const res = await client.get('/api/signals?symbol=SOL/USDT');
    expect(res.status).toBe(200);
    const body = res.body as any;
    expect(body.signals).toEqual([]);
    expect(body.count).toBe(0);
    expect(body.total).toBe(0);
    expect(body.source).toBe('server');
  });

  /* ═════ Путь 3: фронтенд-маппинг (тот же код, что рендерит /signals) ═════ */

  it('фронтенд-маппинг отображает реальные DTO: LONG/SHORT, цели, статусы, время', async (ctx) => {
    if (guard(ctx)) return;
    const res = await client.get('/api/signals');
    const dtos = (res.body as any).signals as SignalDto[];
    const models = toSignalUiModels(dtos);
    expect(models.length).toBe(4);

    // A) LONG + 3 цели.
    const long = models.find((m) => m.id === dtos.find((d) => d.direction === 'LONG' && d.status === 'ACTIVE' && d.targets?.length === 3)!.id)!;
    expect(long.baseSymbol).toBe('BTC');
    expect(long.pair).toBe('BTC/USDT');
    expect(long.direction).toBe('LONG');
    expect(long.timeframe).toBe('1h');
    expect(long.status).toBe('ACTIVE');
    expect(long.entry.min).toBe(65000);
    expect(long.entry.max).toBe(65200);
    expect(long.stop.price).toBe(64000);
    expect(long.targets.map((t) => t.price)).toEqual([66500, 68000, 70000]);
    expect(long.hasTargets).toBe(true);
    expect(long.signalCandleTs).toContain('2026-09-20');

    // B) SHORT.
    const short = models.find((m) => m.direction === 'SHORT')!;
    expect(short).toBeTruthy();
    expect(short.baseSymbol).toBe('BTC');
    expect(short.targets.map((t) => t.price)).toEqual([64000]);

    // C) ноль целей — ничего не выдумано.
    const eth = models.find((m) => m.baseSymbol === 'ETH')!;
    expect(eth.hasTargets).toBe(false);
    expect(eth.targets).toEqual([]);

    // D) терминальный статус + сделка + R.
    const closed = models.find((m) => m.status === 'TARGET_REACHED')!;
    expect(closed.hasTrade).toBe(true);
    expect(closed.isOpen).toBe(false);

    // Символы с сигналами — только те, что реально есть (для чипов селектора).
    // Функция возвращает пары вида «BTC/USDT» (SignalsPage приводит к базе при выборе).
    expect(new Set(symbolsWithSignals(dtos))).toEqual(new Set(['BTC/USDT', 'ETH/USDT']));
  });

  it('V2.8 таймфрейм исполнения = 1h (не «15m») даже после отображения', async (ctx) => {
    if (guard(ctx)) return;
    const res = await client.get('/api/signals?symbol=BTC/USDT');
    const dtos = (res.body as any).signals as SignalDto[];
    const v28 = dtos.find((d) => d.strategyId === 'V2_8_ZERO_FEE_SNIPER_TRAILING');
    expect(v28).toBeTruthy();
    const model = toSignalUiModels([v28!])[0];
    expect(model.timeframe).toBe('1h');
    expect(model.timeframe).not.toBe('15m');
  });

  /**
   * Путь 4: GET /api/signals/:id — точечное чтение для deep-link'а колокольчика.
   *
   * Уведомление открывает `/signals?symbol=RUNE&signal=<id>`; страница обязана
   * получить ТУ ЖЕ строку, что и лента (одна идентичность DTO), а не «похожую».
   * Отдельно фиксируется честная семантика ошибок: нет строки → 404, кривой id →
   * 400 (а не пустой ответ и не 500 от постгреса).
   */
  it('deep-link: GET /api/signals/:id отдаёт ровно ту же строку, что и лента', async (ctx) => {
    if (guard(ctx)) return;
    const feed = await client.get('/api/signals?symbol=BTC/USDT');
    const dto = (feed.body as any).signals.find((s: any) => s.targets?.length === 3);
    expect(dto).toBeTruthy();

    const res = await client.get(`/api/signals/${dto.id}`);
    expect(res.status).toBe(200);
    const body = res.body as any;
    expect(body.source).toBe('server');
    // Идентичность: это тот же сигнал, а не копия «похожего вида».
    expect(body.signal).toEqual(dto);
    expect(body.signal.id).toBe(dto.id);
    expect(body.signal.entryMin).toBe(65000);
    expect(body.signal.stopLoss).toBe(64000);
    expect(body.signal.targets).toEqual([66500, 68000, 70000]);
    // Карантин происхождения отдаётся как есть — читатель решает политику сам.
    expect(typeof body.signal.provenanceStatus).toBe('string');
  });

  it('deep-link: неизвестный id → 404 SIGNAL_NOT_FOUND, кривой id → 400 INVALID_ID', async (ctx) => {
    if (guard(ctx)) return;
    const missing = await client.get('/api/signals/3f8a1c2b-4d5e-4f60-8a1b-2c3d4e5f6071');
    expect(missing.status).toBe(404);
    expect((missing.body as any).error).toBe('SIGNAL_NOT_FOUND');

    const malformed = await client.get('/api/signals/not-a-uuid');
    expect(malformed.status).toBe(400);
    expect((malformed.body as any).error).toBe('INVALID_ID');
  });

  it('deep-link: точечное чтение работает и для закрытого сигнала (история)', async (ctx) => {
    if (guard(ctx)) return;
    const feed = await client.get('/api/signals?symbol=BTC/USDT');
    const closed = (feed.body as any).signals.find((s: any) => s.status === 'TARGET_REACHED');
    expect(closed).toBeTruthy();

    const res = await client.get(`/api/signals/${closed.id}`);
    expect(res.status).toBe(200);
    const dto = (res.body as any).signal;
    expect(dto.status).toBe('TARGET_REACHED');
    expect(dto.resultR).toBeCloseTo(1.67, 5);
    expect(dto.closedAt).toBeTruthy();
  });
});

/**
 * Точка входа backend-продукта V3.4.
 *
 * Запускает: собственную БД (SQLite-файл), планировщик сканов по публичным
 * данным Binance, HTTP-API для Android и раздачу лендинга/APK.
 *
 * Торговли нет: только чтение публичных свечей и публикация собственных
 * аналитических сигналов. Торговые ключи не запрашиваются и не используются.
 */
import fs from 'node:fs';
import http from 'node:http';
import { loadConfig } from './config';
import { openDatabase, databaseReady } from './db';
import { SignalRepository } from './repository';
import { BinancePublicProvider } from './market';
import { createPushSender } from './push/fcm';
import { Scanner, pairOf, type Logger } from './scanner';
import { createApp } from './api';

export const SERVER_VERSION = '0.1.0';

function makeLogger(level: 'debug' | 'info' | 'warn' | 'error'): Logger {
  const order = { debug: 10, info: 20, warn: 30, error: 40 } as const;
  const emit = (lvl: keyof typeof order, msg: string, extra?: unknown) => {
    if (order[lvl] < order[level]) return;
    const payload = extra === undefined ? '' : ` ${JSON.stringify(extra)}`;
    const line = `${new Date().toISOString()} ${lvl.toUpperCase()} ${msg}${payload}`;
    if (lvl === 'error') console.error(line);
    else if (lvl === 'warn') console.warn(line);
    else console.log(line);
  };
  return {
    debug: (m, e) => emit('debug', m, e),
    info: (m, e) => emit('info', m, e),
    warn: (m, e) => emit('warn', m, e),
    error: (m, e) => emit('error', m, e),
  };
}

export interface StartedServer {
  close(): Promise<void>;
  server: http.Server;
}

export function startServer(env: NodeJS.ProcessEnv = process.env): StartedServer {
  const config = loadConfig(env);
  const log = makeLogger(config.logLevel);
  const db = openDatabase(config.dbPath);
  if (!databaseReady(db)) throw new Error('база продукта не инициализирована');
  const repo = new SignalRepository(db);
  // Чистим просроченные регистрации устройств на старте: публичная регистрация
  // не должна превращаться в бесконечный рост БД.
  const prunedDevices = repo.pruneDevices(
    new Date(Date.now() - config.deviceTtlDays * 24 * 60 * 60 * 1000).toISOString(),
  );
  if (prunedDevices > 0) log.info('удалены устаревшие регистрации устройств', { removed: prunedDevices });
  const provider = new BinancePublicProvider({ timeoutMs: config.marketTimeoutMs });
  const push = createPushSender({
    projectId: config.fcm.projectId,
    serviceAccountFile: config.fcm.serviceAccountFile,
    enabled: config.pushEnabled,
  });

  if (!push.state.configured) {
    log.warn('push выключен', { missing: push.state.missing, reason: push.state.reason });
  }
  if (config.staticDir && !fs.existsSync(config.staticDir)) {
    log.warn('каталог лендинга не найден — статика не раздаётся', { dir: config.staticDir });
  }

  const scanner = new Scanner({
    provider,
    repo,
    symbols: config.symbols,
    push,
    logger: log,
  });

  const app = createApp({
    repo,
    config,
    push,
    version: SERVER_VERSION,
    startedAtMs: Date.now(),
  });

  const server = http.createServer(app);
  server.listen(config.port, config.host, () => {
    log.info('backend V3.4 слушает', {
      host: config.host,
      port: config.port,
      symbols: config.symbols,
      scanIntervalMs: config.scanIntervalMs,
      dbPath: config.dbPath,
      pushConfigured: push.state.configured,
    });
  });

  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  const scheduleNext = (delayMs: number) => {
    if (stopped) return;
    timer = setTimeout(() => {
      void runOnce();
    }, delayMs);
    timer.unref?.();
  };

  const runOnce = async () => {
    if (stopped) return;
    try {
      const summary = await scanner.scanAll();
      log.info('скан завершён', {
        durationMs: summary.durationMs,
        symbolsOk: `${summary.symbolsOk}/${summary.symbols.length}`,
        signalsPublished: summary.signalsPublished,
        events: summary.events,
        errors: summary.errors.slice(0, 3),
      });
      for (const s of summary.symbols) {
        if (s.dataError) log.warn('данные символа недоступны', { symbol: s.symbol, error: s.dataError });
      }
    } catch (e) {
      log.error('скан упал', { message: e instanceof Error ? e.message : String(e) });
    } finally {
      scheduleNext(config.scanIntervalMs);
    }
  };

  scheduleNext(config.scanInitialDelayMs);

  return {
    server,
    close: async () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      await new Promise<void>((resolve) => server.close(() => resolve()));
      try {
        db.close();
      } catch {
        /* уже закрыта */
      }
    },
  };
}

/** Запуск как самостоятельного процесса. */
const isMain = process.argv[1]?.endsWith('server.mjs') || process.argv[1]?.endsWith('index.ts');
if (isMain) {
  const started = startServer();
  const shutdown = (signal: string) => {
    console.log(`${new Date().toISOString()} INFO получен ${signal}, останавливаюсь`);
    void started.close().then(() => process.exit(0)).catch(() => process.exit(1));
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

export { pairOf };

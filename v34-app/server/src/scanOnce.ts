/**
 * Один скан без HTTP-сервера: удобно для cron, diagnostics и деплой-проверки.
 *
 * Запуск: node --experimental-sqlite dist/scan-once.mjs
 * Код возврата: 0 — все символы опрошены успешно, 1 — были ошибки данных.
 */
import { loadConfig } from './config';
import { openDatabase } from './db';
import { SignalRepository } from './repository';
import { BinancePublicProvider } from './market';
import { createPushSender } from './push/fcm';
import { Scanner } from './scanner';

const config = loadConfig();
const db = openDatabase(config.dbPath);
const repo = new SignalRepository(db);
const provider = new BinancePublicProvider({ timeoutMs: config.marketTimeoutMs });
const push = createPushSender({
  projectId: config.fcm.projectId,
  serviceAccountFile: config.fcm.serviceAccountFile,
  enabled: config.pushEnabled,
});
const scanner = new Scanner({ provider, repo, symbols: config.symbols, push });

const summary = await scanner.scanAll();
console.log(JSON.stringify(summary, null, 2));
db.close();
process.exit(summary.errors.length > 0 ? 1 : 0);

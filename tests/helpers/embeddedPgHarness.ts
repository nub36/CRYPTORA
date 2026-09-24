/**
 * CRYPTORA — заготовка для интеграционных тестов на НАСТОЯЩЕМ PostgreSQL.
 *
 * Поднимает embedded-postgres, прогоняет НАСТОЯЩИЕ миграции НАСТОЯЩИМ
 * раннером (`scripts/migrate.mjs`), запускает настоящее Express-приложение из
 * `server/app.js` и регистрирует администратора/пользователя. Моков базы
 * данных здесь нет: подменять можно только сетевой слой рыночных данных, и
 * каждый такой тест обязан это явно документировать.
 *
 * Порядок завершения важен: сначала пул приложения (`closePool`), потом
 * PostgreSQL. Иначе pg рвёт живые соединения сервера и процесс получает
 * FATAL 57P01 «terminating connection due to administrator command» как
 * unhandled error (F-17).
 *
 * Три существующих файла (migrationsPostgres, scanUniverse,
 * strategyOperations) несут этот же bootstrap инлайн — они писались раньше и
 * переведены на хелпер не были, чтобы не трогать зелёные наборы. Новые файлы
 * обязаны использовать хелпер.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { execFileSync } from 'node:child_process';
import { expect } from 'vitest';
import { listen, HttpClient } from './httpHarness';

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
      } else {
        srv.close(() => reject(new Error('no address')));
      }
    });
  });
}

export interface PgHarness {
  /** Строка подключения к поднятой базе. */
  url: string;
  /** Отдельный клиент pg для прямых SQL-проверок (не пул приложения). */
  db: any;
  /** HTTP-клиент настоящего приложения. */
  client: HttpClient;
  /** `SELECT` короткой формой: сразу массив строк. */
  q: (sql: string, params?: unknown[]) => Promise<any[]>;
  /** Регистрация + подтверждение почты + роль напрямую в БД (тестовая инфраструктура). */
  registerAndVerify: (email: string, password: string, role: 'admin' | 'user') => Promise<void>;
  /** Логин; возвращает клиент, который носит cookie сессии. */
  login: (email: string, password: string) => Promise<HttpClient>;
  /** Остановить сервер, закрыть пул приложения и PostgreSQL. */
  close: () => Promise<void>;
}

export type PgHarnessResult =
  | { ok: true; harness: PgHarness }
  | { ok: false; skipReason: string };

/**
 * @param opts.prefix префикс временного каталога данных (видно в /tmp)
 * @param opts.app    запускать ли Express-приложение (по умолчанию да)
 */
export async function startPgHarness(
  opts: { prefix?: string; app?: boolean } = {}
): Promise<PgHarnessResult> {
  const { prefix = 'cryptora-pg-', app = true } = opts;

  let EmbeddedPostgres: any;
  try {
    EmbeddedPostgres = (await import('embedded-postgres')).default;
  } catch (e) {
    return { ok: false, skipReason: `embedded-postgres недоступен: ${(e as Error).message}` };
  }

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const port = await freePort();

  let pg: any = null;
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
    try {
      if (pg) await pg.stop();
    } catch { /* уже остановлен */ }
    return { ok: false, skipReason: `не удалось поднять PostgreSQL: ${(e as Error).message}` };
  }

  const url = `postgresql://cryptora:cryptora@127.0.0.1:${port}/cryptora`;

  try {
    // НАСТОЯЩИЕ миграции НАСТОЯЩИМ раннером — тот же путь, что и на сервере.
    execFileSync(process.execPath, [path.join(ROOT, 'scripts/migrate.mjs')], {
      env: { ...process.env, DATABASE_URL: url },
      cwd: ROOT,
      encoding: 'utf8',
    });
  } catch (e) {
    try {
      await pg.stop();
    } catch { /* уже остановлен */ }
    return { ok: false, skipReason: `миграции не применились: ${(e as Error).message}` };
  }

  // Конфиг сервера читает окружение при импорте — ставим ДО import().
  process.env.DATABASE_URL = url;
  process.env.SESSION_SECRET = 'integration-test-secret';
  process.env.NODE_ENV = 'development';
  process.env.REGISTRATION_ENABLED = 'true';
  process.env.SESSION_STORE = 'memory';

  const db = await pg.getPgClient('cryptora');
  await db.connect();

  const q = async (sql: string, params: unknown[] = []): Promise<any[]> =>
    (await db.query(sql, params)).rows;

  let client: HttpClient;
  let closeServer: () => Promise<void> = async () => {};

  if (app) {
    const { createApp } = await import('../../server/app.js');
    const harness = await listen(createApp());
    client = harness.client;
    closeServer = harness.close;
  } else {
    client = new HttpClient(`http://127.0.0.1:${port}`);
  }

  const registerAndVerify = async (
    email: string,
    password: string,
    role: 'admin' | 'user'
  ): Promise<void> => {
    const reg = await client.post('/api/auth/register', {
      email,
      password,
      displayName: role === 'admin' ? 'Integration Admin' : 'Plain User',
    });
    expect([200, 201, 409], `register ${email}: ${JSON.stringify(reg.body)}`).toContain(reg.status);
    // Верификация почты обязательна; токен наружу не отдаётся, поэтому
    // подтверждаем напрямую в БД — это тестовая инфраструктура, не обход защиты.
    await db.query('UPDATE users SET email_verified = TRUE, role = $2 WHERE email = $1', [
      email,
      role,
    ]);
  };

  const login = async (email: string, password: string): Promise<HttpClient> => {
    const fresh = new HttpClient((client as any).base);
    const res = await fresh.post('/api/auth/login', { email, password });
    expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
    return fresh;
  };

  const close = async (): Promise<void> => {
    try {
      await db.end();
    } catch { /* уже закрыто */ }
    try {
      await closeServer();
    } catch { /* сервер уже остановлен */ }
    try {
      const { closePool } = await import('../../server/db/pool.js');
      await closePool();
    } catch { /* пул уже закрыт */ }
    try {
      await pg.stop();
    } catch { /* БД уже остановлена */ }
  };

  return { ok: true, harness: { url, db, client, q, registerAndVerify, login, close } };
}

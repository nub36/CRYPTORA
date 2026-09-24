/** @vitest-environment node */
/**
 * CRYPTORA — Обработчик ошибок пула PostgreSQL (F-17).
 *
 * Что было на проде и в CI: `pg` доставляет ошибки ПРОСТАИВАЮЩЕГО клиента
 * через событие `'error'` самого пула. Без слушателя Node трактует это как
 * необработанное событие и завершает процесс. Реальный триггер — снятие
 * простаивающего соединения сервером (`FATAL 57P01 admin_shutdown` при
 * рестарте/failover PostgreSQL, `pg_terminate_backend()`, обрыв сети):
 * бэкенд падал целиком, а в CI прогон становился красным при 1176/1176
 * прошедших тестах («Errors 2 errors»).
 *
 * Здесь проверяется:
 *  • слушатель действительно стоит на НАСТОЯЩЕМ pg.Pool, и то же событие без
 *    него фатально (доказательство, что чинится реальная причина);
 *  • запись структурирована и НЕ содержит секретов (connectionString, пароль);
 *  • ошибки активных запросов по-прежнему уходят вызывающему (не глотаются);
 *  • `closePool()` терминален: во время остановки новое соединение не
 *    открывается — именно эта гонка и рождала 57P01 без ожидающего промиса;
 *  • запрещённые способы «починить» это (dangerouslyIgnoreUnhandledErrors,
 *    глобальный uncaughtException, ретраи в CI) не появились в коде.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import pg from 'pg';

import {
  formatPoolError,
  attachPoolErrorHandlers,
  getPool,
  query,
  getClient,
  checkDatabase,
  closePool,
  isPoolClosed,
  __setPoolForTests,
} from '../../server/db/pool.js';

const ROOT = path.resolve(__dirname, '../..');

/** Ровно та ошибка, которую отдаёт PostgreSQL при снятии простаивающего клиента. */
const fatalIdleError = () =>
  Object.assign(new Error('terminating connection due to administrator command'), {
    severity: 'FATAL',
    code: '57P01',
  });

const openPools: any[] = [];
const openServers: net.Server[] = [];

const trackPool = (p: any) => {
  openPools.push(p);
  return p;
};

afterEach(async () => {
  while (openPools.length) {
    const p = openPools.pop();
    try {
      await p.end();
    } catch {
      /* пул без клиентов закрывается мгновенно; игнорируем повтор */
    }
  }
  while (openServers.length) {
    const srv = openServers.pop()!;
    await new Promise((r) => srv.close(() => r(null)));
  }
  __setPoolForTests(null);
});

/* -------------------------------------------------------------------------- */
/* Структура записи и секреты                                                  */
/* -------------------------------------------------------------------------- */

describe('formatPoolError — структурированная запись без секретов', () => {
  it('несёт только диагностику: код, severity, сообщение, состояние пула', () => {
    const entry = formatPoolError(fatalIdleError(), { poolTotal: 3, poolIdle: 2 });
    expect(entry).toEqual({
      event: 'pg_pool_idle_client_error',
      code: '57P01',
      severity: 'FATAL',
      message: 'terminating connection due to administrator command',
      recoverable: true,
      poolTotal: 3,
      poolIdle: 2,
    });
  });

  it('секреты не попадают в запись, даже если они есть на объекте ошибки', () => {
    const err = Object.assign(fatalIdleError(), {
      connectionString: 'postgresql://cryptora:SuperSecret@127.0.0.1:5432/cryptora',
      password: 'SuperSecret',
      host: '127.0.0.1',
      query: "SELECT * FROM users WHERE email = 'a@b.c'",
    });
    const entry = formatPoolError(err);
    const json = JSON.stringify(entry);
    expect(json).not.toContain('SuperSecret');
    expect(json).not.toContain('postgresql://');
    expect(json).not.toContain('SELECT');
    // Ключи записи фиксированы: новому полю неоткуда взять секрет.
    expect(Object.keys(entry).sort()).toEqual([
      'code', 'event', 'message', 'poolIdle', 'poolTotal', 'recoverable', 'severity',
    ]);
  });

  it('классифицирует восстановимые обрывы соединения и не путает их с ошибками запросов', () => {
    for (const code of ['57P01', '57P02', '57P03', 'ECONNRESET', 'EPIPE', 'ETIMEDOUT']) {
      expect(formatPoolError(Object.assign(new Error('x'), { code })).recoverable, code).toBe(true);
    }
    // Ошибка нарушения UNIQUE / синтаксиса — это баг вызывающего кода, а не
    // «сервер снял соединение»: она не должна помечаться восстановимой.
    for (const code of ['23505', '42P01', '22001', undefined, null]) {
      expect(formatPoolError(Object.assign(new Error('x'), { code })).recoverable, String(code)).toBe(false);
    }
  });

  it('не падает на мусоре вместо ошибки', () => {
    for (const junk of [undefined, null, 'строка', 42, {}]) {
      expect(() => formatPoolError(junk)).not.toThrow();
    }
    expect(formatPoolError('обрыв').message).toBe('обрыв');
  });
});

/* -------------------------------------------------------------------------- */
/* Слушатель на настоящем pg.Pool                                              */
/* -------------------------------------------------------------------------- */

describe('Обработчик события error на настоящем pg.Pool', () => {
  const CONNECTION = 'postgresql://cryptora:cryptora@127.0.0.1:5432/cryptora';

  it('БЕЗ обработчика то же событие фатально — именно это и чинится', () => {
    const bare = trackPool(new pg.Pool({ connectionString: CONNECTION }));
    // EventEmitter: 'error' без слушателя ⇒ throw ⇒ падение процесса.
    expect(() => bare.emit('error', fatalIdleError())).toThrow(
      /terminating connection due to administrator command/
    );
  });

  it('С обработчиком процесс выживает и пишет структурированную запись', () => {
    const entries: any[] = [];
    const pool = trackPool(attachPoolErrorHandlers(new pg.Pool({ connectionString: CONNECTION }), (e) => entries.push(e)));

    expect(() => pool.emit('error', fatalIdleError())).not.toThrow();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ event: 'pg_pool_idle_client_error', code: '57P01', recoverable: true });
    // Состояние пула снимается на момент ошибки (реальный Pool даёт числа).
    expect(entries[0].poolTotal).toBe(0);
    expect(entries[0].poolIdle).toBe(0);

    // Серия обрывов не накапливает состояние и не роняет процесс.
    for (let i = 0; i < 5; i++) expect(() => pool.emit('error', fatalIdleError())).not.toThrow();
    expect(entries).toHaveLength(6);
  });

  it('attachPoolErrorHandlers возвращает тот же пул и не ломает его API', async () => {
    const pool = new pg.Pool({ connectionString: CONNECTION });
    expect(attachPoolErrorHandlers(pool, () => {})).toBe(pool);
    expect(typeof pool.query).toBe('function');
    expect(typeof pool.connect).toBe('function');
    await trackPool(pool).end();
  });

  it('сломанный логгер не роняет процесс: цель обработчика — выжить', () => {
    const pool = trackPool(
      attachPoolErrorHandlers(new pg.Pool({ connectionString: CONNECTION }), () => {
        throw new Error('логгер недоступен');
      })
    );
    expect(() => pool.emit('error', fatalIdleError())).not.toThrow();
  });

  it('обрыв соединения на живом пуле: запрос отклоняется, процесс жив', async () => {
    // Сервер принимает TCP-соединение и сразу рвёт его — так выглядит снятие
    // соединения/недоступность БД. Ошибка АКТИВНОГО запроса обязана уйти
    // вызывающему (промис реджектится), а не в обработчик пула.
    const server = net.createServer((socket) => socket.destroy());
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    openServers.push(server);
    const port = (server.address() as net.AddressInfo).port;

    const entries: any[] = [];
    const pool = trackPool(
      attachPoolErrorHandlers(
        new pg.Pool({
          connectionString: `postgresql://cryptora:cryptora@127.0.0.1:${port}/cryptora`,
          connectionTimeoutMillis: 2000,
          max: 1,
        }),
        (e) => entries.push(e)
      )
    );

    await expect(pool.query('SELECT 1')).rejects.toBeTruthy();
    // Ни один необработанный 'error' не ускользнул: vitest сообщил бы о нём.
    expect(process.exitCode ?? 0).toBe(0);
    // Обработчик пула при этом не обязан сработать — важно, что падения нет.
    expect(entries.every((e) => e.event === 'pg_pool_idle_client_error')).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Остановка процесса: closePool терминален                                    */
/* -------------------------------------------------------------------------- */

describe('Остановка: пул закрывается терминально', () => {
  const fakePool = (state: { ended: number; queries: any[] }) => ({
    query: async (text: string, params: unknown[]) => {
      state.queries.push({ text, params });
      return { rows: [{ ok: 1 }] };
    },
    connect: async () => ({ release: () => {}, query: async () => ({ rows: [] }) }),
    end: async () => {
      state.ended++;
    },
    totalCount: 0,
    idleCount: 0,
    on: () => {},
  });

  it('запрос идёт через пул параметризованным SQL', async () => {
    const state = { ended: 0, queries: [] as any[] };
    __setPoolForTests(fakePool(state) as any);

    const res = await query('SELECT 1 AS ok WHERE id = $1', [7]);
    expect(res.rows).toEqual([{ ok: 1 }]);
    expect(state.queries).toEqual([{ text: 'SELECT 1 AS ok WHERE id = $1', params: [7] }]);

    const client = (await getClient()) as { release: () => void };
    expect(typeof client.release).toBe('function');
    expect(await checkDatabase()).toBe(true);
  });

  it('после closePool новое соединение НЕ открывается (гонка остановки)', async () => {
    const state = { ended: 0, queries: [] as any[] };
    __setPoolForTests(fakePool(state) as any);

    await closePool();
    expect(state.ended).toBe(1);
    expect(isPoolClosed()).toBe(true);

    // Именно здесь раньше возникал 57P01: запрос во время остановки открывал
    // новое соединение к закрывающейся БД.
    expect(() => getPool()).toThrow(/pool is closed/i);
    await expect(query('SELECT 1')).rejects.toThrow(/pool is closed/i);
    await expect(getClient()).rejects.toThrow(/pool is closed/i);
    // Недоступная БД при проверке здоровья — деградация, а не крах.
    expect(await checkDatabase()).toBe(false);
  });

  it('closePool идемпотентен', async () => {
    const state = { ended: 0, queries: [] as any[] };
    __setPoolForTests(fakePool(state) as any);
    await closePool();
    await closePool();
    expect(state.ended).toBe(1);
  });

  it('инъекция пула снимает флаг закрытия (teardown одного файла не ломает следующий)', async () => {
    await closePool();
    expect(isPoolClosed()).toBe(true);
    const state = { ended: 0, queries: [] as any[] };
    __setPoolForTests(fakePool(state) as any);
    expect(isPoolClosed()).toBe(false);
    await expect(query('SELECT 1')).resolves.toBeTruthy();
  });
});

/* -------------------------------------------------------------------------- */
/* Запрещённые способы «починить» F-17                                         */
/* -------------------------------------------------------------------------- */

describe('Запрещённые маскировки проблемы отсутствуют в коде', () => {
  const sources = [
    'server/db/pool.js',
    'server/index.js',
    'server/app.js',
    '.github/workflows/ci.yml',
  ].map((rel) => ({ rel, text: fs.readFileSync(path.join(ROOT, rel), 'utf8') }));

  it('нет dangerouslyIgnoreUnhandledErrors', () => {
    for (const { rel, text } of sources) {
      expect(text, rel).not.toContain('dangerouslyIgnoreUnhandledErrors');
    }
  });

  it('нет глобального проглатывания uncaughtException / unhandledRejection', () => {
    for (const { rel, text } of sources.filter((s) => s.rel.endsWith('.js'))) {
      expect(text, rel).not.toMatch(/process\.on\(\s*['"]uncaughtException['"]/);
      expect(text, rel).not.toMatch(/process\.on\(\s*['"]unhandledRejection['"]/);
    }
  });

  it('в CI нет ретраев, прячущих падение', () => {
    const ci = sources.find((s) => s.rel.endsWith('ci.yml'))!.text;
    expect(ci).not.toMatch(/retry|retries|--repeat|continue-on-error/i);
  });

  it('обработчик события error пула действительно присутствует', () => {
    const pool = sources.find((s) => s.rel === 'server/db/pool.js')!.text;
    expect(pool).toMatch(/\.on\('error'/);
    // И остановка закрывает пул последним шагом.
    const index = sources.find((s) => s.rel === 'server/index.js')!.text;
    expect(index).toContain('await closePool()');
    expect(index.indexOf('getStrategyScheduler().stop()')).toBeLessThan(index.indexOf('await closePool()'));
  });

  it('обработчик навешивается при создании пула, а не по желанию вызывающего', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const pool = trackPool(getPool());
      expect(() => pool.emit('error', fatalIdleError())).not.toThrow();
      // Дефолтный логгер пишет двумя аргументами: префикс и JSON записи.
      const logged = spy.mock.calls.map((c) => c.map((x) => String(x)).join(' ')).join('\n');
      expect(logged).toContain('pg_pool_idle_client_error');
      expect(logged).not.toContain('SuperSecret');
    } finally {
      spy.mockRestore();
    }
  });
});

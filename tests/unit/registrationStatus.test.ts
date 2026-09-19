/**
 * CRYPTORA — GET /api/auth/registration-status
 *
 * REAL: express-приложение, роутер auth, middleware, конфиг.
 * MOCKED: только SQL-слой (MemoryDb) — эндпоинт к БД не обращается, но
 *         приложение поднимается целиком, как в authIntegration.test.ts.
 *
 * Инвариант: публичный статус должен совпадать с тем флагом, который
 * блокирует POST /api/auth/register. Иначе UI обещает одно, а API делает другое.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

process.env.LOGIN_RATE_LIMIT = '100000';
process.env.REGISTER_RATE_LIMIT = '100000';
process.env.API_RATE_LIMIT = '1000000';
process.env.SESSION_STORE = 'memory';
process.env.MAIL_TRANSPORT = 'json';

const { __setPoolForTests } = await import('../../server/db/pool.js');
const { MemoryDb } = await import('../helpers/memoryDb');
const { listen } = await import('../helpers/httpHarness');

let close: () => Promise<void>;

beforeEach(() => {
  __setPoolForTests(new MemoryDb().asPool());
});

afterEach(async () => {
  await close?.();
  vi.resetModules();
});

const startApp = async () => {
  // config.js читает process.env один раз при импорте, поэтому приложение
  // пересобирается заново — иначе REGISTRATION_ENABLED не подхватится.
  const { createApp } = await import('../../server/app.js');
  const harness = await listen(createApp({ sessionStore: 'memory' }));
  close = harness.close;
  return harness.client;
};

describe('GET /api/auth/registration-status', () => {
  it('отдаёт registrationOpen=true при включённой регистрации', async () => {
    const prev = process.env.REGISTRATION_ENABLED;
    process.env.REGISTRATION_ENABLED = 'true';
    try {
      vi.resetModules();
      const c = await startApp();
      const res = await c.get('/api/auth/registration-status');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ registrationOpen: true });
    } finally {
      process.env.REGISTRATION_ENABLED = prev;
    }
  });

  it('отдаёт registrationOpen=false при выключенной регистрации', async () => {
    const prev = process.env.REGISTRATION_ENABLED;
    process.env.REGISTRATION_ENABLED = 'false';
    try {
      vi.resetModules();
      const c = await startApp();
      const res = await c.get('/api/auth/registration-status');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ registrationOpen: false });
    } finally {
      process.env.REGISTRATION_ENABLED = prev;
    }
  });

  it('публичный статус согласован с отказом POST /api/auth/register', async () => {
    const prev = process.env.REGISTRATION_ENABLED;
    process.env.REGISTRATION_ENABLED = 'false';
    try {
      vi.resetModules();
      const c = await startApp();

      const status = await c.get('/api/auth/registration-status');
      const attempt = await c.post('/api/auth/register', {
        email: 'carol@example.com',
        displayName: 'Carol',
        password: 'correct horse battery',
      });

      // Закрыто в статусе ⇒ закрыто и по факту.
      expect((status.body as { registrationOpen: boolean }).registrationOpen).toBe(false);
      expect(attempt.status).toBe(403);
    } finally {
      process.env.REGISTRATION_ENABLED = prev;
    }
  });

  it('эндпоинт не требует аутентификации', async () => {
    const prev = process.env.REGISTRATION_ENABLED;
    process.env.REGISTRATION_ENABLED = 'true';
    try {
      vi.resetModules();
      const c = await startApp();
      const res = await c.get('/api/auth/registration-status');
      // Никаких 401/403 для анонимного запроса.
      expect([401, 403]).not.toContain(res.status);
    } finally {
      process.env.REGISTRATION_ENABLED = prev;
    }
  });
});

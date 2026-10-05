/**
 * CRYPTORA — контракт health-эндпоинтов.
 *
 * Этот файл назван в комментарии `server/routes/health.js` как место, где
 * контракт закреплён. Проверяется три вещи, которые нельзя оставлять на
 * внимательность ревьюера:
 *
 *   1. состав и форма ответа (включая поля обратной совместимости);
 *   2. коды HTTP: 200 для ok/degraded, 503 только при отказе БД;
 *   3. ОТСУТСТВИЕ СЕКРЕТОВ в сериализованном теле — DSN, токены, пароли,
 *      chat id, e-mail, текст ошибки драйвера БД.
 *
 * Роутер монтируется в настоящее Express-приложение и опрашивается по
 * настоящему HTTP: так же, как его будет опрашивать Nginx.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

const buildHealthReport = vi.fn();
const buildReadinessReport = vi.fn();

vi.mock('../../server/services/health/healthService.js', () => ({
  buildHealthReport: (...args: unknown[]) => buildHealthReport(...args),
  buildReadinessReport: (...args: unknown[]) => buildReadinessReport(...args),
}));

vi.mock('../../server/services/mail.js', () => ({
  getMailStatus: () => ({
    configured: true,
    // Намеренно кладём секреты в соседние поля: роутер не должен их пробросить.
    host: 'smtp.internal.example.com',
    user: 'postmaster@cryptora.example',
    pass: 'super-secret-smtp-password',
  }),
}));

vi.mock('../../server/services/oauth/providers.js', () => ({
  isProviderConfigured: (name: string) => name === 'google' || name === 'telegram',
}));

/** Полный здоровый отчёт — форма, которую обещает docs/HEALTH_MONITORING.md. */
function healthyBody(): Record<string, any> {
  return {
    status: 'ok',
    timestamp: '2026-10-05T12:00:00.000Z',
    uptimeSeconds: 86400,
    version: '0.9.3',
    environment: 'production',
    database: { status: 'ok', latencyMs: 3, errorCode: null, slowThresholdMs: 500 },
    marketData: {
      status: 'ok',
      lastSuccessfulUpdate: '2026-10-05T11:59:30.000Z',
      ageSeconds: 30,
      staleThresholdSeconds: 900,
      feeds: {
        'binance-spot-candles': {
          exchange: 'binance',
          market: 'spot',
          kind: 'candles',
          critical: true,
          observed: true,
          status: 'ok',
          reason: null,
          sourceTimestamp: '2026-10-05T11:58:00.000Z',
          receivedAt: '2026-10-05T11:59:30.000Z',
          ageSeconds: 30,
          sourceAgeSeconds: 120,
          thresholdSeconds: 900,
          successes: 120,
          failures: 0,
        },
      },
    },
    signalMonitor: {
      status: 'ok',
      lastCycleStartedAt: '2026-10-05T11:59:45.000Z',
      lastCycleCompletedAt: '2026-10-05T11:59:45.120Z',
      lastSuccessfulCycleAt: '2026-10-05T11:59:45.120Z',
      lastCycleAt: '2026-10-05T11:59:45.120Z',
      ageSeconds: 15,
      durationMs: 120,
      cycles: 2880,
      inspectedSignals: 7,
      updatedSignals: 1,
      errors: 0,
      consecutiveFailures: 0,
      reason: null,
      staleThresholdSeconds: 300,
    },
    radarMonitor: { status: 'ok', ageSeconds: 20, reason: null },
    strategyScheduler: { status: 'ok', ageSeconds: 10, reason: null },
    thresholds: { marketDataStaleSeconds: 900 },
  };
}

let server: Server;
let base = '';

async function get(path: string) {
  const res = await fetch(`${base}${path}`);
  const text = await res.text();
  return { status: res.status, text, body: JSON.parse(text) as Record<string, any> };
}

beforeAll(async () => {
  const express = (await import('express')).default;
  const router = (await import('../../server/routes/health.js')).default;
  const app = express();
  app.use('/api/health', router);
  // Обработчик ошибок как в приложении: клиенту — обобщённое сообщение.
  app.use((_err: unknown, _req: unknown, res: any, _next: unknown) => {
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  });

  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = server.address() as AddressInfo;
  base = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  buildHealthReport.mockReset();
  buildReadinessReport.mockReset();
});

describe('GET /api/health/live', () => {
  it('всегда 200 и не зависит от БД: liveness не должна перезапускать здоровый процесс при аварии базы', async () => {
    // healthService намеренно сломан — liveness обязан его не звать.
    buildHealthReport.mockRejectedValue(new Error('db down'));
    buildReadinessReport.mockRejectedValue(new Error('db down'));

    const res = await get('/api/health/live');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('alive');
    expect(typeof res.body.uptimeSeconds).toBe('number');
    expect(res.body.pid).toBe(process.pid);
    expect(buildHealthReport).not.toHaveBeenCalled();
    expect(buildReadinessReport).not.toHaveBeenCalled();
  });
});

describe('GET /api/health/ready', () => {
  it('отдаёт 200 и status=ready, когда сервис готов', async () => {
    buildReadinessReport.mockResolvedValue({
      httpStatus: 200,
      body: { status: 'ready', timestamp: 'now', database: { status: 'ok' }, subsystems: {} },
    });

    const res = await get('/api/health/ready');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ready');
  });

  it('отдаёт 503 и status=not_ready, когда подсистемы не подняты', async () => {
    buildReadinessReport.mockResolvedValue({
      httpStatus: 503,
      body: { status: 'not_ready', timestamp: 'now', database: { status: 'error' }, subsystems: {} },
    });

    const res = await get('/api/health/ready');

    expect(res.status).toBe(503);
    expect(res.body.status).toBe('not_ready');
  });

  it('исключение уходит в error handler, а не наружу сырым текстом', async () => {
    buildReadinessReport.mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.5:5432'));

    const res = await get('/api/health/ready');

    expect(res.status).toBe(500);
    expect(res.text).not.toContain('10.0.0.5');
    expect(res.text).not.toContain('ECONNREFUSED');
  });
});

describe('GET /api/health — форма ответа', () => {
  it('содержит все разделы контракта', async () => {
    buildHealthReport.mockResolvedValue({ httpStatus: 200, body: healthyBody() });

    const res = await get('/api/health');

    expect(res.status).toBe(200);
    for (const key of [
      'status',
      'timestamp',
      'uptimeSeconds',
      'version',
      'environment',
      'database',
      'marketData',
      'signalMonitor',
      'radarMonitor',
      'strategyScheduler',
      'thresholds',
    ]) {
      expect(res.body, `отсутствует поле ${key}`).toHaveProperty(key);
    }
  });

  it('каждый поток рыночных данных отдаёт ОБА времени: источника и приёма', async () => {
    buildHealthReport.mockResolvedValue({ httpStatus: 200, body: healthyBody() });

    const feed = (await get('/api/health')).body.marketData.feeds['binance-spot-candles'];

    // Два независимых времени — иначе «200 OK от биржи» выдавалось бы за свежесть.
    expect(feed).toHaveProperty('sourceTimestamp');
    expect(feed).toHaveProperty('receivedAt');
    expect(feed).toHaveProperty('sourceAgeSeconds');
    expect(feed).toHaveProperty('ageSeconds');
    expect(feed.critical).toBe(true);
  });

  it('сохраняет поля обратной совместимости и отдаёт в них ТОЛЬКО булевы флаги', async () => {
    buildHealthReport.mockResolvedValue({ httpStatus: 200, body: healthyBody() });

    const body = (await get('/api/health')).body;

    expect(body.app).toBe('CRYPTORA Market Intelligence Terminal');
    expect(body.node).toBe(process.version);
    expect(body.mail).toEqual({ configured: true });
    expect(body.providers).toEqual({
      google: true,
      telegram: true,
      yandex: false,
      vk: false,
    });
    // Ни хоста SMTP, ни пользователя, ни пароля — только факт настройки.
    expect(Object.keys(body.mail)).toEqual(['configured']);
    for (const value of Object.values(body.providers)) {
      expect(typeof value).toBe('boolean');
    }
  });
});

describe('GET /api/health — коды HTTP', () => {
  it('degraded остаётся 200: узел обслуживает запросы, выводить его из ротации нельзя', async () => {
    const body = healthyBody();
    body.status = 'degraded';
    body.signalMonitor.status = 'stale';
    body.signalMonitor.reason = 'CYCLE_AGE_EXCEEDED';
    buildHealthReport.mockResolvedValue({ httpStatus: 200, body });

    const res = await get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('degraded');
  });

  it('error отдаёт 503 и категорию ошибки БД вместо сообщения драйвера', async () => {
    const body = healthyBody();
    body.status = 'error';
    body.database = { status: 'error', latencyMs: 2000, errorCode: 'TIMEOUT', slowThresholdMs: 500 };
    buildHealthReport.mockResolvedValue({ httpStatus: 503, body });

    const res = await get('/api/health');

    expect(res.status).toBe(503);
    expect(res.body.database.errorCode).toBe('TIMEOUT');
    // Категория — это перечислимое значение, а не произвольный текст pg.
    expect(['TIMEOUT', 'UNAVAILABLE', null]).toContain(res.body.database.errorCode);
  });

  it('падение healthService не отдаёт деталей клиенту', async () => {
    buildHealthReport.mockRejectedValue(
      new Error('password authentication failed for user "cryptora" at db.internal:5432'),
    );

    const res = await get('/api/health');

    expect(res.status).toBe(500);
    expect(res.text).not.toContain('password');
    expect(res.text).not.toContain('db.internal');
    expect(res.text).not.toContain('cryptora"');
  });
});

describe('GET /api/health — отсутствие секретов', () => {
  const FORBIDDEN: Array<[string, RegExp]> = [
    ['postgres DSN', /postgres(ql)?:\/\//i],
    ['пароль', /\bpass(word|wd)?\b\s*[:=]/i],
    ['секрет/токен', /\b(secret|token|apikey|api_key|bearer)\b/i],
    ['e-mail', /[\w.+-]+@[\w-]+\.[a-z]{2,}/i],
    ['Telegram bot token', /\d{6,}:[A-Za-z0-9_-]{30,}/],
    ['приватный IP:port', /\b(10|192\.168|127)\.\d+\.\d+\.\d+:\d+/],
  ];

  it.each(FORBIDDEN)('не содержит %s', async (_label, pattern) => {
    buildHealthReport.mockResolvedValue({ httpStatus: 200, body: healthyBody() });

    const res = await get('/api/health');

    expect(res.text).not.toMatch(pattern);
  });

  it('не содержит секретов и в аварийном ответе (503)', async () => {
    const body = healthyBody();
    body.status = 'error';
    body.database = {
      status: 'error',
      latencyMs: 12,
      errorCode: 'UNAVAILABLE',
      slowThresholdMs: 500,
    };
    buildHealthReport.mockResolvedValue({ httpStatus: 503, body });

    const res = await get('/api/health');

    expect(res.status).toBe(503);
    for (const [, pattern] of FORBIDDEN) {
      expect(res.text).not.toMatch(pattern);
    }
  });

  it('значение process.env.DATABASE_URL не встречается в ответе', async () => {
    const previous = process.env.DATABASE_URL;
    process.env.DATABASE_URL = 'postgresql://audit_user:hunter2@10.0.0.5:5432/cryptora_prod';
    buildHealthReport.mockResolvedValue({ httpStatus: 200, body: healthyBody() });

    try {
      const res = await get('/api/health');
      expect(res.text).not.toContain('hunter2');
      expect(res.text).not.toContain('audit_user');
      expect(res.text).not.toContain(process.env.DATABASE_URL);
    } finally {
      if (previous === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previous;
    }
  });
});

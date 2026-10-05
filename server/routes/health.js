/**
 * CRYPTORA — Health endpoints.
 *
 *   GET /api/health       полный отчёт (БД, рыночные данные, мониторы)
 *   GET /api/health/live   liveness: процесс Node жив
 *   GET /api/health/ready  readiness: БД доступна, подсистемы подняты
 *
 * Аутентификация не требуется: эти эндпоинты опрашивают Nginx, systemd и
 * внешний мониторинг. ИМЕННО ПОЭТОМУ в ответе нет ни одного секрета:
 * ни DATABASE_URL, ни токенов, ни адресов почты, ни chat id, ни текста
 * ошибок драйвера БД (он содержит хост/порт/имя базы). Состав ответа
 * закреплён тестом `tests/unit/healthEndpointContract.test.ts`.
 *
 * Нагрузка: один `SELECT 1` с таймаутом + чтение in-memory телеметрии.
 * Ни обхода таблицы сигналов, ни запросов к биржам.
 */

import { Router } from 'express';
import { config } from '../config.js';
import { getMailStatus } from '../services/mail.js';
import { isProviderConfigured } from '../services/oauth/providers.js';
import { buildHealthReport, buildReadinessReport } from '../services/health/healthService.js';
import { readPackageVersion } from '../services/health/version.js';

const router = Router();

/**
 * Liveness. НИЧЕГО не проверяет, кроме того, что процесс способен ответить.
 *
 * Так и задумано: liveness-проба, которая ходит в БД, перезапускает
 * здоровый процесс при аварии базы — это усиление отказа, а не защита.
 */
router.get('/live', (req, res) => {
  res.status(200).json({
    status: 'alive',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    pid: process.pid,
  });
});

/** Readiness: можно ли направлять трафик на этот узел. */
router.get('/ready', async (req, res, next) => {
  try {
    const { httpStatus, body } = await buildReadinessReport();
    res.status(httpStatus).json(body);
  } catch (error) {
    next(error);
  }
});

/**
 * Полный отчёт.
 *
 * HTTP-коды: 200 для `ok` и `degraded` (узел обслуживает запросы),
 * 503 только для `error` (БД недоступна — работать нечем).
 */
router.get('/', async (req, res, next) => {
  try {
    const { httpStatus, body } = await buildHealthReport();
    res.status(httpStatus).json({
      ...body,
      app: 'CRYPTORA Market Intelligence Terminal',
      node: process.version,
      // ── Совместимость с прежним контрактом (PR ≤ #54) ──────────────────
      // Прежние потребители (Nginx check, старые дашборды) читали именно эти
      // поля. Значения — ТОЛЬКО булевы флаги конфигурации: никогда не хост,
      // не пользователь, не client id, не токен.
      // `database` стало объектом (статус + латентность + категория ошибки),
      // поэтому прежнее строковое значение сохранено отдельным полем: старая
      // проба, читавшая 'connected'/'disconnected', продолжает работать.
      databaseStatus: body?.database?.status === 'ok' ? 'connected' : 'disconnected',
      mail: { configured: getMailStatus().configured === true },
      providers: {
        google: isProviderConfigured('google'),
        telegram: isProviderConfigured('telegram'),
        yandex: isProviderConfigured('yandex'),
        vk: isProviderConfigured('vk'),
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;

/** Экспортируется для тестов контракта. */
export const HEALTH_VERSION = readPackageVersion();
export const HEALTH_ENVIRONMENT = config.NODE_ENV;

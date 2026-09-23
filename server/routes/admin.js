/**
 * CRYPTORA — Admin Routes
 *
 * All routes require auth + admin role.
 *
 * GET  /api/admin/dashboard  — Backend health, DB status, version, uptime
 * GET  /api/admin/users      — List users with search
 * PATCH /api/admin/users/:id/block   — Block user
 * PATCH /api/admin/users/:id/unblock — Unblock user
 * GET  /api/admin/system     — Read-only system info
 */

import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { query, checkDatabase } from '../db/pool.js';
import { config } from '../config.js';
import { recordAudit } from '../services/audit.js';
import {
  setStrategyEnabled,
  engineStatus,
} from '../services/strategySettings.js';
import { isKnownStrategyId } from '../services/strategyCatalog.js';
import { schedulerStatus } from '../services/strategyEngine/strategyScheduler.js';
import {
  getScanUniverseState,
  addScanSymbol,
  removeScanSymbol,
  SCAN_UNIVERSE_MAX,
} from '../services/scanUniverse.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const APP_VERSION = (() => {
  try {
    return JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8')
    ).version ?? 'unknown';
  } catch {
    return 'unknown';
  }
})();

const router = Router();

// All admin routes require auth + admin
router.use(requireAuth, requireAdmin);

/* ------------------------------------------------------------------ */
/* GET /api/admin/dashboard                                           */
/* ------------------------------------------------------------------ */
router.get('/dashboard', async (req, res) => {
  const dbHealthy = await checkDatabase();

  // Count users by role/status
  const userStats = await query(`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE role = 'admin')::int AS admins,
      COUNT(*) FILTER (WHERE role = 'user')::int AS users,
      COUNT(*) FILTER (WHERE is_active = true)::int AS active,
      COUNT(*) FILTER (WHERE is_active = false)::int AS blocked
    FROM users
  `);

  // Recent audit entries
  const recentAudit = await query(`
    SELECT al.action, al.target_type, al.target_id, al.created_at,
           u.display_name AS actor_name
    FROM audit_log al
    JOIN users u ON u.id = al.actor_user_id
    ORDER BY al.created_at DESC
    LIMIT 10
  `);

  res.json({
    health: {
      status: dbHealthy ? 'ok' : 'degraded',
      database: dbHealthy ? 'connected' : 'disconnected',
      version: APP_VERSION,
      nodeVersion: process.version,
      environment: config.NODE_ENV,
      uptimeSeconds: Math.floor(process.uptime()),
      registrationEnabled: config.REGISTRATION_ENABLED,
    },
    users: userStats.rows[0] || { total: 0, admins: 0, users: 0, active: 0, blocked: 0 },
    recentAudit: recentAudit.rows,
    timestamp: new Date().toISOString(),
  });
});

/* ------------------------------------------------------------------ */
/* GET /api/admin/users                                               */
/* ------------------------------------------------------------------ */
router.get('/users', async (req, res) => {
  const search = (req.query.search || '').toString().trim().toLowerCase();
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize || '20', 10)));
  const offset = (page - 1) * pageSize;

  let whereClause = '';
  const params = [];
  let paramIndex = 1;

  if (search) {
    whereClause = `WHERE lower(email) LIKE $${paramIndex} OR lower(display_name) LIKE $${paramIndex}`;
    params.push(`%${search}%`);
    paramIndex++;
  }

  const countResult = await query(
    `SELECT COUNT(*)::int AS total FROM users ${whereClause}`,
    params
  );

  const usersResult = await query(
    `SELECT id, email, display_name, role, is_active, email_verified, created_at, last_login_at
     FROM users
     ${whereClause}
     ORDER BY created_at DESC
     LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
    [...params, pageSize, offset]
  );

  res.json({
    users: usersResult.rows.map((u) => ({
      id: u.id,
      email: u.email,
      displayName: u.display_name,
      role: u.role,
      isActive: u.is_active,
      emailVerified: u.email_verified ?? false,
      createdAt: u.created_at,
      lastLoginAt: u.last_login_at,
    })),
    pagination: {
      page,
      pageSize,
      total: countResult.rows[0].total,
      totalPages: Math.ceil(countResult.rows[0].total / pageSize),
    },
  });
});

/* ------------------------------------------------------------------ */
/* PATCH /api/admin/users/:id/block                                   */
/* ------------------------------------------------------------------ */
router.patch('/users/:id/block', async (req, res) => {
  const { id } = req.params;

  // Self-block protection
  if (id === req.user.id) {
    return res.status(400).json({ error: 'Нельзя заблокировать самого себя' });
  }

  // Verify target exists and is currently active
  const target = await query(
    'SELECT id, email, is_active FROM users WHERE id = $1',
    [id]
  );

  if (target.rows.length === 0) {
    return res.status(404).json({ error: 'Пользователь не найден' });
  }

  if (!target.rows[0].is_active) {
    return res.status(400).json({ error: 'Пользователь уже заблокирован' });
  }

  // Block
  await query(
    'UPDATE users SET is_active = false, updated_at = now() WHERE id = $1',
    [id]
  );

  // Invalidate all sessions for this user
  await query(
    "DELETE FROM sessions WHERE sess->>'userId' = $1",
    [id]
  );

  // Audit
  await recordAudit({
    actorUserId: req.user.id,
    action: 'USER_BLOCK',
    targetType: 'user',
    targetId: id,
    metadata: { targetEmail: target.rows[0].email },
  });

  res.json({ message: 'Пользователь заблокирован' });
});

/* ------------------------------------------------------------------ */
/* PATCH /api/admin/users/:id/unblock                                 */
/* ------------------------------------------------------------------ */
router.patch('/users/:id/unblock', async (req, res) => {
  const { id } = req.params;

  // Verify target exists and is currently blocked
  const target = await query(
    'SELECT id, email, is_active FROM users WHERE id = $1',
    [id]
  );

  if (target.rows.length === 0) {
    return res.status(404).json({ error: 'Пользователь не найден' });
  }

  if (target.rows[0].is_active) {
    return res.status(400).json({ error: 'Пользователь уже активен' });
  }

  // Unblock
  await query(
    'UPDATE users SET is_active = true, updated_at = now() WHERE id = $1',
    [id]
  );

  // Audit
  await recordAudit({
    actorUserId: req.user.id,
    action: 'USER_UNBLOCK',
    targetType: 'user',
    targetId: id,
    metadata: { targetEmail: target.rows[0].email },
  });

  res.json({ message: 'Пользователь разблокирован' });
});

/* ------------------------------------------------------------------ */
/* GET /api/admin/system                                              */
/* ------------------------------------------------------------------ */
router.get('/system', async (req, res) => {
  const dbHealthy = await checkDatabase();

  res.json({
    version: APP_VERSION,
    nodeVersion: process.version,
    environment: config.NODE_ENV,
    uptimeSeconds: Math.floor(process.uptime()),
    database: dbHealthy ? 'connected' : 'disconnected',
    memoryUsage: {
      rss: Math.round(process.memoryUsage().rss / 1024 / 1024) + ' MB',
      heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + ' MB',
    },
    timestamp: new Date().toISOString(),
  });
});

/* ------------------------------------------------------------------ */
/* Стратегии: глобальный переключатель ВКЛ/ВЫКЛ                        */
/* ------------------------------------------------------------------ */

/**
 * GET /api/admin/strategies/status
 *
 * Сводка для админ-панели: сколько стратегий включено, когда был последний
 * скан/сигнал, есть ли ошибки, жив ли планировщик. Все числа — результат
 * реальных запросов и реального состояния процесса.
 */
router.get('/strategies/status', async (_req, res, next) => {
  try {
    const [db, scheduler] = await Promise.all([engineStatus(), schedulerStatus()]);
    res.json({ ...db, scheduler });
  } catch (e) {
    next(e);
  }
});

/**
 * PATCH /api/admin/strategies/:strategyId
 *
 * Тело: { "enabled": true }
 *
 * Только переключатель. Математические параметры стратегии через API не
 * меняются и не принимаются: они живут в коде, а не в БД.
 *
 * Защита — requireAdmin на уровне всего router'а (см. выше). Роль,
 * прочитанная на фронте, защитой не является и здесь не используется.
 */
router.patch('/strategies/:strategyId', async (req, res, next) => {
  const { strategyId } = req.params;

  if (!isKnownStrategyId(strategyId)) {
    return res.status(404).json({
      error: 'UNKNOWN_STRATEGY',
      message: `Стратегия «${strategyId}» не существует. Четвёртую стратегию создать нельзя.`,
    });
  }

  const { enabled } = req.body ?? {};
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({
      error: 'INVALID_BODY',
      message: 'Ожидается тело вида {"enabled": true|false}.',
    });
  }

  try {
    const updated = await setStrategyEnabled({
      strategyId,
      enabled,
      actorUserId: req.user.id,
    });
    // Планировщик перечитывает strategy_settings каждый цикл, поэтому
    // перезапуск бэкенда не требуется.
    res.json({
      strategyId,
      enabled: updated.enabled,
      updatedAt: updated.updated_at,
      message: enabled ? 'Стратегия включена' : 'Стратегия выключена',
    });
  } catch (e) {
    next(e);
  }
});

/* ------------------------------------------------------------------ */
/* Scan Universe (Admin → Монеты)                                      */
/* ------------------------------------------------------------------ */
/*
 * Доступность монет на сайте НЕ управляется здесь: все активные Spot USDT
 * инструменты Binance доступны автоматически (exchangeInfo). Здесь — только
 * какие из них сканирует движок сигналов. Хранение — PostgreSQL, общее для
 * всех процессов и пользователей.
 */

router.get('/scan-universe', async (_req, res, next) => {
  try {
    const state = await getScanUniverseState();
    res.json({ ...state, max: SCAN_UNIVERSE_MAX });
  } catch (e) {
    next(e);
  }
});

router.post('/scan-universe', async (req, res, next) => {
  try {
    const result = await addScanSymbol({ symbol: req.body?.symbol, actorUserId: req.user.id });
    const state = await getScanUniverseState();
    res.json({ ...result, ...state, max: SCAN_UNIVERSE_MAX });
  } catch (e) {
    if (e?.statusCode) return res.status(e.statusCode).json({ error: 'SCAN_UNIVERSE', message: e.message });
    next(e);
  }
});

router.delete('/scan-universe/:symbol', async (req, res, next) => {
  try {
    const result = await removeScanSymbol({ symbol: req.params.symbol, actorUserId: req.user.id });
    const state = await getScanUniverseState();
    res.json({ ...result, ...state, max: SCAN_UNIVERSE_MAX });
  } catch (e) {
    if (e?.statusCode) return res.status(e.statusCode).json({ error: 'SCAN_UNIVERSE', message: e.message });
    next(e);
  }
});

export default router;

/**
 * CRYPTORA — Backend Entry Point
 *
 * Production: listens on 127.0.0.1:3000 (behind Nginx).
 * Development: same, but with relaxed cookie settings.
 *
 * Does NOT serve static files — Nginx handles that in production.
 * For development, run `npm run dev` (Vite) alongside `npm run server`.
 */

import { createApp } from './app.js';
import { config } from './config.js';
import { checkDatabase } from './db/pool.js';
import { getStrategyScheduler } from './services/strategyEngine/strategyScheduler.js';

const app = createApp();

async function start() {
  // Verify DB connectivity before accepting traffic
  const dbOk = await checkDatabase();
  if (!dbOk) {
    console.error('[CRYPTORA] WARNING: Database not reachable. Server will start but /api/health will report degraded.');
  } else {
    console.log('[CRYPTORA] Database connected.');
  }

  // ── Серверный движок стратегий ──────────────────────────────────────
  // Стартует вместе с бэкендом и работает, даже когда браузер закрыт.
  // Перед каждым циклом перечитывает strategy_settings из PostgreSQL, поэтому:
  //   • после рестарта подхватывается актуальное состояние ВКЛ/ВЫКЛ;
  //   • переключение в админке действует без перезапуска;
  //   • если все стратегии выключены (состояние по умолчанию после миграции),
  //     выполняется ноль сканов и ноль запросов к рыночным данным.
  // Отказ движка не должен ронять бэкенд — ошибки логируются внутри.
  if (dbOk) {
    try {
      getStrategyScheduler().start();
      console.log('[CRYPTORA] Strategy scheduler started (enabled strategies only).');
    } catch (err) {
      console.error('[CRYPTORA] Strategy scheduler failed to start:', err.message);
    }
  } else {
    console.warn('[CRYPTORA] Strategy scheduler NOT started: database unreachable.');
  }

  app.listen(config.PORT, config.HOST, () => {
    console.log('=======================================================');
    console.log('  CRYPTORA Backend Server');
    console.log(`  Listening on: http://${config.HOST}:${config.PORT}`);
    console.log(`  Environment:  ${config.NODE_ENV}`);
    console.log(`  Registration: ${config.REGISTRATION_ENABLED ? 'enabled' : 'disabled'}`);
    console.log('=======================================================');
  });
}

// Graceful shutdown
let shuttingDown = false;

const shutdown = async (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\nReceived ${signal}. Shutting down...`);
  try {
    // Корректное завершение: отменяем таймеры и дожидаемся текущих сканов,
    // чтобы не оборвать запись сигнала и не оставить замок стратегии.
    await getStrategyScheduler().stop();
    console.log('[CRYPTORA] Strategy scheduler stopped.');
  } catch (err) {
    console.error('[CRYPTORA] Error stopping strategy scheduler:', err.message);
  }
  process.exit(0);
};

process.on('SIGTERM', () => { shutdown('SIGTERM'); });
process.on('SIGINT', () => { shutdown('SIGINT'); });

start().catch((err) => {
  console.error('[CRYPTORA] Fatal startup error:', err);
  process.exit(1);
});
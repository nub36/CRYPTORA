/**
 * CRYPTORA — Express Application
 *
 * Importable app module (no listen). Used by:
 *   - server/index.js (production entry)
 *   - tests/integration/* (real route handlers against a mock DB)
 */

import express from 'express';
import helmet from 'helmet';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import cookieParser from 'cookie-parser';

import { config } from './config.js';
import { getPool } from './db/pool.js';
import { csrfProtection } from './middleware/csrf.js';
import { errorHandler, apiNotFound } from './middleware/errorHandler.js';
import { apiLimiter } from './middleware/rateLimit.js';

// Route modules
import healthRouter from './routes/health.js';
import authRouter from './routes/auth.js';
import meRouter from './routes/me.js';
import adminRouter from './routes/admin.js';

const PgStore = connectPgSimple(session);

/**
 * Resolve the session store.
 *
 * Production is PostgreSQL-backed. The MemoryStore variant exists only so the
 * integration suite can exercise the real session middleware without a live
 * PostgreSQL; it is refused outright when NODE_ENV=production so that a
 * stray SESSION_STORE=memory can never silently degrade production.
 *
 * @param {{ sessionStore?: 'postgres' | 'memory' }} [options]
 */
function resolveSessionStore(options = {}) {
  const kind = options.sessionStore || config.SESSION_STORE;

  if (kind === 'memory') {
    if (config.NODE_ENV === 'production') {
      throw new Error(
        'SESSION_STORE=memory is not permitted when NODE_ENV=production. ' +
        'Production must use the PostgreSQL session store.'
      );
    }
    return new session.MemoryStore();
  }

  if (kind !== 'postgres') {
    throw new Error(`Unknown SESSION_STORE: ${kind}`);
  }

  return new PgStore({
    pool: getPool(),
    tableName: 'sessions',
    createTableIfMissing: false, // We manage migrations manually
  });
}

/**
 * @param {{ sessionStore?: 'postgres' | 'memory' }} [options]
 */
export function createApp(options = {}) {
  const app = express();

  // Trust proxy (Nginx sets X-Forwarded-For, X-Forwarded-Proto)
  app.set('trust proxy', 1);

  // Security headers
  app.use(helmet({
    contentSecurityPolicy: false, // CSP handled by Nginx
    crossOriginEmbedderPolicy: false,
  }));

  // Body parsing with size limits
  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));
  app.use(cookieParser());

  // Session (server-side; PostgreSQL-backed in production)
  app.use(session({
    store: resolveSessionStore(options),
    name: 'sid',
    secret: config.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: config.COOKIE_SECURE,
      sameSite: config.COOKIE_SAMESITE,
      path: '/',
      maxAge: config.SESSION_MAX_AGE,
    },
  }));

  // CSRF protection for state-changing requests
  app.use(csrfProtection);

  // General API rate limiter (applied to all /api/* except auth which has tighter limits)
  app.use('/api', apiLimiter);

  // ── Routes ────────────────────────────────────────────────────────
  app.use('/api/health', healthRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/me', meRouter);
  app.use('/api/admin', adminRouter);

  // 404 for unmatched API routes
  app.use('/api', apiNotFound);

  // Global error handler (must be last)
  app.use(errorHandler);

  return app;
}
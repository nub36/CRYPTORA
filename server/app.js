/**
 * CRYPTORA — Express Application
 *
 * Importable app module (no listen). Used by:
 *   - server/index.js (production entry)
 *   - tests (supertest)
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

export function createApp() {
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

  // Session (server-side, PostgreSQL-backed)
  const sessionStore = new PgStore({
    pool: getPool(),
    tableName: 'sessions',
    createTableIfMissing: false, // We manage migrations manually
  });

  app.use(session({
    store: sessionStore,
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
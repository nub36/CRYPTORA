/**
 * CRYPTORA — Rate Limiters
 *
 * Per-IP rate limiting for auth endpoints.
 * Uses express-rate-limit with in-memory store (fine for single-instance).
 */

import rateLimit from 'express-rate-limit';
import { config } from '../config.js';

/** Login rate limiter — tight: prevents brute force */
export const loginLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: config.LOGIN_RATE_LIMIT,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Слишком много попыток входа. Попробуйте через минуту.' },
  handler: (req, res) => {
    res.status(429).json({ error: 'Слишком много попыток входа. Попробуйте через минуту.' });
  },
});

/** Register rate limiter — tighter: prevents spam registration */
export const registerLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: config.REGISTER_RATE_LIMIT,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Слишком много регистраций. Попробуйте позже.' },
  handler: (req, res) => {
    res.status(429).json({ error: 'Слишком много регистраций. Попробуйте позже.' });
  },
});

/** General API rate limiter — generous for authenticated users */
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: config.API_RATE_LIMIT,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Слишком много запросов. Попробуйте позже.' },
  handler: (req, res) => {
    res.status(429).json({ error: 'Слишком много запросов. Попробуйте позже.' });
  },
});

/**
 * Resend-verification limiter — 3 requests / 15 minutes per IP.
 * The endpoint triggers outbound SMTP, so this is the anti-flooding gate.
 */
export const resendLimiter = rateLimit({
  windowMs: config.RESEND_RATE_WINDOW_MINUTES * 60 * 1000,
  max: config.RESEND_RATE_LIMIT,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      error: 'Слишком много запросов. Попробуйте позже.',
    });
  },
});

/** Verify-email limiter — stops token guessing / hammering. */
export const verifyLimiter = rateLimit({
  windowMs: config.VERIFY_RATE_WINDOW_MINUTES * 60 * 1000,
  max: config.VERIFY_RATE_LIMIT,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({ error: 'Слишком много попыток. Попробуйте позже.' });
  },
});

/**
 * Verify-code limiter — separate per-IP bucket for the 6-digit code endpoint.
 * The per-CODE guess budget lives in the DB (attempts column), so one IP
 * cannot DoS someone else's verification and vice versa.
 */
export const verifyCodeLimiter = rateLimit({
  windowMs: config.VERIFY_RATE_WINDOW_MINUTES * 60 * 1000,
  max: config.VERIFY_RATE_LIMIT,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({ error: 'RATE_LIMITED', message: 'Слишком много попыток. Попробуйте позже.' });
  },
});

/**
 * OAuth initiation/callback limiter. Redirect dances are cheap but should not
 * be a general-purpose request amplifier; window is 5 minutes.
 */
export const oauthLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: config.OAUTH_RATE_LIMIT,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({ error: 'Слишком много запросов. Попробуйте позже.' });
  },
});
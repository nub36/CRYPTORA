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
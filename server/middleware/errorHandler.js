/**
 * CRYPTORA — Global Error Handler
 *
 * Catches unhandled errors and returns generic messages.
 * NEVER exposes stack traces, DB errors, or internal details to clients.
 */

import { ZodError } from 'zod';

export function errorHandler(err, req, res, _next) {
  // Zod validation errors
  if (err instanceof ZodError) {
    const firstIssue = err.issues[0];
    return res.status(400).json({
      error: firstIssue?.message || 'Некорректные данные',
      field: firstIssue?.path?.[0] || undefined,
    });
  }

  // Log full error server-side
  console.error(`[${new Date().toISOString()}] ${req.method} ${req.path} — ERROR:`, err.message);

  // Never leak internal details
  res.status(500).json({ error: 'Внутренняя ошибка сервера' });
}

/**
 * 404 handler for unmatched API routes.
 */
export function apiNotFound(req, res) {
  res.status(404).json({ error: 'Ресурс не найден' });
}
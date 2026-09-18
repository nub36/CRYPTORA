/**
 * CRYPTORA — Profile Routes
 *
 * GET   /api/me — Current user profile
 * PATCH /api/me — Update display name (Phase 1: only displayName)
 */

import { Router } from 'express';
import { updateProfileSchema } from '../validators/auth.js';
import { requireAuth } from '../middleware/auth.js';
import { query } from '../db/pool.js';

const router = Router();

/* ------------------------------------------------------------------ */
/* GET /api/me                                                        */
/* ------------------------------------------------------------------ */
router.get('/', requireAuth, (req, res) => {
  res.json({
    user: {
      id: req.user.id,
      email: req.user.email,
      displayName: req.user.displayName,
      role: req.user.role,
      isActive: req.user.isActive,
      emailVerified: req.user.emailVerified,
      emailVerifiedAt: req.user.emailVerifiedAt,
      createdAt: req.user.createdAt,
      lastLoginAt: req.user.lastLoginAt,
    },
  });
});

/* ------------------------------------------------------------------ */
/* PATCH /api/me                                                      */
/* ------------------------------------------------------------------ */
router.patch('/', requireAuth, async (req, res) => {
  const parsed = updateProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    return res.status(400).json({
      error: firstIssue?.message || 'Некорректные данные',
      field: firstIssue?.path?.[0],
    });
  }

  const { displayName } = parsed.data;

  await query(
    `UPDATE users SET display_name = $1, updated_at = now() WHERE id = $2`,
    [displayName, req.user.id]
  );

  res.json({
    user: {
      id: req.user.id,
      email: req.user.email,
      displayName,
      role: req.user.role,
      isActive: req.user.isActive,
      emailVerified: req.user.emailVerified,
      emailVerifiedAt: req.user.emailVerifiedAt,
      createdAt: req.user.createdAt,
      lastLoginAt: req.user.lastLoginAt,
    },
  });
});

export default router;
/**
 * CRYPTORA — Profile Routes
 *
 * GET   /api/me — Current user profile
 * PATCH /api/me — Update display name (Phase 1: only displayName)
 */

import { Router } from 'express';
import { updateProfileSchema } from '../validators/auth.js';
import { requireAuth, requireFreshAuth } from '../middleware/auth.js';
import { query } from '../db/pool.js';
import {
  SOCIAL_PROVIDERS,
  listIdentitiesForUser,
  deleteIdentity,
  countLoginMethods,
} from '../services/authIdentities.js';

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

/* ------------------------------------------------------------------ */
/* GET /api/me/identities                                             */
/*                                                                    */
/* Connected social accounts + whether a password is set — powers the  */
/* "Подключённые аккаунты" section of the profile page.                */
/* ------------------------------------------------------------------ */
router.get('/identities', requireAuth, async (req, res) => {
  const [identities, methods] = await Promise.all([
    listIdentitiesForUser(req.user.id),
    countLoginMethods(req.user.id),
  ]);

  res.json({
    hasPassword: methods.hasPassword,
    identities: identities.map((row) => ({
      provider: row.provider,
      providerEmail: row.provider_email ?? null,
      createdAt: row.created_at,
    })),
  });
});

/* ------------------------------------------------------------------ */
/* DELETE /api/me/identities/:provider                                */
/*                                                                    */
/* Unlink a social account. Guards:                                    */
/*   - fresh authentication (requireFreshAuth) — a stolen ambient      */
/*     cookie must not be enough to cut off login methods;             */
/*   - never removes the LAST remaining way to sign in.                */
/* ------------------------------------------------------------------ */
router.delete('/identities/:provider', requireAuth, requireFreshAuth, async (req, res) => {
  const provider = String(req.params.provider);
  if (!SOCIAL_PROVIDERS.includes(provider)) {
    return res.status(400).json({ error: 'Неизвестный провайдер' });
  }

  const methods = await countLoginMethods(req.user.id);
  const linked = await listIdentitiesForUser(req.user.id);
  const hasThis = linked.some((row) => row.provider === provider);
  if (!hasThis) {
    return res.status(404).json({ error: 'Провайдер не подключён' });
  }

  if (methods.total <= 1) {
    return res.status(409).json({
      error: 'LAST_LOGIN_METHOD',
      message: 'Нельзя отключить единственный способ входа',
    });
  }

  await deleteIdentity(req.user.id, provider);
  res.json({ status: 'ok' });
});

export default router;
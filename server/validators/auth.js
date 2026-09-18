/**
 * CRYPTORA — Auth Validation Schemas (Zod)
 *
 * All input validation at the boundary. No raw request body ever reaches DB queries.
 */

import { z } from 'zod';

const EMAIL_MAX_LENGTH = 254;
const DISPLAY_NAME_MIN = 2;
const DISPLAY_NAME_MAX = 50;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;

/**
 * Normalize email: lowercase, trim.
 * Rejects if contains invalid characters.
 */
function normalizeEmail(raw) {
  return typeof raw === 'string' ? raw.trim().toLowerCase() : raw;
}

export const registerSchema = z.object({
  email: z
    .string()
    .min(3, 'Email слишком короткий')
    .max(EMAIL_MAX_LENGTH, `Email не длиннее ${EMAIL_MAX_LENGTH} символов`)
    .transform(normalizeEmail)
    .refine((val) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val), {
      message: 'Некорректный email',
    }),

  displayName: z
    .string()
    .min(DISPLAY_NAME_MIN, `Имя не короче ${DISPLAY_NAME_MIN} символов`)
    .max(DISPLAY_NAME_MAX, `Имя не длиннее ${DISPLAY_NAME_MAX} символов`)
    .trim(),

  password: z
    .string()
    .min(PASSWORD_MIN, `Пароль не короче ${PASSWORD_MIN} символов`)
    .max(PASSWORD_MAX, `Пароль не длиннее ${PASSWORD_MAX} символов`),
});

export const loginSchema = z.object({
  email: z
    .string()
    .min(1, 'Введите email')
    .max(EMAIL_MAX_LENGTH)
    .transform(normalizeEmail),
  password: z
    .string()
    .min(1, 'Введите пароль')
    .max(PASSWORD_MAX),
});

export const updateProfileSchema = z.object({
  displayName: z
    .string()
    .min(DISPLAY_NAME_MIN, `Имя не короче ${DISPLAY_NAME_MIN} символов`)
    .max(DISPLAY_NAME_MAX, `Имя не длиннее ${DISPLAY_NAME_MAX} символов`)
    .trim(),
});

export const blockUserSchema = z.object({
  userId: z.string().uuid('Некорректный userId'),
});

/**
 * Verification token as it arrives from the link.
 * Raw tokens are 32 random bytes base64url-encoded → exactly 43 characters.
 * The bound is deliberately generous; entropy is validated in the service.
 */
export const verifyEmailSchema = z.object({
  token: z
    .string()
    .min(32, 'Некорректная ссылка')
    .max(128, 'Некорректная ссылка')
    .regex(/^[A-Za-z0-9_-]+$/, 'Некорректная ссылка'),
});

export const resendSchema = z.object({
  email: z
    .string()
    .min(1, 'Введите email')
    .max(EMAIL_MAX_LENGTH)
    .transform(normalizeEmail),
});
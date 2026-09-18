/**
 * CRYPTORA — Mail Service
 *
 * Provider-agnostic SMTP via nodemailer. Nothing here is tied to a specific
 * email vendor — any standard SMTP server works.
 *
 * SECURITY
 *   - SMTP_PASS is never logged and never returned by any API.
 *   - The raw verification token is never logged, in any environment.
 *   - Production never silently falls back to a fake transport: if SMTP is not
 *     configured, `getMailStatus().configured` is false and sending throws
 *     MailUnavailableError. Callers handle that explicitly.
 *
 * EXTENSIBILITY
 *   `sendMail()` is the single low-level primitive. Adding a password-reset
 *   email later means composing new content and calling sendMail() — the
 *   transport, configuration and status handling are reused as-is.
 */

import nodemailer from 'nodemailer';
import { config } from '../config.js';

/** Raised when mail cannot be sent (SMTP missing in production, or send failed). */
export class MailUnavailableError extends Error {
  constructor(message = 'Почтовый сервис недоступен') {
    super(message);
    this.name = 'MailUnavailableError';
  }
}

let transport = null;
let transportKind = null;

/**
 * Resolve which transport the current configuration implies — without building it.
 * @returns {{ configured: boolean, kind: 'smtp'|'json'|null, reason?: string }}
 */
export function getMailStatus() {
  const explicit = config.MAIL_TRANSPORT;

  if (explicit === 'smtp') {
    return config.SMTP_HOST
      ? { configured: true, kind: 'smtp' }
      : { configured: false, kind: null, reason: 'MAIL_TRANSPORT=smtp but SMTP_HOST is empty' };
  }

  if (explicit === 'json') {
    // A fake transport is never acceptable in production.
    return config.NODE_ENV === 'production'
      ? { configured: false, kind: null, reason: 'MAIL_TRANSPORT=json is not permitted in production' }
      : { configured: true, kind: 'json' };
  }

  // Auto
  if (config.SMTP_HOST) return { configured: true, kind: 'smtp' };
  if (config.NODE_ENV === 'production') {
    return { configured: false, kind: null, reason: 'SMTP_HOST is not configured' };
  }
  return { configured: true, kind: 'json' };
}

/** Build (once) and return the transport for the resolved configuration. */
export function getTransport() {
  if (transport) return transport;

  const status = getMailStatus();
  if (!status.configured) {
    throw new MailUnavailableError(status.reason);
  }

  if (status.kind === 'smtp') {
    transport = nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_SECURE,
      auth: config.SMTP_USER
        ? { user: config.SMTP_USER, pass: config.SMTP_PASS }
        : undefined,
    });
  } else {
    // Dev/test only: renders the message, sends nothing.
    transport = nodemailer.createTransport({ jsonTransport: true });
  }

  transportKind = status.kind;
  return transport;
}

/**
 * Test seam — inject a transport (e.g. a spy). Production never calls this.
 * @param {object|null} injected
 * @param {'smtp'|'json'|'mock'|null} kind
 */
export function __setTransportForTests(injected, kind = 'mock') {
  transport = injected;
  transportKind = kind;
}

/** Test seam — drop the injected transport. */
export function __resetTransportForTests() {
  transport = null;
  transportKind = null;
}

/** Which transport is currently active (for /api/health-style reporting). */
export function getTransportKind() {
  return transportKind;
}

/**
 * Low-level send. Reusable for any future message type (e.g. password reset).
 *
 * @param {{ to: string, subject: string, text: string, html?: string }} message
 * @returns {Promise<{ accepted: boolean, messageId?: string }>}
 */
export async function sendMail(message) {
  const t = getTransport();

  try {
    const info = await t.sendMail({
      from: config.MAIL_FROM,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });

    // Log metadata only — never the rendered body, which may contain a token.
    console.log(
      `[mail] sent to=${message.to} subject="${message.subject}" transport=${transportKind} id=${info?.messageId ?? 'n/a'}`
    );

    return { accepted: true, messageId: info?.messageId };
  } catch (err) {
    // Never include SMTP details (host/user/pass) in the message.
    console.error(`[mail] send failed to=${message.to}: ${err?.message ?? 'unknown error'}`);
    throw new MailUnavailableError('Не удалось отправить письмо');
  }
}

/** Mask an address for display: u***@example.com */
export function maskEmail(email) {
  const [local, domain] = String(email).split('@');
  if (!domain) return '***';
  const head = local.slice(0, 1);
  return `${head}***@${domain}`;
}

/**
 * Send the email-verification message.
 *
 * @param {{ to: string, displayName: string, token: string }} params
 *   `token` is the RAW one-time token. It appears only in the link and is
 *   never logged or persisted.
 */
export async function sendVerificationEmail({ to, displayName, token }) {
  const link = `${config.APP_ORIGIN}/verify-email?token=${encodeURIComponent(token)}`;
  const name = displayName || 'пользователь';

  const text = [
    `Здравствуйте, ${name}!`,
    '',
    'Подтвердите адрес электронной почты для аккаунта CRYPTORA.',
    '',
    `Ссылка для подтверждения: ${link}`,
    '',
    `Ссылка действительна ${config.EMAIL_VERIFY_TOKEN_TTL_MINUTES} минут и может быть использована один раз.`,
    '',
    'Если вы не регистрировались в CRYPTORA, просто проигнорируйте это письмо.',
  ].join('\n');

  // Self-contained HTML: inline styles only, no remote assets, no tracking pixels.
  const html = `<!DOCTYPE html>
<html lang="ru">
  <body style="margin:0;padding:0;background:#0b1220;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0b1220;padding:32px 12px;">
      <tr><td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:520px;background:#111a2e;border:1px solid #1f2b45;border-radius:12px;padding:28px;">
          <tr><td style="color:#e2e8f0;font-size:15px;line-height:1.6;">
            <p style="margin:0 0 16px;font-weight:600;color:#ffffff;">CRYPTORA</p>
            <p style="margin:0 0 12px;">Здравствуйте, ${escapeHtml(name)}!</p>
            <p style="margin:0 0 20px;">Подтвердите адрес электронной почты, чтобы завершить регистрацию.</p>
            <p style="margin:0 0 20px;">
              <a href="${escapeAttr(link)}"
                 style="display:inline-block;background:#0891b2;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;">
                Подтвердить email
              </a>
            </p>
            <p style="margin:0 0 8px;font-size:13px;color:#94a3b8;">
              Или скопируйте ссылку в браузер:<br/>
              <span style="word-break:break-all;">${escapeHtml(link)}</span>
            </p>
            <p style="margin:16px 0 0;font-size:13px;color:#94a3b8;">
              Ссылка действительна ${config.EMAIL_VERIFY_TOKEN_TTL_MINUTES} минут и одноразовая.<br/>
              Если вы не регистрировались в CRYPTORA, проигнорируйте это письмо.
            </p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

  return sendMail({
    to,
    subject: 'Подтвердите email — CRYPTORA',
    text,
    html,
  });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, '&#39;');
}

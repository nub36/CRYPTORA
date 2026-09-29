/**
 * CRYPTORA — Mail Service (provider-agnostic abstraction)
 *
 * The transport layer is plain SMTP via nodemailer — nothing here is tied to
 * a specific vendor (Brevo, Resend, Postmark, self-hosted Postfix… anything
 * speaking SMTP works). Message CONTENT lives in ./templates.js.
 *
 * SECURITY
 *   - SMTP_PASS is never logged and never returned by any API.
 *   - Verification codes/tokens are never logged, in any environment.
 *   - Production never silently falls back to a fake transport: if SMTP is
 *     not configured, `getMailStatus().configured` is false and sending
 *     throws MailUnavailableError. Callers surface a controlled error.
 *
 * RELIABILITY
 *   - Connection/greeting/socket timeouts are bounded (SMTP_TIMEOUT_MS) so a
 *     hung relay cannot hang an HTTP request.
 *
 * OBSERVABILITY
 *   - getMailStatus() reports {configured, kind, reason} without exposing a
 *     single credential — safe to surface through /api/health.
 */

import nodemailer from 'nodemailer';
import { config } from '../../config.js';
import { renderVerificationCodeEmail } from './templates.js';

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
 * The sender identity. SMTP_FROM_EMAIL/SMTP_FROM_NAME take precedence; the
 * legacy MAIL_FROM ("Name <addr>") string is still honoured.
 */
export function getMailFrom() {
  if (config.SMTP_FROM_EMAIL) {
    return config.SMTP_FROM_NAME
      ? `${config.SMTP_FROM_NAME} <${config.SMTP_FROM_EMAIL}>`
      : config.SMTP_FROM_EMAIL;
  }
  return config.MAIL_FROM;
}

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
      // A hung relay must fail fast, not hang the registration request.
      connectionTimeout: config.SMTP_TIMEOUT_MS,
      greetingTimeout: config.SMTP_TIMEOUT_MS,
      socketTimeout: config.SMTP_TIMEOUT_MS,
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
      from: getMailFrom(),
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });

    // Log metadata only — never the rendered body, which may contain a code.
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
  const [local, domain] = String(email ?? '').split('@');
  if (!domain) return '***';
  const head = local.slice(0, 1);
  return `${head}***@${domain}`;
}

/**
 * Send the 6-digit email-verification code.
 *
 * `code` is plaintext ONLY inside the outbound message; it is never logged,
 * persisted or echoed through an API.
 *
 * @param {{ to: string, code: string }} params
 */
export async function sendVerificationCodeEmail({ to, code }) {
  const { subject, text, html } = renderVerificationCodeEmail({
    code,
    ttlMinutes: config.EMAIL_VERIFY_CODE_TTL_MINUTES,
  });
  return sendMail({ to, subject, text, html });
}

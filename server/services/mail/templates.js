/**
 * CRYPTORA — Email templates
 *
 * Rules for every template here:
 *   - table-based layout, inline CSS only (Gmail/Outlook/Yandex/Mail.ru safe);
 *   - dark visual identity with explicit bgcolor fallbacks;
 *   - the essential content (the code) is plain text — readable with images
 *     disabled, no remote assets, no tracking pixels;
 *   - a plain-text alternative is always produced;
 *   - no secrets and no unnecessary PII in the body.
 */

import { config } from '../../config.js';

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, '&#39;');
}

/** Public host shown in the footer (e.g. cryptonic.online). */
function appHost() {
  try {
    return new URL(config.APP_ORIGIN).host;
  } catch {
    return 'cryptonic.online';
  }
}

/**
 * Verification-code email in the CRYPTORA visual style.
 *
 * @param {{ code: string, ttlMinutes: number }} params
 * @returns {{ subject: string, text: string, html: string }}
 */
export function renderVerificationCodeEmail({ code, ttlMinutes }) {
  const host = appHost();
  const safeCode = escapeHtml(code);

  const subject = 'CRYPTORA — код подтверждения';

  const text = [
    'CRYPTORA',
    'Рынок. Данные. Решения.',
    '',
    'Подтвердите email',
    '',
    `Ваш код: ${code}`,
    '',
    `Код действует ${ttlMinutes} минут.`,
    '',
    'Если вы не создавали аккаунт CRYPTORA,',
    'просто проигнорируйте это письмо.',
    '',
    host,
  ].join('\n');

  const html = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta name="color-scheme" content="dark light"/>
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:#0b1220;" bgcolor="#0b1220">
  <!-- preheader (hidden preview text, no PII) -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">Код подтверждения CRYPTORA. Действует ${ttlMinutes} минут.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#0b1220" style="background-color:#0b1220;padding:32px 12px;">
    <tr><td align="center" style="padding:32px 12px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#111a2e" style="max-width:480px;background-color:#111a2e;border:1px solid #1f2b45;border-radius:14px;">
        <tr><td style="padding:32px 28px 8px;text-align:center;">
          <div style="font-family:Arial,Helvetica,sans-serif;font-size:22px;font-weight:bold;letter-spacing:4px;color:#ffffff;">CRYPTORA</div>
          <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#64748b;letter-spacing:1px;margin-top:6px;">Рынок. Данные. Решения.</div>
        </td></tr>
        <tr><td style="padding:20px 28px 0;text-align:center;">
          <div style="font-family:Arial,Helvetica,sans-serif;font-size:17px;font-weight:bold;color:#e2e8f0;">Подтвердите email</div>
          <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#94a3b8;margin-top:8px;">Ваш код:</div>
        </td></tr>
        <tr><td align="center" style="padding:16px 28px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" bgcolor="#0b1220" style="background-color:#0b1220;border:1px solid #164e63;border-radius:10px;">
            <tr><td style="padding:16px 32px;font-family:'Courier New',Courier,monospace;font-size:34px;font-weight:bold;letter-spacing:10px;color:#22d3ee;">${safeCode}</td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:0 28px 8px;text-align:center;">
          <div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#94a3b8;">Код действует ${ttlMinutes} минут.</div>
        </td></tr>
        <tr><td style="padding:16px 28px 28px;text-align:center;">
          <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#64748b;line-height:1.6;">
            Если вы не создавали аккаунт CRYPTORA,<br/>просто проигнорируйте это письмо.
          </div>
          <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#475569;margin-top:16px;">${escapeHtml(host)}</div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { subject, text, html };
}

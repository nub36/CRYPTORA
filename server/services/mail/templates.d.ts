/**
 * Type declarations for server/services/mail/templates.js.
 */

export declare function escapeHtml(s: unknown): string;
export declare function escapeAttr(s: unknown): string;

export declare function renderVerificationCodeEmail(params: {
  code: string;
  ttlMinutes: number;
}): { subject: string; text: string; html: string };

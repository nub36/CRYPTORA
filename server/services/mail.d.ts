/**
 * Type declarations for server/services/mail.js (plain-JS module).
 */

export interface MailStatus {
  /** 'smtp' (real delivery), 'json' (local echo), or 'unavailable'. */
  kind: 'smtp' | 'json' | 'unavailable';
  configured: boolean;
  reason?: string;
}

export interface SendMailOptions {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/**
 * A transport is anything nodemailer-compatible. Tests inject a spy whose
 * `sendMail` takes the richer `CapturedMail` shape, so the parameter is
 * declared as an open record rather than an exact message type.
 */
export interface MailTransport {
  sendMail: (options: Record<string, unknown>) => Promise<unknown>;
}

/** Structural alias used by call sites that pass a narrower sendMail. */
export type MailTransportLike = {
  sendMail: (options: never) => Promise<unknown>;
};

export declare class MailUnavailableError extends Error {
  reason: string;
}

export declare function getMailStatus(): MailStatus;
export declare function getTransport(): MailTransport;
export declare function getTransportKind(): 'smtp' | 'json' | 'mock';
export declare function sendMail(options: SendMailOptions): Promise<unknown>;
export declare function maskEmail(email: string): string;
export declare function sendVerificationEmail(args: {
  to: string;
  displayName?: string;
  token: string;
}): Promise<unknown>;

/** Test seams — production code never calls these. */
export declare function __setTransportForTests(
  transport: MailTransportLike | null,
  kind?: 'smtp' | 'json' | 'mock'
): void;
export declare function __resetTransportForTests(): void;

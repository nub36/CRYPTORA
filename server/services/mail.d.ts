/**
 * Type declarations for server/services/mail.js (facade over ./mail/).
 */

export interface MailStatus {
  /** 'smtp' (real delivery), 'json' (local echo), or null (unavailable). */
  kind: 'smtp' | 'json' | null;
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

export declare function getMailFrom(): string;
export declare function getMailStatus(): MailStatus;
export declare function getTransport(): MailTransport;
export declare function getTransportKind(): 'smtp' | 'json' | 'mock' | null;
export declare function sendMail(options: SendMailOptions): Promise<unknown>;
export declare function maskEmail(email: string | null | undefined): string;
export declare function sendVerificationCodeEmail(args: {
  to: string;
  code: string;
}): Promise<unknown>;

/** Test seams — production code never calls these. */
export declare function __setTransportForTests(
  transport: MailTransportLike | null,
  kind?: 'smtp' | 'json' | 'mock'
): void;
export declare function __resetTransportForTests(): void;

/**
 * Type declarations for server/services/oauth/telegram.js.
 */

export interface TelegramUser {
  id: string;
  firstName: string;
  lastName: string;
  username: string;
}

export type TelegramVerifyResult =
  | { ok: true; user: TelegramUser }
  | { ok: false; reason: 'missing_hash' | 'bad_signature' | 'stale' | 'missing_fields' };

export declare function verifyTelegramLogin(
  params: Record<string, unknown>,
  botToken: string,
  maxAgeSeconds: number
): TelegramVerifyResult;

/** TEST HELPER ONLY — produce a validly signed widget payload. */
export declare function signTelegramPayloadForTests(
  fields: Record<string, string | number | undefined | null>,
  botToken: string
): Record<string, string>;

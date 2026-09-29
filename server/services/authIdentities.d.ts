/**
 * Type declarations for server/services/authIdentities.js (plain-JS module).
 */

export declare const SOCIAL_PROVIDERS: ReadonlyArray<'google' | 'telegram' | 'yandex' | 'vk'>;

export interface IdentityRow {
  id: string;
  user_id: string;
  provider: string;
  provider_subject: string;
  provider_email: string | null;
  created_at: Date | string;
}

export declare function findIdentity(
  provider: string,
  providerSubject: string | number
): Promise<IdentityRow | null>;

export declare function listIdentitiesForUser(
  userId: string
): Promise<Array<Pick<IdentityRow, 'provider' | 'provider_email' | 'created_at'>>>;

export declare function createIdentity(args: {
  userId: string;
  provider: string;
  providerSubject: string | number;
  providerEmail?: string | null;
}): Promise<IdentityRow>;

export declare function deleteIdentity(userId: string, provider: string): Promise<boolean>;

export declare function countLoginMethods(
  userId: string
): Promise<{ hasPassword: boolean; identities: number; total: number }>;

export declare function createUserFromProvider(args: {
  email: string | null;
  displayName: string;
  emailVerified?: boolean;
}): Promise<{
  id: string;
  email: string | null;
  display_name: string;
  role: string;
  is_active: boolean;
  email_verified: boolean;
  email_verified_at: Date | string | null;
  created_at: Date | string;
}>;

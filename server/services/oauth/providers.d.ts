/**
 * Type declarations for server/services/oauth/providers.js.
 */

export declare const OAUTH_PROVIDERS: ReadonlyArray<'google' | 'yandex' | 'vk'>;

export declare function isProviderConfigured(provider: string): boolean;
export declare function redirectUriFor(provider: string): string;

export declare function generatePkcePair(): { verifier: string; challenge: string };
export declare function generateState(): string;
export declare function generateNonce(): string;

export declare function buildAuthorizationUrl(
  provider: 'google' | 'yandex' | 'vk',
  params: { state: string; codeChallenge: string; nonce?: string }
): string;

export declare class OAuthExchangeError extends Error {}

export interface ProviderIdentity {
  provider: string;
  subject: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string;
}

export declare function exchangeCodeForIdentity(
  provider: 'google' | 'yandex' | 'vk',
  params: {
    code: string;
    codeVerifier: string;
    nonce?: string;
    deviceId?: string;
    state?: string;
  }
): Promise<ProviderIdentity>;

/** Test seam — replace the network exchange with a stub. */
export declare function __setIdentityExchangeForTests(
  fn: null | ((provider: string, params: Record<string, unknown>) => Promise<ProviderIdentity>)
): void;

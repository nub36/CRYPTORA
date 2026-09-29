/**
 * CRYPTORA — Google OIDC ID-token verification (type declarations).
 */

import type { JWTVerifyGetKey } from 'jose';

export const GOOGLE_ISSUERS: string[];
export const GOOGLE_DISCOVERY_URL: string;
export const GOOGLE_JWKS_FALLBACK_URL: string;
export const GOOGLE_ID_TOKEN_ALGS: string[];
export const CLOCK_TOLERANCE_SEC: number;

export class GoogleIdTokenError extends Error {
  name: 'GoogleIdTokenError';
}

export function __setGoogleJwksForTests(resolver: JWTVerifyGetKey | null): void;

export interface VerifiedGoogleIdentity {
  sub: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
}

export function verifyGoogleIdToken(
  idToken: string,
  expected: { nonce: string; clientId?: string }
): Promise<VerifiedGoogleIdentity>;

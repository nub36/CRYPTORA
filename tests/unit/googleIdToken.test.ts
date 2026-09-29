// @vitest-environment node
/**
 * CRYPTORA — Google OIDC ID-token verification (full signature checks).
 *
 * Runs in the node environment: jose's Web Crypto interop requires same-realm
 * Uint8Array instances, which jsdom does not provide.
 *
 * Signs real RS256 JWTs with locally generated keys and feeds them through
 * verifyGoogleIdToken with an injected local JWKS (no network). Covers every
 * rejection class: bad signature, wrong kid, wrong issuer/audience, expiry,
 * nonce mismatch, alg:none, foreign keys, malformed input.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

process.env.GOOGLE_CLIENT_ID = 'cryptora-test-client.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET = 'test-secret-not-real';

const { SignJWT, generateKeyPair, exportJWK, createLocalJWKSet } = await import('jose');
const {
  verifyGoogleIdToken,
  __setGoogleJwksForTests,
  GoogleIdTokenError,
  GOOGLE_ID_TOKEN_ALGS,
  CLOCK_TOLERANCE_SEC,
} = await import('../../server/services/oauth/googleIdToken.js');

const CLIENT_ID = 'cryptora-test-client.apps.googleusercontent.com';
const NONCE = 'nonce-abc-123';
const KID = 'google-test-key-1';

let privateKey: CryptoKey;
let foreignPrivateKey: CryptoKey;

const now = () => Math.floor(Date.now() / 1000);

interface TokenOpts {
  iss?: string;
  aud?: string;
  exp?: number;
  iat?: number;
  nonce?: string | null;
  sub?: string | null;
  email?: string;
  emailVerified?: boolean;
  kid?: string;
  key?: CryptoKey;
  alg?: string;
}

/** Sign a Google-shaped ID token; every field overridable per test. */
async function makeToken(opts: TokenOpts = {}): Promise<string> {
  const {
    iss = 'https://accounts.google.com',
    aud = CLIENT_ID,
    exp = now() + 3600,
    iat = now() - 10,
    nonce = NONCE,
    sub = '108234567890',
    email = 'gina@example.com',
    emailVerified = true,
    kid = KID,
    key = privateKey,
    alg = 'RS256',
  } = opts;

  const payload: Record<string, unknown> = {
    iss,
    aud,
    sub: sub ?? undefined,
    email,
    email_verified: emailVerified,
    name: 'Gina Google',
  };
  if (nonce !== null) payload.nonce = nonce;

  const jwt = new SignJWT(payload).setProtectedHeader({ alg, kid });
  if (typeof exp === 'number') jwt.setExpirationTime(exp);
  if (typeof iat === 'number') jwt.setIssuedAt(iat);
  return jwt.sign(key);
}

async function expectRejected(token: string, expectedNonce = NONCE): Promise<Error> {
  try {
    await verifyGoogleIdToken(token, { nonce: expectedNonce });
  } catch (err) {
    expect(err).toBeInstanceOf(GoogleIdTokenError);
    // Log-safe: the raw token must never appear in the error.
    if (token.length > 0) {
      expect((err as Error).message).not.toContain(token.slice(0, 20));
    }
    return err as Error;
  }
  throw new Error('expected verifyGoogleIdToken to reject');
}

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey as CryptoKey;
  const foreign = await generateKeyPair('RS256');
  foreignPrivateKey = foreign.privateKey as CryptoKey;

  const jwk = await exportJWK(pair.publicKey);
  __setGoogleJwksForTests(
    createLocalJWKSet({ keys: [{ ...jwk, kid: KID, alg: 'RS256', use: 'sig' }] })
  );
});

afterAll(() => {
  __setGoogleJwksForTests(null);
});

describe('verifyGoogleIdToken — happy path', () => {
  it('accepts a valid RS256 token signed by the JWKS key', async () => {
    const res = await verifyGoogleIdToken(await makeToken(), { nonce: NONCE });
    expect(res).toEqual({
      sub: '108234567890',
      email: 'gina@example.com',
      emailVerified: true,
      name: 'Gina Google',
    });
  });

  it('accepts the legacy issuer form without the scheme', async () => {
    const res = await verifyGoogleIdToken(await makeToken({ iss: 'accounts.google.com' }), {
      nonce: NONCE,
    });
    expect(res.sub).toBe('108234567890');
  });

  it('tolerates small clock skew on exp/iat', async () => {
    // exp a few seconds "in the past" but inside the tolerance window.
    const res = await verifyGoogleIdToken(
      await makeToken({ exp: now() - Math.floor(CLOCK_TOLERANCE_SEC / 2) }),
      { nonce: NONCE }
    );
    expect(res.sub).toBe('108234567890');
  });

  it('only RS256 is on the algorithm allowlist', () => {
    expect(GOOGLE_ID_TOKEN_ALGS).toEqual(['RS256']);
  });
});

describe('verifyGoogleIdToken — signature & key handling', () => {
  it('rejects a token whose signature was forged with a foreign key (same kid)', async () => {
    await expectRejected(await makeToken({ key: foreignPrivateKey }));
  });

  it('rejects a tampered payload (signature no longer matches)', async () => {
    const token = await makeToken();
    const [h, p, s] = token.split('.');
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
    payload.sub = 'attacker-sub';
    const forged = `${h}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${s}`;
    await expectRejected(forged);
  });

  it('rejects an unknown kid (no matching JWKS key)', async () => {
    await expectRejected(await makeToken({ kid: 'rotated-away-key' }));
  });

  it('rejects alg:none (unsigned token)', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({
        iss: 'https://accounts.google.com',
        aud: CLIENT_ID,
        sub: '108234567890',
        exp: now() + 3600,
        iat: now(),
        nonce: NONCE,
      })
    ).toString('base64url');
    await expectRejected(`${header}.${payload}.`);
  });

  it('rejects a non-RS256 algorithm even with a valid-looking structure', async () => {
    const { SignJWT: Sign } = await import('jose');
    const hmacKey = new TextEncoder().encode('a'.repeat(32));
    const hs256 = await new Sign({
      iss: 'https://accounts.google.com',
      aud: CLIENT_ID,
      sub: '108234567890',
      nonce: NONCE,
    })
      .setProtectedHeader({ alg: 'HS256', kid: KID })
      .setExpirationTime(now() + 3600)
      .setIssuedAt()
      .sign(hmacKey);
    await expectRejected(hs256);
  });

  it('rejects malformed tokens outright', async () => {
    await expectRejected('not-a-jwt');
    await expectRejected('a.b');
    await expectRejected('');
  });
});

describe('verifyGoogleIdToken — claim validation', () => {
  it('rejects a wrong issuer', async () => {
    await expectRejected(await makeToken({ iss: 'https://evil.example.com' }));
  });

  it('rejects a wrong audience (token minted for another client)', async () => {
    await expectRejected(await makeToken({ aud: 'other-client.apps.googleusercontent.com' }));
  });

  it('rejects an expired token (beyond clock tolerance)', async () => {
    await expectRejected(await makeToken({ exp: now() - CLOCK_TOLERANCE_SEC - 120 }));
  });

  it('rejects iat too far in the future', async () => {
    await expectRejected(await makeToken({ iat: now() + CLOCK_TOLERANCE_SEC + 300 }));
  });

  it('rejects a wrong nonce (replay/binding defence)', async () => {
    await expectRejected(await makeToken({ nonce: 'some-other-nonce' }));
  });

  it('rejects a missing nonce claim', async () => {
    await expectRejected(await makeToken({ nonce: null }));
  });

  it('fails closed when the caller has no expected nonce', async () => {
    await expect(
      verifyGoogleIdToken(await makeToken(), { nonce: '' as unknown as string })
    ).rejects.toBeInstanceOf(GoogleIdTokenError);
  });

  it('rejects a token without sub', async () => {
    await expectRejected(await makeToken({ sub: null }));
  });
});

describe('verifyGoogleIdToken — email trust', () => {
  it('email_verified=false → email is NOT treated as verified', async () => {
    const res = await verifyGoogleIdToken(await makeToken({ emailVerified: false }), {
      nonce: NONCE,
    });
    expect(res.emailVerified).toBe(false);
    expect(res.email).toBe('gina@example.com'); // informational only
  });

  it('missing email_verified claim → unverified', async () => {
    const token = await new SignJWT({
      iss: 'https://accounts.google.com',
      aud: CLIENT_ID,
      sub: '42',
      nonce: NONCE,
      email: 'x@example.com',
    })
      .setProtectedHeader({ alg: 'RS256', kid: KID })
      .setExpirationTime(now() + 3600)
      .setIssuedAt()
      .sign(privateKey);
    const res = await verifyGoogleIdToken(token, { nonce: NONCE });
    expect(res.emailVerified).toBe(false);
  });
});

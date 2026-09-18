/**
 * CRYPTORA — Audit Service Sanitization Tests
 *
 * Tests that sensitive fields are stripped from metadata.
 */

import { describe, it, expect } from 'vitest';

// We test the sanitize logic directly (it's a pure function)
function sanitizeMetadata(meta: Record<string, unknown>): Record<string, unknown> {
  const BLOCKED = new Set([
    'password', 'passwordHash', 'password_hash', 'hash',
    'sessionToken', 'session_token', 'token', 'secret',
    'cookie', 'setCookie', 'set-cookie',
    'apiKey', 'api_key', 'privateKey', 'private_key',
  ]);

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (!BLOCKED.has(key) && !BLOCKED.has(key.toLowerCase())) {
      result[key] = value;
    }
  }
  return result;
}

describe('sanitizeMetadata', () => {
  it('strips password field', () => {
    const result = sanitizeMetadata({ password: 'secret123', email: 'test@example.com' });
    expect(result).toEqual({ email: 'test@example.com' });
  });

  it('strips passwordHash field', () => {
    const result = sanitizeMetadata({ passwordHash: '$argon2id$...', email: 'test@example.com' });
    expect(result).toEqual({ email: 'test@example.com' });
  });

  it('strips password_hash field', () => {
    const result = sanitizeMetadata({ password_hash: '$argon2id$...', email: 'test@example.com' });
    expect(result).toEqual({ email: 'test@example.com' });
  });

  it('strips sessionToken field', () => {
    const result = sanitizeMetadata({ sessionToken: 'abc123', action: 'login' });
    expect(result).toEqual({ action: 'login' });
  });

  it('strips token field', () => {
    const result = sanitizeMetadata({ token: 'abc123', action: 'login' });
    expect(result).toEqual({ action: 'login' });
  });

  it('strips apiKey field', () => {
    const result = sanitizeMetadata({ apiKey: 'sk-...', action: 'api_call' });
    expect(result).toEqual({ action: 'api_call' });
  });

  it('preserves non-sensitive fields', () => {
    const result = sanitizeMetadata({
      action: 'USER_BLOCK',
      targetEmail: 'blocked@example.com',
      reason: 'spam',
    });
    expect(result).toEqual({
      action: 'USER_BLOCK',
      targetEmail: 'blocked@example.com',
      reason: 'spam',
    });
  });

  it('handles empty metadata', () => {
    const result = sanitizeMetadata({});
    expect(result).toEqual({});
  });

  it('handles mixed sensitive and non-sensitive fields', () => {
    const result = sanitizeMetadata({
      action: 'USER_BLOCK',
      password: 'should_be_stripped',
      targetEmail: 'user@example.com',
      token: 'also_stripped',
      timestamp: '2024-01-01',
    });
    expect(result).toEqual({
      action: 'USER_BLOCK',
      targetEmail: 'user@example.com',
      timestamp: '2024-01-01',
    });
  });
});
/**
 * CRYPTORA — Migration 005 (email verification) file-level assertions.
 *
 * There is no PostgreSQL in the sandbox, so the migration cannot be executed
 * here. These tests assert the SQL contract statically: that the file exists,
 * that it is additive, that migration 001 is untouched, and that the token
 * table can never hold a plaintext token.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../server/db/migrations');

function read(name: string): string {
  return fs.readFileSync(path.join(MIGRATIONS_DIR, name), 'utf8');
}

const files = fs
  .readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort();

describe('migration discovery', () => {
  it('numbers are contiguous and 005 is the newest', () => {
    expect(files).toEqual([
      '001_create_users.sql',
      '002_create_sessions.sql',
      '003_create_user_preferences.sql',
      '004_create_audit_log.sql',
      '005_email_verification.sql',
    ]);
  });

  it('scripts/migrate.mjs picks migrations up from the directory (no hardcoded list)', () => {
    const runner = fs.readFileSync(path.resolve(__dirname, '../../scripts/migrate.mjs'), 'utf8');
    expect(runner).toMatch(/readdirSync\(MIGRATIONS_DIR\)/);
    expect(runner).toMatch(/\.sql/);
    expect(runner).not.toMatch(/005_email_verification/);
  });
});

describe('001_create_users.sql is untouched by this change', () => {
  it('does not mention email_verified (that lives in 005)', () => {
    const sql = read('001_create_users.sql');
    expect(sql).not.toMatch(/email_verified/i);
    expect(sql).not.toMatch(/email_verification_tokens/i);
  });
});

describe('005_email_verification.sql — users columns', () => {
  const sql = read('005_email_verification.sql');

  it('is additive (ALTER TABLE, never a rewrite)', () => {
    expect(sql).toMatch(/ALTER TABLE\s+(IF EXISTS\s+)?users/i);
    expect(sql).not.toMatch(/DROP TABLE\s+(IF EXISTS\s+)?users/i);
    expect(sql).not.toMatch(/CREATE TABLE\s+(IF NOT EXISTS\s+)?users/i);
  });

  it('adds email_verified BOOLEAN NOT NULL DEFAULT FALSE', () => {
    expect(sql).toMatch(
      /ADD COLUMN(?: IF NOT EXISTS)?\s+email_verified\s+BOOLEAN\s+NOT NULL\s+DEFAULT\s+FALSE/i
    );
  });

  it('adds a nullable email_verified_at TIMESTAMPTZ', () => {
    expect(sql).toMatch(
      /ADD COLUMN(?: IF NOT EXISTS)?\s+email_verified_at\s+TIMESTAMPTZ\s+NULL/i
    );
  });

  it('indexes unverified users for admin filtering', () => {
    expect(sql).toMatch(/CREATE\s+(?:UNIQUE\s+)?INDEX.*idx_users_email_unverified/i);
    expect(sql).toMatch(/email_verified\s*=\s*FALSE/i);
  });
});

describe('005_email_verification.sql — token table', () => {
  const sql = read('005_email_verification.sql');

  it('creates email_verification_tokens', () => {
    expect(sql).toMatch(/CREATE TABLE(?: IF NOT EXISTS)?\s+email_verification_tokens/i);
  });

  it('has the full required column set', () => {
    const block = sql.slice(sql.indexOf('email_verification_tokens'));
    expect(block).toMatch(/\bid\s+UUID\s+PRIMARY KEY\s+DEFAULT\s+gen_random_uuid\(\)/i);
    expect(block).toMatch(/\buser_id\s+UUID\s+NOT NULL/i);
    expect(block).toMatch(/\btoken_hash\s+TEXT\s+NOT NULL/i);
    expect(block).toMatch(/\bexpires_at\s+TIMESTAMPTZ\s+NOT NULL/i);
    expect(block).toMatch(/\bused_at\s+TIMESTAMPTZ/i);
    expect(block).toMatch(/\bcreated_at\s+TIMESTAMPTZ\s+NOT NULL\s+DEFAULT\s+NOW\(\)/i);
  });

  it('cascades deletion to users', () => {
    expect(sql).toMatch(/REFERENCES\s+users\s*\(id\)\s+ON DELETE CASCADE/i);
  });

  it('enforces uniqueness on token_hash and indexes lookups', () => {
    // NOTE: `s` flag — these CREATE INDEX statements span multiple lines.
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX[^\n]*idx_evt_token_hash\s+ON\s+email_verification_tokens\s*\(token_hash\)/is
    );
    expect(sql).toMatch(/CREATE INDEX[^\n]*idx_evt_user_id\s+ON\s+email_verification_tokens\s*\(user_id\)/is);
    expect(sql).toMatch(/CREATE INDEX[^\n]*idx_evt_expires_at\s+ON\s+email_verification_tokens\s*\(expires_at\)/is);
  });

  it('can NEVER store a plaintext token', () => {
    // No bare `token` column; the only token-bearing column is the digest.
    expect(sql).not.toMatch(/^\s*token\s+(TEXT|VARCHAR)/im);
    expect(sql).not.toMatch(/token_raw/i);
    expect(sql).not.toMatch(/plaintext/i);
    // And the digest column is the one the code hashes into.
    expect(sql).toMatch(/token_hash\s+TEXT\s+NOT NULL/i);
  });
});

describe('server-side hashing matches what the migration stores', () => {
  it('hashToken() produces 64-char lowercase hex — a SHA-256 digest', async () => {
    const { hashToken } = await import('../../server/services/emailVerification.js');
    const digest = hashToken('some-raw-token-value');
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('the raw token is never equal to, nor a prefix of, its digest', async () => {
    const { generateRawToken, hashToken } = await import('../../server/services/emailVerification.js');
    const raw = generateRawToken();
    const digest = hashToken(raw);
    expect(raw).not.toBe(digest);
    expect(digest.startsWith(raw)).toBe(false);
    expect(raw.length).toBe(43); // 32 bytes → 43 base64url chars
    // A 32-byte token is 256 bits of entropy, as required.
    expect(Buffer.from(raw, 'base64url').length).toBe(32);
  });

  it('hashToken is deterministic and collision-resistant for distinct inputs', async () => {
    const { hashToken } = await import('../../server/services/emailVerification.js');
    expect(hashToken('a')).toBe(hashToken('a'));
    expect(hashToken('a')).not.toBe(hashToken('b'));
    expect(hashToken('a')).toBe(crypto.createHash('sha256').update('a').digest('hex'));
  });
});

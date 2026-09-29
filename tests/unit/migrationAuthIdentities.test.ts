/**
 * CRYPTORA — Migration 013 (auth identities + codes) file-level assertions.
 *
 * There is no PostgreSQL in the sandbox, so the migration cannot be executed
 * here (the embedded-postgres integration suite applies it for real). These
 * tests assert the SQL contract statically: additive-only, backward
 * compatible, and structurally correct for the linking policy.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../server/db/migrations');
const FILE = '013_auth_identities.sql';

const raw = fs.readFileSync(path.join(MIGRATIONS_DIR, FILE), 'utf8');
/** Executable SQL only — comment lines (rollback docs etc.) stripped. */
const sql = raw
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

describe('migration 013 — auth identities', () => {
  it('exists and follows the numbering convention', () => {
    const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
    expect(files).toContain(FILE);
    expect(files[files.length - 1]).toBe(FILE); // latest migration
  });

  it('is strictly additive — no destructive statements', () => {
    expect(sql).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(sql).not.toMatch(/\bDROP\s+COLUMN\b/i);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(sql).not.toMatch(/\bTRUNCATE\b/i);
    expect(sql).not.toMatch(/^\s*UPDATE\s/im); // no data rewrites
  });

  it('does not touch existing users/sessions data (only relaxes constraints)', () => {
    // The only ALTERs on users drop NOT NULL — both are safe for existing rows.
    const userAlters = sql.match(/ALTER TABLE users[\s\S]*?;/gi) ?? [];
    expect(userAlters.length).toBeGreaterThan(0);
    for (const stmt of userAlters) {
      expect(stmt).toMatch(/DROP NOT NULL/i);
      expect(stmt).not.toMatch(/SET NOT NULL|DROP COLUMN|TYPE /i);
    }
    expect(sql).not.toMatch(/sessions/i); // sessions are never touched
  });

  it('creates auth_identities with the required shape', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS auth_identities/i);
    expect(sql).toMatch(/user_id\s+UUID\s+NOT NULL/i);
    expect(sql).toMatch(/REFERENCES users \(id\) ON DELETE CASCADE/i);
    expect(sql).toMatch(/provider\s+TEXT\s+NOT NULL/i);
    expect(sql).toMatch(/provider_subject\s+TEXT\s+NOT NULL/i);
    expect(sql).toMatch(/provider_email\s+TEXT\s+NULL/i);
  });

  it('enforces UNIQUE(provider, provider_subject) — duplicate identities are impossible', () => {
    expect(sql).toMatch(/UNIQUE\s*\(provider,\s*provider_subject\)/i);
  });

  it('restricts provider to the supported set', () => {
    expect(sql).toMatch(/CHECK \(provider IN \('google', 'telegram', 'yandex', 'vk'\)\)/i);
  });

  it('extends email_verification_tokens additively with kind + attempts', () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'link'/i);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0/i);
    // Existing link tokens keep working: the default keeps them kind='link'.
    expect(sql).toMatch(/CHECK \(kind IN \('link', 'code'\)\)/i);
  });

  it('earlier migrations are untouched by this change set', () => {
    // 001 and 005 still define the original shapes this migration layers on.
    const m001 = fs.readFileSync(path.join(MIGRATIONS_DIR, '001_create_users.sql'), 'utf8');
    const m005 = fs.readFileSync(path.join(MIGRATIONS_DIR, '005_email_verification.sql'), 'utf8');
    expect(m001).toMatch(/password_hash\s+TEXT\s+NOT NULL/i);
    expect(m005).toMatch(/CREATE TABLE IF NOT EXISTS email_verification_tokens/i);
    expect(m005).not.toMatch(/kind|attempts/i);
  });

  it('documents rollback/forward behaviour (in the header comments)', () => {
    expect(raw).toMatch(/Rollback/i);
    expect(raw).toMatch(/Forward/i);
  });
});

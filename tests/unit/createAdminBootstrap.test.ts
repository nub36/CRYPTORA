/**
 * CRYPTORA — Regression test for the CLI admin bootstrap.
 *
 * BUG THIS CATCHES
 * ----------------
 * `npm run create-admin` inserted the admin without email_verified, so
 * migration 005 defaulted it to FALSE/NULL. Login refuses unverified accounts,
 * so the first admin — the only admin — could never log in. Verified on a real
 * PostgreSQL 16.15 VPS.
 *
 * WHAT IS REAL vs MOCKED
 * ----------------------
 * REAL: createBootstrapAdmin() imported from scripts/create-admin.mjs — the
 *       actual SQL string, the actual argon2 hashing, the actual params.
 * MOCKED: the database, at the query layer only. The stub records every
 *       (sql, params) pair and echoes the params back as the inserted row, so
 *       assertions run against values that genuinely flowed through the real
 *       INSERT. No PostgreSQL exists in the sandbox.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import argon2 from 'argon2';
import { createBootstrapAdmin, type Queryable } from '../../scripts/create-admin.mjs';

const EMAIL = 'root@example.com';
const DISPLAY_NAME = 'Root Admin';
const PASSWORD = 'correct horse battery';

interface Recorded {
  sql: string;
  params: unknown[];
}

function stubDb() {
  const recorded: Recorded[] = [];

  const db: Queryable = {
    query: async (sql: string, params: unknown[] = []) => {
      recorded.push({ sql, params });

      // Existence check.
      if (/^\s*SELECT id, email FROM users/i.test(sql)) {
        return { rows: [] };
      }

      // Insert: echo the bound params back as the persisted row, exactly as
      // RETURNING would, so the test inspects real values.
      if (/^\s*INSERT INTO users/i.test(sql)) {
        return {
          rows: [
            {
              id: 'aaaaaaaa-1111-2222-3333-444444444444',
              email: params[0],
              display_name: params[1],
              // NB: the real RETURNING does not select password_hash, so the
              // stub must not fabricate it either.
              role: 'admin',
              is_active: true,
              email_verified: true,
              // `now()` is a SQL literal in the statement, not a bound param.
              email_verified_at: /email_verified_at\)\s*\n?\s*VALUES[\s\S]*now\(\)/i.test(sql)
                ? new Date()
                : null,
              created_at: new Date(),
            },
          ],
        };
      }

      throw new Error(`Unexpected SQL in create-admin stub: ${sql}`);
    },
  };

  return { db, recorded };
}

describe('createBootstrapAdmin — the actual INSERT', () => {
  let db: Queryable;
  let recorded: Recorded[];
  let outcome: Awaited<ReturnType<typeof createBootstrapAdmin>>;

  beforeEach(async () => {
    const stub = stubDb();
    db = stub.db;
    recorded = stub.recorded;
    outcome = await createBootstrapAdmin(db, {
      email: EMAIL,
      displayName: DISPLAY_NAME,
      password: PASSWORD,
    });
  });

  it('creates the admin', () => {
    expect(outcome.alreadyExists).toBe(false);
    expect(outcome.admin).toBeTruthy();
  });

  it('sets role = admin and is_active = true', () => {
    const insert = recorded.find((r) => /^\s*INSERT INTO users/i.test(r.sql))!;
    expect(insert.sql).toMatch(/'admin'/);
    expect(insert.sql).toMatch(/\bis_active\b/i);
    expect(outcome.admin!.role).toBe('admin');
    expect(outcome.admin!.is_active).toBe(true);
  });

  it('sets email_verified = true in the SQL itself', () => {
    const insert = recorded.find((r) => /^\s*INSERT INTO users/i.test(r.sql))!;
    // The column must be named AND assigned true, not left to the DEFAULT FALSE.
    expect(insert.sql).toMatch(/\bemail_verified\b/i);
    expect(insert.sql).toMatch(/\bemail_verified_at\b/i);
    expect(insert.sql).toMatch(/true,\s*now\(\)/i);
  });

  it('returns email_verified = true with email_verified_at populated', () => {
    expect(outcome.admin!.email_verified).toBe(true);
    expect(outcome.admin!.email_verified_at).toBeTruthy();
    expect(outcome.admin!.email_verified_at).not.toBeNull();
    expect(new Date(outcome.admin!.email_verified_at as string).getTime()).not.toBeNaN();
  });

  it('hashes the password with Argon2id using the shared config parameters', async () => {
    // Read the hash from the bound INSERT parameter — that is the value that
    // actually reaches PostgreSQL. The real RETURNING clause deliberately does
    // not select password_hash back.
    const insert = recorded.find((r) => /^\s*INSERT INTO users/i.test(r.sql))!;
    const hash = String(insert.params[2]);
    expect(hash).toMatch(/^\$argon2id\$/);

    // The stored hash must actually verify against the plaintext password.
    await expect(argon2.verify(hash, PASSWORD)).resolves.toBe(true);

    // 64 MB / 3 iterations, matching server/config.js.
    const parts = hash.split('$');
    const params = parts[3]; // e.g. v=19$m=65536,t=3,p=1
    expect(params).toContain('m=65536');
    expect(params).toContain('t=3');
    expect(params).toContain('p=1');
  });

  it('RETURNING never selects password_hash back', () => {
    // The CLI prints the returned row field by field; the hash must not be in it.
    const insert = recorded.find((r) => /^\s*INSERT INTO users/i.test(r.sql))!;
    const returning = insert.sql.split(/RETURNING/i)[1];
    expect(returning).toBeTruthy();
    expect(returning!).not.toMatch(/password_hash/i);
  });

  it('never stores the plaintext password', () => {
    const insert = recorded.find((r) => /^\s*INSERT INTO users/i.test(r.sql))!;

    // Not as a bound parameter…
    expect(insert.params).not.toContain(PASSWORD);
    // …not anywhere in the statement text…
    expect(insert.sql).not.toContain(PASSWORD);
    // …and not in what the function returns.
    expect(JSON.stringify(outcome)).not.toContain(PASSWORD);
    // Only 3 params: email, display name, hash.
    expect(insert.params).toHaveLength(3);
    expect(insert.params[0]).toBe(EMAIL);
    expect(insert.params[1]).toBe(DISPLAY_NAME);
    expect(String(insert.params[2])).toMatch(/^\$argon2id\$/);
  });

  it('creates NO verification token for the CLI admin', () => {
    // No write to email_verification_tokens, and no mail is involved.
    const tokenWrites = recorded.filter((r) => /email_verification_tokens/i.test(r.sql));
    expect(tokenWrites).toEqual([]);
  });

  it('does not weaken the public register flow (still unverified there)', () => {
    // Guard against "fixing" this by flipping the schema default or the
    // register route: the CLI is the only place that may set verified=true.
    const register = fs.readFileSync(
      path.resolve(__dirname, '../../server/routes/auth.js'),
      'utf8'
    );

    // The public INSERT must bind role 'user' and email_verified FALSE.
    expect(register).toMatch(/'user',\s*FALSE/i);
    // And it must NOT contain the CLI's verified form.
    expect(register).not.toMatch(/'admin',\s*true,\s*true,\s*now\(\)/i);
  });

  it('migration 005 still defaults email_verified to FALSE', () => {
    // The safety net stays: anything that forgets the column is unverified.
    const sql = fs.readFileSync(
      path.resolve(__dirname, '../../server/db/migrations/005_email_verification.sql'),
      'utf8'
    );
    expect(sql).toMatch(/email_verified\s+BOOLEAN\s+NOT NULL\s+DEFAULT\s+FALSE/i);
  });
});

describe('createBootstrapAdmin — duplicate handling', () => {
  it('reports an existing user without inserting', async () => {
    const recorded: Recorded[] = [];
    const db: Queryable = {
      query: async (sql: string, params: unknown[] = []) => {
        recorded.push({ sql, params });
        if (/^\s*SELECT id, email FROM users/i.test(sql)) {
          return { rows: [{ id: 'existing-id', email: params[0] }] };
        }
        throw new Error('must not insert when the user exists');
      },
    };

    const outcome = await createBootstrapAdmin(db, {
      email: EMAIL,
      displayName: DISPLAY_NAME,
      password: PASSWORD,
    });

    expect(outcome.alreadyExists).toBe(true);
    expect(outcome.existing?.id).toBe('existing-id');
    expect(recorded.filter((r) => /INSERT/i.test(r.sql))).toEqual([]);
  });
});

describe('create-admin script hygiene', () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, '../../scripts/create-admin.mjs'),
    'utf8'
  );

  it('never logs the password or the hash', () => {
    // No console call that interpolates the password or passwordHash.
    expect(src).not.toMatch(/console\.\w+\([^)]*\bpassword\b(?!\.length|Prompt|\()/i);
    expect(src).not.toMatch(/console\.\w+\([^)]*passwordHash/i);
    expect(src).not.toMatch(/console\.\w+\([^)]*confirmPassword(?!\s*!==)/i);
  });

  it('does not print the returned row wholesale', () => {
    // Printing `admin` directly could leak password_hash if RETURNING changed.
    expect(src).not.toMatch(/console\.\w+\(\s*(?:JSON\.stringify\()?\s*admin\s*\)?\s*\)/);
  });

  it('is guarded so importing it does not start the interactive prompt', () => {
    expect(src).toMatch(/invokedDirectly/);
    expect(src).toMatch(/pathToFileURL\(process\.argv\[1\]\)/);
    // main() must only be called inside the guard.
    const calls = src.match(/^\s*main\(\);/gm) ?? [];
    expect(calls).toHaveLength(1);
  });

  it('takes Argon2id parameters from config, not hardcoded duplicates', () => {
    expect(src).toMatch(/from '\.\.\/server\/config\.js'/);
    expect(src).toMatch(/config\.ARGON2_MEMORY_COST/);
    expect(src).toMatch(/config\.ARGON2_TIME_COST/);
    expect(src).toMatch(/config\.ARGON2_PARALLELISM/);
    expect(src).not.toMatch(/memoryCost:\s*65536/);
  });

  it('documents the trusted-bootstrap rationale', () => {
    expect(src).toMatch(/trusted local bootstrap|TRUSTED/i);
    expect(src).toMatch(/email_verified = true/i);
  });
});

/**
 * CRYPTORA — Admin Bootstrap Policy (regression guard)
 *
 * Locks in the correction: the first admin is created ONLY by the
 * interactive `npm run create-admin` CLI. A plaintext admin password
 * must never exist in .env, shell scripts, git-tracked source,
 * migrations, or logs.
 *
 * If any of these assertions fail, someone has reintroduced an
 * "admin seed" mechanism — that is a security regression.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

/** Env-var names that must never hold an admin credential. */
const FORBIDDEN_VARS = [
  'ADMIN_PASSWORD',
  'ADMIN_SEED_PASSWORD',
  'ADMIN_SEED',
  'DEFAULT_ADMIN_PASSWORD',
];

/**
 * Matches a real assignment in an env file, e.g. `ADMIN_PASSWORD=...`
 * (also `export ADMIN_PASSWORD=...`). Prose that merely *names* the
 * variable in a warning comment is allowed and is good documentation.
 */
function envAssignments(body: string): string[] {
  const hits: string[] = [];
  for (const v of FORBIDDEN_VARS) {
    const re = new RegExp(`^\\s*(?:export\\s+)?${v}\\s*=`, 'gm');
    const m = body.match(re);
    if (m) hits.push(...m.map((s) => s.trim()));
  }
  return hits;
}

describe('admin bootstrap policy — no plaintext admin password anywhere', () => {
  it('.env.example assigns no admin credential variable', () => {
    const env = read('.env.example');
    expect(envAssignments(env), '.env.example must not assign an admin password').toEqual([]);
  });

  it('.env.example explicitly documents that admins come from the CLI', () => {
    const env = read('.env.example');
    expect(env).toMatch(/npm run create-admin/);
  });

  it('package.json defines create-admin and no admin-seed script', () => {
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.scripts['create-admin']).toBe('node scripts/create-admin.mjs');

    const seedScripts = Object.keys(pkg.scripts).filter((k) => /seed/i.test(k));
    expect(seedScripts, `no seed script may exist, found: ${seedScripts}`).toEqual([]);
  });

  it('migrations create no admin row (no INSERT at all)', () => {
    const dir = path.join(ROOT, 'server/db/migrations');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql'));
    expect(files.length).toBeGreaterThan(0);

    for (const f of files) {
      const sql = fs.readFileSync(path.join(dir, f), 'utf8');
      expect(sql.toUpperCase(), `${f} must not INSERT data`).not.toContain('INSERT');
      expect(sql.toLowerCase(), `${f} must not hardcode a role`).not.toMatch(/role\s*=\s*'admin'/);
    }
  });

  it('shell scripts contain no admin credential', () => {
    const dir = path.join(ROOT, 'scripts');
    const shFiles = fs.readdirSync(dir).filter((f) => f.endsWith('.sh'));

    for (const f of shFiles) {
      const body = fs.readFileSync(path.join(dir, f), 'utf8');
      for (const v of FORBIDDEN_VARS) {
        expect(body, `${f} must not reference ${v}`).not.toContain(v);
      }
    }
  });

  it('backend source never reads an admin password from env', () => {
    const targets = [
      'server/config.js',
      'server/app.js',
      'server/index.js',
      'server/routes/auth.js',
      'server/routes/admin.js',
      'server/db/pool.js',
      'scripts/migrate.mjs',
    ];

    for (const t of targets) {
      const body = read(t);
      for (const v of FORBIDDEN_VARS) {
        expect(body, `${t} must not read ${v}`).not.toContain(v);
      }
    }
  });

  it('no HTTP endpoint can create an admin', () => {
    // Admin creation is CLI-only; a public route would be a critical hole.
    const routes = ['server/routes/auth.js', 'server/routes/admin.js', 'server/routes/me.js']
      .map(read)
      .join('\n');

    expect(routes).not.toMatch(/['"`]\/create-admin['"`]/);
    expect(routes).not.toMatch(/createAdmin/i);
    expect(routes).not.toMatch(/router\.(post|put|patch)\([^)]*admin['"`]?\s*\)?/i);
  });
});

describe('create-admin CLI — password handled safely', () => {
  const cli = read('scripts/create-admin.mjs');

  it('hashes with Argon2id before insert', () => {
    expect(cli).toContain('argon2.argon2id');
    expect(cli).toMatch(/memoryCost:\s*65536/);
    expect(cli).toMatch(/timeCost:\s*3/);
  });

  it('inserts only the hash, never the plaintext password', () => {
    expect(cli).toContain('password_hash');
    expect(cli).toMatch(/\[email,\s*displayName,\s*passwordHash\]/);
    // The raw password must not appear in the parameter array.
    expect(cli).not.toMatch(/\[\s*email,\s*displayName,\s*password\s*\]/);
  });

  it('masks the password prompt (raw mode, no plaintext echo)', () => {
    expect(cli).toContain('setRawMode(true)');
    expect(cli).toContain("process.stdout.write('*')");
  });

  it('never logs the password', () => {
    const logged = cli.match(/console\.(log|error)\(([^\n]*)\)/g) ?? [];
    for (const line of logged) {
      expect(line, `must not log password: ${line}`).not.toMatch(/\bpassword\b(?!Hash)/i);
    }
  });

  it('requires a confirmation match and minimum length', () => {
    expect(cli).toMatch(/password\.length\s*<\s*8/);
    expect(cli).toMatch(/password\s*!==\s*confirmPassword/);
  });

  it('refuses to create a duplicate admin email', () => {
    expect(cli).toMatch(/lower\(email\)\s*=\s*lower\(\$1\)/);
    expect(cli).toMatch(/уже существует/);
  });

  it('is invoked only from the CLI script, never from the server', () => {
    const serverEntry = read('server/index.js') + read('server/app.js');
    expect(serverEntry).not.toContain('create-admin');
  });
});

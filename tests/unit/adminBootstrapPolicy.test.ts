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

  it('migrations create no admin row and seed no credentials', () => {
    const dir = path.join(ROOT, 'server/db/migrations');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql'));
    expect(files.length).toBeGreaterThan(0);

    /**
     * Раньше здесь стоял запрет на само слово INSERT. Настоящее свойство,
     * которое защищает тест, другое: миграция не должна создавать
     * пользователя и не должна нести учётные данные. Запрет по слову оказался
     * шире цели и заблокировал легитимный seed 006 — три строки
     * `strategy_settings`, все с `enabled = FALSE` и без каких-либо паролей.
     *
     * Поэтому проверяем по существу:
     *   1. ни одного INSERT в таблицы, где живут учётные данные;
     *   2. любой разрешённый INSERT — только в белый список таблиц без
     *      паролей, ролей и токенов;
     *   3. никакого захардкоженного пароля/роли/токена.
     */
    const CREDENTIAL_TABLES = ['users', 'sessions', 'audit_log', 'email_verification_tokens'];
    const INSERT_WHITELIST = ['strategy_settings', 'scan_universe'];

    for (const f of files) {
      const sql = fs.readFileSync(path.join(dir, f), 'utf8');
      // Комментарии не анализируем: в них legitimately объясняется политика.
      const code = sql.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');

      for (const m of code.matchAll(/INSERT\s+INTO\s+(\w+)/gi)) {
        const table = m[1]!.toLowerCase();
        expect(
          CREDENTIAL_TABLES,
          `${f} must not INSERT into credential-bearing table '${table}'`,
        ).not.toContain(table);
        expect(
          INSERT_WHITELIST,
          `${f} INSERTs into '${table}', which is not whitelisted — extend the list only for a table with no credentials`,
        ).toContain(table);
      }

      expect(sql.toLowerCase(), `${f} must not hardcode a role`).not.toMatch(/role\s*=\s*'admin'/);
      expect(code.toLowerCase(), `${f} must not hardcode a password hash`)
        .not.toMatch(/password_hash\s*[,)]?\s*(values|')/i);
    }
  });

  it('the only seeded rows are the three disabled product strategies', () => {
    const sql = fs
      .readFileSync(path.join(ROOT, 'server/db/migrations/006_strategy_settings.sql'), 'utf8')
      .split('\n')
      .map((l) => l.replace(/--.*$/, ''))
      .join('\n');

    const valuesBlock = sql.slice(sql.indexOf('VALUES'));
    const tuples = [...valuesBlock.matchAll(/\(\s*'([^']+)'\s*,\s*(TRUE|FALSE)/gi)];
    expect(tuples.map((t) => t[1]).sort()).toEqual([
      'V2_8_ZERO_FEE_SNIPER_TRAILING',
      'V3_0_HTF_LIQUIDATION_TRAP',
      'V3_3_HTF_ZONE_MITIGATION',
    ]);
    // Ключевое требование: после миграции ничего не начинает работать само.
    expect(tuples.every((t) => t[2]!.toUpperCase() === 'FALSE')).toBe(true);
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

    // The cost parameters must come from server/config.js rather than being
    // re-declared here, so the CLI and the HTTP register/login path can never
    // drift to different Argon2id settings.
    expect(cli).toMatch(/from '\.\.\/server\/config\.js'/);
    expect(cli).toMatch(/memoryCost:\s*config\.ARGON2_MEMORY_COST/);
    expect(cli).toMatch(/timeCost:\s*config\.ARGON2_TIME_COST/);
    expect(cli).toMatch(/parallelism:\s*config\.ARGON2_PARALLELISM/);
    expect(cli).not.toMatch(/memoryCost:\s*\d/);
    expect(cli).not.toMatch(/timeCost:\s*\d/);

    // …and config.js itself must still declare the required strength.
    const cfg = read('server/config.js');
    expect(cfg).toMatch(/ARGON2_MEMORY_COST:\s*65536/);
    expect(cfg).toMatch(/ARGON2_TIME_COST:\s*3/);
    expect(cfg).toMatch(/ARGON2_PARALLELISM:\s*1/);
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

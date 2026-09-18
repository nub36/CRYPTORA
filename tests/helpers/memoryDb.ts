/**
 * CRYPTORA — In-memory DB adapter for the integration suite.
 *
 * ⚠️ THIS IS A MOCK. It is the ONLY mocked layer in the integration tests.
 *
 * What is REAL in the integration suite:
 *   - Express app assembly (server/app.js → createApp)
 *   - every route handler (server/routes/*.js)
 *   - every middleware (auth, csrf, rateLimit, errorHandler)
 *   - Zod validators (server/validators/auth.js)
 *   - express-session middleware + cookie flow
 *   - Argon2id hashing/verification
 *   - audit service (server/services/audit.js)
 *
 * What is MOCKED:
 *   - the SQL layer only. `query(text, params)` is pattern-matched against an
 *     in-memory users/audit_log/sessions store. It understands exactly the
 *     statements the real handlers issue (see the SQL inventory below) and
 *     throws on anything unknown, so a handler change cannot silently pass.
 *
 * Injected via the explicit test seam `__setPoolForTests` in server/db/pool.js.
 * No business logic is duplicated here: it stores and returns rows, nothing else.
 */

export interface UserRow {
  id: string;
  email: string;
  display_name: string;
  password_hash: string;
  role: 'user' | 'admin';
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
  last_login_at: Date | null;
}

export interface AuditRow {
  id: string;
  actor_user_id: string;
  action: string;
  target_type: string;
  target_id: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
}

/** Collapse whitespace so multi-line template-literal SQL matches one-liners. */
function norm(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

/** Bound parameters arrive as unknown; these statements only ever bind strings. */
function str(v: unknown): string {
  return String(v);
}

/** Very small LIKE matcher supporting `%term%` (the only form the app uses). */
function likeMatch(value: string, pattern: string): boolean {
  const term = pattern.replace(/^%/, '').replace(/%$/, '');
  return value.toLowerCase().includes(term.toLowerCase());
}

let seq = 0;
const nextId = (): string => {
  seq += 1;
  return `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`;
};

export class MemoryDb {
  users: UserRow[] = [];
  audit: AuditRow[] = [];
  sessions: Array<{ sess: { userId?: string } }> = [];

  /** Every statement executed, for assertions. */
  executed: string[] = [];

  reset(): void {
    this.users = [];
    this.audit = [];
    this.sessions = [];
    this.executed = [];
  }

  /** Drop-in replacement for pg.Pool — exposes .query and .end. */
  asPool(): { query: (t: string, p?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number }>; end: () => Promise<void> } {
    return {
      query: (text: string, params?: unknown[]) => this.query(text, params ?? []),
      end: async () => undefined,
    };
  }

  findUserById(id: string): UserRow | undefined {
    return this.users.find((u) => u.id === id);
  }

  findUserByEmail(email: string): UserRow | undefined {
    const e = String(email).toLowerCase();
    return this.users.find((u) => u.email.toLowerCase() === e);
  }

  async query(text: string, params: unknown[] = []): Promise<{ rows: unknown[]; rowCount: number }> {
    const sql = norm(text);
    this.executed.push(sql);
    const p = params as Array<string | number>;

    /* ── connectivity probe ─────────────────────────────────────────── */
    if (/^SELECT 1 AS ok$/i.test(sql)) {
      return { rows: [{ ok: 1 }], rowCount: 1 };
    }

    /* ── INSERT INTO users (register: role 'user') ──────────────────── */
    if (/^INSERT INTO users \(email, display_name, password_hash, role\) VALUES \(\$1, \$2, \$3, 'user'\)/i.test(sql)) {
      const now = new Date();
      const row: UserRow = {
        id: nextId(),
        email: str(p[0]),
        display_name: str(p[1]),
        password_hash: str(p[2]),
        role: 'user',
        is_active: true,
        created_at: now,
        updated_at: now,
        last_login_at: null,
      };
      this.users.push(row);
      return { rows: [row], rowCount: 1 };
    }

    /* ── INSERT INTO audit_log ──────────────────────────────────────── */
    if (/^INSERT INTO audit_log \(actor_user_id, action, target_type, target_id, metadata\) VALUES \(\$1, \$2, \$3, \$4, \$5\)/i.test(sql)) {
      const row: AuditRow = {
        id: nextId(),
        actor_user_id: str(p[0]),
        action: str(p[1]),
        target_type: str(p[2]),
        target_id: p[3] === null || p[3] === undefined ? null : str(p[3]),
        metadata: JSON.parse(String(p[4] ?? '{}')) as Record<string, unknown>,
        created_at: new Date(),
      };
      this.audit.push(row);
      return { rows: [], rowCount: 1 };
    }

    /* ── SELECT ... FROM users WHERE lower(email) = lower($1) ───────── */
    if (/FROM users WHERE lower\(email\) = lower\(\$1\)/i.test(sql)) {
      const u = this.findUserByEmail(str(p[0]));
      return { rows: u ? [u] : [], rowCount: u ? 1 : 0 };
    }

    /* ── SELECT ... FROM users WHERE id = $1 ────────────────────────── */
    if (/FROM users WHERE id = \$1/i.test(sql)) {
      const u = this.findUserById(str(p[0]));
      return { rows: u ? [u] : [], rowCount: u ? 1 : 0 };
    }

    /* ── UPDATE users SET last_login_at ─────────────────────────────── */
    if (/^UPDATE users SET last_login_at = now\(\) WHERE id = \$1/i.test(sql)) {
      const u = this.findUserById(str(p[0]));
      if (u) u.last_login_at = new Date();
      return { rows: [], rowCount: u ? 1 : 0 };
    }

    /* ── UPDATE users SET display_name ──────────────────────────────── */
    if (/^UPDATE users SET display_name = \$1, updated_at = now\(\) WHERE id = \$2/i.test(sql)) {
      const u = this.findUserById(str(p[1]));
      if (u) {
        u.display_name = str(p[0]);
        u.updated_at = new Date();
      }
      return { rows: [], rowCount: u ? 1 : 0 };
    }

    /* ── UPDATE users SET is_active ─────────────────────────────────── */
    const activeMatch = sql.match(/^UPDATE users SET is_active = (true|false), updated_at = now\(\) WHERE id = \$1/i);
    if (activeMatch) {
      const u = this.findUserById(str(p[0]));
      if (u) {
        u.is_active = activeMatch[1].toLowerCase() === 'true';
        u.updated_at = new Date();
      }
      return { rows: [], rowCount: u ? 1 : 0 };
    }

    /* ── DELETE FROM sessions (block propagation) ───────────────────── */
    if (/^DELETE FROM sessions WHERE sess->>'userId' = \$1/i.test(sql)) {
      const before = this.sessions.length;
      this.sessions = this.sessions.filter((s) => s.sess?.userId !== str(p[0]));
      return { rows: [], rowCount: before - this.sessions.length };
    }

    /* ── admin dashboard: user aggregate ────────────────────────────── */
    if (/COUNT\(\*\)::int AS total, COUNT\(\*\) FILTER/i.test(sql)) {
      return {
        rows: [
          {
            total: this.users.length,
            admins: this.users.filter((u) => u.role === 'admin').length,
            users: this.users.filter((u) => u.role === 'user').length,
            active: this.users.filter((u) => u.is_active).length,
            blocked: this.users.filter((u) => !u.is_active).length,
          },
        ],
        rowCount: 1,
      };
    }

    /* ── admin dashboard: recent audit ──────────────────────────────── */
    if (/FROM audit_log al JOIN users u ON u\.id = al\.actor_user_id ORDER BY al\.created_at DESC LIMIT 10/i.test(sql)) {
      const rows = [...this.audit]
        .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
        .slice(0, 10)
        .map((a) => ({
          action: a.action,
          target_type: a.target_type,
          target_id: a.target_id,
          created_at: a.created_at,
          actor_name: this.findUserById(a.actor_user_id)?.display_name ?? null,
        }));
      return { rows, rowCount: rows.length };
    }

    /* ── admin users: count ─────────────────────────────────────────── */
    if (/^SELECT COUNT\(\*\)::int AS total FROM users/i.test(sql)) {
      return { rows: [{ total: this.filterUsers(sql, p).length }], rowCount: 1 };
    }

    /* ── admin users: page ──────────────────────────────────────────── */
    if (/^SELECT id, email, display_name, role, is_active, created_at, last_login_at FROM users/i.test(sql) && /LIMIT \$\d+ OFFSET \$\d+/i.test(sql)) {
      const filtered = this.filterUsers(sql, p);
      const limitIdx = sql.match(/LIMIT \$(\d+) OFFSET \$(\d+)/i);
      const limit = limitIdx ? Number(p[Number(limitIdx[1]) - 1]) : filtered.length;
      const offset = limitIdx ? Number(p[Number(limitIdx[2]) - 1]) : 0;
      const rows = [...filtered]
        .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
        .slice(offset, offset + limit);
      return { rows, rowCount: rows.length };
    }

    /* ── audit service: paginated read with optional filters ────────── */
    if (/^SELECT al\.\*, u\.email AS actor_email, u\.display_name AS actor_name FROM audit_log al/i.test(sql)) {
      // Apply the WHERE filters positionally, exactly as the real query binds them.
      let filtered = this.audit;

      const actorMatch = sql.match(/actor_user_id = \$(\d+)/i);
      if (actorMatch) {
        const actorId = str(p[Number(actorMatch[1]) - 1]);
        filtered = filtered.filter((a) => a.actor_user_id === actorId);
      }

      const actionMatch = sql.match(/action = \$(\d+)/i);
      if (actionMatch) {
        const action = str(p[Number(actionMatch[1]) - 1]);
        filtered = filtered.filter((a) => a.action === action);
      }

      const limitIdx = sql.match(/LIMIT \$(\d+) OFFSET \$(\d+)/i);
      const limit = limitIdx ? Number(p[Number(limitIdx[1]) - 1]) : filtered.length;
      const offset = limitIdx ? Number(p[Number(limitIdx[2]) - 1]) : 0;

      const rows = [...filtered]
        .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
        .slice(offset, offset + limit)
        .map((a) => {
          const actor = this.findUserById(a.actor_user_id);
          return { ...a, actor_email: actor?.email ?? null, actor_name: actor?.display_name ?? null };
        });
      return { rows, rowCount: rows.length };
    }

    throw new Error(
      `MemoryDb: unhandled SQL. Add a matcher before relying on it.\n  ${sql}`
    );
  }

  /** Applies the optional `WHERE lower(email) LIKE $1 OR lower(display_name) LIKE $1`. */
  private filterUsers(sql: string, p: Array<string | number>): UserRow[] {
    if (!/WHERE lower\(email\) LIKE \$1 OR lower\(display_name\) LIKE \$1/i.test(sql)) {
      return this.users;
    }
    const term = str(p[0]);
    return this.users.filter(
      (u) => likeMatch(u.email, term) || likeMatch(u.display_name, term)
    );
  }
}

/** Seed a user directly (bypasses HTTP) — for RBAC/blocked-user setups. */
export function seedUser(
  db: MemoryDb,
  overrides: Partial<UserRow> & { password_hash: string }
): UserRow {
  const now = new Date();
  const row: UserRow = {
    id: nextId(),
    email: 'seed@example.com',
    display_name: 'Seeded',
    role: 'user',
    is_active: true,
    created_at: now,
    updated_at: now,
    last_login_at: null,
    ...overrides,
  };
  db.users.push(row);
  return row;
}

/**
 * CRYPTORA — RBAC, block/unblock and audit integration tests (item 8).
 *
 * REAL: Express app, route handlers, requireAuth + requireAdmin middleware,
 *       validators, session middleware, Argon2id, audit service.
 * MOCKED: only the SQL layer (MemoryDb via __setPoolForTests).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import argon2 from 'argon2';
import type { HttpClient } from '../helpers/httpHarness';

process.env.LOGIN_RATE_LIMIT = '100000';
process.env.REGISTER_RATE_LIMIT = '100000';
process.env.API_RATE_LIMIT = '1000000';
process.env.SESSION_STORE = 'memory';

const { createApp } = await import('../../server/app.js');
const { __setPoolForTests } = await import('../../server/db/pool.js');
const { MemoryDb, seedUser } = await import('../helpers/memoryDb');
const { listen } = await import('../helpers/httpHarness');
const { getAuditLog } = await import('../../server/services/audit.js');

const PASSWORD = 'correct horse battery';

let db: InstanceType<typeof MemoryDb>;
let close: () => Promise<void>;

beforeEach(async () => {
  db = new MemoryDb();
  __setPoolForTests(db.asPool());
});

afterEach(async () => {
  if (close) await close();
  __setPoolForTests(null);
});

/** Log in and assert it worked — a silent login failure must not mask the real check. */
async function loginAs(client: HttpClient, email: string): Promise<void> {
  const res = await client.post('/api/auth/login', { email, password: PASSWORD });
  expect(res.status).toBe(200);
}

/** Fresh server + client (cookie jars are not shared across tests). */
async function freshServer(): Promise<HttpClient> {
  const harness = await listen(createApp({ sessionStore: 'memory' }));
  close = harness.close;
  return harness.client;
}

async function seedAdmin(email = 'root@example.com') {
  const hash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
  return seedUser(db, { email, display_name: 'Root', password_hash: hash, role: 'admin' });
}

async function seedNormal(email = 'user@example.com', name = 'User') {
  const hash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
  return seedUser(db, { email, display_name: name, password_hash: hash, role: 'user' });
}

describe('requireAdmin — real HTTP requests (item 8)', () => {
  it('a normal user gets 403 on /api/admin/dashboard', async () => {
    await seedNormal();
    const client = await freshServer();
    await loginAs(client, 'user@example.com');

    const res = await client.get('/api/admin/dashboard');
    expect(res.status).toBe(403);
    expect((res.body as { error: string }).error).toBe('Доступ запрещён');
  });

  it('a normal user gets 403 on /api/admin/users', async () => {
    await seedNormal();
    const client = await freshServer();
    await loginAs(client, 'user@example.com');

    expect((await client.get('/api/admin/users')).status).toBe(403);
  });

  it('a normal user gets 403 on /api/admin/system', async () => {
    await seedNormal();
    const client = await freshServer();
    await loginAs(client, 'user@example.com');

    expect((await client.get('/api/admin/system')).status).toBe(403);
  });

  it('a normal user cannot block anyone (403)', async () => {
    await seedNormal('user@example.com', 'User');
    const target = await seedNormal('target@example.com', 'Target');

    const client = await freshServer();
    expect(
      (await client.post('/api/auth/login', { email: 'user@example.com', password: PASSWORD })).status
    ).toBe(200);

    const res = await client.patch(`/api/admin/users/${target.id}/block`);
    expect(res.status).toBe(403);
    expect(db.findUserById(target.id)!.is_active).toBe(true);
  });

  it('an admin gets 200 on /api/admin/dashboard', async () => {
    await seedAdmin();
    const client = await freshServer();
    await loginAs(client, 'root@example.com');

    const res = await client.get('/api/admin/dashboard');
    expect(res.status).toBe(200);
    const body = res.body as { health: Record<string, unknown>; users: Record<string, number> };
    expect(body.health.version).toBeTruthy();
    expect(body.health.database).toBe('connected');
    expect(body.users.total).toBe(1);
    expect(body.users.admins).toBe(1);
  });

  it('an admin gets 200 on /api/admin/system with real process data', async () => {
    await seedAdmin();
    const client = await freshServer();
    await loginAs(client, 'root@example.com');

    const res = await client.get('/api/admin/system');
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.nodeVersion).toBe(process.version);
    expect(typeof body.uptimeSeconds).toBe('number');
    expect(body.database).toBe('connected');
  });

  it('an admin can list users', async () => {
    await seedAdmin();
    await seedNormal('a@example.com', 'Ann');
    await seedNormal('b@example.com', 'Bob');

    const client = await freshServer();
    await loginAs(client, 'root@example.com');

    const res = await client.get('/api/admin/users');
    expect(res.status).toBe(200);
    const body = res.body as { users: Array<Record<string, unknown>>; pagination: Record<string, number> };
    expect(body.pagination.total).toBe(3);
    expect(body.users.length).toBe(3);
    // password_hash must never leak into the admin listing.
    expect(JSON.stringify(body)).not.toContain('$argon2id$');
  });

  it('admin user search filters by email/name', async () => {
    await seedAdmin();
    await seedNormal('ann@example.com', 'Ann');
    await seedNormal('bob@example.com', 'Bob');

    const client = await freshServer();
    await loginAs(client, 'root@example.com');

    const res = await client.get('/api/admin/users?search=ann');
    const body = res.body as { users: Array<{ email: string }> };
    expect(body.users.length).toBe(1);
    expect(body.users[0].email).toBe('ann@example.com');
  });

  it('an unauthenticated caller gets 401, not 403 (auth checked before role)', async () => {
    const client = await freshServer();
    expect((await client.get('/api/admin/dashboard')).status).toBe(401);
  });

  it('role cannot be self-assigned via the public profile endpoint', async () => {
    await seedNormal();
    const client = await freshServer();
    await loginAs(client, 'user@example.com');

    await client.patch('/api/me', { displayName: 'User', role: 'admin' });
    expect(db.users[0].role).toBe('user');
    expect((await client.get('/api/admin/dashboard')).status).toBe(403);
  });
});

describe('block / unblock with audit', () => {
  it('admin blocks a user: is_active=false and USER_BLOCK audited', async () => {
    const admin = await seedAdmin();
    const target = await seedNormal('target@example.com', 'Target');

    const client = await freshServer();
    await loginAs(client, 'root@example.com');

    const res = await client.patch(`/api/admin/users/${target.id}/block`);
    expect(res.status).toBe(200);
    expect(db.findUserById(target.id)!.is_active).toBe(false);

    const log = await getAuditLog({ action: 'USER_BLOCK' });
    expect(log).toHaveLength(1);
    expect(log[0].actor_user_id).toBe(admin.id);
    expect(log[0].target_id).toBe(target.id);
    expect(log[0].target_type).toBe('user');
  });

  it('issues the session-invalidation DELETE for the blocked user', async () => {
    await seedAdmin();
    const target = await seedNormal('target@example.com', 'Target');

    const client = await freshServer();
    await loginAs(client, 'root@example.com');
    await client.patch(`/api/admin/users/${target.id}/block`);

    const del = db.executed.find((s) => /^DELETE FROM sessions WHERE sess->>'userId' = \$1/i.test(s));
    expect(del, 'expected a session-invalidation DELETE').toBeTruthy();
  });

  it('admin unblocks a user: is_active=true and USER_UNBLOCK audited', async () => {
    const admin = await seedAdmin();
    const target = await seedNormal('target@example.com', 'Target');
    db.findUserById(target.id)!.is_active = false;

    const client = await freshServer();
    await loginAs(client, 'root@example.com');

    const res = await client.patch(`/api/admin/users/${target.id}/unblock`);
    expect(res.status).toBe(200);
    expect(db.findUserById(target.id)!.is_active).toBe(true);

    const log = await getAuditLog({ action: 'USER_UNBLOCK' });
    expect(log).toHaveLength(1);
    expect(log[0].actor_user_id).toBe(admin.id);
  });

  it('admin cannot block themselves → 400', async () => {
    const admin = await seedAdmin();
    const client = await freshServer();
    await loginAs(client, 'root@example.com');

    const res = await client.patch(`/api/admin/users/${admin.id}/block`);
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/самого себя/);
    expect(db.findUserById(admin.id)!.is_active).toBe(true);
  });

  it('blocking an unknown user → 404', async () => {
    await seedAdmin();
    const client = await freshServer();
    await loginAs(client, 'root@example.com');

    const res = await client.patch('/api/admin/users/00000000-0000-4000-8000-000000000099/block');
    expect(res.status).toBe(404);
  });

  it('blocking an already-blocked user → 400', async () => {
    await seedAdmin();
    const target = await seedNormal('target@example.com', 'Target');
    db.findUserById(target.id)!.is_active = false;

    const client = await freshServer();
    await loginAs(client, 'root@example.com');

    expect((await client.patch(`/api/admin/users/${target.id}/block`)).status).toBe(400);
  });

  it('unblocking an already-active user → 400', async () => {
    await seedAdmin();
    const target = await seedNormal('target@example.com', 'Target');

    const client = await freshServer();
    await loginAs(client, 'root@example.com');

    expect((await client.patch(`/api/admin/users/${target.id}/unblock`)).status).toBe(400);
  });

  it('audit metadata never contains a password or token', async () => {
    await seedAdmin();
    const target = await seedNormal('target@example.com', 'Target');

    const client = await freshServer();
    await loginAs(client, 'root@example.com');
    await client.patch(`/api/admin/users/${target.id}/block`);

    const log = await getAuditLog();
    const blob = JSON.stringify(log);
    expect(blob).not.toContain(PASSWORD);
    expect(blob).not.toContain('$argon2id$');
    expect(blob).not.toMatch(/"(password|token|secret|sessionToken)"/i);
  });

  it('the dashboard surfaces recent audit entries', async () => {
    await seedAdmin();
    const target = await seedNormal('target@example.com', 'Target');

    const client = await freshServer();
    await loginAs(client, 'root@example.com');
    await client.patch(`/api/admin/users/${target.id}/block`);

    const res = await client.get('/api/admin/dashboard');
    const body = res.body as { recentAudit: Array<{ action: string; actor_name: string }> };
    expect(body.recentAudit.length).toBeGreaterThanOrEqual(1);
    expect(body.recentAudit[0].action).toBe('USER_BLOCK');
    expect(body.recentAudit[0].actor_name).toBe('Root');
  });
});

/**
 * CRYPTORA — Audit service tests (item 4).
 *
 * Imports the ACTUAL production module server/services/audit.js.
 * The previous version of this file declared its own copy of
 * `sanitizeMetadata` — that copy is gone. Nothing is re-implemented here:
 * if the production function changes, these assertions change with it.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// Import the real production code (not a copy).
const { sanitizeMetadata, recordAudit, getAuditLog } = await import('../../server/services/audit.js');
const { __setPoolForTests } = await import('../../server/db/pool.js');
const { MemoryDb } = await import('../helpers/memoryDb');

describe('sanitizeMetadata — production implementation', () => {
  it('strips `password`', () => {
    expect(sanitizeMetadata({ password: 'secret123', email: 'a@example.com' })).toEqual({
      email: 'a@example.com',
    });
  });

  it('strips `passwordHash`', () => {
    expect(sanitizeMetadata({ passwordHash: '$argon2id$x', email: 'a@example.com' })).toEqual({
      email: 'a@example.com',
    });
  });

  it('strips `password_hash`', () => {
    expect(sanitizeMetadata({ password_hash: '$argon2id$x', action: 'X' })).toEqual({ action: 'X' });
  });

  it('strips `hash`', () => {
    expect(sanitizeMetadata({ hash: '$argon2id$x', action: 'X' })).toEqual({ action: 'X' });
  });

  it('strips `sessionToken` / `session_token` / `token`', () => {
    expect(
      sanitizeMetadata({ sessionToken: 'a', session_token: 'b', token: 'c', action: 'login' })
    ).toEqual({ action: 'login' });
  });

  it('strips `secret`, `cookie`, `setCookie`, `set-cookie`', () => {
    expect(
      sanitizeMetadata({
        secret: 'a',
        cookie: 'b',
        setCookie: 'c',
        'set-cookie': 'd',
        action: 'login',
      })
    ).toEqual({ action: 'login' });
  });

  it('strips `apiKey` / `api_key` / `privateKey` / `private_key`', () => {
    expect(
      sanitizeMetadata({
        apiKey: 'sk-x',
        api_key: 'sk-y',
        privateKey: 'p1',
        private_key: 'p2',
        action: 'call',
      })
    ).toEqual({ action: 'call' });
  });

  it('is case-insensitive about blocked key names', () => {
    expect(sanitizeMetadata({ PASSWORD: 'x', Password: 'y', action: 'Z' })).toEqual({ action: 'Z' });
  });

  it('preserves non-sensitive fields untouched', () => {
    const meta = {
      action: 'USER_BLOCK',
      targetEmail: 'blocked@example.com',
      reason: 'spam',
      nested: { a: 1 },
    };
    expect(sanitizeMetadata(meta)).toEqual(meta);
  });

  it('handles empty metadata', () => {
    expect(sanitizeMetadata({})).toEqual({});
  });

  it('strips a mix of sensitive and non-sensitive keys', () => {
    expect(
      sanitizeMetadata({
        action: 'USER_BLOCK',
        password: 'should_be_stripped',
        targetEmail: 'user@example.com',
        token: 'also_stripped',
        timestamp: '2024-01-01',
      })
    ).toEqual({
      action: 'USER_BLOCK',
      targetEmail: 'user@example.com',
      timestamp: '2024-01-01',
    });
  });
});

describe('recordAudit / getAuditLog — production implementation', () => {
  let db: InstanceType<typeof MemoryDb>;

  beforeEach(() => {
    db = new MemoryDb();
    __setPoolForTests(db.asPool());
    db.users.push({
      id: 'actor-1',
      email: 'root@example.com',
      display_name: 'Root',
      password_hash: '$argon2id$placeholder',
      role: 'admin',
      is_active: true,
      created_at: new Date(),
      updated_at: new Date(),
      last_login_at: null,
    });
  });

  afterEach(() => {
    __setPoolForTests(null);
  });

  it('persists an audit row with the given fields', async () => {
    await recordAudit({
      actorUserId: 'actor-1',
      action: 'USER_BLOCK',
      targetType: 'user',
      targetId: 'target-1',
      metadata: { targetEmail: 't@example.com' },
    });

    expect(db.audit).toHaveLength(1);
    expect(db.audit[0].action).toBe('USER_BLOCK');
    expect(db.audit[0].actor_user_id).toBe('actor-1');
    expect(db.audit[0].target_type).toBe('user');
    expect(db.audit[0].target_id).toBe('target-1');
    expect(db.audit[0].metadata).toEqual({ targetEmail: 't@example.com' });
  });

  it('sanitizes metadata BEFORE it reaches the database', async () => {
    await recordAudit({
      actorUserId: 'actor-1',
      action: 'USER_BLOCK',
      targetType: 'user',
      targetId: 'target-1',
      metadata: { password: 'hunter2', sessionToken: 'abc', targetEmail: 't@example.com' },
    });

    const stored = JSON.stringify(db.audit[0].metadata);
    expect(stored).not.toContain('hunter2');
    expect(stored).not.toContain('abc');
    expect(stored).toContain('t@example.com');
  });

  it('defaults metadata to {} when omitted', async () => {
    await recordAudit({
      actorUserId: 'actor-1',
      action: 'USER_UNBLOCK',
      targetType: 'user',
      targetId: 'target-1',
    });
    expect(db.audit[0].metadata).toEqual({});
  });

  it('getAuditLog returns entries joined with the actor', async () => {
    await recordAudit({
      actorUserId: 'actor-1',
      action: 'USER_BLOCK',
      targetType: 'user',
      targetId: 'target-1',
    });

    const rows = await getAuditLog();
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe('USER_BLOCK');
    expect(rows[0].actor_name).toBe('Root');
    expect(rows[0].actor_email).toBe('root@example.com');
  });

  it('getAuditLog filters by action', async () => {
    await recordAudit({ actorUserId: 'actor-1', action: 'USER_BLOCK', targetType: 'user' });
    await recordAudit({ actorUserId: 'actor-1', action: 'USER_UNBLOCK', targetType: 'user' });

    expect(await getAuditLog({ action: 'USER_BLOCK' })).toHaveLength(1);
    expect(await getAuditLog({ action: 'USER_UNBLOCK' })).toHaveLength(1);
    expect(await getAuditLog()).toHaveLength(2);
  });
});

/**
 * CRYPTORA — Telegram Login Widget signature verification (pure unit).
 *
 * Reference algorithm: https://core.telegram.org/widgets/login
 *   secret_key = SHA256(bot_token); hash = hex(HMAC_SHA256(dcs, secret_key))
 */

import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';

const { verifyTelegramLogin, signTelegramPayloadForTests } = await import(
  '../../server/services/oauth/telegram.js'
);

const BOT_TOKEN = '110201543:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw'; // sample-format, not a real bot
const MAX_AGE = 300;

const now = () => Math.floor(Date.now() / 1000);

describe('verifyTelegramLogin', () => {
  it('accepts a payload signed with the official algorithm', () => {
    const payload = signTelegramPayloadForTests(
      { id: '12345', first_name: 'Ann', last_name: 'B', username: 'annb', auth_date: now() },
      BOT_TOKEN
    );
    const res = verifyTelegramLogin(payload, BOT_TOKEN, MAX_AGE);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.user.id).toBe('12345');
      expect(res.user.firstName).toBe('Ann');
      expect(res.user.username).toBe('annb');
    }
  });

  it('matches an independently computed reference signature', () => {
    const fields: Record<string, string> = {
      auth_date: String(now()),
      first_name: 'Ref',
      id: '999',
    };
    const dcs = Object.keys(fields)
      .sort()
      .map((k) => `${k}=${fields[k]}`)
      .join('\n');
    const secret = crypto.createHash('sha256').update(BOT_TOKEN).digest();
    const hash = crypto.createHmac('sha256', secret).update(dcs).digest('hex');

    const res = verifyTelegramLogin({ ...fields, hash }, BOT_TOKEN, MAX_AGE);
    expect(res.ok).toBe(true);
  });

  it('rejects a tampered field', () => {
    const payload = signTelegramPayloadForTests(
      { id: '12345', first_name: 'Ann', auth_date: now() },
      BOT_TOKEN
    );
    payload.id = '54321'; // signature no longer covers this
    const res = verifyTelegramLogin(payload, BOT_TOKEN, MAX_AGE);
    expect(res).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('rejects a payload signed with a different bot token', () => {
    const payload = signTelegramPayloadForTests(
      { id: '12345', first_name: 'Ann', auth_date: now() },
      'another:token'
    );
    const res = verifyTelegramLogin(payload, BOT_TOKEN, MAX_AGE);
    expect(res).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('rejects missing or malformed hash', () => {
    expect(verifyTelegramLogin({ id: '1', auth_date: String(now()) }, BOT_TOKEN, MAX_AGE)).toEqual({
      ok: false,
      reason: 'missing_hash',
    });
    expect(
      verifyTelegramLogin({ id: '1', auth_date: String(now()), hash: 'zz' }, BOT_TOKEN, MAX_AGE)
    ).toEqual({ ok: false, reason: 'missing_hash' });
  });

  it('rejects stale auth_date (replay defence)', () => {
    const payload = signTelegramPayloadForTests(
      { id: '12345', first_name: 'Ann', auth_date: now() - MAX_AGE - 60 },
      BOT_TOKEN
    );
    expect(verifyTelegramLogin(payload, BOT_TOKEN, MAX_AGE)).toEqual({ ok: false, reason: 'stale' });
  });

  it('ignores unexpected extra fields instead of signing them', () => {
    const payload = signTelegramPayloadForTests(
      { id: '12345', first_name: 'Ann', auth_date: now() },
      BOT_TOKEN
    );
    const res = verifyTelegramLogin({ ...payload, injected: 'evil' }, BOT_TOKEN, MAX_AGE);
    expect(res.ok).toBe(true);
  });
});

import { describe, it, expect, vi } from 'vitest';
import { evaluateUserAlert, evaluateAll, type UserAlertRule } from '@/services/alerts/alertEvaluator';
import {
  deliverTelegram,
  deliverWebhook,
  parseChannelsConfig,
  isPlausibleBotToken,
  isValidWebhookUrl,
  maskToken,
  buildWebhookPayload,
} from '@/services/alerts/deliveryChannels';
import { AlertDispatcher } from '@/services/alerts/AlertDispatcher';

const T0 = Date.UTC(2026, 8, 17, 12, 0, 0);
const rule = (over: Partial<UserAlertRule> = {}): UserAlertRule => ({
  id: 'r1',
  symbol: 'BTC',
  condition: 'ABOVE',
  targetValue: 100,
  createdAt: new Date(T0).toISOString(),
  ...over,
});
const ev = () => evaluateUserAlert(rule(), { price: 101, source: 'binance spot ticker (WS)' }, T0)!;

describe('alertEvaluator', () => {
  it('ABOVE/BELOW: срабатывают строго по фактической цене, без данных — молчат', () => {
    expect(evaluateUserAlert(rule(), { price: 99, source: 's' }, T0)).toBeNull();
    expect(evaluateUserAlert(rule(), { price: 100, source: 's' }, T0)?.actualValue).toBe(100);
    expect(evaluateUserAlert(rule({ condition: 'BELOW' }), { price: 99.5, source: 's' }, T0)?.actualValue).toBe(99.5);
    expect(evaluateUserAlert(rule(), { source: 's' }, T0)).toBeNull();
  });

  it('FUNDING_EXTREME по модулю, OI_SPIKE по Δ1ч; строковый порог парсится', () => {
    expect(evaluateUserAlert(rule({ condition: 'FUNDING_EXTREME', targetValue: '0.05' }), { fundingRatePct: -0.06, source: 's' }, T0)).not.toBeNull();
    expect(evaluateUserAlert(rule({ condition: 'FUNDING_EXTREME', targetValue: 0.05 }), { fundingRatePct: 0.01, source: 's' }, T0)).toBeNull();
    expect(evaluateUserAlert(rule({ condition: 'OI_SPIKE', targetValue: 5 }), { oiChange1hPct: 7, source: 's' }, T0)).not.toBeNull();
    expect(evaluateUserAlert(rule({ targetValue: 'abc' }), { price: 1e9, source: 's' }, T0)).toBeNull();
  });

  it('cooldown и paused подавляют повтор; id события детерминирован', () => {
    const first = ev();
    expect(first.id).toBe(`evt-r1-${T0}`);
    expect(first.message).toContain('источник: binance spot ticker (WS)');
    const withLast = rule({ lastTriggeredAt: first.timestamp });
    expect(evaluateUserAlert(withLast, { price: 101, source: 's' }, T0 + 60_000)).toBeNull();
    expect(evaluateUserAlert(withLast, { price: 101, source: 's' }, T0 + 5 * 60_000)).not.toBeNull();
    expect(evaluateUserAlert(rule({ paused: true }), { price: 101, source: 's' }, T0)).toBeNull();
  });

  it('evaluateAll не мутирует вход и обновляет lastTriggeredAt только сработавшим', () => {
    const rules = [rule(), rule({ id: 'r2', symbol: 'ETH', targetValue: 10 })];
    const r = evaluateAll(rules, { BTC: { price: 150, source: 's' } }, T0);
    expect(r.events.length).toBe(1);
    expect(r.rules[0].lastTriggeredAt).toBeDefined();
    expect(r.rules[1].lastTriggeredAt).toBeUndefined();
    expect(rules[0].lastTriggeredAt).toBeUndefined();
  });
});

describe('deliveryChannels', () => {
  it('валидация конфигурации', () => {
    expect(isPlausibleBotToken('123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw0')).toBe(true);
    expect(isPlausibleBotToken('nope')).toBe(false);
    expect(isValidWebhookUrl('https://x.y/h')).toBe(true);
    expect(isValidWebhookUrl('ftp://x')).toBe(false);
    expect(maskToken('123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw0')).toBe('123456…saw0');
    const cfg = parseChannelsConfig('{"telegram":{"enabled":true,"botToken":"t","chatId":"1"}}');
    expect(cfg.telegram.enabled).toBe(true);
    expect(cfg.webhook.url).toBe('');
    expect(parseChannelsConfig('garbage').telegram.enabled).toBe(false);
  });

  it('Telegram: DELIVERED только при 2xx; ошибка API — FAILED с описанием; секрет не логируется', async () => {
    const token = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw0';
    const fetchOk = vi.fn(async (_u: string, _i?: RequestInit) => new Response('{"ok":true}', { status: 200 }));
    const ok = await deliverTelegram({ enabled: true, botToken: token, chatId: '42' }, ev(), fetchOk);
    expect(ok.status).toBe('DELIVERED');
    expect(fetchOk.mock.calls[0][0]).toBe(`https://api.telegram.org/bot${token}/sendMessage`);
    const body = JSON.parse(String(fetchOk.mock.calls[0][1]?.body));
    expect(body.chat_id).toBe('42');
    expect(body.text).toContain('не исполняет сделок');

    const fetchBad = vi.fn(async () => new Response('{"ok":false,"description":"Unauthorized"}', { status: 401 }));
    const bad = await deliverTelegram({ enabled: true, botToken: token, chatId: '42' }, ev(), fetchBad);
    expect(bad.status).toBe('FAILED');
    expect(bad.detail).toBe('HTTP 401: Unauthorized');
    expect(bad.detail).not.toContain(token);

    const off = await deliverTelegram({ enabled: false, botToken: token, chatId: '42' }, ev(), fetchOk);
    expect(off.status).toBe('SKIPPED');
    const misconf = await deliverTelegram({ enabled: true, botToken: 'x', chatId: '' }, ev(), fetchOk);
    expect(misconf.status).toBe('FAILED');
  });

  it('Webhook: payload cryptora.alert.v1; CORS-ошибка → повтор no-cors → SENT_UNCONFIRMED', async () => {
    expect(buildWebhookPayload(ev()).schema).toBe('cryptora.alert.v1');
    const fetchOk = vi.fn(async () => new Response(null, { status: 204 }));
    expect((await deliverWebhook({ enabled: true, url: 'https://h/x' }, ev(), fetchOk)).status).toBe('DELIVERED');

    let n = 0;
    const fetchCors = vi.fn(async (_u: string, init?: RequestInit) => {
      n++;
      if (n === 1) throw new TypeError('Failed to fetch');
      expect(init?.mode).toBe('no-cors');
      const r = new Response(null, { status: 200 });
      Object.defineProperty(r, 'type', { value: 'opaque' });
      return r;
    });
    const r = await deliverWebhook({ enabled: true, url: 'https://h/x' }, ev(), fetchCors);
    expect(r.status).toBe('SENT_UNCONFIRMED');

    const fetchDown = vi.fn(async () => {
      throw new TypeError('offline');
    });
    expect((await deliverWebhook({ enabled: true, url: 'https://h/x' }, ev(), fetchDown)).status).toBe('FAILED');
    expect((await deliverWebhook({ enabled: true, url: 'bad' }, ev(), fetchOk)).status).toBe('FAILED');
  });
});

describe('AlertDispatcher', () => {
  it('пишет журнал по каждому каналу и персистит его', async () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    const fetchFn = vi.fn(async () => new Response('', { status: 200 }));
    const d = new AlertDispatcher(fetchFn, storage);
    const recs = await d.dispatch(ev(), ['IN_APP', 'WEBHOOK', 'TELEGRAM'], {
      browser: { enabled: false },
      telegram: { enabled: false, botToken: '', chatId: '' },
      webhook: { enabled: true, url: 'https://h/x' },
    });
    expect(recs.map((r) => `${r.channel}:${r.status}`)).toEqual(['IN_APP:DELIVERED', 'WEBHOOK:DELIVERED', 'TELEGRAM:SKIPPED']);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(JSON.parse(store.get('cryptora_alert_delivery_log')!).length).toBe(3);
    expect(new AlertDispatcher(fetchFn, storage).getLog().length).toBe(3);
  });
});

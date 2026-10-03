import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const routes = fs.readFileSync(path.resolve(__dirname, '../../server/routes/notifications.js'), 'utf8');

describe('notification endpoint ownership boundary', () => {
  it('authenticates the whole router and derives every owner from req.user', () => {
    expect(routes).toContain('router.use(requireAuth)');
    expect(routes.match(/req\.user\.id/g)?.length).toBe(4);
    expect(routes).not.toMatch(/req\.(?:body|query|params)\.(?:userId|user_id|ownerId|owner_id)/);
  });

  it('never accepts a configuration object for Telegram test delivery', () => {
    const testRoute = routes.slice(
      routes.indexOf("router.post('/telegram/test'"),
      routes.indexOf("router.post('/telegram/send'")
    );
    expect(testRoute).toContain('deliverSavedTelegram(req.user.id');
    expect(testRoute).not.toContain('req.body');
  });
});

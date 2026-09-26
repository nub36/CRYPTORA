import { test, expect, type Page, type Route } from '@playwright/test';

const RADAR_UNIVERSE = ['DOT', 'AEVO', 'RUNE'] as const;

type WsMessage = { method?: string; params?: string[] };

async function installMockRealtime(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const win = window as unknown as {
      __radarWsInstances: any[];
      __radarWsSent: any[];
      __radarEmitTicker: (symbol: string, price: number, volume: number, index: number) => void;
    };
    try {
      window.localStorage.removeItem('cryptora_qa_fixture');
      window.localStorage.setItem('cryptora_watchlist', '[]');
      window.localStorage.setItem('cryptora_alerts', '[]');
    } catch {
      /* noop */
    }
    win.__radarWsInstances = [];
    win.__radarWsSent = [];

    class MockWebSocket {
      public url: string;
      public onopen: ((event?: Event) => void) | null = null;
      public onmessage: ((event: { data: string }) => void) | null = null;
      public onerror: ((event?: Event) => void) | null = null;
      public onclose: ((event?: Event) => void) | null = null;
      public sentMessages: string[] = [];

      constructor(url: string) {
        this.url = url;
        win.__radarWsInstances.push(this);
        setTimeout(() => this.onopen?.(new Event('open')), 0);
      }

      send(raw: string) {
        this.sentMessages.push(raw);
        try {
          win.__radarWsSent.push(JSON.parse(raw));
        } catch {
          win.__radarWsSent.push(raw);
        }
      }

      close() {
        this.onclose?.(new Event('close'));
      }

      emit(payload: unknown) {
        this.onmessage?.({ data: JSON.stringify(payload) });
      }
    }

    (window as unknown as { WebSocket: unknown }).WebSocket = MockWebSocket;

    win.__radarEmitTicker = (symbol: string, price: number, volume: number, index: number) => {
      const upper = symbol.toUpperCase();
      const payload = {
        stream: `${upper.toLowerCase()}usdt@ticker`,
        data: {
          e: '24hrTicker',
          E: Date.now() + index,
          s: `${upper}USDT`,
          P: '0.00',
          c: String(price),
          h: String(price + 1),
          l: String(price - 1),
          v: String(volume),
          q: String(volume * price),
        },
      };
      for (const ws of win.__radarWsInstances) ws.emit(payload);
    };
  });
}

async function installApiFixtures(page: Page): Promise<void> {
  await page.route(/\/api\/strategies\/scan-universe(?:\?.*)?$/, (route: Route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ symbols: RADAR_UNIVERSE, activeKnown: true }),
  }));

  await page.route('**/api/signals**', (route: Route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ signals: [], count: 0, total: 0, source: 'server' }),
  }));

  await page.route('**/api/strategies', (route: Route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ strategies: [], source: 'server' }),
  }));

  await page.route('**/api/market/**', (route: Route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({}),
  }));
}

async function emitBaselineTicks(page: Page): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    for (const symbol of RADAR_UNIVERSE) {
      await page.evaluate(([s, idx]) => {
        (window as unknown as { __radarEmitTicker: (symbol: string, price: number, volume: number, index: number) => void })
          .__radarEmitTicker(s, 100, 1000 + (idx % 2), idx);
      }, [symbol, i] as const);
    }
  }
}

function tickerStreams(messages: WsMessage[], method: string): string[] {
  return messages
    .filter((message) => message.method === method)
    .flatMap((message) => message.params ?? [])
    .filter((stream) => stream.endsWith('@ticker'))
    .sort();
}

test.describe('Market Radar LIVE lifecycle', () => {
  test('subscribes bounded Scan Universe, warms, renders anomaly, filters, and releases leases', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(String(err)));
    await installMockRealtime(page);
    await installApiFixtures(page);

    await page.goto('/radar');
    await expect(page.getByTestId('radar-empty-state')).toHaveAttribute('data-state', 'warming', { timeout: 15_000 });

    await page.waitForFunction(() => {
      const messages = ((window as any).__radarWsSent ?? []) as WsMessage[];
      const urlStreams = (((window as any).__radarWsInstances ?? []) as Array<{ url: string }>).flatMap((ws) => {
        try {
          return new URL(ws.url).searchParams.get('streams')?.split('/') ?? [];
        } catch {
          return [];
        }
      });
      const subscribed = messages
        .filter((message) => message.method === 'SUBSCRIBE')
        .flatMap((message) => message.params ?? [])
        .concat(urlStreams);
      return ['aevousdt@ticker', 'dotusdt@ticker', 'runeusdt@ticker'].every((stream) => subscribed.includes(stream));
    });

    const subscribedTickers = await page.evaluate(() => {
      const messages = ((window as any).__radarWsSent ?? []) as WsMessage[];
      const urlStreams = (((window as any).__radarWsInstances ?? []) as Array<{ url: string }>).flatMap((ws) => {
        try {
          return new URL(ws.url).searchParams.get('streams')?.split('/') ?? [];
        } catch {
          return [];
        }
      });
      return Array.from(new Set(messages
        .filter((message) => message.method === 'SUBSCRIBE')
        .flatMap((message) => message.params ?? [])
        .concat(urlStreams)
        .filter((stream) => stream.endsWith('@ticker') && stream !== 'btcusdt@ticker')))
        .sort();
    });
    expect(subscribedTickers).toEqual(['aevousdt@ticker', 'dotusdt@ticker', 'runeusdt@ticker']);

    await emitBaselineTicks(page);
    await expect(page.getByTestId('radar-empty-state')).toHaveAttribute('data-state', 'ready-empty', { timeout: 10_000 });

    await page.evaluate(() => {
      (window as unknown as { __radarEmitTicker: (symbol: string, price: number, volume: number, index: number) => void })
        .__radarEmitTicker('DOT', 105, 1000, 101);
    });
    await expect(page.getByTestId('radar-event-row')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('DOT').first()).toBeVisible();

    await page.getByLabel('Важность аномалии').selectOption('MEDIUM');
    await expect(page.getByTestId('radar-empty-state')).toHaveAttribute('data-state', 'filtered');

    await page.getByRole('link', { name: 'CRYPTORA Главная' }).click();
    await page.waitForFunction(() => {
      const messages = ((window as any).__radarWsSent ?? []) as WsMessage[];
      const unsubscribed = messages
        .filter((message) => message.method === 'UNSUBSCRIBE')
        .flatMap((message) => message.params ?? []);
      return ['aevousdt@ticker', 'dotusdt@ticker', 'runeusdt@ticker'].every((stream) => unsubscribed.includes(stream));
    });

    const messages = await page.evaluate(() => ((window as any).__radarWsSent ?? []) as WsMessage[]);
    expect(tickerStreams(messages, 'UNSUBSCRIBE')).toEqual(['aevousdt@ticker', 'dotusdt@ticker', 'runeusdt@ticker']);

    const responsive = await page.evaluate(() => new Promise<boolean>((resolve) => requestAnimationFrame(() => resolve(true))));
    expect(responsive).toBe(true);
    expect(pageErrors, `pageerror: ${pageErrors.join('; ')}`).toEqual([]);
  });
});

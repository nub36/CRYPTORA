import { describe, expect, it, beforeEach } from 'vitest';
import { RealtimeFeedManager } from '@/services/realtime/RealtimeFeedManager';
import {
  releaseRadarScopedSubscriptions,
  syncRadarScopedSubscriptions,
  type ScopedSymbolReleases,
} from '@/services/realtime/radarScopedSubscriptions';

class MockWebSocket {
  public static instances: MockWebSocket[] = [];
  public url: string;
  public onopen: (() => void) | null = null;
  public onmessage: ((ev: { data: string }) => void) | null = null;
  public onerror: (() => void) | null = null;
  public onclose: (() => void) | null = null;
  public sentMessages: string[] = [];

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
    setTimeout(() => this.onopen?.(), 1);
  }

  public send(message: string) {
    this.sentMessages.push(message);
  }

  public close() {
    this.onclose?.();
  }
}

async function connectedManager(): Promise<RealtimeFeedManager> {
  const manager = new RealtimeFeedManager({ wsOptions: { webSocketClass: MockWebSocket } });
  manager.binanceClient.connect();
  await new Promise((resolve) => setTimeout(resolve, 5));
  return manager;
}

function messages(): Array<{ method?: string; params?: string[] }> {
  return MockWebSocket.instances.flatMap((ws) => ws.sentMessages.map((raw) => JSON.parse(raw)));
}

function streams(method: 'SUBSCRIBE' | 'UNSUBSCRIBE'): string[] {
  return messages()
    .filter((message) => message.method === method)
    .flatMap((message) => message.params ?? []);
}

describe('Radar-owned live universe subscriptions', () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
  });

  it('acquires one bounded scoped ticker lease per scan-universe symbol on LIVE mount', async () => {
    const manager = await connectedManager();
    const leases: ScopedSymbolReleases = new Map();

    syncRadarScopedSubscriptions(manager, leases, ['BTC', 'ETH', 'SOL']);

    expect(leases.size).toBe(3);
    expect(streams('SUBSCRIBE').filter((stream) => stream.endsWith('@ticker')).sort()).toEqual([
      'btcusdt@ticker',
      'ethusdt@ticker',
      'solusdt@ticker',
    ]);
    releaseRadarScopedSubscriptions(leases);
    manager.destroy();
  });

  it('releases Radar leases exactly once on unmount', async () => {
    const manager = await connectedManager();
    const leases: ScopedSymbolReleases = new Map();
    syncRadarScopedSubscriptions(manager, leases, ['BTC', 'ETH', 'SOL']);

    releaseRadarScopedSubscriptions(leases);
    releaseRadarScopedSubscriptions(leases);

    expect(streams('UNSUBSCRIBE').filter((stream) => stream.endsWith('@ticker')).sort()).toEqual([
      'btcusdt@ticker',
      'ethusdt@ticker',
      'solusdt@ticker',
    ]);
    expect(leases.size).toBe(0);
    manager.destroy();
  });

  it('does not drop a shared watchlist/coin subscription when Radar unmounts', async () => {
    const manager = await connectedManager();
    manager.subscribeSymbol('BTC');
    const leases: ScopedSymbolReleases = new Map();
    syncRadarScopedSubscriptions(manager, leases, ['BTC']);

    releaseRadarScopedSubscriptions(leases);

    expect(streams('UNSUBSCRIBE')).not.toContain('btcusdt@ticker');
    expect(streams('UNSUBSCRIBE')).not.toContain('btcusdt@trade');
    manager.destroy();
  });

  it('delta-applies universe changes without duplicate subscriptions or ETH churn', async () => {
    const manager = await connectedManager();
    const leases: ScopedSymbolReleases = new Map();
    syncRadarScopedSubscriptions(manager, leases, ['BTC', 'ETH']);
    const messagesBeforeUpdate = messages().length;

    syncRadarScopedSubscriptions(manager, leases, ['ETH', 'SOL']);
    syncRadarScopedSubscriptions(manager, leases, ['ETH', 'SOL']);

    const updateMessages = messages().slice(messagesBeforeUpdate);
    const updateStreams = (method: 'SUBSCRIBE' | 'UNSUBSCRIBE') => updateMessages
      .filter((message) => message.method === method)
      .flatMap((message) => message.params ?? []);

    expect(Array.from(leases.keys()).sort()).toEqual(['ETH', 'SOL']);
    expect(updateStreams('UNSUBSCRIBE').sort()).toEqual(['btcusdt@ticker', 'btcusdt@trade']);
    expect(updateStreams('SUBSCRIBE').sort()).toEqual(['solusdt@ticker', 'solusdt@trade']);
    expect(updateStreams('UNSUBSCRIBE')).not.toContain('ethusdt@ticker');
    expect(updateStreams('SUBSCRIBE')).not.toContain('ethusdt@ticker');

    releaseRadarScopedSubscriptions(leases);
    manager.destroy();
  });
});

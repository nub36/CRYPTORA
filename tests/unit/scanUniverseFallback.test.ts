/**
 * exchangeInfo недоступен → канонический реестр НЕ сканируется как fallback.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LiveSignalEngine } from '@/services/signals/live/LiveSignalEngine';
import {
  getScanUniverse,
  isScanUniverseConfirmed,
  refreshScanUniverse,
  resetScanUniverseForTests,
} from '@/services/signals/scanUniverse';
import type { MarketDataProvider } from '@/services/data/MarketDataProvider';

afterEach(() => {
  resetScanUniverseForTests();
  LiveSignalEngine.resetInstance();
});

const reply = (body: unknown, ok = true) => vi.fn(async () => ({ ok, status: ok ? 200 : 503, json: async () => body })) as unknown as typeof fetch;

describe('scan universe without confirmed exchange status', () => {
  it('before any server answer: empty, not canonical 25', () => {
    expect(getScanUniverse()).toEqual([]);
    expect(isScanUniverseConfirmed()).toBe(false);
  });

  it('server says activeKnown=false → empty, even if a list was confirmed before', async () => {
    await refreshScanUniverse(reply({ symbols: ['BTC', 'ETH'], activeKnown: true }));
    expect(getScanUniverse()).toEqual(['BTC', 'ETH']);
    await refreshScanUniverse(reply({ symbols: [], activeKnown: false }));
    expect(getScanUniverse()).toEqual([]);
    expect(isScanUniverseConfirmed()).toBe(false);
  });

  it('server unreachable → never falls back to canonical', async () => {
    await refreshScanUniverse(reply({}, false));
    expect(getScanUniverse()).toEqual([]);
  });

  it('engine with an empty universe requests no candles', async () => {
    const getCandles = vi.fn().mockResolvedValue([]);
    const provider = { getCandles } as unknown as MarketDataProvider;
    const engine = LiveSignalEngine.getInstance({ provider, symbols: ['BTC'] })!;
    engine.updateSymbols(getScanUniverse());
    await engine.scanNow();
    expect(getCandles).not.toHaveBeenCalled();
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CoinIcon } from '@/components/common/CoinIcon';
import {
  coinMetadataRequestCount,
  getCoinLogoUrl,
  getCoinNames,
  resetCoinLogoCacheForTests,
} from '@/services/data/registry/coinLogoRegistry';

afterEach(() => {
  resetCoinLogoCacheForTests();
  vi.unstubAllGlobals();
});

const LOGO = (s: string) => `https://assets.coingecko.com/coins/images/${s}.png`;

function serverMetadata(assets: Record<string, { name: string; logo: string }>) {
  return vi.fn(async (url: string) => {
    if (String(url).startsWith('/api/market/metadata/assets')) return { ok: true, json: async () => ({ assets }) };
    return { ok: false, status: 404, json: async () => ({}) };
  });
}

describe('logo pipeline — server metadata cache, one request for the whole universe', () => {
  it('resolves canonical AND dynamic assets (BTC ETH SOL LTC BCH ZEC PEPE USDC + dynamic) from ONE request', async () => {
    const symbols = ['BTC', 'ETH', 'SOL', 'LTC', 'BCH', 'ZEC', 'PEPE', 'USDC', 'WIF', 'BONK', 'ENA'];
    const fetch = serverMetadata(Object.fromEntries(symbols.map((s) => [s, { name: `${s} name`, logo: LOGO(s) }])));
    vi.stubGlobal('fetch', fetch);

    const urls = await Promise.all(symbols.map((s) => getCoinLogoUrl(`${s}USDT`)));
    expect(urls).toEqual(symbols.map(LOGO));
    expect(fetch).toHaveBeenCalledTimes(1); // no request storm, no per-coin calls
    expect(coinMetadataRequestCount()).toBe(1);

    // cached: rendering hundreds of icons later makes zero further requests
    await Promise.all(Array.from({ length: 300 }, () => getCoinLogoUrl('PEPE')));
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('renders the metadata image for a dynamic asset lazily', async () => {
    vi.stubGlobal('fetch', serverMetadata({ PEPE: { name: 'Pepe', logo: LOGO('pepe') } }));
    render(<CoinIcon symbol="PEPEUSDT" size={32} />);
    const image = await screen.findByTestId('coin-logo-image');
    expect(image).toHaveAttribute('src', LOGO('pepe'));
    expect(image).toHaveAttribute('loading', 'lazy');
  });

  it('falls back to direct CoinGecko when the server endpoint is unavailable', async () => {
    const fetch = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.startsWith('/api/')) return { ok: false, status: 404, json: async () => ({}) };
      if (u.includes('ids=')) return { ok: true, json: async () => [{ id: 'bitcoin', name: 'Bitcoin', image: LOGO('btc') }] };
      return { ok: true, json: async () => [{ id: 'litecoin', symbol: 'ltc', name: 'Litecoin', image: LOGO('ltc') }] };
    });
    vi.stubGlobal('fetch', fetch);
    expect(await getCoinLogoUrl('BTC')).toBe(LOGO('btc'));
    expect(await getCoinLogoUrl('LTC')).toBe(LOGO('ltc'));
    expect(fetch).toHaveBeenCalledTimes(3); // server (failed) + 2 bulk CoinGecko calls, once
  });

  it('letter avatar is the LAST fallback: unknown ticker, failed sources, or broken image', async () => {
    const fetch = serverMetadata({ BTC: { name: 'Bitcoin', logo: LOGO('btc') } });
    vi.stubGlobal('fetch', fetch);
    const unknown = render(<CoinIcon symbol="ZZZUNKNOWN" />);
    expect(await screen.findByTestId('coin-logo-fallback')).toHaveTextContent('Z');
    unknown.unmount();

    render(<CoinIcon symbol="BTC" />);
    await waitFor(() => expect(screen.getByTestId('coin-logo-image')).toBeInTheDocument());
    fireEvent.error(screen.getByTestId('coin-logo-image'));
    expect(screen.getByTestId('coin-logo-fallback')).toHaveTextContent('B');
  });

  it('total failure backs off instead of retrying on every icon (no storm)', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('offline'));
    vi.stubGlobal('fetch', fetch);
    expect(await getCoinLogoUrl('BTC')).toBeNull();
    const callsAfterFirst = fetch.mock.calls.length;
    await Promise.all(Array.from({ length: 50 }, (_, i) => getCoinLogoUrl(`C${i}`)));
    expect(fetch.mock.calls.length).toBe(callsAfterFirst);
  });

  it('provides display names for selector search (canonical > metadata > ticker)', async () => {
    vi.stubGlobal('fetch', serverMetadata({ LTC: { name: 'Litecoin', logo: LOGO('ltc') } }));
    const names = await getCoinNames(['BTC', 'LTC', 'NEWCOIN']);
    expect(names.get('BTC')).toBe('Bitcoin');
    expect(names.get('LTC')).toBe('Litecoin');
    expect(names.get('NEWCOIN')).toBe('NEWCOIN');
  });
});

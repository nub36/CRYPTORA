import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CoinIcon } from '@/components/common/CoinIcon';
import { resetCoinLogoCacheForTests } from '@/services/data/registry/coinLogoRegistry';

afterEach(() => {
  resetCoinLogoCacheForTests();
  vi.unstubAllGlobals();
});

describe('CoinIcon CoinGecko metadata pipeline', () => {
  it('uses the real metadata image URL when the shared markets response contains it', async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ id: 'bitcoin', image: 'https://assets.coingecko.com/coins/images/1/large/bitcoin.png' }],
    });
    vi.stubGlobal('fetch', fetch);

    render(<CoinIcon symbol="BTCUSDT" size={32} />);
    const image = await screen.findByTestId('coin-logo-image');
    expect(image).toHaveAttribute('src', 'https://assets.coingecko.com/coins/images/1/large/bitcoin.png');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0][0])).toContain('/coins/markets?');
    expect(String(fetch.mock.calls[0][0])).toContain('ids=');
  });

  it('falls back to the letter avatar when metadata is absent or the logo image errors', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
    vi.stubGlobal('fetch', fetch);
    const first = render(<CoinIcon symbol="BTC" />);
    expect(await screen.findByTestId('coin-logo-fallback')).toHaveTextContent('B');
    first.unmount();

    resetCoinLogoCacheForTests();
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [{ id: 'bitcoin', image: 'https://assets.coingecko.com/coins/images/1/large/bitcoin.png' }],
    });
    render(<CoinIcon symbol="BTC" />);
    await waitFor(() => expect(screen.getByTestId('coin-logo-image')).toBeInTheDocument());
    fireEvent.error(screen.getByTestId('coin-logo-image'));
    expect(screen.getByTestId('coin-logo-fallback')).toHaveTextContent('B');
  });
});

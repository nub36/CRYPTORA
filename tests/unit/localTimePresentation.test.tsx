import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { localTimeZoneLabel } from '@/utils/timePresentation';
import { signalSymbolToRoute } from '@/services/signals/signalNotifications';

afterEach(() => cleanup());

describe('local time presentation', () => {
  it('derives the zone label from the browser instead of a hardcoded offset', () => {
    const label = localTimeZoneLabel();
    expect(label).toBeTruthy();
    // Must never be a baked-in Moscow offset.
    expect(label).not.toBe('UTC+3');
    expect(label).not.toContain('Moscow');
  });

  it('footer shows a browser-local clock, not a UTC-labelled one', async () => {
    vi.resetModules();
    const { Footer } = await import('@/components/layout/Footer');
    const { MarketDataProviderComponent } = await import('@/context/MarketDataContext');
    const { ThemeProvider } = await import('@/context/ThemeContext');
    localStorage.setItem('cryptora_qa_fixture', '1');

    render(
      <MemoryRouter>
        <ThemeProvider>
          <MarketDataProviderComponent>
            <Footer />
          </MarketDataProviderComponent>
        </ThemeProvider>
      </MemoryRouter>,
    );

    const node = document.querySelector('[data-qa="footer-clock"]') as HTMLElement;
    expect(node).toBeTruthy();
    // The visible clock is prefixed with the viewer's own zone, not the literal "UTC hh:mm:ss".
    expect(node.textContent).toMatch(/\d{2}:\d{2}:\d{2}/);
    expect(node.textContent).toContain(localTimeZoneLabel());
    // The UTC instant remains available as supporting context, not as the headline.
    expect(node.getAttribute('title')).toContain('UTC');
    localStorage.clear();
  });
});

describe('signal → asset navigation', () => {
  it('maps pair notation to the coin route base asset', () => {
    expect(signalSymbolToRoute('FET/USDT')).toBe('FET');
    expect(signalSymbolToRoute('ARB/USDT')).toBe('ARB');
    expect(signalSymbolToRoute('NEAR/USDT')).toBe('NEAR');
    // Already-bare and exchange-style inputs normalize too.
    expect(signalSymbolToRoute('BTC')).toBe('BTC');
    expect(signalSymbolToRoute('solusdt')).toBe('SOL');
    expect(signalSymbolToRoute('ETH-USDT')).toBe('ETH');
  });
});

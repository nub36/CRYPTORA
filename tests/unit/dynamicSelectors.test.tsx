/**
 * Market pagination, selectors (coin / liquidation) and the Admin scan manager
 * over the FULL dynamic universe.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { paginate, DEFAULT_PAGE_SIZE } from '@/utils/pagination';
import { filterPickerSymbols, SymbolPickerModal, PICKER_RENDER_LIMIT } from '@/components/common/SymbolPickerModal';
import { searchScanCandidates, ScanUniverseManager, SCAN_MANAGER_RENDER_LIMIT } from '@/components/admin/ScanUniverseManager';
import { resetExchangeUniverseForTests } from '@/services/data/registry/exchangeUniverse';
import { resetCoinLogoCacheForTests } from '@/services/data/registry/coinLogoRegistry';
import {
  applyServerUniverse,
  getScanUniverse,
  normalizeScanSymbol,
  refreshScanUniverse,
  resetScanUniverseForTests,
  subscribeScanUniverse,
} from '@/services/signals/scanUniverse';

afterEach(() => {
  resetExchangeUniverseForTests();
  resetCoinLogoCacheForTests();
  resetScanUniverseForTests();
  vi.unstubAllGlobals();
});

const DYNAMIC = Array.from({ length: 540 }, (_, i) => `DYN${i}`);
const UNIVERSE = ['BTC', 'ETH', 'SOL', 'LTC', 'BCH', 'ZEC', 'PEPE', 'USDC', 'FET', 'ARB', 'NEAR', ...DYNAMIC];
const NAMES: Record<string, string> = { LTC: 'Litecoin', PEPE: 'Pepe', BCH: 'Bitcoin Cash', ZEC: 'Zcash', USDC: 'USDC' };

function stubServer(extra: (url: string, init?: RequestInit) => unknown = () => undefined) {
  const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    const custom = extra(u, init);
    if (custom) return custom;
    if (u.includes('/api/market/universe/spot')) {
      return { ok: true, json: async () => ({ symbols: UNIVERSE.map((s) => ({ symbol: s, exchangeSymbol: `${s}USDT`, baseAsset: s })) }) };
    }
    if (u.includes('/api/market/metadata/assets')) {
      return { ok: true, json: async () => ({ assets: Object.fromEntries(Object.entries(NAMES).map(([s, n]) => [s, { name: n, logo: `https://img/${s}.png` }])) }) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  });
  vi.stubGlobal('fetch', fetchFn);
  return fetchFn;
}

describe('Market pagination (bounded DOM for 500+ assets)', () => {
  it('renders one page at a time and covers every row across pages', () => {
    const rows = Array.from({ length: 736 }, (_, i) => i);
    const first = paginate(rows, 1);
    expect(first.rows).toHaveLength(DEFAULT_PAGE_SIZE);
    expect(first.pageCount).toBe(Math.ceil(736 / DEFAULT_PAGE_SIZE));
    const last = paginate(rows, 999);
    expect(last.page).toBe(first.pageCount);
    expect(last.to).toBe(736);
    const all = Array.from({ length: first.pageCount }, (_, p) => paginate(rows, p + 1).rows).flat();
    expect(all).toEqual(rows);
    expect(paginate([], 1)).toMatchObject({ rows: [], pageCount: 1, from: 0, to: 0 });
  });
});

describe('Coin / Liquidation selector — full active Spot universe', () => {
  it('pure filter finds dynamic assets by ticker and name; no "custom ticker" in authoritative mode', () => {
    const assets = UNIVERSE.map((s) => ({ symbol: s, name: NAMES[s] ?? s }));
    expect(filterPickerSymbols('litecoin', assets, true).map((e) => e.symbol)).toEqual(['LTC']);
    expect(filterPickerSymbols('PEPE', assets, true)[0]).toMatchObject({ symbol: 'PEPE', custom: false });
    expect(filterPickerSymbols('DYN539', assets, true)[0]!.symbol).toBe('DYN539');
    expect(filterPickerSymbols('VEN', assets, true).some((e) => e.custom)).toBe(false);
    expect(filterPickerSymbols('', assets, true)).toHaveLength(UNIVERSE.length); // not canonical 25
  });

  it('modal lazily loads the universe, renders a bounded list with logos, and selects a dynamic asset', async () => {
    const fetchFn = stubServer();
    const onSelect = vi.fn();
    render(<SymbolPickerModal open onClose={() => {}} onSelect={onSelect} title="Инструмент для графика ликвидаций" />);
    const dialog = screen.getByRole('dialog');
    expect(await within(dialog).findByText(`Активных Spot USDT на Binance: ${UNIVERSE.length}`)).toBeInTheDocument();
    expect(within(dialog).getAllByRole('button').filter((b) => b.dataset.qa?.startsWith('symbol-picker-option-')).length)
      .toBeLessThanOrEqual(PICKER_RENDER_LIMIT);
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'bitcoin cash' } });
    const bch = await within(dialog).findByRole('button', { name: /^BCH Bitcoin Cash$/ });
    fireEvent.click(bch);
    expect(onSelect).toHaveBeenCalledWith('BCH');
    // universe + metadata only: 2 requests, no per-coin requests
    expect(fetchFn.mock.calls.map(([u]) => String(u)).sort()).toEqual(['/api/market/metadata/assets', '/api/market/universe/spot']);
  });

  it('closed modal makes no requests at all', () => {
    const fetchFn = stubServer();
    render(<SymbolPickerModal open={false} onClose={() => {}} onSelect={() => {}} />);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('Admin scan universe — server-side, dynamic assets', () => {
  it('pure search sees dynamic assets (LTC, PEPE, DYN…) and marks scan membership', () => {
    const names = new Map(Object.entries(NAMES));
    const scan = new Set(['BTC', 'PEPE']);
    expect(searchScanCandidates('', UNIVERSE, names, scan).map((r) => r.symbol)).toEqual(['BTC', 'PEPE']);
    expect(searchScanCandidates('lite', UNIVERSE, names, scan)).toEqual([{ symbol: 'LTC', name: 'Litecoin', inScan: false }]);
    expect(searchScanCandidates('PEPE', UNIVERSE, names, scan)[0]).toMatchObject({ inScan: true });
    expect(searchScanCandidates('DYN5', UNIVERSE, names, scan).length).toBeGreaterThan(SCAN_MANAGER_RENDER_LIMIT);
  });

  it('shows "Доступно на рынке" / "В скане" and adds LTC via the server API', async () => {
    let saved = ['BTC', 'ETH'];
    const state = () => ({ saved, effective: saved, inactive: [], activeKnown: true, activeCount: UNIVERSE.length, max: 100 });
    const fetchFn = stubServer((u, init) => {
      if (u === '/api/admin/scan-universe' && (!init || !init.method)) return { ok: true, json: async () => state() };
      if (u === '/api/admin/scan-universe' && init?.method === 'POST') {
        saved = [...saved, JSON.parse(String(init.body)).symbol];
        return { ok: true, json: async () => state() };
      }
      return undefined;
    });
    render(<ScanUniverseManager />);
    expect(await screen.findByText(String(UNIVERSE.length), { selector: '[data-qa="universe-available-count"]' })).toBeInTheDocument();
    expect(screen.getByText('2', { selector: '[data-qa="universe-count"]' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Поиск монеты для скана'), { target: { value: 'LTC' } });
    const addBtn = await screen.findByRole('button', { name: /Добавить в скан/ });
    await act(async () => { fireEvent.click(addBtn); });
    expect(await screen.findByText('3', { selector: '[data-qa="universe-count"]' })).toBeInTheDocument();
    const post = fetchFn.mock.calls.find(([u, i]) => u === '/api/admin/scan-universe' && (i as RequestInit)?.method === 'POST');
    expect(JSON.parse(String((post![1] as RequestInit).body))).toEqual({ symbol: 'LTC' });
    expect(getScanUniverse()).toEqual(['BTC', 'ETH', 'LTC']); // engine sees the server state
    expect(localStorage.getItem('cryptora_scan_universe_v1')).toBeNull(); // not localStorage
  });

  it('client engine universe comes from the server and notifies subscribers', async () => {
    stubServer((u) => (u === '/api/strategies/scan-universe'
      ? { ok: true, json: async () => ({ symbols: ['BTC', 'PEPE', 'LTC'], activeKnown: true }) }
      : undefined));
    const listener = vi.fn();
    subscribeScanUniverse(listener);
    await refreshScanUniverse();
    expect(getScanUniverse()).toEqual(['BTC', 'PEPE', 'LTC']);
    expect(listener).toHaveBeenCalledTimes(1);
    applyServerUniverse(['BTC', 'PEPE', 'LTC']);
    expect(listener).toHaveBeenCalledTimes(1); // unchanged → no churn
    expect(normalizeScanSymbol('pepeusdt')).toBe('PEPE');
  });
});

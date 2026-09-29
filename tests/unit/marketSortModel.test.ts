import { describe, it, expect } from 'vitest';
import {
  compareSortValues,
  describeSortState,
  isMissingSortValue,
  nextSortState,
  sortMarketRows,
  type MarketSortField,
} from '@/utils/marketSort';
import { SPOT_SORT_FIELDS, sortMarketUniverse } from '@/services/data/registry/marketUniverse';
import type { AssetSummary } from '@/types/market';

/**
 * Task §7 / §10 — the ONE sorting model shared by the Spot and Futures tables.
 * Every guarantee the UI relies on is pinned here: numeric ordering on numbers,
 * A→Z / Z→A on text, "Нет данных" always last in BOTH directions, stability on
 * ties, and composition with search + filters before pagination.
 */

interface Row {
  symbol: string;
  name: string;
  price: number;
  change24h: number;
  volume24h: number | null;
  funding: number | null;
  openInterest: number | null;
  favorite: boolean;
}

const FIELDS: MarketSortField<Row>[] = [
  { key: 'symbol', label: 'Тикер', kind: 'text', value: (r) => r.symbol, defaultDirection: 'asc' },
  { key: 'name', label: 'Название', kind: 'text', value: (r) => r.name, defaultDirection: 'asc' },
  { key: 'price', label: 'Цена', kind: 'numeric', value: (r) => r.price },
  { key: 'change24h', label: '24ч %', kind: 'numeric', value: (r) => r.change24h },
  { key: 'volume24h', label: 'Объём 24ч', kind: 'numeric', value: (r) => r.volume24h },
  { key: 'funding', label: 'Фандинг', kind: 'numeric', value: (r) => r.funding },
  { key: 'openInterest', label: 'ОИ', kind: 'numeric', value: (r) => r.openInterest },
];

const ROWS: Row[] = [
  { symbol: 'BTC', name: 'Bitcoin', price: 64000, change24h: 2.5, volume24h: 42_000_000_000, funding: 0.01, openInterest: 18_000_000_000, favorite: true },
  { symbol: 'ETH', name: 'Ethereum', price: 3200, change24h: -1.2, volume24h: 18_000_000_000, funding: -0.005, openInterest: 9_000_000_000, favorite: false },
  { symbol: 'ARB', name: 'Arbitrum', price: 0.85, change24h: 9.4, volume24h: null, funding: null, openInterest: null, favorite: false },
  { symbol: 'SOL', name: 'Solana', price: 148.25, change24h: 0, volume24h: 3_500_000_000, funding: 0.02, openInterest: null, favorite: true },
  { symbol: '1000PEPE', name: 'Pepe (×1000)', price: 0.0085, change24h: -1.2, volume24h: 900_000_000, funding: 0.0, openInterest: 400_000_000, favorite: false },
];

const keys = (rows: Row[]) => rows.map((r) => r.symbol);

describe('marketSort — missing-value semantics', () => {
  it('treats null/undefined/NaN and the rendered placeholders as missing', () => {
    expect(isMissingSortValue(null)).toBe(true);
    expect(isMissingSortValue(undefined)).toBe(true);
    expect(isMissingSortValue(Number.NaN)).toBe(true);
    expect(isMissingSortValue(Number.POSITIVE_INFINITY)).toBe(true);
    expect(isMissingSortValue('Нет данных')).toBe(true);
    expect(isMissingSortValue('—')).toBe(true);
    expect(isMissingSortValue('')).toBe(true);
  });

  it('never treats a real zero as missing', () => {
    expect(isMissingSortValue(0)).toBe(false);
    expect(isMissingSortValue(-0)).toBe(false);
    expect(compareSortValues(0, null, 'asc')).toBeLessThan(0);
    expect(compareSortValues(0, null, 'desc')).toBeLessThan(0);
  });

  it('pushes missing values last in both directions', () => {
    expect(compareSortValues(null, 5, 'asc')).toBeGreaterThan(0);
    expect(compareSortValues(null, 5, 'desc')).toBeGreaterThan(0);
    expect(compareSortValues(5, null, 'asc')).toBeLessThan(0);
    expect(compareSortValues(5, null, 'desc')).toBeLessThan(0);
    expect(compareSortValues(null, undefined, 'asc')).toBe(0);
  });
});

describe('marketSort — numeric sorting', () => {
  it('sorts prices numerically, not lexicographically', () => {
    expect(keys(sortMarketRows(ROWS, FIELDS, { key: 'price', direction: 'asc' })))
      .toEqual(['1000PEPE', 'ARB', 'SOL', 'ETH', 'BTC']);
    expect(keys(sortMarketRows(ROWS, FIELDS, { key: 'price', direction: 'desc' })))
      .toEqual(['BTC', 'ETH', 'SOL', 'ARB', '1000PEPE']);
  });

  it('sorts 24h change in both directions', () => {
    const asc = keys(sortMarketRows(ROWS, FIELDS, { key: 'change24h', direction: 'asc' }));
    expect(asc[0]).toBe('ETH'); // -1.2, first of the tie in input order
    expect(asc[asc.length - 1]).toBe('ARB'); // +9.4
    expect(keys(sortMarketRows(ROWS, FIELDS, { key: 'change24h', direction: 'desc' }))[0]).toBe('ARB');
  });

  it('keeps rows with missing 24h volume at the bottom of both directions', () => {
    const asc = keys(sortMarketRows(ROWS, FIELDS, { key: 'volume24h', direction: 'asc' }));
    const desc = keys(sortMarketRows(ROWS, FIELDS, { key: 'volume24h', direction: 'desc' }));
    expect(asc[asc.length - 1]).toBe('ARB');
    expect(desc[desc.length - 1]).toBe('ARB');
    expect(asc[0]).toBe('1000PEPE');
    expect(desc[0]).toBe('BTC');
  });

  it('sorts futures-only fields (funding, open interest) with nulls last', () => {
    const funding = keys(sortMarketRows(ROWS, FIELDS, { key: 'funding', direction: 'desc' }));
    expect(funding[0]).toBe('SOL');
    expect(funding[funding.length - 1]).toBe('ARB');

    const oiAsc = sortMarketRows(ROWS, FIELDS, { key: 'openInterest', direction: 'asc' });
    expect(keys(oiAsc).slice(0, 3)).toEqual(['1000PEPE', 'ETH', 'BTC']);
    expect(keys(oiAsc).slice(3).sort()).toEqual(['ARB', 'SOL']);
  });
});

describe('marketSort — alphabetical sorting', () => {
  it('sorts A→Z and Z→A on the ticker', () => {
    expect(keys(sortMarketRows(ROWS, FIELDS, { key: 'symbol', direction: 'asc' })))
      .toEqual(['1000PEPE', 'ARB', 'BTC', 'ETH', 'SOL']);
    expect(keys(sortMarketRows(ROWS, FIELDS, { key: 'symbol', direction: 'desc' })))
      .toEqual(['SOL', 'ETH', 'BTC', 'ARB', '1000PEPE']);
  });

  it('sorts names case-insensitively', () => {
    const rows = [
      { ...ROWS[0], name: 'bitcoin' },
      { ...ROWS[1], name: 'Aave' },
      { ...ROWS[2], name: 'Cardano' },
    ];
    expect(sortMarketRows(rows, FIELDS, { key: 'name', direction: 'asc' }).map((r) => r.name))
      .toEqual(['Aave', 'bitcoin', 'Cardano']);
  });
});

describe('marketSort — stability', () => {
  it('keeps the incoming order for equal values', () => {
    const ties: Row[] = ['AAA', 'BBB', 'CCC', 'DDD'].map((symbol) => ({
      ...ROWS[0], symbol, name: symbol, change24h: 1.5,
    }));
    expect(keys(sortMarketRows(ties, FIELDS, { key: 'change24h', direction: 'desc' })))
      .toEqual(['AAA', 'BBB', 'CCC', 'DDD']);
    expect(keys(sortMarketRows(ties, FIELDS, { key: 'change24h', direction: 'asc' })))
      .toEqual(['AAA', 'BBB', 'CCC', 'DDD']);
  });

  it('keeps missing-value rows in their incoming order at the bottom', () => {
    const rows: Row[] = [
      { ...ROWS[0], symbol: 'M1', volume24h: null },
      { ...ROWS[0], symbol: 'V1', volume24h: 10 },
      { ...ROWS[0], symbol: 'M2', volume24h: null },
      { ...ROWS[0], symbol: 'M3', volume24h: Number.NaN },
    ];
    expect(keys(sortMarketRows(rows, FIELDS, { key: 'volume24h', direction: 'desc' })))
      .toEqual(['V1', 'M1', 'M2', 'M3']);
  });

  it('does not mutate the input array', () => {
    const input = [...ROWS];
    sortMarketRows(input, FIELDS, { key: 'price', direction: 'asc' });
    expect(keys(input)).toEqual(keys(ROWS));
  });

  it('returns a copy when the sort key is unknown or state is null', () => {
    expect(keys(sortMarketRows(ROWS, FIELDS, null))).toEqual(keys(ROWS));
    expect(keys(sortMarketRows(ROWS, FIELDS, { key: 'nope', direction: 'asc' }))).toEqual(keys(ROWS));
  });
});

describe('marketSort — click semantics', () => {
  it('toggles direction on the same field and uses the default on a new one', () => {
    const first = nextSortState(null, FIELDS, 'price');
    expect(first).toEqual({ key: 'price', direction: 'desc' });
    expect(nextSortState(first, FIELDS, 'price')).toEqual({ key: 'price', direction: 'asc' });
    expect(nextSortState(first, FIELDS, 'symbol')).toEqual({ key: 'symbol', direction: 'asc' });
  });

  it('describes the active field and direction for the mobile control', () => {
    expect(describeSortState(FIELDS, { key: 'symbol', direction: 'asc' })).toContain('А → Я');
    expect(describeSortState(FIELDS, { key: 'symbol', direction: 'desc' })).toContain('Я → А');
    expect(describeSortState(FIELDS, { key: 'price', direction: 'desc' })).toContain('по убыванию');
    expect(describeSortState(FIELDS, null)).toBe('Без сортировки');
  });
});

describe('marketSort — composition with search, filters and pagination', () => {
  const search = (rows: Row[], query: string) =>
    rows.filter((r) => r.symbol.toLowerCase().includes(query) || r.name.toLowerCase().includes(query));

  it('applies sorting AFTER filters and BEFORE pagination', () => {
    const filtered = search(ROWS, 'o'); // Bitcoin, Solana
    const sorted = sortMarketRows(filtered, FIELDS, { key: 'price', direction: 'asc' });
    const page = sorted.slice(0, 1);
    expect(keys(sorted)).toEqual(['SOL', 'BTC']);
    expect(keys(page)).toEqual(['SOL']);
  });

  it('keeps sorting intact when a favourites filter is applied', () => {
    const favorites = ROWS.filter((r) => r.favorite);
    expect(keys(sortMarketRows(favorites, FIELDS, { key: 'price', direction: 'asc' }))).toEqual(['SOL', 'BTC']);
    expect(keys(sortMarketRows(favorites, FIELDS, { key: 'price', direction: 'desc' }))).toEqual(['BTC', 'SOL']);
  });

  it('keeps missing values last even inside a filtered subset', () => {
    const subset = ROWS.filter((r) => r.volume24h === null || r.price < 200);
    const desc = sortMarketRows(subset, FIELDS, { key: 'volume24h', direction: 'desc' });
    expect(keys(desc)[desc.length - 1]).toBe('ARB');
  });
});

describe('Spot table shares the same sort model', () => {
  const quote = (over: Partial<AssetSummary>): AssetSummary => ({
    symbol: 'XXX', name: 'Asset', price: 1, change1h: null, change24h: 0, change7d: null,
    volume24h: 0, marketCap: 0, rank: 1, sparkline: [], lastUpdate: Date.now(), ...over,
  } as AssetSummary);

  const universeRow = (symbol: string, name: string, rank: number, over: Partial<AssetSummary>) => ({
    id: symbol.toLowerCase(),
    symbol,
    name,
    rank,
    quote: quote({ symbol, name, rank, ...over }),
  });

  const spotRows = [
    universeRow('BTC', 'Bitcoin', 1, { price: 64000, change24h: 2, volume24h: 40e9, marketCap: 1.2e12 }),
    universeRow('ETH', 'Ethereum', 2, { price: 3200, change24h: -1, volume24h: 18e9, marketCap: 3.9e11 }),
    // marketCap === 0 → «капитализация неизвестна», а не настоящий ноль.
    universeRow('NEW', 'Newcoin', 3, { price: 0.5, change24h: 5, volume24h: 1e6, marketCap: 0 }),
  ] as unknown as Parameters<typeof sortMarketUniverse>[0];

  it('exposes every field the task requires for Spot', () => {
    const exposed = SPOT_SORT_FIELDS.map((f) => f.key);
    for (const key of ['rank', 'symbol', 'price', 'change24h', 'volume24h']) {
      expect(exposed).toContain(key);
    }
  });

  it('sorts spot rows through the shared comparator with unknown caps last', () => {
    expect(sortMarketUniverse(spotRows, 'marketCap', 'desc').map((r) => r.symbol)).toEqual(['BTC', 'ETH', 'NEW']);
    expect(sortMarketUniverse(spotRows, 'marketCap', 'asc').map((r) => r.symbol)).toEqual(['ETH', 'BTC', 'NEW']);
  });

  it('sorts spot prices numerically in both directions', () => {
    expect(sortMarketUniverse(spotRows, 'price', 'asc').map((r) => r.symbol)).toEqual(['NEW', 'ETH', 'BTC']);
    expect(sortMarketUniverse(spotRows, 'price', 'desc').map((r) => r.symbol)).toEqual(['BTC', 'ETH', 'NEW']);
  });

  it('sorts spot tickers alphabetically in both directions', () => {
    expect(sortMarketUniverse(spotRows, 'symbol', 'asc').map((r) => r.symbol)).toEqual(['BTC', 'ETH', 'NEW']);
    expect(sortMarketUniverse(spotRows, 'symbol', 'desc').map((r) => r.symbol)).toEqual(['NEW', 'ETH', 'BTC']);
  });

  it('falls back to the catalog order (rank, ticker) on ties', () => {
    const ties = [
      universeRow('ZZZ', 'Zzz', 9, { change24h: 1 }),
      universeRow('AAA', 'Aaa', 4, { change24h: 1 }),
      universeRow('MMM', 'Mmm', 4, { change24h: 1 }),
    ] as unknown as Parameters<typeof sortMarketUniverse>[0];
    expect(sortMarketUniverse(ties, 'change24h', 'desc').map((r) => r.symbol)).toEqual(['AAA', 'MMM', 'ZZZ']);
  });
});

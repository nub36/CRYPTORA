import { describe, it, expect } from 'vitest';
import { sortData } from '@/utils/sorting';

interface Item {
  id: string;
  price: number;
  name: string;
}

const sampleItems: Item[] = [
  { id: '1', price: 100, name: 'Solana' },
  { id: '2', price: 50000, name: 'Bitcoin' },
  { id: '3', price: 3000, name: 'Ethereum' },
];

describe('sortData utility', () => {
  it('returns unchanged array if no sort config is passed', () => {
    const res = sortData(sampleItems, null);
    expect(res).toEqual(sampleItems);
  });

  it('sorts numeric fields ascending and descending', () => {
    const asc = sortData(sampleItems, { key: 'price', direction: 'asc' });
    expect(asc[0].name).toBe('Solana');
    expect(asc[2].name).toBe('Bitcoin');

    const desc = sortData(sampleItems, { key: 'price', direction: 'desc' });
    expect(desc[0].name).toBe('Bitcoin');
    expect(desc[2].name).toBe('Solana');
  });

  it('sorts string fields alphabetically', () => {
    const asc = sortData(sampleItems, { key: 'name', direction: 'asc' });
    expect(asc[0].name).toBe('Bitcoin');
    expect(asc[1].name).toBe('Ethereum');
    expect(asc[2].name).toBe('Solana');
  });
});

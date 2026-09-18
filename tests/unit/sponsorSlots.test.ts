import { describe, it, expect } from 'vitest';
import { loadPlacements, activePlacements } from '@/services/ads/SponsorSlots';

const p = { id: 'a', slot: 'overview-sidebar', title: 'T', text: 'x', href: 'https://p.example', partner: 'P', activeFrom: '2026-01-01', activeTo: '2026-12-31' } as const;

describe('SponsorSlots', () => {
  it('repository config is valid and (by default) empty → nothing rendered', () => {
    expect(loadPlacements()).toEqual([]);
  });
  it('rejects invalid config entirely (no partial garbage), http:// links, wrong slot', () => {
    expect(loadPlacements({ placements: [{ ...p, href: 'http://x' }] })).toEqual([]);
    expect(loadPlacements({ placements: [{ ...p, slot: 'header' }] })).toEqual([]);
    expect(loadPlacements('junk')).toEqual([]);
  });
  it('filters by slot, date window and forbidden promises', () => {
    const all = loadPlacements({ placements: [p, { ...p, id: 'b', text: 'гарантированная доходность' }, { ...p, id: 'c', slot: 'footer-banner' }] });
    expect(activePlacements('overview-sidebar', new Date('2026-06-01'), all).map((x) => x.id)).toEqual(['a']);
    expect(activePlacements('overview-sidebar', new Date('2027-06-01'), all)).toEqual([]);
    expect(activePlacements('footer-banner', new Date('2026-06-01'), all).map((x) => x.id)).toEqual(['c']);
  });
});

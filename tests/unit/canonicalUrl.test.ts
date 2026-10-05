/**
 * CRYPTORA — canonical URL building (domain migration 2026-10-05).
 *
 * После миграции все абсолютные публичные URL строятся от единственного
 * канонического origin https://cryptonic.online (см. src/seo/canonicalUrl.ts).
 * Проверяются правила: absolute-URL только canonical, query/hash отбрасываются,
 * завершающий слэш не удваивается, корень остаётся «/».
 */

import { describe, it, expect } from 'vitest';
import { CANONICAL_SITE_ORIGIN, buildCanonicalUrl } from '../../src/seo/canonicalUrl';

describe('CANONICAL_SITE_ORIGIN', () => {
  it('единственный канонический origin — cryptonic.online', () => {
    expect(CANONICAL_SITE_ORIGIN).toBe('https://cryptonic.online');
  });
});

describe('buildCanonicalUrl', () => {
  it('корень → https://cryptonic.online/', () => {
    expect(buildCanonicalUrl('/')).toBe(`${CANONICAL_SITE_ORIGIN}/`);
  });

  it('deep-route → абсолютный URL на canonical-домене', () => {
    expect(buildCanonicalUrl('/signals')).toBe(`${CANONICAL_SITE_ORIGIN}/signals`);
  });

  it('query отбрасывается (?next=/signals)', () => {
    expect(buildCanonicalUrl('/login?next=/signals')).toBe(`${CANONICAL_SITE_ORIGIN}/login`);
  });

  it('hash отбрасывается', () => {
    expect(buildCanonicalUrl('/radar#events')).toBe(`${CANONICAL_SITE_ORIGIN}/radar`);
  });

  it('query и hash отбрасываются вместе', () => {
    expect(buildCanonicalUrl('/coin/BTC?tab=trades#row-3')).toBe(`${CANONICAL_SITE_ORIGIN}/coin/BTC`);
  });

  it('завершающий слэш не удваивается (/signals/ → /signals)', () => {
    expect(buildCanonicalUrl('/signals/')).toBe(`${CANONICAL_SITE_ORIGIN}/signals`);
  });

  it('ведущий слэш гарантируется', () => {
    expect(buildCanonicalUrl('signals')).toBe(`${CANONICAL_SITE_ORIGIN}/signals`);
  });

  it('пустой path → корень', () => {
    expect(buildCanonicalUrl('')).toBe(`${CANONICAL_SITE_ORIGIN}/`);
  });
});

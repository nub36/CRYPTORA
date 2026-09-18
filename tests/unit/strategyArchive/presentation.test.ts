/** C8 — presentation model of the archive: derived from the registry, verdict ≠ reproducibility, no performance ranking. */
import { describe, it, expect } from 'vitest';
import {
  STRATEGY_ARCHIVE, buildArchiveCards, filterCounts, filterMatches, comparabilityWarnings, ARCHIVE_FILTERS, VERDICT_LABEL_RU, REPRO_LABEL_RU,
} from '@/services/strategyArchive';

const cards = buildArchiveCards();
const by = (v: string) => cards.find((c) => c.version === v)!;

describe('archive cards are derived from the registry', () => {
  it('one card per registry entry (13); count is not hardcoded in the UI model', () => {
    expect(cards.length).toBe(STRATEGY_ARCHIVE.length);
    expect(new Set(cards.map((c) => c.id)).size).toBe(13);
    expect(cards.map((c) => c.version)).toEqual(['2.1a', '2.1b', '2.2', '2.3', '2.4', '2.5', '2.6', '2.7', '2.8', '3.0', '3.1', '3.2', '3.3']);
  });
  it('order is chronological, never by profitability', () => {
    const gross = cards.map((c) => c.headline[0]!.grossRPerTrade ?? 0);
    const sorted = [...gross].sort((a, b) => b - a);
    expect(gross).not.toEqual(sorted);
    expect(cards.map((c) => c.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  });
  it('verdict and reproduction status are separate fields with separate RU labels', () => {
    for (const c of cards) {
      expect(c.verdictLabelRu).toBe(VERDICT_LABEL_RU[c.verdict]);
      expect(c.reproLabelRu).toBe(REPRO_LABEL_RU[c.reproducibility]);
      expect(c.verdictLabelRu).not.toMatch(/ВОСПРОИЗВЕДЕНО/);
      expect(c.reproLabelRu).not.toMatch(/ВАЛИДИРОВАНО|ОТКЛОНЕНО|ФАЛЬСИФИЦИРОВАНО/);
    }
    expect(by('3.1').verdictLabelRu).toBe('ФАЛЬСИФИЦИРОВАНО НА TRAIN'); expect(by('3.1').reproLabelRu).toBe('ВОСПРОИЗВЕДЕНО В CRYPTORA');
    expect(by('2.1a').reproLabelRu).toMatch(/НЕ ПЕРЕЗАПУСКАЛОСЬ/); expect(by('2.1a').reproDetailRu).toMatch(/not executed/);
    expect(by('2.4').verdictLabelRu).toBe('ВАЛИДАЦИЯ ПРОВАЛЕНА'); expect(by('3.3').verdictLabelRu).toMatch(/TRAIN ONLY/);
    expect(by('2.8').verdictLabelRu).toMatch(/fees=0/);
  });
  it('headline numbers come from source artifacts (SOURCE_REPORTED) and match known values', () => {
    for (const c of cards) for (const h of c.headline) expect(h.origin).toBe('SOURCE_REPORTED');
    expect(by('3.0').headline[1]).toMatchObject({ slice: 'VALIDATION', n: 536, grossRPerTrade: 0.1274, netRPerTrade: 0.06 });
    expect(by('2.4').headline[1]).toMatchObject({ slice: 'VALIDATION', n: 234, grossRPerTrade: -0.1098 });
    expect(by('2.8').headline[0]).toMatchObject({ n: 317, grossRPerTrade: 0.1462, netRPerTrade: null });
    expect(by('2.8').headline[0]!.netFeeModel).toMatch(/НЕ СЧИТАЛОСЬ/);
    expect(by('2.7').headline.map((h) => h.netRPerTrade)).toEqual([-0.0782, -0.0172]);
    expect(by('2.1a').headline[1]).toMatchObject({ n: 121300, grossRPerTrade: 3.5281, netRPerTrade: -5.3159 });
    expect(by('2.1b').headline[0]).toMatchObject({ n: 56486, netRPerTrade: -0.1167 });
    expect(by('3.2').headlineNoteRu).toMatch(/cherry-picking/);
    expect(by('2.1a').headlineNoteRu).toMatch(/A \+0\.0350, B \+0\.3510, C \+0\.0779/); // gross per setup, not the mislabeled net field
  });
  it('no promotional wording anywhere in the card text', () => {
    const text = JSON.stringify(cards);
    expect(text).not.toMatch(/прибыльная стратегия|лучший сигнал|ожидаемая доходность|гарантир/i);
  });
});

describe('filters', () => {
  it('six filters; counts add up per verdict; ALL = 13', () => {
    expect(ARCHIVE_FILTERS.map((f) => f.label)).toEqual(['Все', 'Валидировано', 'Train-only', 'Провалена валидация', 'Отклонено', 'Фальсифицировано']);
    const c = filterCounts(cards);
    expect(c).toEqual({ ALL: 13, VALIDATED: 2, TRAIN_ONLY: 2, FAILED_VALIDATION: 1, REJECTED: 6, FALSIFIED: 2 });
    expect(c.VALIDATED + c.TRAIN_ONLY + c.FAILED_VALIDATION + c.REJECTED + c.FALSIFIED).toBe(c.ALL);
    expect(filterMatches('REJECTED', 'REJECTED_ON_TRAIN')).toBe(true); expect(filterMatches('REJECTED', 'FALSIFIED_ON_TRAIN')).toBe(false);
  });
});

describe('comparability warnings', () => {
  it('same family, same validation type ⇒ no warning', () => {
    expect(comparabilityWarnings([by('3.1'), by('3.2')])).toEqual([]);
    expect(comparabilityWarnings([by('2.2'), by('2.3')])).toEqual([]);
  });
  it('V2.8 gross-only vs V3.0 net ⇒ explicit fee warning + family warning', () => {
    const w = comparabilityWarnings([by('2.8'), by('3.0')]);
    expect(w.some((x) => /fees=0/.test(x))).toBe(true);
    expect(w.some((x) => /НЕСОПОСТАВИМО/.test(x))).toBe(true);
    expect(w.some((x) => /движки входов/.test(x))).toBe(true);
  });
  it('TRAIN-only vs TRAIN+VALIDATION within V3 ⇒ validation-type warning', () => {
    const w = comparabilityWarnings([by('3.0'), by('3.3')]);
    expect(w.length).toBe(1); expect(w[0]).toMatch(/TRAIN-результат не сравнивается/);
  });
  it('V2.1 lump-fee vs V2.2 ⇒ denominator/fee warning', () => {
    expect(comparabilityWarnings([by('2.1b'), by('2.2')]).some((x) => /lump 0.1 %/.test(x))).toBe(true);
  });
  it('single card ⇒ nothing to warn about', () => { expect(comparabilityWarnings([by('3.0')])).toEqual([]); });
});

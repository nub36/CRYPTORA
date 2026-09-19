/**
 * CRYPTORA — /strategies must expose exactly the three product strategies.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The V3.0 / V3.3 / V2.8 filter (commit 5c6ee8a) was silently lost when a bulk
 * "restore full project files" commit overwrote StrategyArchivePanel and
 * StrategiesPage with an older snapshot. Nothing guarded it, so /strategies
 * quietly went back to showing all 13 archived research versions on BOTH
 * branches. These tests pin the intended state down.
 *
 * REAL: StrategyArchivePanel + the real strategy registry (buildArchiveCards).
 * No market-data provider is needed because the archive panel is static.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { render } from '@testing-library/react';
import { StrategyArchivePanel } from '@/components/strategies/StrategyArchivePanel';
import { buildArchiveCards } from '@/services/strategyArchive';

/** The three strategies that are wired to LiveSignalEngine. */
const PRODUCT_STRATEGY_IDS = [
  'V3_0_HTF_LIQUIDATION_TRAP',
  'V3_3_HTF_ZONE_MITIGATION',
  'V2_8_ZERO_FEE_SNIPER_TRAILING',
];

function cardIds(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('[data-testid^="archive-card-"]')).map(
    (el) => (el.getAttribute('data-testid') ?? '').replace('archive-card-', '')
  );
}

describe('StrategyArchivePanel — product filter', () => {
  it('the registry really holds more than three strategies (filter is meaningful)', () => {
    const all = buildArchiveCards();
    expect(all.length).toBeGreaterThan(3);
    // Sanity: the three product IDs exist in the registry.
    for (const id of PRODUCT_STRATEGY_IDS) {
      expect(all.map((c) => c.id), `registry must contain ${id}`).toContain(id);
    }
  });

  it('renders exactly the three product strategies when strategyIds is given', () => {
    const { container } = render(<StrategyArchivePanel strategyIds={PRODUCT_STRATEGY_IDS} />);
    const ids = cardIds(container);
    expect(ids.sort()).toEqual([...PRODUCT_STRATEGY_IDS].sort());
    expect(ids).toHaveLength(3);
  });

  it('omits every non-product research version', () => {
    const { container } = render(<StrategyArchivePanel strategyIds={PRODUCT_STRATEGY_IDS} />);
    const ids = cardIds(container);
    for (const id of ids) {
      expect(PRODUCT_STRATEGY_IDS).toContain(id);
    }
    // Specifically, these archived research versions must not appear.
    for (const hidden of [
      'V3_1_HTF_TREND_PULLBACK',
      'V3_2_VOLUME_CLIMAX',
      'V2_3_SNIPER_REVERSAL',
      'V2_1A_STRUCTURAL_LIMIT_ENTRY',
    ]) {
      expect(ids, `${hidden} must not be shown on /strategies`).not.toContain(hidden);
    }
  });

  it('still shows the full archive when strategyIds is omitted (back-compat)', () => {
    const { container } = render(<StrategyArchivePanel />);
    expect(cardIds(container).length).toBeGreaterThan(3);
  });
});

describe('StrategiesPage wiring', () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, '../../src/pages/StrategiesPage.tsx'),
    'utf8'
  );

  /**
   * АРХИТЕКТУРА ИЗМЕНИЛАСЬ (UI-этап «compact terminal»).
   *
   * Раньше три продуктовые стратегии показывались САМОЙ панелью архива через
   * `strategyIds`, из-за чего /strategies выглядел как исследовательский отчёт:
   * «Архив исследований → 13 версий», методологический абзац, read-only бейдж.
   * Теперь primary UI — отдельная `ProductStrategiesSection` (ровно 3 карточки),
   * а архив уехал во вторичный свёрнутый collapsible.
   *
   * Смысл исходного инварианта сохранён и даже усилен: продуктовая страница
   * по-прежнему показывает ровно три стратегии, а не 13. Проверяется ниже и в
   * tests/unit/strategiesPresentation.test.tsx рендером реальной страницы.
   */
  it('primary UI делегирован продуктовой секции трёх стратегий', () => {
    expect(src).toMatch(/<ProductStrategiesSection\s*\/>/);
  });

  it('архив остаётся на странице, но только внутри свёрнутого collapsible', () => {
    // Код архива не удалён (требование владельца).
    expect(src).toContain('<StrategyArchivePanel');
    // ...и он не является первичным блоком: только внутри Collapsible.
    const archiveIdx = src.indexOf('<StrategyArchivePanel');
    const collapsibleIdx = src.indexOf('research-archive-collapsible');
    expect(collapsibleIdx).toBeGreaterThan(-1);
    expect(collapsibleIdx).toBeLessThan(archiveIdx);
  });

  it('страница не рендерит «Лабораторию стратегий» как основной заголовок', () => {
    expect(src).not.toContain('Лаборатория стратегий');
    expect(src).not.toContain('Архитектурный прототип');
    expect(src).toContain('Стратегии');
  });

  it('the panel component still accepts the strategyIds prop (back-compat)', () => {
    const panel = fs.readFileSync(
      path.resolve(__dirname, '../../src/components/strategies/StrategyArchivePanel.tsx'),
      'utf8'
    );
    expect(panel).toMatch(/strategyIds\?:\s*string\[\]/);
    expect(panel).toMatch(/strategyIds\.includes\(c\.id\)/);
  });
});

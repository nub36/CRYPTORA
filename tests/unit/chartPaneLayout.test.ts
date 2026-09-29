import { describe, expect, it } from 'vitest';
import {
  calculatePaneLayout,
  constrainPaneHeight,
  DEFAULT_INDICATOR_HEIGHTS,
  MIN_INDICATOR_HEIGHT,
  MIN_MAIN_CHART_HEIGHT,
  PANE_SEPARATOR_SIZE,
} from '@/components/common/chartPaneLayout';

describe('chart pane layout constraints', () => {
  it('keeps the main pane and every indicator above their minimum with multiple panes', () => {
    const minimumTotal = MIN_MAIN_CHART_HEIGHT + 2 * (MIN_INDICATOR_HEIGHT + PANE_SEPARATOR_SIZE);
    const layout = calculatePaneLayout(minimumTotal, ['RSI', 'MACD'], { RSI: 500, MACD: 500 });
    expect(layout.mainHeight).toBe(MIN_MAIN_CHART_HEIGHT);
    expect(layout.paneHeights.RSI).toBeGreaterThanOrEqual(MIN_INDICATOR_HEIGHT);
    expect(layout.paneHeights.MACD).toBeGreaterThanOrEqual(MIN_INDICATOR_HEIGHT);
    expect(layout.mainHeight + layout.paneHeights.RSI + layout.paneHeights.MACD + 2 * PANE_SEPARATOR_SIZE)
      .toBe(minimumTotal);
  });

  it('clamps pointer resize so one pane cannot consume the price chart or its sibling', () => {
    const total = 680;
    const current = { ...DEFAULT_INDICATOR_HEIGHTS };
    expect(constrainPaneHeight('RSI', -100, total, ['RSI', 'MACD'], current)).toBe(MIN_INDICATOR_HEIGHT);
    const maximum = total - MIN_MAIN_CHART_HEIGHT - current.MACD - 2 * PANE_SEPARATOR_SIZE;
    expect(constrainPaneHeight('RSI', 10_000, total, ['RSI', 'MACD'], current)).toBe(maximum);
  });

  it('preserves stored sizes while an indicator is toggled off and back on', () => {
    const requested = { RSI: 180, MACD: 210 };
    const both = calculatePaneLayout(800, ['RSI', 'MACD'], requested);
    const onlyRsi = calculatePaneLayout(800, ['RSI'], requested);
    const restored = calculatePaneLayout(800, ['RSI', 'MACD'], requested);
    expect(onlyRsi.paneHeights.RSI).toBe(180);
    expect(restored.paneHeights).toEqual(both.paneHeights);
  });
});

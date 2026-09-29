export const MIN_INDICATOR_HEIGHT = 96;
export const MIN_MAIN_CHART_HEIGHT = 220;
export const PANE_SEPARATOR_SIZE = 12;

export type IndicatorPaneKey = 'RSI' | 'MACD';

export interface PaneLayout {
  mainHeight: number;
  paneHeights: Record<IndicatorPaneKey, number>;
}

export const DEFAULT_INDICATOR_HEIGHTS: Record<IndicatorPaneKey, number> = {
  RSI: 126,
  MACD: 146,
};

/**
 * Clamp a requested pane size against the space shared by all visible panes.
 * The main price chart always keeps MIN_MAIN_CHART_HEIGHT and every other
 * indicator keeps MIN_INDICATOR_HEIGHT. This function contains no DOM/chart
 * dependency, so the resize contract can be tested pixel-for-pixel in jsdom.
 */
export function constrainPaneHeight(
  key: IndicatorPaneKey,
  requestedHeight: number,
  totalHeight: number,
  visible: readonly IndicatorPaneKey[],
  current: Readonly<Record<IndicatorPaneKey, number>>,
): number {
  if (!visible.includes(key)) return current[key];
  const otherHeight = visible
    .filter((pane) => pane !== key)
    .reduce((sum, pane) => sum + Math.max(MIN_INDICATOR_HEIGHT, current[pane]), 0);
  const separators = visible.length * PANE_SEPARATOR_SIZE;
  const maximum = Math.max(
    MIN_INDICATOR_HEIGHT,
    totalHeight - MIN_MAIN_CHART_HEIGHT - otherHeight - separators,
  );
  return Math.min(maximum, Math.max(MIN_INDICATOR_HEIGHT, Math.round(requestedHeight)));
}

export function calculatePaneLayout(
  totalHeight: number,
  visible: readonly IndicatorPaneKey[],
  requested: Readonly<Record<IndicatorPaneKey, number>>,
): PaneLayout {
  const paneHeights = { ...requested };
  for (const key of visible) paneHeights[key] = Math.max(MIN_INDICATOR_HEIGHT, Math.round(paneHeights[key]));

  // If persisted/requested sizes together exceed the viewport, shrink panes
  // predictably from the last pane upwards, never below their minimum.
  let overflow = visible.reduce((sum, key) => sum + paneHeights[key], 0)
    + visible.length * PANE_SEPARATOR_SIZE + MIN_MAIN_CHART_HEIGHT - totalHeight;
  for (const key of [...visible].reverse()) {
    if (overflow <= 0) break;
    const reducible = paneHeights[key] - MIN_INDICATOR_HEIGHT;
    const reduction = Math.min(reducible, overflow);
    paneHeights[key] -= reduction;
    overflow -= reduction;
  }

  const used = visible.reduce((sum, key) => sum + paneHeights[key], 0) + visible.length * PANE_SEPARATOR_SIZE;
  return {
    mainHeight: Math.max(MIN_MAIN_CHART_HEIGHT, totalHeight - used),
    paneHeights,
  };
}

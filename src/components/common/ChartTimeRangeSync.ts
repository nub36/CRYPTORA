import type { IChartApi, LogicalRange } from 'lightweight-charts';

/** Synchronizes only horizontal logical ranges. Re-entrant events are ignored to avoid feedback loops. */
export class ChartTimeRangeSync {
  private charts = new Set<IChartApi>();
  private unsubscribeByChart = new Map<IChartApi, () => void>();
  private syncing = false;

  add(chart: IChartApi): () => void {
    if (this.charts.has(chart)) return () => this.remove(chart);
    this.charts.add(chart);
    const listener = (range: LogicalRange | null) => {
      if (!range || this.syncing) return;
      this.apply(chart, range);
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(listener);
    this.unsubscribeByChart.set(chart, () => chart.timeScale().unsubscribeVisibleLogicalRangeChange(listener));
    return () => this.remove(chart);
  }

  syncFrom(chart: IChartApi): void {
    const range = chart.timeScale().getVisibleLogicalRange();
    if (range) this.apply(chart, range);
  }

  private apply(source: IChartApi, range: LogicalRange): void {
    if (this.syncing) return;
    this.syncing = true;
    try {
      for (const target of this.charts) {
        if (target === source) continue;
        const current = target.timeScale().getVisibleLogicalRange();
        if (current && current.from === range.from && current.to === range.to) continue;
        try {
          target.timeScale().setVisibleLogicalRange(range);
        } catch {
          // A target with no data cannot accept a logical range yet; its next data update syncs again.
        }
      }
    } finally {
      this.syncing = false;
    }
  }

  private remove(chart: IChartApi): void {
    this.unsubscribeByChart.get(chart)?.();
    this.unsubscribeByChart.delete(chart);
    this.charts.delete(chart);
  }

  clear(): void {
    for (const chart of [...this.charts]) this.remove(chart);
  }
}

import { describe, expect, it, vi } from 'vitest';
import { ChartTimeRangeSync } from '@/components/common/ChartTimeRangeSync';

function mockChart(initial: { from: number; to: number } | null = null) {
  let range = initial;
  let listener: ((value: { from: number; to: number } | null) => void) | undefined;
  const scale = {
    getVisibleLogicalRange: vi.fn(() => range),
    setVisibleLogicalRange: vi.fn((value: { from: number; to: number }) => {
      range = value;
      listener?.(value);
    }),
    subscribeVisibleLogicalRangeChange: vi.fn((callback: typeof listener) => { listener = callback; }),
    unsubscribeVisibleLogicalRangeChange: vi.fn(() => { listener = undefined; }),
  };
  return { timeScale: () => scale, scale, emit: (value: { from: number; to: number }) => { range = value; listener?.(value); } };
}

describe('ChartTimeRangeSync', () => {
  it('syncs logical ranges once without creating a feedback loop and cleans listeners', () => {
    const sync = new ChartTimeRangeSync();
    const first = mockChart({ from: 0, to: 50 });
    const second = mockChart();
    const third = mockChart();
    const removeFirst = sync.add(first as any);
    const removeSecond = sync.add(second as any);
    sync.add(third as any);

    first.emit({ from: 15, to: 65 });
    expect(second.scale.setVisibleLogicalRange).toHaveBeenCalledTimes(1);
    expect(third.scale.setVisibleLogicalRange).toHaveBeenCalledTimes(1);
    expect(second.scale.setVisibleLogicalRange).toHaveBeenCalledWith({ from: 15, to: 65 });
    expect(first.scale.setVisibleLogicalRange).not.toHaveBeenCalled();

    removeFirst();
    removeSecond();
    sync.clear();
    expect(first.scale.unsubscribeVisibleLogicalRangeChange).toHaveBeenCalledOnce();
    expect(second.scale.unsubscribeVisibleLogicalRangeChange).toHaveBeenCalledOnce();
    expect(third.scale.unsubscribeVisibleLogicalRangeChange).toHaveBeenCalledOnce();
  });
});

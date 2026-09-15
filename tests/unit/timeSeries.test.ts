import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryTimeSeriesRepository } from '@/services/storage/TimeSeriesRepository';
import { OHLCV } from '@/types/market';

describe('TimeSeriesRepository Unit Tests (Storage, Gaps & Eviction)', () => {
  let repo: MemoryTimeSeriesRepository;

  beforeEach(async () => {
    repo = new MemoryTimeSeriesRepository(100);
    await repo.clear();
  });

  it('saves candles and deduplicates duplicate timestamps', async () => {
    const candles: OHLCV[] = [
      { time: 1000, open: 10, high: 12, low: 9, close: 11, volume: 100 },
      { time: 2000, open: 11, high: 13, low: 10, close: 12, volume: 150 },
    ];

    const addedFirst = await repo.saveCandles('BTC', '1h', candles);
    expect(addedFirst).toBe(2);

    // Save overlapping candle with updated volume
    const updatedCandles: OHLCV[] = [
      { time: 2000, open: 11, high: 13, low: 10, close: 12, volume: 200 },
      { time: 3000, open: 12, high: 14, low: 11, close: 13, volume: 180 },
    ];

    const addedSecond = await repo.saveCandles('BTC', '1h', updatedCandles);
    expect(addedSecond).toBe(1); // Only 3000 was new

    const stored = await repo.getCandles('BTC', '1h');
    expect(stored.length).toBe(3);
    expect(stored[1].volume).toBe(200); // Updated value
  });

  it('retrieves candles sorted chronologically with from, to, and limit options', async () => {
    const candles: OHLCV[] = [
      { time: 3000, open: 10, high: 12, low: 9, close: 11, volume: 100 },
      { time: 1000, open: 10, high: 12, low: 9, close: 11, volume: 100 },
      { time: 2000, open: 10, high: 12, low: 9, close: 11, volume: 100 },
    ];

    await repo.saveCandles('ETH', '1h', candles);

    const ordered = await repo.getCandles('ETH', '1h');
    expect(ordered[0].time).toBe(1000);
    expect(ordered[1].time).toBe(2000);
    expect(ordered[2].time).toBe(3000);

    const filtered = await repo.getCandles('ETH', '1h', { from: 1500, to: 2500 });
    expect(filtered.length).toBe(1);
    expect(filtered[0].time).toBe(2000);

    const limited = await repo.getCandles('ETH', '1h', { limit: 2 });
    expect(limited.length).toBe(2);
    expect(limited[0].time).toBe(2000);
    expect(limited[1].time).toBe(3000);
  });

  it('detects time-series gaps when intervals are missing', async () => {
    // 1h timeframe = 3600 seconds interval
    const t0 = 1726000000;
    const candlesWithGap: OHLCV[] = [
      { time: t0, open: 100, high: 105, low: 95, close: 102, volume: 50 },
      { time: t0 + 3600, open: 102, high: 107, low: 101, close: 106, volume: 60 },
      // Missed 3 candles (gap of 4 * 3600 = 14400s)
      { time: t0 + 3600 * 5, open: 110, high: 115, low: 108, close: 112, volume: 70 },
    ];

    await repo.saveCandles('SOL', '1h', candlesWithGap);

    const result = await repo.detectGaps('SOL', '1h');
    expect(result.totalGaps).toBe(1);
    expect(result.gaps[0].missingCandles).toBe(3);
    expect(result.gaps[0].start).toBe(t0 + 3600);
    expect(result.gaps[0].end).toBe(t0 + 3600 * 5);
  });

  it('evicts oldest candles when capacity exceeds limit', async () => {
    const smallRepo = new MemoryTimeSeriesRepository(5);
    const candles: OHLCV[] = Array.from({ length: 8 }, (_, i) => ({
      time: 1000 * (i + 1),
      open: 100,
      high: 105,
      low: 95,
      close: 100,
      volume: 10,
    }));

    await smallRepo.saveCandles('BTC', '15m', candles);

    const stored = await smallRepo.getCandles('BTC', '15m');
    expect(stored.length).toBe(5);
    expect(stored[0].time).toBe(4000); // 1000, 2000, 3000 were evicted
    expect(stored[4].time).toBe(8000);
  });
});

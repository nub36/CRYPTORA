import { describe, it, expect } from 'vitest';
import { extractBinanceSpread } from '@/services/data/adapters/normalization';

describe('extractBinanceSpread', () => {
  it('calculates spread from bid/ask (not lastPrice/high/low)', () => {
    // Endpoint: GET /api/v3/ticker/24hr (FULL type)
    // bidPrice/askPrice = current best bid/ask from order book (Memory source)
    const result = extractBinanceSpread({
      symbol: 'BTCUSDT',
      priceChange: '1000.00',
      priceChangePercent: '1.56',
      lastPrice: '65500.00',   // lastPrice intentionally different from bid/ask
      openPrice: '64000.00',
      highPrice: '66000.00',   // highPrice intentionally different
      lowPrice: '63500.00',    // lowPrice intentionally different
      volume: '12345.678',
      quoteVolume: '800000000',
      openTime: 1700000000000,
      closeTime: 1700086400000,
      bidPrice: '64999.00',
      askPrice: '65001.00',
      bidQty: '1.5',
      askQty: '2.0',
    } as any);
    // Spread = (65001 - 64999) / ((64999+65001)/2) * 10000 = 2/65000 * 10000 ≈ 0.31 bps
    expect(result).not.toBeNull();
    expect(result!.bestBid).toBe(64999);
    expect(result!.bestAsk).toBe(65001);
    expect(result!.spreadBps).toBeCloseTo(0.31, 1);
  });

  it('does NOT use lastPrice, highPrice, or lowPrice for spread', () => {
    // Verify: spread depends solely on bid/ask, ignoring other price fields
    const result = extractBinanceSpread({
      symbol: 'TEST',
      lastPrice: '100.00',    // different from bid/ask
      highPrice: '120.00',    // irrelevant
      lowPrice: '80.00',      // irrelevant
      openPrice: '95.00',
      priceChange: '5.00',
      priceChangePercent: '5.26',
      volume: '1000',
      quoteVolume: '100000',
      openTime: 1700000000000,
      closeTime: 1700086400000,
      bidPrice: '99.50',
      askPrice: '100.50',
    } as any);
    expect(result).not.toBeNull();
    // spread = (100.50 - 99.50) / 100.0 * 10000 = 100 bps
    expect(result!.spreadBps).toBe(100);
    expect(result!.bestBid).toBe(99.5);
    expect(result!.bestAsk).toBe(100.5);
  });

  it('returns null for zero bid', () => {
    const result = extractBinanceSpread({
      symbol: 'TEST',
      bidPrice: '0',
      askPrice: '100',
      openPrice: '95',
      highPrice: '100',
      lowPrice: '90',
      lastPrice: '95',
      priceChange: '0',
      priceChangePercent: '0',
      volume: '0',
      quoteVolume: '0',
      openTime: 0,
      closeTime: 0,
    } as any);
    expect(result).toBeNull();
  });

  it('returns null when ask <= bid (inverted book)', () => {
    const result = extractBinanceSpread({
      symbol: 'TEST',
      bidPrice: '100',
      askPrice: '99',
      openPrice: '95',
      highPrice: '100',
      lowPrice: '90',
      lastPrice: '95',
      priceChange: '0',
      priceChangePercent: '0',
      volume: '0',
      quoteVolume: '0',
      openTime: 0,
      closeTime: 0,
    } as any);
    expect(result).toBeNull();
  });

  it('returns null for missing bid/ask', () => {
    const result = extractBinanceSpread({
      symbol: 'TEST',
      openPrice: '95',
      highPrice: '100',
      lowPrice: '90',
      lastPrice: '95',
      priceChange: '0',
      priceChangePercent: '0',
      volume: '0',
      quoteVolume: '0',
      openTime: 0,
      closeTime: 0,
    } as any);
    expect(result).toBeNull();
  });

  it('typical BTC spread is sub-1 bps', () => {
    const result = extractBinanceSpread({
      symbol: 'BTCUSDT',
      bidPrice: '65000.00',
      askPrice: '65000.50',
      openPrice: '64000',
      highPrice: '66000',
      lowPrice: '63500',
      lastPrice: '65000.25',
      priceChange: '1000',
      priceChangePercent: '1.56',
      volume: '10000',
      quoteVolume: '650000000',
      openTime: 1700000000000,
      closeTime: 1700086400000,
    } as any);
    expect(result).not.toBeNull();
    expect(result!.spreadBps).toBeLessThan(1);
    expect(result!.spreadBps).toBeGreaterThan(0);
  });

  it('wider altcoin spread (~20 bps)', () => {
    const result = extractBinanceSpread({
      symbol: 'DOGEUSDT',
      bidPrice: '0.1000',
      askPrice: '0.1002',
      openPrice: '0.098',
      highPrice: '0.102',
      lowPrice: '0.097',
      lastPrice: '0.1001',
      priceChange: '0.002',
      priceChangePercent: '2.04',
      volume: '500000000',
      quoteVolume: '50000000',
      openTime: 1700000000000,
      closeTime: 1700086400000,
    } as any);
    expect(result).not.toBeNull();
    // spread = (0.1002-0.1000) / ((0.1000+0.1002)/2) * 10000 ≈ 19.98 bps
    expect(result!.spreadBps).toBeCloseTo(19.98, 0);
  });
});

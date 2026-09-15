import { describe, it, expect } from 'vitest';
import { BinanceFuturesAdapter } from '@/services/data/adapters/BinanceFuturesAdapter';
import {
  AdapterRateLimitError,
  AdapterValidationError,
} from '@/services/data/adapters/errors';
import { DerivativesEngine } from '@/services/derivatives/DerivativesEngine';
import { CanonicalAsset } from '@/services/data/registry/assetRegistry';

const SAMPLE_PREMIUM = {
  symbol: 'BTCUSDT',
  markPrice: '65200.00000000',
  indexPrice: '65000.00000000',
  lastFundingRate: '0.00010000', // 0.01%
  nextFundingTime: 1726444800000,
  interestRate: '0.00010000',
  time: 1726440000000,
};

const SAMPLE_OI = {
  symbol: 'BTCUSDT',
  openInterest: '100.5',
  time: 1726440000000,
};

const SAMPLE_TICKER = {
  symbol: 'BTCUSDT',
  priceChange: '1200.00',
  priceChangePercent: '1.85',
  lastPrice: '65200.00',
  volume: '5000.00',
  quoteVolume: '325000000.00',
};

const MOCK_CANONICAL_BTC: CanonicalAsset = {
  symbol: 'BTC',
  name: 'Bitcoin',
  category: 'l1',
  rank: 1,
  binanceSymbol: 'BTCUSDT',
  kucoinSymbol: 'BTC-USDT',
  circulatingSupply: 19700000,
  description: 'First decentralized digital currency based on proof of work consensus.',
};

describe('BinanceFuturesAdapter Unit Tests', () => {
  it('parses and validates premiumIndex DTO correctly', async () => {
    const mockFetch = async () =>
      new Response(JSON.stringify(SAMPLE_PREMIUM), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    const adapter = new BinanceFuturesAdapter({ fetchFn: mockFetch as any });
    const result = await adapter.fetchPremiumIndex('BTCUSDT');

    expect(result.symbol).toBe('BTCUSDT');
    expect(result.markPrice).toBe('65200.00000000');
    expect(result.lastFundingRate).toBe('0.00010000');
  });

  it('parses and validates openInterest DTO correctly', async () => {
    const mockFetch = async () =>
      new Response(JSON.stringify(SAMPLE_OI), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    const adapter = new BinanceFuturesAdapter({ fetchFn: mockFetch as any });
    const result = await adapter.fetchOpenInterest('BTCUSDT');

    expect(result.symbol).toBe('BTCUSDT');
    expect(result.openInterest).toBe('100.5');
  });

  it('throws AdapterRateLimitError on HTTP 429', async () => {
    const mockFetch = async () =>
      new Response(JSON.stringify({ code: -1003, msg: 'Too many requests' }), {
        status: 429,
        statusText: 'Too Many Requests',
      });

    const adapter = new BinanceFuturesAdapter({ fetchFn: mockFetch as any });
    await expect(adapter.fetchPremiumIndex('BTCUSDT')).rejects.toThrow(AdapterRateLimitError);
  });

  it('throws AdapterValidationError on malformed response', async () => {
    const mockFetch = async () =>
      new Response(JSON.stringify({ invalidField: 123 }), {
        status: 200,
      });

    const adapter = new BinanceFuturesAdapter({ fetchFn: mockFetch as any });
    await expect(adapter.fetchPremiumIndex('BTCUSDT')).rejects.toThrow(AdapterValidationError);
  });
});

describe('DerivativesEngine Mathematical Calculations Unit Tests', () => {
  it('calculates Annualized Funding Rate (APR) from 8h funding rate', () => {
    // 0.01% per 8h * 3 * 365 = 10.95% APR
    const apr1 = DerivativesEngine.calculateAnnualizedFunding(0.01);
    expect(apr1).toBe(10.95);

    // Negative funding: -0.05% * 3 * 365 = -54.75% APR
    const apr2 = DerivativesEngine.calculateAnnualizedFunding(-0.05);
    expect(apr2).toBe(-54.75);
  });

  it('calculates Basis % correctly (Contango vs Backwardation)', () => {
    // Contango: Mark = 65200, Index = 65000 -> +0.3077%
    const basisContango = DerivativesEngine.calculateBasis(65200, 65000);
    expect(basisContango).toBeCloseTo(0.3077, 3);

    // Backwardation: Mark = 64800, Index = 65000 -> -0.3077%
    const basisBack = DerivativesEngine.calculateBasis(64800, 65000);
    expect(basisBack).toBeCloseTo(-0.3077, 3);
  });

  it('calculates Open Interest in USD', () => {
    const oiUsd = DerivativesEngine.calculateOpenInterestUsd(100.5, 65000);
    expect(oiUsd).toBe(6532500);
  });

  it('normalizes Binance futures DTOs into typed FuturesAsset model with provenance', () => {
    const futuresAsset = DerivativesEngine.normalizeFuturesAsset(
      MOCK_CANONICAL_BTC,
      SAMPLE_PREMIUM as any,
      SAMPLE_TICKER as any,
      SAMPLE_OI as any
    );

    expect(futuresAsset.symbol).toBe('BTC/USDT');
    expect(futuresAsset.markPrice).toBe(65200);
    expect(futuresAsset.indexPrice).toBe(65000);
    expect(futuresAsset.fundingRate).toBe(0.01);
    expect(futuresAsset.annualizedFundingRate).toBe(10.95);
    expect(futuresAsset.openInterest).toBeGreaterThan(0);
    expect(futuresAsset.futuresVolume24h).toBe(325000000);
    expect(futuresAsset.isDemo).toBe(false);
    expect(futuresAsset.provenance?.exchange).toBe('binance');
    expect(futuresAsset.provenance?.market).toBe('futures');
  });

  it('calculates aggregated market overview over futures assets', () => {
    const btcAsset = DerivativesEngine.normalizeFuturesAsset(
      MOCK_CANONICAL_BTC,
      SAMPLE_PREMIUM as any,
      SAMPLE_TICKER as any,
      SAMPLE_OI as any
    );

    const ethAsset = DerivativesEngine.normalizeFuturesAsset(
      { ...MOCK_CANONICAL_BTC, symbol: 'ETH', binanceSymbol: 'ETHUSDT' },
      { ...SAMPLE_PREMIUM, symbol: 'ETHUSDT', markPrice: '3510', indexPrice: '3500' } as any,
      { ...SAMPLE_TICKER, symbol: 'ETHUSDT', quoteVolume: '150000000' } as any,
      { ...SAMPLE_OI, symbol: 'ETHUSDT', openInterest: '500' } as any
    );

    const overview = DerivativesEngine.calculateAggregatedOverview([btcAsset, ethAsset]);

    expect(overview.totalOpenInterestUsd).toBeGreaterThan(0);
    expect(overview.totalVolume24hUsd).toBe(475000000);
    expect(overview.averageFundingRate8h).toBeCloseTo(0.01, 3);
    expect(overview.marketRegime).toBe('CONTANGO');
  });
});

import { describe, it, expect } from 'vitest';
import {
  futuresDisplayBase,
  futuresDisplaySymbol,
  parseFuturesContractSymbol,
  parseFuturesMultiplier,
  resolveFuturesContractSymbol,
} from '@/services/data/registry/futuresSymbols';
import { futuresBaseToSpot } from '@/services/data/registry/exchangeUniverse';

/**
 * Task §2 / §10 — symbol normalization for BOTH markets.
 *
 * The join key for every USD-M endpoint is the CONTRACT symbol. These tests
 * pin the rules that the RC-1/RC-5 diagnosis identified as the classic source
 * of "price but no volume" rows: multiplier contracts, delivery contracts,
 * quote assets, and the forbidden Spot↔Futures join by base ticker.
 */

describe('futures contract symbol parsing', () => {
  it('splits plain USDT perpetuals', () => {
    expect(parseFuturesContractSymbol('BTCUSDT')).toEqual({ contractSymbol: 'BTCUSDT', baseAsset: 'BTC', quoteAsset: 'USDT' });
    expect(parseFuturesContractSymbol('ethusdt')).toEqual({ contractSymbol: 'ETHUSDT', baseAsset: 'ETH', quoteAsset: 'USDT' });
  });

  it('keeps the multiplier prefix inside the contract base asset', () => {
    expect(parseFuturesContractSymbol('1000PEPEUSDT')?.baseAsset).toBe('1000PEPE');
    expect(parseFuturesContractSymbol('1000SHIBUSDT')?.baseAsset).toBe('1000SHIB');
    expect(parseFuturesContractSymbol('1000000MOGUSDT')?.baseAsset).toBe('1000000MOG');
  });

  it('recognises USDC and coin-quoted contracts', () => {
    expect(parseFuturesContractSymbol('BTCUSDC')).toEqual({ contractSymbol: 'BTCUSDC', baseAsset: 'BTC', quoteAsset: 'USDC' });
    expect(parseFuturesContractSymbol('ETHBTC')?.quoteAsset).toBe('BTC');
  });

  it('rejects delivery contracts and malformed input', () => {
    expect(parseFuturesContractSymbol('BTCUSDT_250926')).toBeNull();
    expect(parseFuturesContractSymbol('BTC-USDT')).toBeNull();
    expect(parseFuturesContractSymbol('')).toBeNull();
    expect(parseFuturesContractSymbol('USDT')).toBeNull();
  });

  it('parses BTCDOMUSDT syntactically but leaves the authoritative base to exchangeInfo', () => {
    // BTCDOM has no Spot instrument; the parser must not invent one.
    expect(parseFuturesContractSymbol('BTCDOMUSDT')?.baseAsset).toBe('BTCDOM');
  });
});

describe('multiplier contracts', () => {
  it('decomposes multiplier prefixes longest-first', () => {
    expect(parseFuturesMultiplier('1000PEPE')).toEqual({ multiplier: 1000, underlying: 'PEPE' });
    expect(parseFuturesMultiplier('1000SHIB')).toEqual({ multiplier: 1000, underlying: 'SHIB' });
    expect(parseFuturesMultiplier('10000SATS')).toEqual({ multiplier: 10_000, underlying: 'SATS' });
    expect(parseFuturesMultiplier('1000000MOG')).toEqual({ multiplier: 1_000_000, underlying: 'MOG' });
    expect(parseFuturesMultiplier('1MBABYDOGE')).toEqual({ multiplier: 1_000_000, underlying: 'BABYDOGE' });
  });

  it('leaves ordinary bases untouched', () => {
    expect(parseFuturesMultiplier('BTC')).toEqual({ multiplier: 1, underlying: 'BTC' });
    expect(parseFuturesMultiplier('1INCH')).toEqual({ multiplier: 1, underlying: '1INCH' });
  });
});

describe('contract symbol resolution for candles', () => {
  const universe = new Map<string, string>([
    ['BTC', 'BTCUSDT'],
    ['1000PEPE', '1000PEPEUSDT'],
    ['BTCDOM', 'BTCDOMUSDT'],
  ]);

  it('resolves through the authoritative universe', () => {
    expect(resolveFuturesContractSymbol('BTC', universe)).toBe('BTCUSDT');
    expect(resolveFuturesContractSymbol('1000pepe', universe)).toBe('1000PEPEUSDT');
  });

  it('accepts an already-resolved contract symbol', () => {
    expect(resolveFuturesContractSymbol('1000PEPEUSDT', universe)).toBe('1000PEPEUSDT');
  });

  it('returns null for instruments outside the active universe instead of guessing', () => {
    // PEPEUSDT exists on Spot but NOT as a USD-M contract (it is 1000PEPEUSDT).
    expect(resolveFuturesContractSymbol('PEPE', universe)).toBeNull();
    expect(resolveFuturesContractSymbol('NOTLISTED', universe)).toBeNull();
    expect(resolveFuturesContractSymbol('', universe)).toBeNull();
  });

  it('falls back to BASEUSDT only when the universe is unknown (degraded mode)', () => {
    expect(resolveFuturesContractSymbol('SOL', null)).toBe('SOLUSDT');
    expect(resolveFuturesContractSymbol('SOLUSDT', null)).toBe('SOLUSDT');
    expect(resolveFuturesContractSymbol('SOL/USDT', null)).toBeNull();
  });
});

describe('futures ↔ spot linking is never a blind base-symbol join', () => {
  const spotBases = new Set(['BTC', 'ETH', 'PEPE', 'SHIB', 'SOL']);

  it('maps a multiplier contract to its underlying spot asset only when spot lists it', () => {
    expect(futuresBaseToSpot('1000PEPE', spotBases)).toBe('PEPE');
    expect(futuresBaseToSpot('1000SHIB', spotBases)).toBe('SHIB');
    expect(futuresBaseToSpot('BTC', spotBases)).toBe('BTC');
  });

  it('returns null for futures-only instruments', () => {
    expect(futuresBaseToSpot('BTCDOM', spotBases)).toBeNull();
    expect(futuresBaseToSpot('1000XYZ', spotBases)).toBeNull();
  });

  it('degrades to the raw base only when the spot universe itself is unknown', () => {
    // Documented degraded mode: with no exchangeInfo we cannot prove the pair
    // is absent, so navigation stays possible and the target page reports the
    // honest "asset not found" state. A multiplier base is still NOT unwrapped
    // blindly, because 1000PEPE ≠ PEPE without proof.
    expect(futuresBaseToSpot('BTC', null)).toBe('BTC');
    expect(futuresBaseToSpot('1000PEPE', null)).toBe('1000PEPE');
  });
});

describe('display helpers', () => {
  it('formats and parses the display pair', () => {
    expect(futuresDisplaySymbol('1000PEPE')).toBe('1000PEPE/USDT');
    expect(futuresDisplaySymbol('BTC', 'usdc')).toBe('BTC/USDC');
    expect(futuresDisplayBase('1000PEPE/USDT')).toBe('1000PEPE');
    expect(futuresDisplayBase('btc/usdt')).toBe('BTC');
  });
});

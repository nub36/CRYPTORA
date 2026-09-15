import { MarketDataProvider } from './MarketDataProvider';
import { DemoMarketDataProvider } from './DemoMarketDataProvider';

// Default provider for terminal: Demo Provider (deterministic, reliable)
export const defaultMarketDataProvider: MarketDataProvider = new DemoMarketDataProvider();

export * from './MarketDataProvider';
export * from './DemoMarketDataProvider';
export * from './LiveMarketDataProvider';
export * from './registry/assetRegistry';
export * from './adapters/BinanceSpotAdapter';
export * from './adapters/KuCoinSpotAdapter';
export * from './adapters/schemas';
export * from './adapters/normalization';
export * from './adapters/errors';

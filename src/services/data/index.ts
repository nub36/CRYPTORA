import { MarketDataProvider } from './MarketDataProvider';
import { DemoMarketDataProvider } from './DemoMarketDataProvider';

// Default provider for Stage 1: Demo Provider
export const defaultMarketDataProvider: MarketDataProvider = new DemoMarketDataProvider();

export * from './MarketDataProvider';
export * from './DemoMarketDataProvider';

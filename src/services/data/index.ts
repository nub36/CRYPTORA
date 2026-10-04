export * from './MarketDataProvider';
// DemoMarketDataProvider is intentionally not re-exported from the production
// data barrel. Development code loads it explicitly through the DEV-gated
// dynamic import in MarketDataContext; a barrel re-export would pull the QA
// provider back into the production module graph.

export * from './LiveMarketDataProvider';
export * from './registry/assetRegistry';
export * from './adapters/BinanceSpotAdapter';
export * from './adapters/KuCoinSpotAdapter';
export * from './adapters/schemas';
export * from './adapters/normalization';
export * from './adapters/errors';
export * from './adapters/sourceHealth';

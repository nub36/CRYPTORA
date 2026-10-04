import type { MarketDataProvider } from './MarketDataProvider';

/** Production replacement for the QA provider; no demo dataset is bundled. */
export class DemoMarketDataProvider implements MarketDataProvider {
  readonly isDemo = true;

  private unavailable(): never {
    throw new Error('QA provider is excluded from the production bundle');
  }

  getMarketOverview(): never { return this.unavailable(); }
  getAssets(): never { return this.unavailable(); }
  getAssetDetail(): never { return this.unavailable(); }
  getAssetSnapshot(): never { return this.unavailable(); }
  getCandles(): never { return this.unavailable(); }
  getFuturesList(): never { return this.unavailable(); }
  getFuturesContract(): never { return this.unavailable(); }
  getFuturesOrderBook(): never { return this.unavailable(); }
  getLiquidations(): never { return this.unavailable(); }
  getRadarEvents(): never { return this.unavailable(); }
  getScreenerResults(): never { return this.unavailable(); }
}

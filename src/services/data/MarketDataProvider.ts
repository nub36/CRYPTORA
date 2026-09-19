import {
  AssetSummary,
  AssetDetail,
  AssetCategory,
  OHLCV,
  Timeframe,
  FuturesAsset,
  LiquidationData,
  RadarEvent,
  MarketOverviewData,
  ScreenerFilters,
} from '@/types/market';

export interface MarketDataProvider {
  readonly isDemo: boolean;
  getMarketOverview(): Promise<MarketOverviewData>;
  getAssets(category?: AssetCategory): Promise<AssetSummary[]>;
  getAssetDetail(symbol: string): Promise<AssetDetail | null>;
  /**
   * Свечи по инструменту. `limit` — желаемая глубина истории (провайдер может
   * вернуть меньше; LIVE-провайдер запрашивает у биржи не более её лимита).
   */
  getCandles(symbol: string, timeframe: Timeframe, limit?: number): Promise<OHLCV[]>;
  getFuturesList(): Promise<FuturesAsset[]>;
  getLiquidations(): Promise<LiquidationData>;
  getRadarEvents(symbol?: string): Promise<RadarEvent[]>;
  getScreenerResults(filters: ScreenerFilters): Promise<AssetSummary[]>;
}

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
  MarketType,
} from '@/types/market';
import type { OrderBookSnapshot } from '@/types/realtime';

/**
 * Options for a candle request.
 *
 * `market` is EXPLICIT and travels from the route/UI down to the exchange
 * adapter. It is never inferred from the symbol string — see RC-6 in
 * docs/DIAGNOSTICS_SPOT_FUTURES_2026-09-29.md.
 */
export interface CandleRequestOptions {
  forceRefresh?: boolean;
  market?: MarketType;
  /** Cancels the in-flight upstream request when the caller navigates away. */
  signal?: AbortSignal;
}

/** Параметры запроса стакана USD-M. */
export interface FuturesOrderBookOptions {
  /** Глубина книги: разрешённая биржей сетка 5/10/20/50/100/500/1000. */
  limit?: number;
  /** Отменяет незавершённый запрос при смене инструмента/уходе со страницы. */
  signal?: AbortSignal;
  /** Игнорировать кэш провайдера (ручное обновление). */
  forceRefresh?: boolean;
}

export interface MarketDataProvider {
  readonly isDemo: boolean;
  getMarketOverview(): Promise<MarketOverviewData>;
  getAssets(category?: AssetCategory): Promise<AssetSummary[]>;
  getAssetDetail(symbol: string): Promise<AssetDetail | null>;
  /** Лёгкий snapshot для первичного UI: только фактический spot ticker, без candles/CoinGecko. */
  getAssetSnapshot?(symbol: string): Promise<AssetDetail | null>;
  /**
   * Свечи по инструменту. `limit` — желаемая глубина истории (провайдер может
   * вернуть меньше; LIVE-провайдер запрашивает у биржи не более её лимита).
   */
  getCandles(symbol: string, timeframe: Timeframe, limit?: number, options?: CandleRequestOptions): Promise<OHLCV[]>;
  getFuturesList(): Promise<FuturesAsset[]>;
  /**
   * One USD-M perpetual by base ticker (`1000PEPE`) or contract symbol
   * (`1000PEPEUSDT`). Returns null when the contract is not in the active
   * universe — the caller then renders «контракт не поддерживается», never a
   * Spot substitute.
   */
  getFuturesContract?(baseOrContract: string): Promise<FuturesAsset | null>;
  /**
   * Стакан USD-M-перпетуала (`/fapi/v1/depth`), задача §4.
   *
   * ОТДЕЛЬНЫЙ метод от спотового стакана (тот приходит по WebSocket
   * `RealtimeFeedManager.subscribeDepth`): это разные книги заявок, и
   * подменять одну другой нельзя. null = контракта нет в активной вселенной.
   */
  getFuturesOrderBook?(
    baseOrContract: string,
    options?: FuturesOrderBookOptions,
  ): Promise<OrderBookSnapshot | null>;
  getLiquidations(): Promise<LiquidationData>;
  getRadarEvents(symbol?: string): Promise<RadarEvent[]>;
  getScreenerResults(filters: ScreenerFilters): Promise<AssetSummary[]>;
}

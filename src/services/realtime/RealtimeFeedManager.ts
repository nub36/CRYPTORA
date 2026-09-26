import { EventBus } from './EventBus';
import { AnomalyEngine, type AnomalyEngineStatus } from './AnomalyEngine';
import { BinanceWebSocketClient, BinanceWebSocketOptions } from './BinanceWebSocketClient';
import {
  BinanceFuturesLiquidationStream,
  LiquidationStreamOptions,
} from './BinanceFuturesLiquidationStream';
import { LiquidationPipeline, LiquidationSourceId, LiquidationStreamState } from '../liquidations/LiquidationPipeline';
import { BybitLiquidationStream } from './liquidations/BybitLiquidationStream';
import { OkxLiquidationStream, OkxLiquidationStreamOptions } from './liquidations/OkxLiquidationStream';
import { RealtimeConnectionState, TickerTick } from '@/types/realtime';
import { RadarEvent } from '@/types/market';

export interface RealtimeFeedManagerOptions {
  throttleIntervalMs?: number;
  anomalyWindowSize?: number;
  wsOptions?: BinanceWebSocketOptions;
  liquidationStreamOptions?: LiquidationStreamOptions;
  bybitLiquidationStreamOptions?: LiquidationStreamOptions;
  okxLiquidationStreamOptions?: OkxLiquidationStreamOptions;
}

export class RealtimeFeedManager {
  private static instance: RealtimeFeedManager | null = null;

  public readonly eventBus: EventBus;
  public readonly anomalyEngine: AnomalyEngine;
  public readonly binanceClient: BinanceWebSocketClient;
  /** Транспорт фактических ликвидаций (Binance USD-M `!forceOrder@arr`). */
  public readonly liquidationStream: BinanceFuturesLiquidationStream;
  /** Транспорты фактических ликвидаций Bybit V5 `allLiquidation` и OKX `liquidation-orders`. */
  public readonly bybitLiquidationStream: BybitLiquidationStream;
  public readonly okxLiquidationStream: OkxLiquidationStream;

  private latestPriceMap: Map<string, number> = new Map();
  /** Persistent subscriptions (watchlist/alerts) are separate from route-scoped leases. */
  private persistentSymbols = new Set<string>();
  private scopedSymbolRefs = new Map<string, number>();
  private isAutoStart = false;

  constructor(options: RealtimeFeedManagerOptions = {}) {
    this.eventBus = new EventBus({
      throttleIntervalMs: options.throttleIntervalMs ?? 250,
    });

    this.anomalyEngine = new AnomalyEngine(
      { windowSize: options.anomalyWindowSize ?? 20 },
      this.eventBus
    );

    this.binanceClient = new BinanceWebSocketClient(
      this.eventBus,
      this.anomalyEngine,
      options.wsOptions
    );

    // Транспорт фактических ликвидаций пишет напрямую в конвейер ликвидаций.
    // Никаких синтетических «дозаполнений»: если поток молчит, срез остаётся пустым.
    this.liquidationStream = new BinanceFuturesLiquidationStream(
      LiquidationPipeline.getInstance(),
      options.liquidationStreamOptions
    );
    this.bybitLiquidationStream = new BybitLiquidationStream(
      LiquidationPipeline.getInstance(),
      options.bybitLiquidationStreamOptions
    );
    this.okxLiquidationStream = new OkxLiquidationStream(
      LiquidationPipeline.getInstance(),
      options.okxLiquidationStreamOptions
    );

    // Track latest prices in memory
    this.eventBus.subscribe<TickerTick>('ticker:*', (tick) => {
      this.latestPriceMap.set(tick.symbol, tick.price);
    });
  }

  public static getInstance(options?: RealtimeFeedManagerOptions): RealtimeFeedManager {
    if (!RealtimeFeedManager.instance) {
      RealtimeFeedManager.instance = new RealtimeFeedManager(options);
    }
    return RealtimeFeedManager.instance;
  }

  public get isRunning(): boolean {
    return this.isAutoStart;
  }

  public connect(): void {
    this.isAutoStart = true;
    this.binanceClient.connect();
    this.liquidationStream.connect();
    this.bybitLiquidationStream.connect();
    this.okxLiquidationStream.connect();
  }

  public disconnect(): void {
    this.isAutoStart = false;
    this.binanceClient.disconnect();
    this.liquidationStream.disconnect();
    this.bybitLiquidationStream.disconnect();
    this.okxLiquidationStream.disconnect();
  }

  /** Агрегированное состояние потоков ликвидаций (connected, если жив хотя бы один). */
  public getLiquidationStreamState(): LiquidationStreamState {
    return LiquidationPipeline.getInstance().getStreamState();
  }

  public getLiquidationStreamStates(): Partial<Record<LiquidationSourceId, LiquidationStreamState>> {
    return LiquidationPipeline.getInstance().getStreamStates();
  }

  public getConnectionState(): RealtimeConnectionState {
    return this.binanceClient.getConnectionState();
  }

  /** Persistent subscription used by watchlists and alerts. */
  public subscribeSymbol(symbol: string): void {
    const normalized = symbol.trim().toUpperCase();
    if (!normalized) return;
    this.persistentSymbols.add(normalized);
    this.binanceClient.subscribeTicker(normalized);
    this.binanceClient.subscribeTrades(normalized);
  }

  /** Acquire a route/view-scoped ticker lease; release it on symbol change/unmount. */
  public subscribeSymbolScoped(symbol: string): () => void {
    const normalized = symbol.trim().toUpperCase();
    if (!normalized) return () => undefined;
    this.scopedSymbolRefs.set(normalized, (this.scopedSymbolRefs.get(normalized) ?? 0) + 1);
    this.binanceClient.subscribeTicker(normalized);
    this.binanceClient.subscribeTrades(normalized);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const refs = (this.scopedSymbolRefs.get(normalized) ?? 1) - 1;
      if (refs > 0) {
        this.scopedSymbolRefs.set(normalized, refs);
        return;
      }
      this.scopedSymbolRefs.delete(normalized);
      if (!this.persistentSymbols.has(normalized)) this.unsubscribeExchangeSymbol(normalized);
    };
  }

  public subscribeDepth(symbol: string): void {
    this.binanceClient.subscribeDepth(symbol);
  }

  public unsubscribeDepth(symbol: string): void {
    this.binanceClient.unsubscribeDepth(symbol);
  }

  public subscribeKline(symbol: string, interval: string): void {
    this.binanceClient.subscribeKline(symbol, interval);
  }

  public unsubscribeKline(symbol: string, interval: string): void {
    this.binanceClient.unsubscribeKline(symbol, interval);
  }

  public unsubscribeSymbol(symbol: string): void {
    const normalized = symbol.trim().toUpperCase();
    this.persistentSymbols.delete(normalized);
    if ((this.scopedSymbolRefs.get(normalized) ?? 0) === 0) {
      this.unsubscribeExchangeSymbol(normalized);
    }
  }

  private unsubscribeExchangeSymbol(symbol: string): void {
    this.binanceClient.unsubscribeTicker(symbol);
    this.binanceClient.unsubscribeTrades(symbol);
  }

  public getLatestPrice(symbol: string): number | undefined {
    return this.latestPriceMap.get(symbol);
  }

  public getAllLatestPrices(): Record<string, number> {
    const res: Record<string, number> = {};
    for (const [sym, price] of this.latestPriceMap.entries()) {
      res[sym] = price;
    }
    return res;
  }

  public getRadarEvents(symbol?: string): RadarEvent[] {
    return this.anomalyEngine.getEvents(symbol);
  }

  public getRadarDetectorStatus(symbols?: readonly string[]): AnomalyEngineStatus {
    return this.anomalyEngine.getStatus(symbols);
  }

  public destroy(): void {
    this.disconnect();
    this.eventBus.destroy();
    this.anomalyEngine.clear();
    this.latestPriceMap.clear();
    this.persistentSymbols.clear();
    this.scopedSymbolRefs.clear();
    if (RealtimeFeedManager.instance === this) {
      RealtimeFeedManager.instance = null;
    }
  }
}

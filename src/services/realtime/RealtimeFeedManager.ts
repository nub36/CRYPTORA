import { EventBus } from './EventBus';
import { AnomalyEngine } from './AnomalyEngine';
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

  public subscribeSymbol(symbol: string): void {
    this.binanceClient.subscribeTicker(symbol);
    this.binanceClient.subscribeTrades(symbol);
  }

  public subscribeDepth(symbol: string): void {
    this.binanceClient.subscribeDepth(symbol);
  }

  public unsubscribeSymbol(symbol: string): void {
    this.binanceClient.unsubscribeTicker(symbol);
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

  public destroy(): void {
    this.disconnect();
    this.eventBus.destroy();
    this.anomalyEngine.clear();
    this.latestPriceMap.clear();
    if (RealtimeFeedManager.instance === this) {
      RealtimeFeedManager.instance = null;
    }
  }
}

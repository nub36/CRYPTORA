import { LiquidationPipeline } from '../liquidations/LiquidationPipeline';
import {
  LiquidationStreamTransport,
  LiquidationTransportOptions,
} from './liquidations/LiquidationStreamTransport';

export type LiquidationStreamOptions = LiquidationTransportOptions;

/**
 * BinanceFuturesLiquidationStream — транспорт ФАКТИЧЕСКИХ ликвидаций Binance USD-M.
 * Публичный агрегированный поток `!forceOrder@arr` (без подписки и без ping со
 * стороны клиента). Общая логика переподключения/деградации — в базовом транспорте.
 */
export class BinanceFuturesLiquidationStream extends LiquidationStreamTransport {
  public readonly exchangeId = 'binance' as const;
  public readonly exchangeLabel = 'Binance Futures';

  constructor(pipeline: LiquidationPipeline, options: LiquidationStreamOptions = {}) {
    super(pipeline, 'wss://fstream.binance.com/ws/!forceOrder@arr', options);
  }

  protected override ingest(msg: unknown): void {
    // Комбинированный конверт {stream, data} либо прямой payload
    const payload = (msg as { data?: unknown })?.data ?? msg;
    if (!payload) return;
    this.pipeline.ingestForceOrderMessage(payload);
  }
}

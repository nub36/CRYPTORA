import { LiquidationPipeline } from '@/services/liquidations/LiquidationPipeline';
import { getCanonicalAssets } from '@/services/data/registry/assetRegistry';
import { LiquidationStreamTransport, LiquidationTransportOptions } from './LiquidationStreamTransport';

/**
 * Bybit V5 — публичный поток `allLiquidation.{symbol}` (USDT-перпы, linear).
 * Кадр: { topic, type:'snapshot', ts, data:[{ T, s, S, v, p }] } — пачками, ≤ 500 ms.
 * `S` — сторона ликвидированной позиции по документации Bybit: Buy ⇒ закрыт лонг, Sell ⇒ закрыт шорт.
 * `p` — bankruptcy price, `v` — исполненный размер в базовой монете (linear).
 * Keep-alive: клиент шлёт {"op":"ping"} каждые 20 с.
 */
export class BybitLiquidationStream extends LiquidationStreamTransport {
  public readonly exchangeId = 'bybit' as const;
  public readonly exchangeLabel = 'Bybit';
  private readonly symbols: string[];

  constructor(pipeline: LiquidationPipeline, options: LiquidationTransportOptions & { symbols?: string[] } = {}) {
    super(pipeline, 'wss://stream.bybit.com/v5/public/linear', options);
    this.symbols =
      options.symbols ??
      getCanonicalAssets()
        .map((a) => a.binanceSymbol)
        .filter((s): s is string => Boolean(s));
  }

  protected override subscribeMessages(): string[] {
    // Bybit ограничивает args ≤ 10 топиков на сообщение
    const out: string[] = [];
    for (let i = 0; i < this.symbols.length; i += 10) {
      out.push(JSON.stringify({ op: 'subscribe', args: this.symbols.slice(i, i + 10).map((s) => `allLiquidation.${s}`) }));
    }
    return out;
  }

  protected override keepAlive() {
    return { intervalMs: 20000, frame: JSON.stringify({ op: 'ping' }) };
  }

  protected override isControlFrame(msg: unknown): boolean {
    const m = msg as { op?: string; topic?: string; success?: boolean };
    return typeof m === 'object' && m !== null && (m.op === 'pong' || m.op === 'subscribe' || m.op === 'ping' || typeof m.success === 'boolean');
  }

  protected override ingest(msg: unknown): void {
    this.pipeline.ingestBybitAllLiquidation(msg);
  }
}

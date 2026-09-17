import { LiquidationPipeline } from '@/services/liquidations/LiquidationPipeline';
import { LiquidationStreamTransport, LiquidationTransportOptions } from './LiquidationStreamTransport';

export type OkxContractValueMap = Record<string, number>; // instId → ctVal (в базовой монете)

export interface OkxLiquidationStreamOptions extends LiquidationTransportOptions {
  /** Публичный REST для каталога инструментов (ctVal). Без него USD-нотионал невычислим. */
  instrumentsUrl?: string;
  fetchFn?: typeof fetch;
  /** Готовый каталог (тесты / инъекция) — REST не вызывается. */
  contractValues?: OkxContractValueMap;
}

/**
 * OKX — публичный канал `liquidation-orders` (instType: SWAP).
 * Кадр: { arg:{channel,instType}, data:[{ instId:'BTC-USDT-SWAP', instFamily, details:[{ bkPx, sz, side, posSide, ts }] }] }.
 * `sz` — в КОНТРАКТАХ; USD = bkPx × sz × ctVal(instId). ctVal берётся из публичного
 * `/api/v5/public/instruments?instType=SWAP` (без ключей). Если каталог недоступен —
 * поток честно остаётся `unavailable`: оценочные ctVal не подставляются.
 * Keep-alive: клиент шлёт текст `ping` каждые 25 с, сервер отвечает `pong`.
 */
export class OkxLiquidationStream extends LiquidationStreamTransport {
  public readonly exchangeId = 'okx' as const;
  public readonly exchangeLabel = 'OKX';
  private readonly instrumentsUrl: string;
  private readonly fetchFn: typeof fetch | null;
  private contractValues: OkxContractValueMap | null;

  constructor(pipeline: LiquidationPipeline, options: OkxLiquidationStreamOptions = {}) {
    super(pipeline, 'wss://ws.okx.com:8443/ws/v5/public', options);
    this.instrumentsUrl = options.instrumentsUrl ?? 'https://www.okx.com/api/v5/public/instruments?instType=SWAP';
    this.fetchFn = options.fetchFn ?? (typeof fetch === 'function' ? (...a: Parameters<typeof fetch>) => fetch(...a) : null);
    this.contractValues = options.contractValues ?? null;
  }

  public getContractValues(): OkxContractValueMap | null {
    return this.contractValues;
  }

  protected override prepare(): Promise<void> | null {
    if (this.contractValues) return null;
    return this.loadInstruments();
  }

  private async loadInstruments(): Promise<void> {
    if (!this.fetchFn) throw new Error('OKX instruments: fetch недоступен');
    const res = await this.fetchFn(this.instrumentsUrl);
    if (!res.ok) throw new Error(`OKX instruments HTTP ${res.status}`);
    const json = (await res.json()) as { code?: string; data?: Array<{ instId?: string; ctVal?: string; settleCcy?: string }> };
    const map: OkxContractValueMap = {};
    for (const it of json.data ?? []) {
      const v = Number(it.ctVal);
      if (it.instId && Number.isFinite(v) && v > 0 && it.instId.endsWith('-USDT-SWAP')) map[it.instId] = v;
    }
    if (Object.keys(map).length === 0) throw new Error('OKX instruments: пустой каталог');
    this.contractValues = map;
  }

  protected override subscribeMessages(): string[] {
    return [JSON.stringify({ op: 'subscribe', args: [{ channel: 'liquidation-orders', instType: 'SWAP' }] })];
  }

  protected override keepAlive() {
    return { intervalMs: 25000, frame: 'ping' };
  }

  protected override isControlFrame(msg: unknown, raw: string): boolean {
    if (raw === 'pong') return true;
    const m = msg as { event?: string };
    return typeof m === 'object' && m !== null && typeof m.event === 'string';
  }

  protected override ingest(msg: unknown): void {
    if (!this.contractValues) return;
    this.pipeline.ingestOkxLiquidationOrders(msg, this.contractValues);
  }
}

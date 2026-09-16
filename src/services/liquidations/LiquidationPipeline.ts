import { LiquidationData, LiquidationEvent, LiquidationDataStatus } from '@/types/market';
import { getAssetByBinanceSymbol } from '../data/registry/assetRegistry';

/** Статус транспорта фактических ликвидаций (отдельно от статуса данных). */
export type LiquidationStreamState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'unavailable';

const WINDOW_24H_MS = 24 * 60 * 60 * 1000;
const TIMELINE_BUCKETS = 8;
const BUCKET_MS = WINDOW_24H_MS / TIMELINE_BUCKETS;

export interface EstimatedLiquidationCluster {
  leverageTier: number;
  side: 'LONG' | 'SHORT';
  priceLevel: number;
  distancePct: number;
  estimatedVolumeUsd: number;
}

/**
 * LiquidationPipeline — конвейер ФАКТИЧЕСКИХ событий принудительного закрытия.
 * ---------------------------------------------------------------------------
 * ⚠️ Инварианты честности данных (RULES.md §1, §3; AGENTS.md §3.1):
 *  1. Конвейер не генерирует и не «подставляет» оценочные агрегаты.
 *     Пока фактических событий нет — итоги равны нулю, `largestEvent === null`,
 *     разбивки пусты, а `dataStatus` честно сообщает `AWAITING_STREAM`/`UNAVAILABLE`.
 *  2. Никаких `Math.random()`: идентификатор события детерминированно выводится
 *     из полей биржевого payload.
 *  3. Каждое событие помечается источником (`isDemo: false` + exchange) только
 *     если оно действительно пришло из биржевого WebSocket-потока.
 *  4. Окно агрегации — скользящие 24 часа от фактического времени событий;
 *     устаревшие события вычищаются.
 *
 * Расчётная модель уровней (`calculateEstimatedClusters`) вынесена отдельно и
 * обязана маркироваться в UI как `MODEL / ESTIMATED` — она никогда не смешивается
 * с фактическими событиями.
 */
export class LiquidationPipeline {
  private static instance: LiquidationPipeline | null = null;

  private events: LiquidationEvent[] = [];
  private maxStoredEvents = 500;
  private streamState: LiquidationStreamState = 'idle';

  public static getInstance(): LiquidationPipeline {
    if (!LiquidationPipeline.instance) {
      LiquidationPipeline.instance = new LiquidationPipeline();
    }
    return LiquidationPipeline.instance;
  }

  /** Только для тестов: сброс singleton-состояния. */
  public static resetInstance(): void {
    LiquidationPipeline.instance = null;
  }

  /* ------------------------------------------------------------------ */
  /* Состояние транспорта                                                */
  /* ------------------------------------------------------------------ */

  public setStreamState(state: LiquidationStreamState): void {
    this.streamState = state;
  }

  public getStreamState(): LiquidationStreamState {
    return this.streamState;
  }

  /* ------------------------------------------------------------------ */
  /* Приём фактических событий                                            */
  /* ------------------------------------------------------------------ */

  /**
   * Приём сообщения агрегированного потока Binance USD-M `!forceOrder@arr`
   * (массив событий) либо одиночного `forceOrder`.
   * Возвращает массив успешно разобранных событий.
   */
  public ingestForceOrderMessage(payload: unknown): LiquidationEvent[] {
    if (Array.isArray(payload)) {
      return payload
        .map((item) => this.processBinanceForceOrder(item))
        .filter((event): event is LiquidationEvent => event !== null);
    }
    const single = this.processBinanceForceOrder(payload);
    return single ? [single] : [];
  }

  /**
   * Разбор одного биржевого payload `forceOrder`.
   * Формат: { e: 'forceOrder', o: { s: 'BTCUSDT', S: 'SELL', p: '65000', q: '1.5', T: 1726444800000 } }
   */
  public processBinanceForceOrder(payload: any): LiquidationEvent | null {
    try {
      const order = payload?.o || payload;
      if (!order || !order.s) return null;

      const rawSymbol = String(order.s);
      const canonical = getAssetByBinanceSymbol(rawSymbol);
      const symbol = canonical ? canonical.symbol : rawSymbol.replace(/USDT$/, '');

      // SELL-ордер при ликвидации => принудительно закрыта LONG-позиция
      // BUY-ордер при ликвидации  => принудительно закрыта SHORT-позиция
      const side: 'LONG' | 'SHORT' = order.S === 'SELL' ? 'LONG' : 'SHORT';

      const price = parseFloat(order.ap || order.p || '0');
      const qty = parseFloat(order.q || '0');
      const amountUsd = price * qty;
      if (!Number.isFinite(amountUsd) || amountUsd <= 0) return null;

      const eventTimeMs = Number(order.T) > 0 ? Number(order.T) : Date.now();

      const event: LiquidationEvent = {
        // Детерминированный идентификатор: никакого Math.random()
        id: `liq-${symbol}-${eventTimeMs}-${price}-${qty}`,
        timestamp: new Date(eventTimeMs).toISOString(),
        symbol,
        side,
        amountUsd: Number(amountUsd.toFixed(2)),
        price,
        exchange: 'Binance Futures',
        // Событие пришло из биржевого потока — это не демо-данные
        isDemo: false,
      };

      this.recordEvent(event);
      return event;
    } catch {
      return null;
    }
  }

  public recordEvent(event: LiquidationEvent): void {
    this.events.unshift(event);
    if (this.events.length > this.maxStoredEvents) {
      this.events.length = this.maxStoredEvents;
    }
    this.pruneExpired();
  }

  private pruneExpired(now = Date.now()): void {
    const cutoff = now - WINDOW_24H_MS;
    this.events = this.events.filter((event) => {
      const ts = Date.parse(event.timestamp);
      return Number.isFinite(ts) ? ts >= cutoff : false;
    });
  }

  /* ------------------------------------------------------------------ */
  /* Честный срез фактических данных                                      */
  /* ------------------------------------------------------------------ */

  public getLiquidationSnapshot(now = Date.now()): LiquidationData {
    this.pruneExpired(now);

    const windowEvents = this.events.filter(
      (event) => Date.parse(event.timestamp) >= now - WINDOW_24H_MS
    );

    let totalLong24h = 0;
    let totalShort24h = 0;
    const assetTotals = new Map<string, { longUsd: number; shortUsd: number }>();
    const exchangeTotals = new Map<string, number>();
    let largestEvent: LiquidationEvent | null = null;

    for (const event of windowEvents) {
      if (event.side === 'LONG') totalLong24h += event.amountUsd;
      else totalShort24h += event.amountUsd;

      const asset = assetTotals.get(event.symbol) || { longUsd: 0, shortUsd: 0 };
      if (event.side === 'LONG') asset.longUsd += event.amountUsd;
      else asset.shortUsd += event.amountUsd;
      assetTotals.set(event.symbol, asset);

      exchangeTotals.set(event.exchange, (exchangeTotals.get(event.exchange) || 0) + event.amountUsd);

      if (!largestEvent || event.amountUsd > largestEvent.amountUsd) {
        largestEvent = event;
      }
    }

    const total24h = totalLong24h + totalShort24h;

    const assetBreakdown = Array.from(assetTotals.entries())
      .map(([symbol, totals]) => ({
        symbol,
        totalUsd: Number((totals.longUsd + totals.shortUsd).toFixed(2)),
        longUsd: Number(totals.longUsd.toFixed(2)),
        shortUsd: Number(totals.shortUsd.toFixed(2)),
      }))
      .sort((a, b) => b.totalUsd - a.totalUsd);

    const exchangeBreakdown = Array.from(exchangeTotals.entries())
      .map(([exchange, totalUsd]) => ({
        exchange,
        totalUsd: Number(totalUsd.toFixed(2)),
        percentage: total24h > 0 ? Number(((totalUsd / total24h) * 100).toFixed(1)) : 0,
      }))
      .sort((a, b) => b.totalUsd - a.totalUsd);

    return {
      totalLong24h: Number(totalLong24h.toFixed(2)),
      totalShort24h: Number(totalShort24h.toFixed(2)),
      total24h: Number(total24h.toFixed(2)),
      largestEvent,
      eventsCount24h: windowEvents.length,
      lastEventAt: windowEvents.length > 0 ? windowEvents[0].timestamp : null,
      dataStatus: this.resolveDataStatus(windowEvents.length),
      recentEvents: this.events.slice(0, 50),
      assetBreakdown,
      exchangeBreakdown,
      timeline: this.buildTimeline(windowEvents, now),
      isDemo: false,
    };
  }

  private resolveDataStatus(eventsCount: number): LiquidationDataStatus {
    if (eventsCount > 0) return 'LIVE_STREAM';
    if (this.streamState === 'connected') return 'AWAITING_STREAM';
    return 'UNAVAILABLE';
  }

  /** 8 трёхчасовых UTC-баров за последние 24 часа, построенных из фактических событий. */
  private buildTimeline(
    windowEvents: LiquidationEvent[],
    now: number
  ): Array<{ timestamp: string; longUsd: number; shortUsd: number }> {
    const buckets = Array.from({ length: TIMELINE_BUCKETS }, (_, index) => {
      const bucketEnd = now - (TIMELINE_BUCKETS - 1 - index) * BUCKET_MS;
      const date = new Date(bucketEnd);
      return {
        timestamp: `${String(date.getUTCHours()).padStart(2, '0')}:00`,
        longUsd: 0,
        shortUsd: 0,
        startMs: bucketEnd - BUCKET_MS,
        endMs: bucketEnd,
      };
    });

    for (const event of windowEvents) {
      const ts = Date.parse(event.timestamp);
      const bucket = buckets.find((b) => ts > b.startMs && ts <= b.endMs);
      if (!bucket) continue;
      if (event.side === 'LONG') bucket.longUsd += event.amountUsd;
      else bucket.shortUsd += event.amountUsd;
    }

    return buckets.map(({ timestamp, longUsd, shortUsd }) => ({
      timestamp,
      longUsd: Number(longUsd.toFixed(2)),
      shortUsd: Number(shortUsd.toFixed(2)),
    }));
  }

  /* ------------------------------------------------------------------ */
  /* Расчётная модель уровней (MODEL / ESTIMATED)                         */
  /* ------------------------------------------------------------------ */

  /**
   * Теоретические ценовые зоны скопления ликвидаций по плечевым тирам.
   * Строго расчётная модель: в UI обязана маркироваться `MODEL / ESTIMATED`
   * и никогда не подаваться как фактические ордера или подтвержденные уровни.
   *
   * @param currentPrice текущая цена актива (из фактического источника данных)
   * @param openInterestUsd открытый интерес по активу в USD (из фактического источника)
   */
  public static calculateEstimatedClusters(
    currentPrice: number,
    openInterestUsd: number
  ): EstimatedLiquidationCluster[] {
    const leverageTiers = [10, 25, 50, 100];
    const clusters: EstimatedLiquidationCluster[] = [];

    for (const leverage of leverageTiers) {
      const distancePct = (1 / leverage) * 100;

      clusters.push({
        leverageTier: leverage,
        side: 'LONG',
        priceLevel: Number((currentPrice * (1 - 1 / leverage)).toFixed(2)),
        distancePct: Number(distancePct.toFixed(2)),
        estimatedVolumeUsd: Number((openInterestUsd * (0.05 / (leverageTiers.indexOf(leverage) + 1))).toFixed(2)),
      });

      clusters.push({
        leverageTier: leverage,
        side: 'SHORT',
        priceLevel: Number((currentPrice * (1 + 1 / leverage)).toFixed(2)),
        distancePct: Number(distancePct.toFixed(2)),
        estimatedVolumeUsd: Number((openInterestUsd * (0.04 / (leverageTiers.indexOf(leverage) + 1))).toFixed(2)),
      });
    }

    return clusters.sort((a, b) => b.priceLevel - a.priceLevel);
  }
}

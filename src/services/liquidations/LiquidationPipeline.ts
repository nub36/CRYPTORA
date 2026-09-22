import { LiquidationData, LiquidationEvent, LiquidationDataStatus } from '@/types/market';
import { getAssetByBinanceSymbol } from '../data/registry/assetRegistry';

/** Статус транспорта фактических ликвидаций (отдельно от статуса данных). */
export type LiquidationStreamState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'unavailable';

/** Идентификаторы подключаемых бирж (Этап 6: Binance → Bybit → OKX). */
export type LiquidationSourceId = 'binance' | 'bybit' | 'okx';
export const LIQUIDATION_SOURCE_LABELS: Record<LiquidationSourceId, string> = {
  binance: 'Binance Futures',
  bybit: 'Bybit',
  okx: 'OKX',
};

const WINDOW_24H_MS = 24 * 60 * 60 * 1000;
const STORAGE_KEY = 'cryptora_liq_events';
const OBS_STORAGE_KEY = 'cryptora_liq_observation';

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
  /** Состояние транспорта по каждой бирже; агрегированный статус выводится из них. */
  private streamStates: Partial<Record<LiquidationSourceId, LiquidationStreamState>> = {};
  private legacyStreamState: LiquidationStreamState = 'idle';
  /** Когда конвейер начал наблюдение (первая подписка на поток). */
  private observationStartedAt: number | null = null;
  /** Достигнуто ли полное 24h окно. */
  private hasFullWindow = false;

  constructor(restoreFromStorage = false) {
    if (restoreFromStorage) {
      this._restoreFromStorage();
      this._restoreObservationMeta();
    }
  }

  public static getInstance(): LiquidationPipeline {
    if (!LiquidationPipeline.instance) {
      LiquidationPipeline.instance = new LiquidationPipeline(true);
    }
    return LiquidationPipeline.instance;
  }

  /** Только для тестов: сброс singleton-состояния. */
  public static resetInstance(): void {
    try { sessionStorage.removeItem(STORAGE_KEY); sessionStorage.removeItem(OBS_STORAGE_KEY); } catch { /* SSR */ }
    LiquidationPipeline.instance = null;
  }

  private _restoreFromStorage(): void {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      const now = Date.now();
      for (const e of parsed) {
        if (e && typeof e.id === 'string' && typeof e.timestamp === 'string') {
          const ts = Date.parse(e.timestamp);
          if (Number.isFinite(ts) && ts >= now - WINDOW_24H_MS) {
            this.events.push(e as LiquidationEvent);
          }
        }
      }
    } catch { /* SSR or corrupt */ }
  }

  private persistToStorage(): void {
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(this.events.slice(0, 100))); } catch { /* full */ }
  }

  private _restoreObservationMeta(): void {
    try {
      const raw = sessionStorage.getItem(OBS_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.startedAt === 'number') {
        this.observationStartedAt = parsed.startedAt;
        this.hasFullWindow = parsed.hasFullWindow === true;
      }
    } catch { /* corrupt */ }
  }

  private persistObservationMeta(): void {
    try { sessionStorage.setItem(OBS_STORAGE_KEY, JSON.stringify({ startedAt: this.observationStartedAt, hasFullWindow: this.hasFullWindow })); } catch { /* full */ }
  }

  /** Начать наблюдение: вызывается при первой подписке на поток. */
  public startObservation(): void {
    if (this.observationStartedAt === null) {
      this.observationStartedAt = Date.now();
      this.persistObservationMeta();
    }
  }

  /**
   * Получить метаданные наблюдения для UI.
   * `now` прокидывается из среза: метаданные и агрегаты обязаны считаться по
   * одним и тем же часам, иначе длительность наблюдения и окно событий разъезжаются.
   */
  public getObservationMeta(now = Date.now()): { startedAt: number | null; durationMs: number; hasFullWindow: boolean } {
    const startedAt = this.observationStartedAt;
    const durationMs = startedAt != null ? now - startedAt : 0;
    if (!this.hasFullWindow && durationMs >= WINDOW_24H_MS) {
      this.hasFullWindow = true;
    }
    return { startedAt, durationMs, hasFullWindow: this.hasFullWindow };
  }

  /* ------------------------------------------------------------------ */
  /* Состояние транспорта                                                */
  /* ------------------------------------------------------------------ */

  public setStreamState(state: LiquidationStreamState, source: LiquidationSourceId = 'binance'): void {
    this.streamStates[source] = state;
    this.legacyStreamState = state;
    if (state === 'connected' && this.observationStartedAt === null) {
      this.observationStartedAt = Date.now();
      this.persistObservationMeta();
    }
  }

  /**
   * Агрегированное состояние: connected, если подключена хотя бы одна биржа;
   * connecting/reconnecting — если кто-то ещё пытается; unavailable — если все недоступны; idle — иначе.
   */
  public getStreamState(): LiquidationStreamState {
    const states = Object.values(this.streamStates);
    if (states.length === 0) return this.legacyStreamState;
    if (states.includes('connected')) return 'connected';
    if (states.includes('connecting')) return 'connecting';
    if (states.includes('reconnecting')) return 'reconnecting';
    if (states.every((s) => s === 'unavailable')) return 'unavailable';
    return 'idle';
  }

  public getStreamStates(): Partial<Record<LiquidationSourceId, LiquidationStreamState>> {
    return { ...this.streamStates };
  }

  /* ------------------------------------------------------------------ */
  /* Приём фактических событий: Bybit V5 / OKX                            */
  /* ------------------------------------------------------------------ */

  /**
   * Bybit V5 `allLiquidation.{symbol}`: { topic, data:[{ T, s, S, v, p }] }.
   * Семантика `S` по документации Bybit: Buy ⇒ ликвидирован ЛОНГ, Sell ⇒ ликвидирован ШОРТ
   * (обратна Binance, где смотрят на сторону ордера закрытия). `p` — bankruptcy price, `v` — размер в монете.
   */
  public ingestBybitAllLiquidation(payload: unknown): LiquidationEvent[] {
    const msg = payload as { topic?: string; data?: unknown };
    if (!msg || typeof msg.topic !== 'string' || !msg.topic.startsWith('allLiquidation.')) return [];
    const rows = Array.isArray(msg.data) ? msg.data : msg.data ? [msg.data] : [];
    const out: LiquidationEvent[] = [];
    for (const row of rows as Array<{ T?: unknown; s?: unknown; S?: unknown; v?: unknown; p?: unknown }>) {
      try {
        if (!row || typeof row.s !== 'string') continue;
        const symbol = this.canonicalFromUsdtSymbol(row.s);
        const side: 'LONG' | 'SHORT' = row.S === 'Buy' ? 'LONG' : row.S === 'Sell' ? 'SHORT' : (null as never);
        if (!side) continue;
        const price = parseFloat(String(row.p ?? '0'));
        const qty = parseFloat(String(row.v ?? '0'));
        const amountUsd = price * qty;
        if (!Number.isFinite(amountUsd) || amountUsd <= 0) continue;
        const eventTimeMs = Number(row.T) > 0 ? Number(row.T) : Date.now();
        const event: LiquidationEvent = {
          id: `liq-bybit-${symbol}-${eventTimeMs}-${price}-${qty}`,
          timestamp: new Date(eventTimeMs).toISOString(),
          symbol,
          side,
          amountUsd: Number(amountUsd.toFixed(2)),
          price,
          exchange: LIQUIDATION_SOURCE_LABELS.bybit,
          isDemo: false,
        };
        this.recordEvent(event);
        out.push(event);
      } catch {
        /* пропускаем битую строку */
      }
    }
    return out;
  }

  /**
   * OKX `liquidation-orders` (SWAP): { arg, data:[{ instId, details:[{ bkPx, sz, side, posSide, ts }] }] }.
   * `sz` — в контрактах: USD = bkPx × sz × ctVal(instId). Без известного ctVal событие ОТБРАСЫВАЕТСЯ
   * (не оценивается). Сторона — `posSide` (long/short); при её отсутствии — по `side` ордера закрытия
   * (sell ⇒ закрыт лонг). Только USDT-линейные свопы (`*-USDT-SWAP`).
   */
  public ingestOkxLiquidationOrders(payload: unknown, contractValues: Record<string, number>): LiquidationEvent[] {
    const msg = payload as { arg?: { channel?: string }; data?: unknown };
    if (!msg || msg.arg?.channel !== 'liquidation-orders' || !Array.isArray(msg.data)) return [];
    const out: LiquidationEvent[] = [];
    for (const inst of msg.data as Array<{ instId?: unknown; details?: unknown }>) {
      if (!inst || typeof inst.instId !== 'string' || !inst.instId.endsWith('-USDT-SWAP')) continue;
      const ctVal = contractValues[inst.instId];
      if (!Number.isFinite(ctVal) || ctVal <= 0) continue;
      const symbol = this.canonicalFromUsdtSymbol(inst.instId.replace('-USDT-SWAP', 'USDT'));
      const details = Array.isArray(inst.details) ? inst.details : [];
      for (const d of details as Array<{ bkPx?: unknown; sz?: unknown; side?: unknown; posSide?: unknown; ts?: unknown }>) {
        try {
          const price = parseFloat(String(d.bkPx ?? '0'));
          const contracts = parseFloat(String(d.sz ?? '0'));
          const qty = contracts * ctVal;
          const amountUsd = price * qty;
          if (!Number.isFinite(amountUsd) || amountUsd <= 0) continue;
          let side: 'LONG' | 'SHORT' | null = null;
          if (d.posSide === 'long') side = 'LONG';
          else if (d.posSide === 'short') side = 'SHORT';
          else if (d.side === 'sell') side = 'LONG';
          else if (d.side === 'buy') side = 'SHORT';
          if (!side) continue;
          const eventTimeMs = Number(d.ts) > 0 ? Number(d.ts) : Date.now();
          const event: LiquidationEvent = {
            id: `liq-okx-${symbol}-${eventTimeMs}-${price}-${contracts}`,
            timestamp: new Date(eventTimeMs).toISOString(),
            symbol,
            side,
            amountUsd: Number(amountUsd.toFixed(2)),
            price,
            exchange: LIQUIDATION_SOURCE_LABELS.okx,
            isDemo: false,
          };
          this.recordEvent(event);
          out.push(event);
        } catch {
          /* пропускаем битую запись */
        }
      }
    }
    return out;
  }

  private canonicalFromUsdtSymbol(raw: string): string {
    const canonical = getAssetByBinanceSymbol(raw);
    return canonical ? canonical.symbol : raw.replace(/USDT$/, '');
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
    if (this.events.some((e) => e.id === event.id)) return;
    this.events.unshift(event);
    if (this.events.length > this.maxStoredEvents) {
      this.events.length = this.maxStoredEvents;
    }
    this.pruneExpired();
    this.persistToStorage();
  }

  private pruneExpired(now = Date.now()): void {
    const cutoff = now - WINDOW_24H_MS;
    this.events = this.events.filter((event) => {
      const ts = Date.parse(event.timestamp);
      return Number.isFinite(ts) ? ts >= cutoff : false;
    });
  }

  /* ------------------------------------------------------------------ */
  /* Адаптивный бакет хронологии (§38)                                    */
  /* ------------------------------------------------------------------ */

  /**
   * Размер бакета подбирается по фактической длительности наблюдения, а не
   * зашивается: 3-часовые бары при 40-минутном наблюдении создавали ложное
   * впечатление точности и рисовали пустые «наблюдённые» часы.
   *
   *   < 1ч  → 5м    1–2ч → 15м    2–6ч → 30м    6–24ч → 1ч    ≥ 24ч → 3ч
   */
  public static pickBucketMinutes(observedMs: number): number {
    const MIN = 60 * 1000;
    if (observedMs < 60 * MIN) return 5;
    if (observedMs < 2 * 60 * MIN) return 15;
    if (observedMs < 6 * 60 * MIN) return 30;
    if (observedMs < WINDOW_24H_MS) return 60;
    return 180;
  }

  /** Максимум баров в хронологии — защита от раздувания DOM на длинном окне. */
  private static readonly MAX_TIMELINE_BARS = 48;

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
    type AssetAcc = { longUsd: number; shortUsd: number; longEvents: number; shortEvents: number; largestUsd: number };
    const assetTotals = new Map<string, AssetAcc>();
    const exchangeTotals = new Map<string, { usd: number; events: number; lastEventAt: string | null }>();
    let largestEvent: LiquidationEvent | null = null;

    for (const event of windowEvents) {
      const isLong = event.side === 'LONG';
      if (isLong) totalLong24h += event.amountUsd;
      else totalShort24h += event.amountUsd;

      const asset = assetTotals.get(event.symbol) || { longUsd: 0, shortUsd: 0, longEvents: 0, shortEvents: 0, largestUsd: 0 };
      if (isLong) { asset.longUsd += event.amountUsd; asset.longEvents += 1; }
      else { asset.shortUsd += event.amountUsd; asset.shortEvents += 1; }
      asset.largestUsd = Math.max(asset.largestUsd, event.amountUsd);
      assetTotals.set(event.symbol, asset);

      const ex = exchangeTotals.get(event.exchange) || { usd: 0, events: 0, lastEventAt: null };
      ex.usd += event.amountUsd;
      ex.events += 1;
      if (ex.lastEventAt === null || event.timestamp > ex.lastEventAt) ex.lastEventAt = event.timestamp;
      exchangeTotals.set(event.exchange, ex);

      if (!largestEvent || event.amountUsd > largestEvent.amountUsd) largestEvent = event;
    }

    const total24h = totalLong24h + totalShort24h;

    const assetBreakdown = Array.from(assetTotals.entries())
      .map(([symbol, t]) => ({
        symbol,
        // Инвариант: total === long + short (округление до 2 знаков по каждой компоненте).
        totalUsd: Number((t.longUsd + t.shortUsd).toFixed(2)),
        longUsd: Number(t.longUsd.toFixed(2)),
        shortUsd: Number(t.shortUsd.toFixed(2)),
        eventCount: t.longEvents + t.shortEvents,
        longEvents: t.longEvents,
        shortEvents: t.shortEvents,
        largestEventUsd: t.longEvents + t.shortEvents > 0 ? Number(t.largestUsd.toFixed(2)) : null,
      }))
      .sort((a, b) => b.totalUsd - a.totalUsd);

    const obs = this.getObservationMeta(now);
    const states = this.getStreamStates();

    /**
     * Разбивка по биржам (§40): перечисляем ВСЕ подключённые биржи, включая
     * нулевые. Ноль — валидное наблюдение («поток жив, событий не было»),
     * а не отсутствие данных, поэтому биржа со нулём не скрывается.
     */
    const allExchanges = (Object.keys(LIQUIDATION_SOURCE_LABELS) as LiquidationSourceId[]).map(
      (id) => LIQUIDATION_SOURCE_LABELS[id]
    );
    const exchangeNames = Array.from(new Set([...allExchanges, ...Array.from(exchangeTotals.keys())]));

    const exchangeBreakdown = exchangeNames
      .map((exchange) => {
        const acc = exchangeTotals.get(exchange);
        const totalUsd = acc ? Number(acc.usd.toFixed(2)) : 0;
        const sourceId = (Object.keys(LIQUIDATION_SOURCE_LABELS) as LiquidationSourceId[]).find(
          (id) => LIQUIDATION_SOURCE_LABELS[id] === exchange
        );
        return {
          exchange,
          totalUsd,
          percentage: total24h > 0 ? Number(((totalUsd / total24h) * 100).toFixed(1)) : 0,
          eventCount: acc ? acc.events : 0,
          state: (sourceId ? states[sourceId] : undefined) ?? 'idle',
          lastEventAt: acc?.lastEventAt ?? null,
        };
      })
      // Сначала по объёму; биржи без событий остаются в списке, но идут последними.
      .sort((a, b) => b.totalUsd - a.totalUsd || a.exchange.localeCompare(b.exchange));

    const { buckets, bucketMinutes, rangeLabel } = this.buildTimeline(windowEvents, now);

    return {
      totalLong24h: Number(totalLong24h.toFixed(2)),
      totalShort24h: Number(totalShort24h.toFixed(2)),
      total24h: Number(total24h.toFixed(2)),
      largestEvent,
      eventsCount24h: windowEvents.length,
      lastEventAt: windowEvents.length > 0 ? windowEvents[0].timestamp : null,
      dataStatus: this.resolveDataStatus(windowEvents.length),
      recentEvents: this.events.slice(0, 100),
      assetBreakdown,
      exchangeBreakdown,
      timeline: buckets,
      timelineBucketMinutes: bucketMinutes,
      timelineRangeLabel: rangeLabel,
      isDemo: false,
      observationStartedAt: obs.startedAt,
      observationDurationMs: obs.durationMs,
      hasFullObservationWindow: obs.hasFullWindow,
    };
  }

  private resolveDataStatus(eventsCount: number): LiquidationDataStatus {
    if (eventsCount > 0) return 'LIVE_STREAM';
    if (this.getStreamState() === 'connected') return 'AWAITING_STREAM';
    return 'UNAVAILABLE';
  }

  /**
   * Хронология фактических событий с адаптивным бакетом.
   *
   * ЧЕСТНОСТЬ ПЕРИОДА (§31, §37, §55): бары строятся только по фактически
   * наблюдаемому интервалу — от `effectiveStart` (начало наблюдения ИЛИ
   * самое раннее событие, что раньше) до текущего момента, и не длиннее
   * скользящего 24-часового окна. Период, в котором наблюдение ещё не шло,
   * в хронологию не попадает вовсе: он не выдаётся за «ноль наблюдений».
   * Бакет, попавший в диапазон, помечается `observed: true`.
   */
  private buildTimeline(
    windowEvents: LiquidationEvent[],
    now: number
  ): { buckets: Array<{ timestamp: string; longUsd: number; shortUsd: number; totalUsd: number; eventCount: number; observed: boolean; startMs: number; endMs: number }>; bucketMinutes: number; rangeLabel: string } {
    const earliestEventMs = windowEvents.reduce<number | null>((min, e) => {
      const ts = Date.parse(e.timestamp);
      if (!Number.isFinite(ts)) return min;
      return min === null ? ts : Math.min(min, ts);
    }, null);

    const candidates = [this.observationStartedAt, earliestEventMs].filter(
      (v): v is number => typeof v === 'number' && Number.isFinite(v)
    );
    if (candidates.length === 0) {
      return { buckets: [], bucketMinutes: LiquidationPipeline.pickBucketMinutes(0), rangeLabel: '' };
    }

    // Начало фактического наблюдения, но не раньше границы 24h-окна.
    const windowFloor = now - WINDOW_24H_MS;
    const effectiveStart = Math.max(Math.min(...candidates), windowFloor);
    const observedMs = Math.max(now - effectiveStart, 0);
    const bucketMinutes = LiquidationPipeline.pickBucketMinutes(observedMs);
    const bucketMs = bucketMinutes * 60 * 1000;

    /**
     * Начало первого бара — ровно старт фактического наблюдения, БЕЗ выравнивания
     * назад по сетке. Выравнивание вниз создавало бар, частично лежащий до начала
     * наблюдения: при коротком окне такой бар оказывался единственным и весь период
     * выглядел ненаблюдавшимся. Теперь каждый построенный бар покрывается
     * наблюдением целиком (§31, §37, §55).
     */
    const firstBucketStart = effectiveStart;
    const rawCount = Math.max(Math.ceil((now - firstBucketStart) / bucketMs), 1);
    // Если баров больше лимита — сдвигаем начало вперёд, сохраняя «сейчас» справа.
    const barCount = Math.min(rawCount, LiquidationPipeline.MAX_TIMELINE_BARS);
    const alignedStart =
      rawCount > LiquidationPipeline.MAX_TIMELINE_BARS
        ? firstBucketStart + (rawCount - LiquidationPipeline.MAX_TIMELINE_BARS) * bucketMs
        : firstBucketStart;

    const buckets = Array.from({ length: barCount }, (_, index) => {
      const startMs = alignedStart + index * bucketMs;
      const endMs = startMs + bucketMs;
      const date = new Date(startMs);
      const timestamp =
        bucketMinutes >= 60
          ? `${String(date.getUTCHours()).padStart(2, '0')}:00`
          : `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`;
      // Бар строится только внутри фактически наблюдавшегося интервала.
      // `observed` остаётся в схеме для будущего серверного 24h-хранилища,
      // где между бакетами возможны реальные пропуски наблюдения.
      // Бар строится только внутри наблюдавшегося интервала, поэтому все бары
      // среза наблюдавшиеся. Последний бар при этом ещё заполняется (его конец
      // в будущем) — это нормальное состояние текущего бакета, а не пропуск.
      const observed = startMs >= alignedStart;
      return { timestamp, longUsd: 0, shortUsd: 0, totalUsd: 0, eventCount: 0, observed, startMs, endMs };
    });

    for (const event of windowEvents) {
      const ts = Date.parse(event.timestamp);
      if (!Number.isFinite(ts)) continue;
      const bucket = buckets.find((b) => ts >= b.startMs && ts < b.endMs);
      // Событие правее последнего бара (пришло между тиками) — учитываем в последнем.
      const target = bucket ?? (ts >= alignedStart ? buckets[buckets.length - 1] : undefined);
      if (!target) continue;
      if (event.side === 'LONG') target.longUsd += event.amountUsd;
      else target.shortUsd += event.amountUsd;
      target.eventCount += 1;
    }

    const rangeLabel = LiquidationPipeline.formatRange(alignedStart, now, bucketMinutes, barCount);

    return {
      buckets: buckets.map((b) => ({
        ...b,
        longUsd: Number(b.longUsd.toFixed(2)),
        shortUsd: Number(b.shortUsd.toFixed(2)),
        totalUsd: Number((b.longUsd + b.shortUsd).toFixed(2)),
      })),
      bucketMinutes,
      rangeLabel,
    };
  }

  /** Подпись фактического периода: «Наблюдение: 05:12 UTC — сейчас · 15м × 9 баров». */
  private static formatRange(startMs: number, now: number, bucketMinutes: number, barCount: number): string {
    const hm = (ms: number) => {
      const d = new Date(ms);
      return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
    };
    const step = bucketMinutes >= 60 ? `${bucketMinutes / 60}ч` : `${bucketMinutes}м`;
    return `Наблюдение: ${hm(startMs)} UTC — ${hm(now)} UTC · шаг ${step}, ${barCount} бар.`;
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

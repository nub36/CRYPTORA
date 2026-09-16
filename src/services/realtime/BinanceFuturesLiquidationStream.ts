import { LiquidationPipeline, LiquidationStreamState } from '../liquidations/LiquidationPipeline';

export interface LiquidationStreamOptions {
  /**
   * Агрегированный поток принудительных закрытий Binance USD-M Futures.
   * Отдельный хост (`fstream`) от спотового потока котировок.
   */
  wsUrl?: string;
  reconnectInitialDelayMs?: number;
  reconnectMaxDelayMs?: number;
  maxReconnectAttempts?: number;
  webSocketClass?: any;
  /** Колбэк смены состояния транспорта (для честного отображения статуса в UI). */
  onStateChange?: (state: LiquidationStreamState) => void;
}

/**
 * BinanceFuturesLiquidationStream — транспорт ФАКТИЧЕСКИХ ликвидаций.
 * ---------------------------------------------------------------------------
 * Подписка на публичный поток `!forceOrder@arr` (Binance USD-M Futures),
 * который публикует ордера принудительного закрытия позиций в реальном времени.
 *
 * Инварианты:
 *  - Транспорт только читает публичные рыночные данные; ключи API не используются.
 *  - При недоступности потока pipeline НЕ подменяет данные: состояние честно
 *    переходит в `unavailable`, и UI сообщает об отсутствии фактического потока.
 *  - Никакого торгового исполнения: поток исключительно на чтение.
 */
export class BinanceFuturesLiquidationStream {
  private wsUrl: string;
  private reconnectInitialDelayMs: number;
  private reconnectMaxDelayMs: number;
  private maxReconnectAttempts: number;
  private webSocketClass: any;
  private pipeline: LiquidationPipeline;
  private onStateChange?: (state: LiquidationStreamState) => void;

  private ws: any = null;
  private state: LiquidationStreamState = 'idle';
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private isExplicitlyClosed = false;
  private receivedMessages = 0;

  constructor(pipeline: LiquidationPipeline, options: LiquidationStreamOptions = {}) {
    this.pipeline = pipeline;
    this.wsUrl = options.wsUrl ?? 'wss://fstream.binance.com/ws/!forceOrder@arr';
    this.reconnectInitialDelayMs = options.reconnectInitialDelayMs ?? 1500;
    this.reconnectMaxDelayMs = options.reconnectMaxDelayMs ?? 30000;
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? 10;
    this.onStateChange = options.onStateChange;
    // Явный `null` означает «транспорта нет» и не подменяется глобальным WebSocket —
    // это позволяет честно проверять деградацию в средах без сети.
    this.webSocketClass =
      options.webSocketClass !== undefined
        ? options.webSocketClass
        : typeof WebSocket !== 'undefined'
          ? WebSocket
          : null;
  }

  public getState(): LiquidationStreamState {
    return this.state;
  }

  /** Количество принятых сообщений потока — используется для проверки живости. */
  public getReceivedMessages(): number {
    return this.receivedMessages;
  }

  public get isSupported(): boolean {
    return Boolean(this.webSocketClass);
  }

  public connect(): void {
    if (this.state === 'connected' || this.state === 'connecting') return;

    if (!this.webSocketClass) {
      // Транспорт недоступен (например, среда без WebSocket) — честный статус
      this.setState('unavailable');
      return;
    }

    this.isExplicitlyClosed = false;
    this.setState(this.reconnectAttempts > 0 ? 'reconnecting' : 'connecting');

    try {
      this.ws = new this.webSocketClass(this.wsUrl);
      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
        this.setState('connected');
      };
      this.ws.onmessage = (event: any) => this.handleMessage(event?.data);
      this.ws.onerror = () => {
        this.setState('unavailable');
      };
      this.ws.onclose = () => {
        this.ws = null;
        if (this.isExplicitlyClosed) {
          this.setState('idle');
          return;
        }
        this.scheduleReconnect();
      };
    } catch {
      this.setState('unavailable');
      this.scheduleReconnect();
    }
  }

  public disconnect(): void {
    this.isExplicitlyClosed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempts = 0;
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        /* ignore */
      }
      this.ws = null;
    }
    this.setState('idle');
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.setState('unavailable');
      return;
    }

    this.reconnectAttempts += 1;
    const delay = Math.min(
      this.reconnectInitialDelayMs * Math.pow(2, this.reconnectAttempts - 1),
      this.reconnectMaxDelayMs
    );

    this.setState('reconnecting');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private handleMessage(dataRaw: any): void {
    if (dataRaw === undefined || dataRaw === null) return;
    try {
      const text = typeof dataRaw === 'string' ? dataRaw : String(dataRaw);
      const msg = JSON.parse(text);

      // Комбинированный конверт {stream, data} либо прямой payload
      const payload = msg?.data ?? msg;
      if (!payload) return;

      this.receivedMessages += 1;

      // Агрегированный поток `!forceOrder@arr` присылает как одиночный объект,
      // так и массив событий — конвейер разбирает оба варианта.
      this.pipeline.ingestForceOrderMessage(payload);
    } catch {
      // Некорректный кадр потока — игнорируем, не искажая агрегаты
    }
  }

  private setState(state: LiquidationStreamState): void {
    this.state = state;
    // Конвейер всегда знает актуальное состояние транспорта: от него зависит
    // честный статус данных (`AWAITING_STREAM` vs `UNAVAILABLE`).
    this.pipeline.setStreamState(state);
    this.onStateChange?.(state);
  }
}

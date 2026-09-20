import { LiquidationPipeline, LiquidationStreamState } from '@/services/liquidations/LiquidationPipeline';

export type LiquidationExchangeId = 'binance' | 'bybit' | 'okx';

export interface LiquidationTransportOptions {
  wsUrl?: string;
  reconnectInitialDelayMs?: number;
  reconnectMaxDelayMs?: number;
  maxReconnectAttempts?: number;
  webSocketClass?: any;
  /** Колбэк смены состояния транспорта (для честного отображения статуса в UI). */
  onStateChange?: (state: LiquidationStreamState) => void;
}

/**
 * Общий транспорт фактических ликвидаций (Этап 6).
 * ---------------------------------------------------------------------------
 * Реализует переподключение с экспоненциальной задержкой, keep-alive и честную
 * деградацию: при отсутствии WebSocket/сети состояние → `unavailable`, никаких
 * подстановок. Биржевые различия (URL, подписка, ping, разбор кадра) — в наследниках.
 *
 * Инварианты: только чтение публичных потоков, без ключей, без исполнения.
 */
export abstract class LiquidationStreamTransport {
  public abstract readonly exchangeId: LiquidationExchangeId;
  public abstract readonly exchangeLabel: string;

  protected readonly pipeline: LiquidationPipeline;
  protected readonly wsUrl: string;
  private readonly reconnectInitialDelayMs: number;
  private readonly reconnectMaxDelayMs: number;
  private readonly maxReconnectAttempts: number;
  private readonly webSocketClass: any;
  private readonly onStateChange?: (state: LiquidationStreamState) => void;

  protected ws: any = null;
  private state: LiquidationStreamState = 'idle';
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null;
  private isExplicitlyClosed = false;
  private receivedMessages = 0;
  private networkRecoveryAttached = false;

  constructor(pipeline: LiquidationPipeline, defaultUrl: string, options: LiquidationTransportOptions = {}) {
    this.pipeline = pipeline;
    this.wsUrl = options.wsUrl ?? defaultUrl;
    this.reconnectInitialDelayMs = options.reconnectInitialDelayMs ?? 1500;
    this.reconnectMaxDelayMs = options.reconnectMaxDelayMs ?? 30000;
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? 10;
    this.onStateChange = options.onStateChange;
    // Явный `null` = «транспорта нет»; не подменяется глобальным WebSocket.
    this.webSocketClass =
      options.webSocketClass !== undefined
        ? options.webSocketClass
        : typeof WebSocket !== 'undefined'
          ? WebSocket
          : null;
  }

  /* --- расширяемые точки --- */

  /** Сообщение(я) подписки после открытия сокета (Binance — не требуется). */
  protected subscribeMessages(): string[] {
    return [];
  }

  /** Keep-alive: интервал (мс) и кадр; null — биржа пингует сама. */
  protected keepAlive(): { intervalMs: number; frame: string } | null {
    return null;
  }

  /** Служебный кадр (pong/subscribe ack) — не считать данными. */
  protected isControlFrame(_msg: unknown, _raw: string): boolean {
    return false;
  }

  /** Разбор кадра данных → ingest в конвейер. */
  protected abstract ingest(msg: unknown): void;

  /* --- публичный API --- */

  public getState(): LiquidationStreamState {
    return this.state;
  }

  public getReceivedMessages(): number {
    return this.receivedMessages;
  }

  public get isSupported(): boolean {
    return Boolean(this.webSocketClass);
  }

  /**
   * Предусловие подключения (например, каталог инструментов). Возвращает null, если
   * подготовка не нужна (сокет открывается синхронно), иначе промис; ошибка → unavailable.
   */
  protected prepare(): Promise<void> | null {
    return null;
  }

  public connect(): void {
    if (this.state === 'connected' || this.state === 'connecting') return;
    if (!this.webSocketClass) {
      this.setState('unavailable');
      return;
    }
    this.isExplicitlyClosed = false;
    this.setState(this.reconnectAttempts > 0 ? 'reconnecting' : 'connecting');
    this.attachNetworkRecoveryListeners();

    const prep = this.prepare();
    if (!prep) {
      this.open();
      return;
    }
    prep.then(
      () => {
        if (this.isExplicitlyClosed) return;
        this.open();
      },
      () => {
        this.setState('unavailable');
        this.scheduleReconnect();
      },
    );
  }

  private open(): void {
    try {
      this.ws = new this.webSocketClass(this.wsUrl);
      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
        for (const frame of this.subscribeMessages()) this.send(frame);
        const ka = this.keepAlive();
        if (ka) {
          this.clearKeepAlive();
          this.keepAliveTimer = setInterval(() => this.send(ka.frame), ka.intervalMs);
        }
        this.setState('connected');
      };
      this.ws.onmessage = (event: any) => this.handleMessage(event?.data);
      this.ws.onerror = () => this.setState('unavailable');
      this.ws.onclose = () => {
        this.ws = null;
        this.clearKeepAlive();
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
    this.clearKeepAlive();
    this.detachNetworkRecoveryListeners();
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

  protected send(frame: string): void {
    try {
      this.ws?.send?.(frame);
    } catch {
      /* транспорт закрыт — переподключение сделает своё */
    }
  }

  private clearKeepAlive(): void {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
  }

  private scheduleReconnect(): void {
    // Н6: бесконечный реконнект — раньше после maxReconnectAttempts (~4.5 мин
    // офлайна) поток молча умирал ('unavailable') до перезагрузки страницы.
    // Теперь задержка насыщается на reconnectMaxDelayMs, попытки продолжаются.
    // maxReconnectAttempts = число попыток до насыщения задержки (обратная совместимость опции).
    this.reconnectAttempts += 1;
    const exponent = Math.min(this.reconnectAttempts - 1, Math.max(this.maxReconnectAttempts, 1));
    const delay = Math.min(
      this.reconnectInitialDelayMs * Math.pow(2, exponent),
      this.reconnectMaxDelayMs,
    );
    this.setState('reconnecting');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  /**
   * Н6: возврат из офлайна ('online') или возврат видимости вкладки —
   * мгновенный реконнект без ожидания текущего таймера задержки.
   */
  private readonly handleNetworkRecovery = (): void => {
    if (this.isExplicitlyClosed) return;
    if (this.state === 'connected' || this.state === 'connecting') return;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempts = 0;
    this.connect();
  };

  private readonly handleVisibilityChange = (): void => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
      this.handleNetworkRecovery();
    }
  };

  private attachNetworkRecoveryListeners(): void {
    if (this.networkRecoveryAttached || typeof window === 'undefined' || typeof document === 'undefined') return;
    window.addEventListener('online', this.handleNetworkRecovery);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    this.networkRecoveryAttached = true;
  }

  private detachNetworkRecoveryListeners(): void {
    if (!this.networkRecoveryAttached || typeof window === 'undefined' || typeof document === 'undefined') return;
    window.removeEventListener('online', this.handleNetworkRecovery);
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    this.networkRecoveryAttached = false;
  }

  private handleMessage(dataRaw: any): void {
    if (dataRaw === undefined || dataRaw === null) return;
    try {
      const text = typeof dataRaw === 'string' ? dataRaw : String(dataRaw);
      let msg: unknown;
      try {
        msg = JSON.parse(text);
      } catch {
        msg = text; // текстовые служебные кадры (OKX 'pong')
      }
      if (this.isControlFrame(msg, text)) return;
      if (typeof msg === 'string') return;
      this.receivedMessages += 1;
      this.ingest(msg);
    } catch {
      // Некорректный кадр — игнорируем, не искажая агрегаты
    }
  }

  private setState(state: LiquidationStreamState): void {
    this.state = state;
    this.pipeline.setStreamState(state, this.exchangeId);
    this.onStateChange?.(state);
  }
}

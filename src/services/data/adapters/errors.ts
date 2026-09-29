export type AdapterSource = 'binance' | 'kucoin' | 'alternative.me' | 'defillama' | 'mempool.space' | 'coingecko';

export class AdapterError extends Error {
  constructor(
    message: string,
    public readonly exchange: AdapterSource,
    public readonly status?: number
  ) {
    super(message);
    this.name = 'AdapterError';
  }
}

export class AdapterNetworkError extends AdapterError {
  constructor(exchange: AdapterSource, cause?: Error) {
    super(`Сетевая ошибка при обращении к API ${exchange.toUpperCase()}`, exchange);
    this.name = 'AdapterNetworkError';
    if (cause) this.cause = cause;
  }
}

/**
 * Запрос не был выполнен: SourceHealthTracker временно заблокировал endpoint
 * после систематических неудач (сеть / WAF / rate limit / делистинг инструмента).
 * Наследует AdapterNetworkError, чтобы существующие catch-ветки реагировали
 * как на сетевой отказ («источник недоступен», без подстановок).
 */
export class AdapterSourceBlockedError extends AdapterNetworkError {
  constructor(
    exchange: AdapterSource,
    public readonly endpointKey: string,
    public readonly retryAfterMs: number
  ) {
    super(exchange, new Error(`Endpoint временно заблокирован circuit breaker'ом источника: ${endpointKey}`));
    this.name = 'AdapterSourceBlockedError';
  }
}

export class AdapterTimeoutError extends AdapterError {
  constructor(exchange: AdapterSource) {
    super(`Таймаут запроса к API ${exchange.toUpperCase()}`, exchange);
    this.name = 'AdapterTimeoutError';
  }
}

export class AdapterValidationError extends AdapterError {
  constructor(exchange: AdapterSource, public readonly details: any) {
    super(`Ошибка валидации схемы данных от ${exchange.toUpperCase()}`, exchange);
    this.name = 'AdapterValidationError';
  }
}

export class AdapterRateLimitError extends AdapterError {
  constructor(exchange: AdapterSource, status: number) {
    super(`Превышен лимит запросов к ${exchange.toUpperCase()} (HTTP ${status})`, exchange, status);
    this.name = 'AdapterRateLimitError';
  }
}

/**
 * Инструмент не существует в запрошенном рынке (например, у Spot-тикера нет
 * активного USD-M perpetual, или контракт делистнут). Отличается от сетевого
 * отказа: повтор не поможет, UI показывает «пара не поддерживается», а НЕ
 * подставляет данные другого рынка.
 */
export class UnsupportedMarketSymbolError extends AdapterError {
  constructor(
    public readonly symbol: string,
    public readonly market: 'spot' | 'futures',
  ) {
    super(
      market === 'futures'
        ? `Контракт ${symbol} отсутствует в активной вселенной Binance USD-M`
        : `Инструмент ${symbol} отсутствует в активной вселенной Binance Spot`,
      'binance',
      404,
    );
    this.name = 'UnsupportedMarketSymbolError';
  }
}

export class SymbolNotFoundError extends AdapterError {
  constructor(exchange: AdapterSource, public readonly symbol: string) {
    super(`Инструмент ${symbol} не поддерживается на ${exchange.toUpperCase()}`, exchange, 404);
    this.name = 'SymbolNotFoundError';
  }
}

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

export class SymbolNotFoundError extends AdapterError {
  constructor(exchange: AdapterSource, public readonly symbol: string) {
    super(`Инструмент ${symbol} не поддерживается на ${exchange.toUpperCase()}`, exchange, 404);
    this.name = 'SymbolNotFoundError';
  }
}

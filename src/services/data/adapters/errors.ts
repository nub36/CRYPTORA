export class AdapterError extends Error {
  constructor(
    message: string,
    public readonly exchange: 'binance' | 'kucoin',
    public readonly status?: number
  ) {
    super(message);
    this.name = 'AdapterError';
  }
}

export class AdapterNetworkError extends AdapterError {
  constructor(exchange: 'binance' | 'kucoin', cause?: Error) {
    super(`Сетевая ошибка при обращении к API ${exchange.toUpperCase()}`, exchange);
    this.name = 'AdapterNetworkError';
    if (cause) this.cause = cause;
  }
}

export class AdapterTimeoutError extends AdapterError {
  constructor(exchange: 'binance' | 'kucoin') {
    super(`Таймаут запроса к API ${exchange.toUpperCase()}`, exchange);
    this.name = 'AdapterTimeoutError';
  }
}

export class AdapterValidationError extends AdapterError {
  constructor(exchange: 'binance' | 'kucoin', public readonly details: any) {
    super(`Ошибка валидации схемы данных от ${exchange.toUpperCase()}`, exchange);
    this.name = 'AdapterValidationError';
  }
}

export class AdapterRateLimitError extends AdapterError {
  constructor(exchange: 'binance' | 'kucoin', status: number) {
    super(`Превышен лимит запросов к ${exchange.toUpperCase()} (HTTP ${status})`, exchange, status);
    this.name = 'AdapterRateLimitError';
  }
}

export class SymbolNotFoundError extends AdapterError {
  constructor(exchange: 'binance' | 'kucoin', public readonly symbol: string) {
    super(`Инструмент ${symbol} не поддерживается на ${exchange.toUpperCase()}`, exchange, 404);
    this.name = 'SymbolNotFoundError';
  }
}

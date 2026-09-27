export interface BinanceRadarTickerStreamStatus {
  state: string;
  subscribedSymbols: number;
  lastMessageAt: string | null;
  stale: boolean;
  reconnectAttempt: number;
}

export interface BinanceRadarTickerStreamOptions {
  onTick: (tick: any) => void;
  onStateChange?: (status: BinanceRadarTickerStreamStatus & { error?: unknown }) => void;
  WebSocketClass?: any;
  url?: string;
  staleAfterMs?: number;
  heartbeatCheckMs?: number;
  reconnectMinMs?: number;
  reconnectMaxMs?: number;
}

export class BinanceRadarTickerStream {
  constructor(options: BinanceRadarTickerStreamOptions);
  setSymbols(symbols: readonly string[]): void;
  getStatus(): BinanceRadarTickerStreamStatus;
  stop(): void;
  isOpen(): boolean;
}

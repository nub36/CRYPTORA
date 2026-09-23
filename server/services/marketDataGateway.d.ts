export interface MarketDataGatewayResult {
  status: number;
  body: unknown;
  cacheSeconds?: number;
}

export function requestMarketData(
  routePath: string,
  query: URLSearchParams,
  options?: { fetchFn?: typeof fetch; timeoutMs?: number },
): Promise<MarketDataGatewayResult>;

export const marketDataGatewayRoutes: readonly string[];

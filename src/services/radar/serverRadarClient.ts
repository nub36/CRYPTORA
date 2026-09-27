import { RadarEvent, RadarEventSchema } from '@/types/market';

export type ServerRadarLifecycle = 'stopped' | 'unavailable' | 'idle' | 'warming' | 'live' | 'feed-stale' | 'feed-disconnected';

/** Bounded public categories; raw provider/database exception text never crosses /api/radar/status. */
export type ServerRadarErrorCode =
  | 'STARTUP_ERROR'
  | 'UNIVERSE_UNAVAILABLE'
  | 'UNIVERSE_REFRESH_ERROR'
  | 'MARKET_FEED_ERROR'
  | 'PERSISTENCE_ERROR'
  | 'RETENTION_CLEANUP_ERROR'
  | 'INTERNAL_ERROR';

export interface ServerRadarStatus {
  source: 'server';
  running: boolean;
  lifecycle: ServerRadarLifecycle;
  configuredUniverseCount: number;
  activeUniverseCount: number;
  inactiveUniverseCount: number;
  activeUniverseKnown: boolean;
  detector: {
    windowSize: number;
    trackedSymbols: number;
    warmedSymbols: number;
    maxObservations: number;
    warm: boolean;
    symbols: Array<{
      symbol: string;
      volumeObservations: number;
      priceObservations: number;
      rangeObservations: number;
      observationCount: number;
      maxObservationCount: number;
      warmed: boolean;
    }>;
  };
  marketFeed: {
    state: string;
    subscribedSymbols: number;
    lastMessageAt: string | null;
    stale: boolean;
    reconnectAttempt: number;
    source: 'binance-spot-ticker';
  };
  startedAt: string | null;
  lastUniverseRefreshAt: string | null;
  lastPersistedEventAt: string | null;
  persistedEvents: number;
  deduplicatedEvents: number;
  retainedDeletes: number;
  /** null means automatic retention was explicitly disabled with env value 0. */
  retentionDays: number | null;
  errorCode: ServerRadarErrorCode | null;
}

function assertResponse(response: Response): Response {
  if (!response.ok) throw new Error(`Radar API HTTP ${response.status}`);
  return response;
}

export async function fetchServerRadarEvents(
  { limit = 100, symbol }: { limit?: number; symbol?: string } = {},
  fetchFn: typeof fetch = (...args) => globalThis.fetch(...args),
): Promise<RadarEvent[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (symbol) params.set('symbol', symbol);
  const body = await assertResponse(await fetchFn(`/api/radar/events?${params}`, {
    credentials: 'include',
    headers: { Accept: 'application/json' },
  })).json() as { events?: unknown; source?: unknown };
  if (body.source !== 'server' || !Array.isArray(body.events)) throw new Error('Invalid Radar history response');
  return body.events.map((event) => RadarEventSchema.parse(event));
}

export async function fetchServerRadarStatus(
  fetchFn: typeof fetch = (...args) => globalThis.fetch(...args),
): Promise<ServerRadarStatus> {
  const body = await assertResponse(await fetchFn('/api/radar/status', {
    credentials: 'include',
    headers: { Accept: 'application/json' },
  })).json() as Partial<ServerRadarStatus>;
  if (body.source !== 'server' || typeof body.lifecycle !== 'string' || !body.detector || !body.marketFeed) {
    throw new Error('Invalid Radar status response');
  }
  return body as ServerRadarStatus;
}

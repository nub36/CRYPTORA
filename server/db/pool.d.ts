/**
 * Type declarations for server/db/pool.js (plain-JS module).
 */

export interface QueryResult<T = unknown> {
  rows: T[];
  rowCount: number;
}

export interface PoolLike {
  query: (text: string, params?: unknown[]) => Promise<QueryResult>;
  end?: () => Promise<void>;
  connect?: () => Promise<unknown>;
  on?: (event: 'error', listener: (err: Error) => void) => unknown;
  totalCount?: number;
  idleCount?: number;
}

/** Structured, secret-free description of an idle-client pool error. */
export interface PoolErrorEntry {
  event: 'pg_pool_idle_client_error';
  code: string | null;
  severity: string | null;
  message: string;
  /** `57P01 admin_shutdown` and friends: the server dropped an idle client. */
  recoverable: boolean;
  poolTotal: number | null;
  poolIdle: number | null;
}

export declare function formatPoolError(
  err: unknown,
  meta?: { poolTotal?: number; poolIdle?: number }
): PoolErrorEntry;

/**
 * Attaches the idle-client `'error'` listener that keeps a backend FATAL
 * (e.g. `57P01 admin_shutdown` after a Postgres restart) from terminating the
 * Node process. Exported so it can be tested without a real database.
 */
export declare function attachPoolErrorHandlers<T extends PoolLike>(
  pool: T,
  log?: (entry: PoolErrorEntry) => void
): T;

export declare function getPool(): PoolLike;
export declare function query(text: string, params?: unknown[]): Promise<QueryResult>;
export declare function getClient(): Promise<unknown>;
export declare function checkDatabase(): Promise<boolean>;
/** Terminal + idempotent: after this, `getPool()` throws instead of re-opening. */
export declare function closePool(): Promise<void>;
export declare function isPoolClosed(): boolean;

/** Test seam — replace the pool. Production code never calls this. */
export declare function __setPoolForTests(injected: PoolLike | null): void;

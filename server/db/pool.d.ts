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
}

export declare function getPool(): PoolLike;
export declare function query(text: string, params?: unknown[]): Promise<QueryResult>;
export declare function getClient(): Promise<unknown>;
export declare function checkDatabase(): Promise<boolean>;
export declare function closePool(): Promise<void>;

/** Test seam — replace the pool. Production code never calls this. */
export declare function __setPoolForTests(injected: PoolLike | null): void;

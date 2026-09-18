/**
 * CRYPTORA — PostgreSQL Connection Pool
 *
 * Singleton pg.Pool. All queries go through parameterized SQL — never string interpolation.
 */

import pg from 'pg';
import { config } from '../config.js';

const { Pool } = pg;

let pool;

export function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: config.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      ssl: config.NODE_ENV === 'production' && config.DATABASE_URL.includes('sslmode')
        ? { rejectUnauthorized: false }
        : false,
    });
  }
  return pool;
}

export async function query(text, params) {
  const p = getPool();
  return p.query(text, params);
}

export async function getClient() {
  const p = getPool();
  return p.connect();
}

/**
 * Health check: verify DB connectivity.
 * @returns {Promise<boolean>}
 */
export async function checkDatabase() {
  try {
    const p = getPool();
    await p.query('SELECT 1 AS ok');
    return true;
  } catch {
    return false;
  }
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
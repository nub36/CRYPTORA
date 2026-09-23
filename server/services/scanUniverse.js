/**
 * CRYPTORA — Scan Universe repository (server-side, PostgreSQL).
 *
 * Site availability = all active Binance Spot USDT instruments (exchangeInfo).
 * Scan universe     = the subset the signal engine evaluates (this table).
 *
 * The effective scan list is ALWAYS `saved ∩ activeSpot`: an instrument that
 * stopped trading is never scanned even if it is still stored.
 */

import { query, getClient } from '../db/pool.js';
import { getActiveSpotBaseSet } from './exchangeUniverse.js';

/** Hard cap: a 60-second cycle cannot honestly cover more. */
export const SCAN_UNIVERSE_MAX = 100;
const SYMBOL_RE = /^[A-Z0-9]{1,20}$/;

/** 'btc', 'BTC/USDT', 'BTCUSDT' → 'BTC'. Garbage → null. */
export function normalizeScanSymbol(raw) {
  if (typeof raw !== 'string') return null;
  let s = raw.trim().toUpperCase();
  if (s.includes('/')) s = s.split('/')[0].trim();
  if (s.length > 4 && s.endsWith('USDT')) s = s.slice(0, -4);
  return SYMBOL_RE.test(s) ? s : null;
}

export async function listSavedScanSymbols() {
  const { rows } = await query('SELECT symbol FROM scan_universe ORDER BY added_at, symbol');
  return rows.map((r) => r.symbol);
}

/**
 * @param {{ activeSet?: Set<string> | null }} [opts] injection for tests
 * @returns {Promise<{ saved: string[], effective: string[], inactive: string[], activeKnown: boolean, activeCount: number | null }>}
 */
export async function getScanUniverseState(opts = {}) {
  const [saved, activeSet] = await Promise.all([
    listSavedScanSymbols(),
    opts.activeSet !== undefined ? Promise.resolve(opts.activeSet) : getActiveSpotBaseSet(),
  ]);
  if (!activeSet) {
    return { saved, effective: [], inactive: [], activeKnown: false, activeCount: null };
  }
  const effective = saved.filter((s) => activeSet.has(s));
  const inactive = saved.filter((s) => !activeSet.has(s));
  return { saved, effective, inactive, activeKnown: true, activeCount: activeSet.size };
}

/**
 * Symbols the SERVER engine should scan, as Binance exchange symbols
 * ('BTCUSDT'), because the server candle fetcher talks to Binance directly.
 * Throws when the active universe is unknown: scanning an unverified list
 * could hit delisted instruments.
 */
export async function getEffectiveScanExchangeSymbols(opts = {}) {
  const state = await getScanUniverseState(opts);
  if (!state.activeKnown) {
    const err = new Error('Active Spot universe (exchangeInfo) unavailable — scan skipped');
    /** @type {any} */ (err).code = 'MARKET_DATA_UNAVAILABLE';
    throw err;
  }
  return state.effective.map((s) => `${s}USDT`);
}

function httpError(message, statusCode) {
  const err = new Error(message);
  /** @type {any} */ (err).statusCode = statusCode;
  return err;
}

async function writeWithAudit(actorUserId, action, symbol, sql, params) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const res = await client.query(sql, params);
    if (res.rowCount > 0) {
      await client.query(
        `INSERT INTO audit_log (actor_user_id, action, target_type, target_id, metadata)
         VALUES ($1, $2, 'scan_universe', $3, $4)`,
        [actorUserId, action, symbol, JSON.stringify({ symbol })]
      );
    }
    await client.query('COMMIT');
    return res.rowCount > 0;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Add an ACTIVE Spot instrument to the scan universe.
 * @param {{ symbol: unknown, actorUserId: string, activeSet?: Set<string> | null }} p
 */
export async function addScanSymbol({ symbol: raw, actorUserId, activeSet }) {
  const symbol = normalizeScanSymbol(raw);
  if (!symbol) throw httpError('Некорректный тикер', 400);
  const active = activeSet !== undefined ? activeSet : await getActiveSpotBaseSet();
  if (!active) throw httpError('Список активных инструментов Binance временно недоступен', 503);
  if (!active.has(symbol)) throw httpError(`${symbol} не торгуется на Binance Spot против USDT`, 400);
  const saved = await listSavedScanSymbols();
  if (saved.includes(symbol)) return { symbol, added: false };
  if (saved.length >= SCAN_UNIVERSE_MAX) throw httpError(`Лимит — ${SCAN_UNIVERSE_MAX} инструментов в скане`, 409);
  const added = await writeWithAudit(
    actorUserId, 'SCAN_UNIVERSE_ADD', symbol,
    `INSERT INTO scan_universe (symbol, added_by) VALUES ($1, $2) ON CONFLICT (symbol) DO NOTHING`,
    [symbol, actorUserId]
  );
  return { symbol, added };
}

/** Remove an instrument (active or not) from the scan universe. */
export async function removeScanSymbol({ symbol: raw, actorUserId }) {
  const symbol = normalizeScanSymbol(raw);
  if (!symbol) throw httpError('Некорректный тикер', 400);
  const removed = await writeWithAudit(
    actorUserId, 'SCAN_UNIVERSE_REMOVE', symbol,
    'DELETE FROM scan_universe WHERE symbol = $1',
    [symbol]
  );
  return { symbol, removed };
}

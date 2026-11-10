/**
 * Собственная база продукта V3.4 (SQLite через встроенный `node:sqlite`).
 *
 * Почему отдельная БД и отдельный файл: новый продукт не имеет права читать или
 * писать данные старого CRYPTORA. Здесь живут только его собственные сигналы,
 * события и подписки на push.
 *
 * Свойства схемы:
 *   • дедупликация сигналов на уровне БД: UNIQUE(strategy, symbol, timeframe,
 *     setup_open_time) — повторный скан того же закрытого бара не создаёт второй
 *     сигнал;
 *   • события дедуплицируются PK(signal_id, event_type): push уходит ровно один
 *     раз, даже после рестарта и гонки воркеров;
 *   • WAL + busy_timeout: сервер переживает рестарт без потери данных и без
 *     блокировок на чтении;
 *   • миграции только аддитивные и идемпотентные.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const SIGNAL_STATUSES = Object.freeze([
  'ACTIVE', 'FILLED', 'TARGET_REACHED', 'INVALIDATED', 'CLOSED', 'EXPIRED', 'CANCELLED', 'UNRESOLVED',
] as const);
export type SignalStatus = (typeof SIGNAL_STATUSES)[number];
export const OPEN_SIGNAL_STATUSES = Object.freeze(['ACTIVE', 'FILLED'] as const);
export const CLOSED_SIGNAL_STATUSES = Object.freeze([
  'TARGET_REACHED', 'INVALIDATED', 'CLOSED', 'EXPIRED', 'CANCELLED', 'UNRESOLVED',
] as const);
export const NO_TRADE_STATUSES = Object.freeze(['EXPIRED', 'CANCELLED', 'UNRESOLVED'] as const);
export const TRADE_CLOSED_STATUSES = Object.freeze(['TARGET_REACHED', 'INVALIDATED', 'CLOSED'] as const);

export const EVENT_TYPES = Object.freeze([
  'NEW_SIGNAL', 'FILL', 'TP1', 'TP2', 'BREAKEVEN', 'STOP_LOSS', 'CLOSED', 'CANCELLED',
] as const);
export type SignalEventType = (typeof EVENT_TYPES)[number];

const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'signals, events, devices, scan status',
    sql: `
      CREATE TABLE IF NOT EXISTS signals (
        id                TEXT PRIMARY KEY,
        strategy_id       TEXT NOT NULL,
        strategy_version  TEXT NOT NULL,
        symbol            TEXT NOT NULL,
        exchange_symbol   TEXT NOT NULL,
        timeframe         TEXT NOT NULL,
        direction         TEXT NOT NULL CHECK (direction IN ('LONG', 'SHORT')),
        setup_open_time   INTEGER NOT NULL,
        entry_min         REAL,
        entry_max         REAL,
        stop_loss         REAL,
        tp1               REAL,
        tp2               REAL,
        status            TEXT NOT NULL CHECK (status IN (
                            'ACTIVE','FILLED','TARGET_REACHED','INVALIDATED',
                            'CLOSED','EXPIRED','CANCELLED','UNRESOLVED')),
        created_at        TEXT NOT NULL,
        updated_at        TEXT NOT NULL,
        filled_at         TEXT,
        fill_price        REAL,
        closed_at         TEXT,
        close_price       REAL,
        close_reason      TEXT,
        result_r          REAL,
        net_result_r      REAL,
        pnl_result_pct    REAL,
        bars_held         INTEGER,
        risk_reward_ratio REAL,
        data_source       TEXT,
        metadata          TEXT,
        UNIQUE (strategy_id, symbol, timeframe, setup_open_time)
      );
      CREATE INDEX IF NOT EXISTS idx_signals_created_at ON signals (created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_signals_status ON signals (status, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_signals_symbol ON signals (symbol, created_at DESC);

      CREATE TABLE IF NOT EXISTS signal_events (
        signal_id   TEXT NOT NULL,
        event_type  TEXT NOT NULL CHECK (event_type IN (
                      'NEW_SIGNAL','FILL','TP1','TP2','BREAKEVEN','STOP_LOSS','CLOSED','CANCELLED')),
        occurred_at TEXT,
        created_at  TEXT NOT NULL,
        detail      TEXT,
        PRIMARY KEY (signal_id, event_type)
      );

      CREATE TABLE IF NOT EXISTS devices (
        token        TEXT PRIMARY KEY,
        platform     TEXT NOT NULL DEFAULT 'android',
        enabled      INTEGER NOT NULL DEFAULT 1,
        created_at   TEXT NOT NULL,
        last_seen_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS scan_runs (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at    TEXT NOT NULL,
        finished_at   TEXT,
        status        TEXT NOT NULL DEFAULT 'RUNNING',
        symbols_total INTEGER NOT NULL DEFAULT 0,
        symbols_ok    INTEGER NOT NULL DEFAULT 0,
        signals_new   INTEGER NOT NULL DEFAULT 0,
        error         TEXT
      );

      CREATE TABLE IF NOT EXISTS symbol_status (
        exchange_symbol    TEXT PRIMARY KEY,
        last_scan_at       TEXT,
        last_success_at    TEXT,
        last_bar_open_time INTEGER,
        closed_1h          INTEGER NOT NULL DEFAULT 0,
        closed_4h          INTEGER NOT NULL DEFAULT 0,
        gaps_1h            INTEGER NOT NULL DEFAULT 0,
        data_error         TEXT,
        source             TEXT,
        notes              TEXT
      );

      CREATE TABLE IF NOT EXISTS push_delivery (
        signal_id     TEXT NOT NULL,
        event_type    TEXT NOT NULL,
        device_token  TEXT NOT NULL,
        attempted_at  TEXT NOT NULL,
        status        TEXT NOT NULL,
        error_code    TEXT,
        PRIMARY KEY (signal_id, event_type, device_token)
      );
    `,
  },
];

/** Открыть БД, включить безопасные PRAGMA и применить миграции. */
export function openDatabase(file: string): DatabaseSync {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA synchronous = NORMAL;');
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec('PRAGMA foreign_keys = ON;');
  migrate(db);
  return db;
}

export function migrate(db: DatabaseSync): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  );`);
  const applied = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]).map((r) => r.version),
  );
  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue;
    db.exec('BEGIN');
    try {
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
        .run(m.version, m.name, new Date().toISOString());
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
}

/** Схема применена и БД отвечает — для /health. */
export function databaseReady(db: DatabaseSync): boolean {
  try {
    const row = db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get() as { n: number } | undefined;
    return (row?.n ?? 0) > 0;
  } catch {
    return false;
  }
}

export type Database = DatabaseSync;

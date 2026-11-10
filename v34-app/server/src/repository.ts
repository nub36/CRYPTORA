/**
 * Репозиторий сигналов продукта V3.4.
 *
 * Здесь только данные: никакой торговой математики. Все уровни, исходы и
 * прогресс приходят из frozen-ядра (`@v34/core`) и сохраняются как есть.
 *
 * Запись устойчива к рестарту и повторному скану:
 *   • сигнал дедуплицируется UNIQUE-ключом;
 *   • событие — PRIMARY KEY (signal_id, event_type), запись идёт через
 *     `INSERT … ON CONFLICT DO NOTHING`, и только победивший вызов получает
 *     `recorded = true` (значит push отправляется ровно один раз).
 */
import type { DatabaseSync } from 'node:sqlite';
import type { PublishedSignal, SignalEventType, SignalStatus } from './types';
import { EVENT_TYPES, OPEN_SIGNAL_STATUSES } from './db';

export interface SignalRow {
  id: string;
  strategy_id: string;
  strategy_version: string;
  symbol: string;
  exchange_symbol: string;
  timeframe: string;
  direction: 'LONG' | 'SHORT';
  setup_open_time: number;
  entry_min: number | null;
  entry_max: number | null;
  stop_loss: number | null;
  tp1: number | null;
  tp2: number | null;
  status: SignalStatus;
  created_at: string;
  updated_at: string;
  filled_at: string | null;
  fill_price: number | null;
  closed_at: string | null;
  close_price: number | null;
  close_reason: string | null;
  result_r: number | null;
  net_result_r: number | null;
  pnl_result_pct: number | null;
  bars_held: number | null;
  risk_reward_ratio: number | null;
  data_source: string | null;
  metadata: string | null;
}

export interface EventRow {
  signal_id: string;
  event_type: SignalEventType;
  occurred_at: string | null;
  created_at: string;
  detail: string | null;
}

export interface NewSignalInput {
  id: string;
  strategyId: string;
  strategyVersion: string;
  symbol: string;
  exchangeSymbol: string;
  timeframe: string;
  direction: 'LONG' | 'SHORT';
  setupOpenTime: number;
  entryMin: number | null;
  entryMax: number | null;
  stopLoss: number | null;
  tp1: number | null;
  tp2: number | null;
  riskRewardRatio: number | null;
  dataSource: { exchange: string; isFallback: boolean } | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export const MAX_LIMIT = 200;
export const DEFAULT_LIMIT = 50;

export class SignalRepository {
  constructor(private readonly db: DatabaseSync) {}

  /** Вставка сигнала. false — такой сигнал уже был (дедупликация БД). */
  insertSignal(input: NewSignalInput): boolean {
    const stmt = this.db.prepare(`
      INSERT INTO signals (
        id, strategy_id, strategy_version, symbol, exchange_symbol, timeframe, direction,
        setup_open_time, entry_min, entry_max, stop_loss, tp1, tp2, status,
        created_at, updated_at, risk_reward_ratio, data_source, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?)
      ON CONFLICT (strategy_id, symbol, timeframe, setup_open_time) DO NOTHING
    `);
    const res = stmt.run(
      input.id, input.strategyId, input.strategyVersion, input.symbol, input.exchangeSymbol,
      input.timeframe, input.direction, input.setupOpenTime, input.entryMin, input.entryMax,
      input.stopLoss, input.tp1, input.tp2, input.createdAt, input.createdAt,
      input.riskRewardRatio, input.dataSource ? JSON.stringify(input.dataSource) : null,
      JSON.stringify(input.metadata ?? {}),
    );
    return Number(res.changes) > 0;
  }

  getById(id: string): SignalRow | null {
    const row = this.db.prepare('SELECT * FROM signals WHERE id = ?').get(id) as SignalRow | undefined;
    return row ?? null;
  }

  listSignals(filter: {
    status?: string[];
    symbol?: string;
    direction?: 'LONG' | 'SHORT';
    limit?: number;
    cursor?: { createdAt: string; id: string } | null;
  } = {}): SignalRow[] {
    const where: string[] = [];
    const args: (string | number)[] = [];
    const statuses = filter.status ?? [];
    if (statuses.length > 0) {
      where.push(`status IN (${statuses.map(() => '?').join(',')})`);
      args.push(...statuses);
    }
    if (filter.symbol) {
      where.push('(symbol = ? OR exchange_symbol = ?)');
      args.push(filter.symbol, filter.symbol);
    }
    if (filter.direction) {
      where.push('direction = ?');
      args.push(filter.direction);
    }
    if (filter.cursor) {
      where.push('(created_at < ? OR (created_at = ? AND id < ?))');
      args.push(filter.cursor.createdAt, filter.cursor.createdAt, filter.cursor.id);
    }
    const limit = Math.min(MAX_LIMIT, Math.max(1, filter.limit ?? DEFAULT_LIMIT));
    const sql = `SELECT * FROM signals ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
                 ORDER BY created_at DESC, id DESC LIMIT ?`;
    return this.db.prepare(sql).all(...args, limit) as unknown as SignalRow[];
  }

  countSignals(filter: { status?: string[]; symbol?: string; direction?: 'LONG' | 'SHORT' } = {}): number {
    const where: string[] = [];
    const args: string[] = [];
    if (filter.status?.length) {
      where.push(`status IN (${filter.status.map(() => '?').join(',')})`);
      args.push(...filter.status);
    }
    if (filter.symbol) {
      where.push('(symbol = ? OR exchange_symbol = ?)');
      args.push(filter.symbol, filter.symbol);
    }
    if (filter.direction) {
      where.push('direction = ?');
      args.push(filter.direction);
    }
    const sql = `SELECT COUNT(*) AS n FROM signals ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`;
    const row = this.db.prepare(sql).get(...args) as { n: number };
    return row.n;
  }

  /** Открытые (ACTIVE/FILLED) сигналы символа — рабочий набор для ведения. */
  openSignalsForSymbol(exchangeSymbol: string): SignalRow[] {
    const sql = `SELECT * FROM signals WHERE exchange_symbol = ?
                 AND status IN (${OPEN_SIGNAL_STATUSES.map(() => '?').join(',')})
                 ORDER BY setup_open_time ASC`;
    return this.db.prepare(sql).all(exchangeSymbol, ...OPEN_SIGNAL_STATUSES) as unknown as SignalRow[];
  }

  updateLifecycle(
    id: string,
    patch: {
      status: SignalStatus;
      filledAt?: string | null;
      fillPrice?: number | null;
      closedAt?: string | null;
      closePrice?: number | null;
      closeReason?: string | null;
      resultR?: number | null;
      netResultR?: number | null;
      pnlResultPct?: number | null;
      barsHeld?: number | null;
    },
    updatedAt: string,
  ): void {
    const fields: string[] = [];
    const args: (string | number | null)[] = [];
    const map: Record<string, string> = {
      filledAt: 'filled_at',
      fillPrice: 'fill_price',
      closedAt: 'closed_at',
      closePrice: 'close_price',
      closeReason: 'close_reason',
      resultR: 'result_r',
      netResultR: 'net_result_r',
      pnlResultPct: 'pnl_result_pct',
      barsHeld: 'bars_held',
    };
    for (const [key, column] of Object.entries(map)) {
      const value = (patch as Record<string, unknown>)[key];
      if (value === undefined) continue;
      fields.push(`${column} = ?`);
      args.push(value as string | number | null);
    }
    fields.push('status = ?', 'updated_at = ?');
    args.push(patch.status, updatedAt, id);
    this.db.prepare(`UPDATE signals SET ${fields.join(', ')} WHERE id = ?`).run(...args);
  }

  /** Записать событие. recorded=true только у первого писателя. */
  recordEvent(signalId: string, eventType: SignalEventType, occurredAt: string | null, detail: unknown = null): boolean {
    if (!EVENT_TYPES.includes(eventType)) throw new Error(`unknown event type ${eventType}`);
    const res = this.db
      .prepare(`INSERT INTO signal_events (signal_id, event_type, occurred_at, created_at, detail)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT (signal_id, event_type) DO NOTHING`)
      .run(signalId, eventType, occurredAt, new Date().toISOString(), detail ? JSON.stringify(detail) : null);
    return Number(res.changes) > 0;
  }

  eventsOf(signalId: string): EventRow[] {
    return this.db
      .prepare('SELECT * FROM signal_events WHERE signal_id = ? ORDER BY created_at ASC, event_type ASC')
      .all(signalId) as unknown as EventRow[];
  }

  eventsOfMany(signalIds: readonly string[]): Map<string, EventRow[]> {
    const map = new Map<string, EventRow[]>();
    if (signalIds.length === 0) return map;
    const placeholders = signalIds.map(() => '?').join(',');
    const rows = this.db
      .prepare(`SELECT * FROM signal_events WHERE signal_id IN (${placeholders}) ORDER BY created_at ASC`)
      .all(...signalIds) as unknown as EventRow[];
    for (const row of rows) {
      const list = map.get(row.signal_id) ?? [];
      list.push(row);
      map.set(row.signal_id, list);
    }
    return map;
  }

  /* ── Устройства для push ─────────────────────────────────────────────── */

  upsertDevice(token: string, platform: string, nowIso: string): void {
    this.db.prepare(`
      INSERT INTO devices (token, platform, enabled, created_at, last_seen_at)
      VALUES (?, ?, 1, ?, ?)
      ON CONFLICT (token) DO UPDATE SET enabled = 1, last_seen_at = excluded.last_seen_at, platform = excluded.platform
    `).run(token, platform, nowIso, nowIso);
  }

  hasDevice(token: string): boolean {
    const row = this.db.prepare('SELECT 1 AS x FROM devices WHERE token = ?').get(token);
    return row !== undefined;
  }

  /**
   * Удаление устаревших/отключённых регистраций.
   *
   * Нужно, чтобы публичная регистрация не превращалась в бесконечный рост БД:
   * токены, которые давно не обновлялись (приложение удалено/переустановлено),
   * удаляются. Возвращает число удалённых строк.
   */
  pruneDevices(olderThanIso: string): number {
    const res = this.db.prepare('DELETE FROM devices WHERE last_seen_at < ?').run(olderThanIso);
    return Number(res.changes);
  }

  disableDevice(token: string): void {
    this.db.prepare('UPDATE devices SET enabled = 0 WHERE token = ?').run(token);
  }

  enabledDevices(): { token: string; platform: string }[] {
    return this.db.prepare('SELECT token, platform FROM devices WHERE enabled = 1').all() as unknown as {
      token: string;
      platform: string;
    }[];
  }

  countDevices(): { enabled: number; total: number } {
    const total = (this.db.prepare('SELECT COUNT(*) AS n FROM devices').get() as { n: number }).n;
    const enabled = (this.db.prepare('SELECT COUNT(*) AS n FROM devices WHERE enabled = 1').get() as { n: number }).n;
    return { enabled, total };
  }

  recordPushDelivery(signalId: string, eventType: string, token: string, status: string, errorCode: string | null): void {
    this.db.prepare(`
      INSERT INTO push_delivery (signal_id, event_type, device_token, attempted_at, status, error_code)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (signal_id, event_type, device_token) DO UPDATE SET
        attempted_at = excluded.attempted_at, status = excluded.status, error_code = excluded.error_code
    `).run(signalId, eventType, token, new Date().toISOString(), status, errorCode);
  }

  /* ── Сканы и статус источников ───────────────────────────────────────── */

  startScan(startedAt: string, symbolsTotal: number): number {
    const res = this.db
      .prepare("INSERT INTO scan_runs (started_at, status, symbols_total) VALUES (?, 'RUNNING', ?)")
      .run(startedAt, symbolsTotal);
    return Number(res.lastInsertRowid);
  }

  finishScan(id: number, patch: {
    finishedAt: string;
    status: 'OK' | 'PARTIAL' | 'FAILED';
    symbolsOk: number;
    signalsNew: number;
    error: string | null;
  }): void {
    this.db.prepare(`
      UPDATE scan_runs SET finished_at = ?, status = ?, symbols_ok = ?, signals_new = ?, error = ?
      WHERE id = ?
    `).run(patch.finishedAt, patch.status, patch.symbolsOk, patch.signalsNew, patch.error, id);
  }

  lastScan(): {
    id: number; started_at: string; finished_at: string | null; status: string;
    symbols_total: number; symbols_ok: number; signals_new: number; error: string | null;
  } | null {
    const row = this.db.prepare('SELECT * FROM scan_runs ORDER BY id DESC LIMIT 1').get();
    return (row as ReturnType<SignalRepository['lastScan']> extends infer T ? T : never) ?? null;
  }

  lastSuccessfulScanAt(): string | null {
    const row = this.db
      .prepare("SELECT finished_at FROM scan_runs WHERE status IN ('OK','PARTIAL') ORDER BY id DESC LIMIT 1")
      .get() as { finished_at: string | null } | undefined;
    return row?.finished_at ?? null;
  }

  upsertSymbolStatus(row: {
    exchangeSymbol: string;
    lastScanAt: string;
    lastSuccessAt: string | null;
    lastBarOpenTime: number | null;
    closed1h: number;
    closed4h: number;
    gaps1h: number;
    dataError: string | null;
    source: string | null;
    notes: string[];
  }): void {
    this.db.prepare(`
      INSERT INTO symbol_status (exchange_symbol, last_scan_at, last_success_at, last_bar_open_time,
        closed_1h, closed_4h, gaps_1h, data_error, source, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (exchange_symbol) DO UPDATE SET
        last_scan_at = excluded.last_scan_at,
        last_success_at = COALESCE(excluded.last_success_at, symbol_status.last_success_at),
        last_bar_open_time = excluded.last_bar_open_time,
        closed_1h = excluded.closed_1h,
        closed_4h = excluded.closed_4h,
        gaps_1h = excluded.gaps_1h,
        data_error = excluded.data_error,
        source = excluded.source,
        notes = excluded.notes
    `).run(
      row.exchangeSymbol, row.lastScanAt, row.lastSuccessAt, row.lastBarOpenTime,
      row.closed1h, row.closed4h, row.gaps1h, row.dataError, row.source, JSON.stringify(row.notes),
    );
  }

  symbolStatuses(): {
    exchange_symbol: string; last_scan_at: string | null; last_success_at: string | null;
    last_bar_open_time: number | null; closed_1h: number; closed_4h: number; gaps_1h: number;
    data_error: string | null; source: string | null; notes: string | null;
  }[] {
    return this.db.prepare('SELECT * FROM symbol_status ORDER BY exchange_symbol ASC').all() as never;
  }
}

/** Строка БД → вход ведения сигнала (PublishedSignal ядра). */
export function toPublishedSignal(row: SignalRow): PublishedSignal {
  const targets = [row.tp1, row.tp2].filter((t): t is number => typeof t === 'number');
  return {
    strategyId: row.strategy_id,
    direction: row.direction,
    setupOpenTime: row.setup_open_time,
    entryType: 'LIMIT_CORRIDOR',
    entryZone: [
      row.entry_min ?? Number.NaN,
      row.entry_max ?? Number.NaN,
    ],
    invalidationLevel: row.stop_loss ?? Number.NaN,
    targets,
  };
}

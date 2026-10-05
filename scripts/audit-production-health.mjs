#!/usr/bin/env node
/**
 * CRYPTORA — READ-ONLY диагностика production-здоровья.
 *
 *   npm run audit:production-health
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ КОНТРАКТ БЕЗОПАСНОСТИ — обеспечен кодом, а не обещанием                  ║
 * ║                                                                          ║
 * ║  • Единственная транзакция: `BEGIN READ ONLY` … `ROLLBACK`. Перед        ║
 * ║    первым запросом читается `SHOW transaction_read_only`; если сервер    ║
 * ║    не подтвердил 'on', скрипт завершается с ошибкой.                     ║
 * ║  • Каждый SQL проходит через `sel()`: разрешены только SELECT/WITH/SHOW. ║
 * ║    INSERT/UPDATE/DELETE/ALTER/CREATE/DROP/TRUNCATE/COPY/GRANT до         ║
 * ║    сервера не доходят — процесс падает раньше.                           ║
 * ║  • `statement_timeout` и `idle_in_transaction_session_timeout` через     ║
 * ║    SET LOCAL: зависший аудит не держит production-базу.                  ║
 * ║  • Отдельный `pg.Client`, а не пул приложения.                           ║
 * ║  • Ни одного сетевого запроса к биржам: свежесть рыночных данных         ║
 * ║    оценивается по СЛЕДАМ В БД (события радара, проверки монитора).       ║
 * ║  • Секреты не печатаются: DSN маскируется, значения строк не выводятся   ║
 * ║    кроме идентификаторов и меток времени.                                ║
 * ║  • systemd/nginx/firewall/SSH не трогаются. Деплоя нет.                  ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Вердикт: PASS / WARN / FAIL (код выхода 0 / 0 / 1).
 */

import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  validateLifecycleTimestamps,
  provenanceCompleteness,
} from '../server/services/signalInvariants.js';
import { getHealthThresholds } from '../server/services/health/healthThresholds.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, '../server/db/migrations');

const argv = process.argv.slice(2);
const flag = (name, dflt = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const JSON_OUT = argv.includes('--json');
const STATEMENT_TIMEOUT = flag('timeout', '20s');
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://cryptora:cryptora@127.0.0.1:5432/cryptora';

/** Маскировка DSN: в вывод попадает только хост/порт/база, без пароля. */
export function maskDsn(dsn) {
  try {
    const url = new URL(dsn);
    return `${url.protocol}//***@${url.hostname}:${url.port || '5432'}${url.pathname}`;
  } catch {
    return '***';
  }
}

/** Только читающие запросы. Всё остальное — исключение до отправки на сервер. */
const READ_ONLY_RE = /^\s*(select|with|show|table)\b/i;
export function assertReadOnlySql(sql) {
  if (!READ_ONLY_RE.test(String(sql))) {
    throw new Error(`audit:production-health refuses a non-read-only statement: ${String(sql).slice(0, 40)}…`);
  }
  return sql;
}

/* ─────────────────────────────────────────────── отчёт ─────────────── */

const checks = [];
const addCheck = (name, status, detail, data = null) => {
  checks.push({ name, status, detail, data });
};

const SEVERITY = { PASS: 0, WARN: 1, FAIL: 2 };
const overall = () => checks.reduce(
  (acc, c) => (SEVERITY[c.status] > SEVERITY[acc] ? c.status : acc), 'PASS'
);

/* ─────────────────────────────────────────── сами проверки ─────────── */

async function checkMigrations(sel) {
  const files = fs.existsSync(MIGRATIONS_DIR)
    ? fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()
    : [];
  const { rows } = await sel('SELECT version FROM schema_migrations ORDER BY version');
  const applied = new Set(rows.map((r) => r.version));
  const pending = files.map((f) => f.replace(/\.sql$/, '')).filter((v) => !applied.has(v));
  if (pending.length === 0) {
    addCheck('migrations', 'PASS', `${applied.size} applied, 0 pending`);
  } else {
    addCheck('migrations', 'FAIL', `${pending.length} pending migration(s)`, { pending });
  }
}

async function checkProvenance(sel) {
  const { rows } = await sel(`
    SELECT id, strategy_id, strategy_version, engine_setup_id, symbol, timeframe,
           signal_candle_ts, created_at, status, provenance_status, test_run_id
      FROM signals
     ORDER BY created_at DESC
     LIMIT 5000`);

  const incomplete = [];
  const byStatus = { VERIFIED: 0, MISMATCH: 0, UNKNOWN: 0 };
  for (const r of rows) {
    byStatus[r.provenance_status] = (byStatus[r.provenance_status] ?? 0) + 1;
    const verdict = provenanceCompleteness({
      strategyId: r.strategy_id,
      strategyVersion: r.strategy_version,
      engineSetupId: r.engine_setup_id,
      symbol: r.symbol,
      timeframe: r.timeframe,
      signalCandleTs: r.signal_candle_ts,
      createdAt: r.created_at,
      status: r.status,
      provenanceStatus: r.provenance_status,
    });
    if (!verdict.complete) incomplete.push({ id: r.id, missing: verdict.missing });
  }

  if (rows.length === 0) {
    addCheck('signal provenance completeness', 'PASS', 'no signals stored');
  } else if (incomplete.length === 0) {
    addCheck('signal provenance completeness', 'PASS', `${rows.length} signals, all provenance fields present`, { byStatus });
  } else {
    addCheck(
      'signal provenance completeness',
      'WARN',
      `${incomplete.length}/${rows.length} signals miss provenance fields`,
      { byStatus, sample: incomplete.slice(0, 10) }
    );
  }

  const quarantined = (byStatus.MISMATCH ?? 0) + (byStatus.UNKNOWN ?? 0);
  if (quarantined > 0) {
    addCheck('signal provenance quarantine', 'WARN', `${quarantined} signal(s) not VERIFIED (excluded from monitor and statistics)`, { byStatus });
  } else if (rows.length > 0) {
    addCheck('signal provenance quarantine', 'PASS', 'all stored signals VERIFIED');
  }
  return rows;
}

async function checkLifecycleTimestamps(sel) {
  const { rows } = await sel(`
    SELECT id, signal_candle_ts, filled_at, closed_at, status
      FROM signals
     WHERE filled_at IS NOT NULL OR closed_at IS NOT NULL
     ORDER BY created_at DESC
     LIMIT 5000`);
  const invalid = [];
  for (const r of rows) {
    const verdict = validateLifecycleTimestamps(r);
    if (!verdict.ok) invalid.push({ id: r.id, violations: verdict.violations.map((v) => v.code) });
  }
  if (invalid.length === 0) {
    addCheck('lifecycle timestamps', 'PASS', `${rows.length} signals with fill/close timestamps, all ordered correctly`);
  } else {
    addCheck('lifecycle timestamps', 'FAIL', `${invalid.length} signal(s) with impossible timestamp order`, { sample: invalid.slice(0, 20) });
  }
}

async function checkDuplicates(sel) {
  // Ключ дедупликации защищён UNIQUE-констрейнтом; проверяем ЛОГИЧЕСКИЙ дубль:
  // та же стратегия/символ/таймфрейм/направление в пределах одного бара.
  const { rows } = await sel(`
    SELECT strategy_id, symbol, timeframe, direction, signal_candle_ts, COUNT(*) AS n
      FROM signals
     GROUP BY strategy_id, symbol, timeframe, direction, signal_candle_ts
    HAVING COUNT(*) > 1
     ORDER BY n DESC
     LIMIT 50`);
  if (rows.length === 0) {
    addCheck('duplicate signals', 'PASS', 'no duplicate (strategy, symbol, timeframe, direction, candle) groups');
  } else {
    addCheck('duplicate signals', 'FAIL', `${rows.length} duplicate group(s)`, {
      sample: rows.slice(0, 10).map((r) => ({
        strategyId: r.strategy_id, symbol: r.symbol, timeframe: r.timeframe, count: Number(r.n),
      })),
    });
  }
}

async function checkOpenSignalAnomalies(sel, thresholds) {
  const { rows } = await sel(`
    SELECT id, strategy_id, symbol, timeframe, signal_candle_ts, created_at,
           monitor_last_check_at, monitor_last_result, status
      FROM signals
     WHERE status IN ('ACTIVE', 'FILLED')
     ORDER BY created_at ASC
     LIMIT 2000`);
  const now = Date.now();
  const neverChecked = rows.filter((r) => r.monitor_last_check_at === null);
  const staleChecked = rows.filter((r) => {
    const at = r.monitor_last_check_at ? new Date(r.monitor_last_check_at).getTime() : null;
    return at !== null && (now - at) / 1000 > thresholds.signalMonitorErrorSeconds;
  });
  const errored = rows.filter((r) => r.monitor_last_result === 'ERROR');

  if (rows.length === 0) {
    addCheck('open signal anomalies', 'PASS', 'no open signals');
    return;
  }
  const problems = [];
  if (neverChecked.length > 0) problems.push(`${neverChecked.length} never inspected by the monitor`);
  if (staleChecked.length > 0) problems.push(`${staleChecked.length} not inspected within ${thresholds.signalMonitorErrorSeconds}s`);
  if (errored.length > 0) problems.push(`${errored.length} with last monitor result ERROR`);

  if (problems.length === 0) {
    addCheck('open signal anomalies', 'PASS', `${rows.length} open signals, all recently inspected`);
  } else {
    addCheck('open signal anomalies', 'WARN', problems.join('; '), {
      openSignals: rows.length,
      sample: [...neverChecked, ...staleChecked].slice(0, 10).map((r) => ({ id: r.id, symbol: r.symbol, status: r.status })),
    });
  }
}

async function checkMonitorTelemetry(sel, thresholds) {
  const { rows } = await sel('SELECT * FROM signal_monitor_state WHERE id = 1');
  const state = rows[0];
  if (!state) {
    addCheck('monitor telemetry', 'WARN', 'signal_monitor_state is empty — monitor has not persisted a cycle yet');
    return;
  }
  const finishedAt = state.last_tick_finished_at ? new Date(state.last_tick_finished_at).getTime() : null;
  const ageSeconds = finishedAt === null ? null : Math.round((Date.now() - finishedAt) / 1000);
  if (ageSeconds === null) {
    addCheck('monitor telemetry', 'WARN', 'no completed monitor tick recorded');
  } else if (ageSeconds > thresholds.signalMonitorErrorSeconds) {
    addCheck('monitor telemetry', 'FAIL', `last monitor tick finished ${ageSeconds}s ago`, { ageSeconds });
  } else if (ageSeconds > thresholds.signalMonitorStaleSeconds) {
    addCheck('monitor telemetry', 'WARN', `last monitor tick finished ${ageSeconds}s ago`, { ageSeconds });
  } else {
    addCheck('monitor telemetry', 'PASS', `last monitor tick ${ageSeconds}s ago`, {
      ageSeconds,
      lastOpenSignals: state.last_open_signals,
      lastGroups: state.last_groups,
      lastCandleRequests: state.last_candle_requests,
    });
  }
}

async function checkMarketDataFreshness(sel, thresholds) {
  /**
   * Свежесть БЕЗ сетевых запросов: самое позднее событие радара в БД
   * доказывает, что ticker-поток реально доходил до персистентности.
   * Отсутствие событий — не авария (рынок может быть спокоен), поэтому
   * максимум WARN.
   */
  const { rows } = await sel(`
    SELECT MAX(detected_at) AS last_event FROM radar_events`).catch(() => ({ rows: [{ last_event: null }] }));
  const last = rows[0]?.last_event ? new Date(rows[0].last_event).getTime() : null;
  if (last === null) {
    addCheck('market data freshness (radar trace)', 'WARN', 'no radar events persisted — cannot prove the market feed reached the database');
    return;
  }
  const ageSeconds = Math.round((Date.now() - last) / 1000);
  if (ageSeconds > thresholds.marketDataErrorSeconds) {
    addCheck('market data freshness (radar trace)', 'WARN', `last radar event ${ageSeconds}s ago`, { ageSeconds });
  } else {
    addCheck('market data freshness (radar trace)', 'PASS', `last radar event ${ageSeconds}s ago`, { ageSeconds });
  }
}

async function checkSignalStatisticsConsistency(sel) {
  /**
   * Инвариант: wins + losses + unresolved ≤ total. Проверяется прямым
   * пересчётом по таблице, а не вызовом сервиса статистики — иначе ошибка
   * в сервисе «подтвердила бы сама себя».
   */
  const { rows } = await sel(`
    SELECT
      COUNT(*)                                                             AS total,
      COUNT(*) FILTER (WHERE status IN ('ACTIVE','FILLED'))                AS open_count,
      COUNT(*) FILTER (WHERE status = 'TARGET_REACHED')                    AS wins,
      COUNT(*) FILTER (WHERE status IN ('INVALIDATED','CLOSED'))           AS closed_other,
      COUNT(*) FILTER (WHERE status IN ('EXPIRED','CANCELLED','UNRESOLVED')) AS no_trade,
      COUNT(*) FILTER (WHERE test_run_id IS NOT NULL)                      AS test_run_rows
      FROM signals`);
  const r = rows[0];
  const total = Number(r.total);
  const sum = Number(r.open_count) + Number(r.wins) + Number(r.closed_other) + Number(r.no_trade);
  if (sum === total) {
    addCheck('signal statistics consistency', 'PASS', `status partition sums to total (${total})`, {
      total, open: Number(r.open_count), wins: Number(r.wins),
      closedOther: Number(r.closed_other), noTrade: Number(r.no_trade),
      testRunRows: Number(r.test_run_rows),
    });
  } else {
    addCheck('signal statistics consistency', 'FAIL', `status partition (${sum}) does not sum to total (${total}) — unknown status value present`);
  }
}

/* ────────────────────────────────────────────────── запуск ─────────── */

async function main() {
  const thresholds = getHealthThresholds();
  const client = new pg.Client({ connectionString: DATABASE_URL });

  if (!JSON_OUT) {
    console.log('CRYPTORA — read-only production health audit');
    console.log(`Database: ${maskDsn(DATABASE_URL)}`);
    console.log('Mode:     READ ONLY (BEGIN READ ONLY … ROLLBACK). No DELETE/UPDATE/INSERT/DDL.\n');
  }

  try {
    await client.connect();
  } catch (error) {
    addCheck('database connectivity', 'FAIL', `cannot connect: ${String(error?.code ?? error?.message ?? 'unknown')}`);
    return report();
  }

  // Любой SQL — только через sel().
  const sel = async (sql, params) => client.query(assertReadOnlySql(sql), params);

  try {
    await client.query('BEGIN READ ONLY');
    await client.query(`SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT}'`);
    await client.query("SET LOCAL idle_in_transaction_session_timeout = '30s'");

    const ro = await sel('SHOW transaction_read_only');
    const value = ro.rows[0]?.transaction_read_only;
    if (value !== 'on') throw new Error(`refusing to continue: transaction_read_only = ${value}`);

    const started = Date.now();
    await sel('SELECT 1 AS ok');
    addCheck('database connectivity', 'PASS', `SELECT 1 in ${Date.now() - started}ms`);

    await checkMigrations(sel);
    await checkProvenance(sel);
    await checkLifecycleTimestamps(sel);
    await checkDuplicates(sel);
    await checkOpenSignalAnomalies(sel, thresholds);
    await checkMonitorTelemetry(sel, thresholds);
    await checkMarketDataFreshness(sel, thresholds);
    await checkSignalStatisticsConsistency(sel);
  } catch (error) {
    addCheck('audit execution', 'FAIL', String(error?.message ?? error).slice(0, 300));
  } finally {
    // ROLLBACK в любом случае: аудит не оставляет следов.
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  }

  return report();
}

function report() {
  const verdict = overall();
  if (JSON_OUT) {
    console.log(JSON.stringify({ verdict, checks, generatedAt: new Date().toISOString() }, null, 2));
  } else {
    const icon = { PASS: '✅', WARN: '⚠️ ', FAIL: '❌' };
    for (const c of checks) {
      console.log(`${icon[c.status]} ${c.status.padEnd(4)} ${c.name} — ${c.detail}`);
      if (c.data && process.env.AUDIT_VERBOSE === '1') {
        console.log(`        ${JSON.stringify(c.data)}`);
      }
    }
    console.log(`\nVERDICT: ${verdict}`);
    console.log('No rows were modified: the audit ran inside BEGIN READ ONLY and ended with ROLLBACK.');
  }
  return verdict === 'FAIL' ? 1 : 0;
}

// Импорт из теста не должен запускать аудит.
const isDirectRun = process.argv[1] && path.resolve(process.argv[1]).endsWith('audit-production-health.mjs');
if (isDirectRun) {
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error('[audit:production-health] fatal:', String(error?.message ?? error).slice(0, 300));
      process.exit(1);
    });
}

export { main, checks, addCheck, overall };

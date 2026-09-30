#!/usr/bin/env node
/**
 * CRYPTORA — READ-ONLY аудит жизненного цикла сигналов на боевом сервере.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ КОНТРАКТ БЕЗОПАСНОСТИ — проверяется самим скриптом, а не обещаниями      ║
 * ║                                                                          ║
 * ║  • Единственная транзакция открывается как `BEGIN READ ONLY` и           ║
 * ║    завершается `ROLLBACK`. Перед первым запросом читается                ║
 * ║    `SHOW transaction_read_only`; если сервер не подтвердил 'on' —        ║
 * ║    скрипт аварийно завершается.                                          ║
 * ║  • Каждый SQL проходит через `sel()`, который отвергает всё, кроме       ║
 * ║    SELECT / WITH / SHOW / TABLE. INSERT, UPDATE, DELETE, ALTER,          ║
 * ║    CREATE, DROP, TRUNCATE, GRANT, COPY … невозможны: запрос до сервера   ║
 * ║    не доходит, процесс падает с ненулевым кодом.                         ║
 * ║  • `statement_timeout` и `idle_in_transaction_session_timeout`           ║
 * ║    выставляются через SET LOCAL — зависший аудит не держит БД.           ║
 * ║  • Отдельный клиент `pg.Client`, а не пул приложения: рабочие соединения ║
 * ║    сервиса не занимаются.                                                ║
 * ║  • Рыночные данные — только GET через штатный `MarketDataFetcher`        ║
 * ║    (тот же публичный источник, что у продакшена).                        ║
 * ║  • Сервис не трогается: ни restart, ни reload, ни правок настроек.       ║
 * ║  • Секреты не печатаются никогда: DSN маскируется, `.env` не выводится,  ║
 * ║    `metadata` печатается только по белому списку ключей, а финальный     ║
 * ║    вывод дополнительно прогоняется через маскирующий фильтр.             ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * ЧЕГО ЗДЕСЬ НЕТ. Второй реализации стратегической математики. Вердикт по
 * каждому сигналу выносит ЗАМОРОЖЕННАЯ функция `trackPublishedSetup` из
 * скомпилированного ядра (`server/services/strategyEngine/entry.ts`) — ровно
 * та, которой сервер ведёт позиции. Строка БД переводится в её вход штатным
 * адаптером `toPublishedSetup` из `signalMonitor/signalTradeManager.js`.
 * Всё, что скрипт считает сам, — это НАБЛЮДЕНИЕ касаний опубликованных чисел
 * («когда high впервые дошёл до tp1») и помечено как наблюдение, а не решение.
 *
 * СВЕЧИ. В расчёт идут только ЗАКРЫТЫЕ свечи: серия переводится штатным
 * `ohlcvArrayToArchive(list, tf, nowMs)`, где `isClosed = closeTime < nowMs`,
 * и формирующаяся свеча отбрасывается. Если внутри одной свечи задето
 * несколько уровней, порядок определяет замороженная семантика ядра, а не
 * этот скрипт.
 *
 * Запуск — из каталога установки CRYPTORA (см. команду в отчёте задачи).
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

/* ═══════════════════════════════════════════════════════ параметры ═══ */

const argv = process.argv.slice(2);
const flag = (name, dflt = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const has = (name) => argv.includes(`--${name}`);

const ROOT = path.resolve(flag('root', process.cwd()));
const STATEMENT_TIMEOUT = flag('timeout', '20s');
/** Сколько групп (символ × таймфрейм) разрешено запросить у биржи. */
const MAX_GROUPS = Number(flag('maxGroups', '64'));
/** Порог «монитор молчит» в минутах. */
const STALE_MIN = Number(flag('staleMinutes', '10'));
const SKIP_MARKET = has('noMarket');

const APT_ID = flag('aptId', 'bff009bb-4c98-4beb-8e50-aaa0d3adcf1e');
const SOL_SHORT_ID = flag('solShortId', '1bb7a4ad-2edb-4513-a06f-2857b1b4ceeb');

/* ═══════════════════════════════════════════════════════ вывод ═══════ */

const LINES = [];
const out = (s = '') => { LINES.push(String(s)); };
const hr = (t) => { out(''); out('─'.repeat(78)); out(t); out('─'.repeat(78)); };

/**
 * Маскирование на выходе — последний рубеж. Даже если какое-то поле БД
 * неожиданно содержит DSN, JWT или длинный секрет, в файл он не попадёт.
 */
function sanitize(text) {
  return text
    .replace(/\b([a-z+]+:\/\/)[^\s:@/]+:[^\s@/]+@/gi, '$1***:***@')
    .replace(/\b(password|passwd|pwd|secret|token|cookie|session|api[_-]?key|authorization)\b(\s*[:=]\s*)\S+/gi, '$1$2***')
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, '***jwt***')
    .replace(/\b[A-Fa-f0-9]{40,}\b/g, (m) => `${m.slice(0, 8)}…(${m.length})`);
}

function die(msg, code = 2) {
  out('');
  out(`!!! АВАРИЙНАЯ ОСТАНОВКА: ${msg}`);
  process.stdout.write(sanitize(LINES.join('\n')) + '\n');
  process.exit(code);
}

const iso = (v) => (v == null ? null : new Date(v).toISOString().replace('.000Z', 'Z'));
const n = (v) => (v == null ? null : Number(v));
const fx = (v, d = 6) => (v == null || Number.isNaN(Number(v)) ? '—' : Number(v).toFixed(d).replace(/0+$/, '').replace(/\.$/, ''));

/* ═══════════════════════════════════════════════ загрузка окружения ═══ */

function repoModule(rel) {
  return import(pathToFileURL(path.join(ROOT, rel)).href);
}

function assertCryptoraRoot() {
  const pkgPath = path.join(ROOT, 'package.json');
  if (!fs.existsSync(pkgPath)) die(`в ${ROOT} нет package.json — запустите скрипт из каталога установки CRYPTORA (или передайте --root)`);
  let pkg;
  try { pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')); } catch { die('package.json нечитаем'); }
  if (pkg.name !== 'cryptora') die(`это не каталог CRYPTORA (package.json name = ${JSON.stringify(pkg.name)})`);
  for (const rel of [
    'server/services/strategyEngine/strategyCoreBundle.js',
    'server/services/signalMonitor/signalTradeManager.js',
    'server/services/strategyEngine/marketDataFetcher.js',
  ]) {
    if (!fs.existsSync(path.join(ROOT, rel))) die(`не найден обязательный модуль ${rel}`);
  }
  return pkg.version ?? 'unknown';
}

/**
 * DSN: переменная окружения → `.env` рядом с установкой → документированный
 * дефолт из server/config.js. Значение НИКОГДА не печатается целиком.
 */
function resolveDsn() {
  if (process.env.DATABASE_URL) return { dsn: process.env.DATABASE_URL, from: 'переменная окружения' };
  const envPath = path.join(ROOT, '.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = /^\s*(?:export\s+)?DATABASE_URL\s*=\s*(.+?)\s*$/.exec(line);
      if (m) return { dsn: m[1].replace(/^["']|["']$/g, ''), from: '.env каталога установки' };
    }
  }
  return { dsn: 'postgresql://cryptora:cryptora@127.0.0.1:5432/cryptora', from: 'дефолт server/config.js' };
}

function maskDsn(dsn) {
  try {
    const u = new URL(dsn);
    return `${u.protocol}//***@${u.hostname}:${u.port || '5432'}${u.pathname}`;
  } catch { return '***'; }
}

/* ═══════════════════════════════════════════ read-only транзакция ═══ */

const FORBIDDEN = /\b(insert|update|delete|alter|create|drop|truncate|grant|revoke|copy|merge|vacuum|reindex|refresh|comment|lock|call|do)\b/i;

function makeSel(client) {
  let count = 0;
  return async function sel(sql, params = []) {
    const head = sql.trim().slice(0, 12).toLowerCase();
    if (!/^(select|with|show|table)\b/.test(head.trim())) {
      die(`попытка выполнить не-SELECT: ${sql.trim().slice(0, 60)}…`);
    }
    if (FORBIDDEN.test(sql.replace(/'[^']*'/g, "''"))) {
      die(`в SQL обнаружено пишущее ключевое слово: ${sql.trim().slice(0, 80)}…`);
    }
    count++;
    return client.query(sql, params);
  };
}

/* ═══════════════════════════════════════════════════ рыночные данные ═══ */

const marketCache = new Map();
let marketRequests = 0;
const marketErrors = [];

/**
 * Свечи готовятся ТОЧНО так же, как их готовит монитор
 * (`signalMonitor.toClosedArchive`): штатный `ohlcvArrayToArchive`,
 * отбрасывание формирующейся свечи по `isClosed`, сортировка и дедуп по
 * openTime. Никакой собственной нормализации.
 */
async function closedCandles(fetcher, core, toExchangeSymbol, symbol, timeframe, limit) {
  if (SKIP_MARKET || !fetcher) return null;
  const key = `${symbol}|${timeframe}|${limit}`;
  if (marketCache.has(key)) return marketCache.get(key);
  try {
    marketRequests++;
    let exchangeSymbol = symbol;
    try { exchangeSymbol = toExchangeSymbol(symbol); } catch { /* символ уйдёт как есть */ }
    const raw = await fetcher.getCandles(exchangeSymbol, timeframe, { limit });
    const nowMs = Date.now();
    const arr = core.ohlcvArrayToArchive(raw, timeframe, nowMs).filter((c) => c && c.isClosed);
    arr.sort((a, b) => a.openTime - b.openTime);
    const dedup = [];
    for (const c of arr) {
      const last = dedup[dedup.length - 1];
      if (last && last.openTime === c.openTime) dedup[dedup.length - 1] = c;
      else dedup.push(c);
    }
    marketCache.set(key, dedup);
    return dedup;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    marketErrors.push(`${symbol} ${timeframe}: ${msg}`);
    marketCache.set(key, null);
    return null;
  }
}

/* ═══════════════════════════════════════════════════════ основное ═══ */

const version = assertCryptoraRoot();
const require = createRequire(path.join(ROOT, 'package.json'));

let pg;
try { pg = require('pg'); } catch (e) { die(`не удалось загрузить драйвер pg из ${ROOT}/node_modules: ${e.message}`); }

const { dsn, from: dsnFrom } = resolveDsn();

out('═'.repeat(78));
out('CRYPTORA — READ-ONLY PRODUCTION LIFECYCLE AUDIT');
out('═'.repeat(78));
out(`Время запуска (UTC) : ${new Date().toISOString()}`);
out(`Каталог установки   : ${ROOT}`);
out(`Версия package.json : ${version}`);
out(`База данных         : ${maskDsn(dsn)}   (источник DSN: ${dsnFrom})`);
out(`Режим               : READ ONLY (BEGIN READ ONLY → ROLLBACK)`);
out(`statement_timeout   : ${STATEMENT_TIMEOUT}`);

const client = new pg.Client({ connectionString: dsn, application_name: 'cryptora-readonly-audit' });
let core = null;
let toPublishedSetup = null;
let fetcher = null;
let toExchangeSymbol = (s) => s;

try {
  await client.connect();
} catch (e) {
  die(`не удалось подключиться к PostgreSQL: ${e.message}`);
}

const sel = makeSel(client);

try {
  await client.query('BEGIN READ ONLY');
  await client.query(`SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT}'`);
  await client.query("SET LOCAL idle_in_transaction_session_timeout = '60s'");
  const ro = await sel('SHOW transaction_read_only');
  const roVal = ro.rows?.[0]?.transaction_read_only;
  if (String(roVal).toLowerCase() !== 'on') {
    die(`транзакция НЕ read-only (transaction_read_only = ${roVal}) — аудит прекращён до первого чтения данных`);
  }
  out(`Подтверждение СУБД  : transaction_read_only = ${roVal}`);

  /* ── 1. Фактическая схема ────────────────────────────────────────── */

  hr('1. ФАКТИЧЕСКАЯ СХЕМА (прочитана из information_schema, не предположена)');

  const tabs = await sel(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name LIKE '%signal%'
    ORDER BY table_name`);
  out(`Таблицы со «signal»: ${tabs.rows.map((r) => r.table_name).join(', ') || '— нет —'}`);

  const colsRes = await sel(`
    SELECT table_name, column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name IN ('signals','signal_monitor_state')
    ORDER BY table_name, ordinal_position`);
  const COLS = new Map();
  for (const r of colsRes.rows) {
    if (!COLS.has(r.table_name)) COLS.set(r.table_name, new Map());
    COLS.get(r.table_name).set(r.column_name, r.data_type);
  }
  if (!COLS.has('signals')) die('в базе нет таблицы public.signals — это не боевая БД CRYPTORA');
  const sigCols = COLS.get('signals');
  out(`signals: ${sigCols.size} колонок`);
  out(`  ${[...sigCols.keys()].join(', ')}`);
  if (COLS.has('signal_monitor_state')) {
    out(`signal_monitor_state: ${[...COLS.get('signal_monitor_state').keys()].join(', ')}`);
  } else {
    out('signal_monitor_state: таблицы НЕТ (миграция 010 не применена)');
  }

  const have = (c) => sigCols.has(c);
  /** Берём только реально существующие колонки — имена не угадываются. */
  const WANT = [
    'id', 'strategy_id', 'strategy_version', 'engine_setup_id', 'symbol', 'timeframe', 'direction',
    'signal_candle_ts', 'entry_type', 'valid_for_bars', 'exit_rule',
    'entry_min', 'entry_max', 'stop_loss', 'tp1', 'tp2', 'targets',
    'status', 'created_at', 'updated_at',
    'fill_price', 'filled_at', 'fill_stop', 'fill_targets',
    'closed_at', 'close_price', 'close_reason', 'exit_reason',
    'result_r', 'net_result_r', 'pnl_result_pct', 'bars_held',
    'monitor_check_count', 'monitor_last_check_at', 'monitor_last_result', 'monitor_last_error',
    'provenance_status', 'chain_version',
    // Нужны адаптеру toPublishedSetup (riskRewardRatio, факторы, хэши).
    // В отчёт НЕ печатаются.
    'metadata', 'hash', 'previous_hash',
  ];
  const SELECT_COLS = WANT.filter(have);
  const missing = WANT.filter((c) => !have(c));
  if (missing.length) out(`Отсутствуют (нормально для вашей версии схемы): ${missing.join(', ')}`);

  const checks = await sel(`
    SELECT conname, pg_get_constraintdef(oid) AS def
    FROM pg_constraint WHERE conrelid = 'public.signals'::regclass AND contype = 'c'
    ORDER BY conname`);
  out('');
  out('CHECK-ограничения signals:');
  for (const r of checks.rows) out(`  ${r.conname}: ${r.def}`);

  const SEL_LIST = SELECT_COLS.map((c) => `"${c}"`).join(', ');

  /* ── 2. Загрузка ядра и адаптеров ────────────────────────────────── */

  hr('2. ЗАМОРОЖЕННОЕ ЯДРО (вердикт выносит оно, а не этот скрипт)');
  try {
    const bundle = await repoModule('server/services/strategyEngine/strategyCoreBundle.js');
    core = await bundle.loadStrategyCore();
    out('Ядро загружено: server/services/strategyEngine/entry.ts (esbuild-бандл)');
    out(`  trackPublishedSetup : ${typeof core.trackPublishedSetup}`);
    out(`  ohlcvArrayToArchive : ${typeof core.ohlcvArrayToArchive}`);
    out(`  EXEC_TIMEFRAME      : ${core.EXEC_TIMEFRAME ?? '—'}`);
    out(`  CANDLE_LIMIT_1H     : ${core.CANDLE_LIMIT_1H ?? '—'}`);
  } catch (e) {
    out(`!! ядро НЕ загружено: ${e.message}`);
    out('   Вердикты CORE EXPECTED будут недоступны; данные БД всё равно выгружаются.');
  }
  try {
    const stm = await repoModule('server/services/signalMonitor/signalTradeManager.js');
    toPublishedSetup = stm.toPublishedSetup;
    out(`Адаптер строки БД → сетап: toPublishedSetup (${stm.TRACKED_STRATEGY_IDS?.length ?? '?'} ведомых стратегий)`);
  } catch (e) {
    out(`!! адаптер не загружен: ${e.message}`);
  }
  if (!SKIP_MARKET) {
    try {
      const md = await repoModule('server/services/strategyEngine/marketDataFetcher.js');
      fetcher = md.getMarketDataFetcher();
      toExchangeSymbol = md.toExchangeSymbol;
      out('Рыночные данные: штатный MarketDataFetcher (публичные klines, только GET)');
    } catch (e) {
      out(`!! фетчер не загружен: ${e.message}`);
    }
  } else {
    out('Рыночные данные: ПРОПУЩЕНЫ (--noMarket)');
  }

  /* ── вспомогательное: вердикт ядра по строке ─────────────────────── */

  const tfMs = (tf) => core?.ARCHIVE_TF_MS?.[tf] ?? (tf === '1h' ? 3600000 : tf === '4h' ? 14400000 : tf === '15m' ? 900000 : 86400000);

  const num = (v) => (v == null ? null : Number(v));
  const numArr = (v) => (Array.isArray(v) ? v.map(Number).filter(Number.isFinite) : null);

  /**
   * Зеркало приватной `mapRow` из server/services/signalRepository.js.
   * Она не экспортируется, а `toPublishedSetup` принимает именно camelCase-форму,
   * поэтому отображение повторено здесь один-в-один. Это перевод имён колонок,
   * а не стратегическая логика: ни один уровень тут не пересчитывается.
   */
  function mapDbRow(r) {
    const targets = numArr(r.targets);
    return {
      id: r.id,
      strategyId: r.strategy_id,
      strategyVersion: r.strategy_version ?? null,
      engineSetupId: r.engine_setup_id ?? null,
      symbol: r.symbol,
      timeframe: r.timeframe,
      direction: r.direction,
      signalCandleTs: r.signal_candle_ts,
      entryType: r.entry_type ?? null,
      validForBars: r.valid_for_bars ?? null,
      exitRule: r.exit_rule ?? null,
      entryMin: num(r.entry_min),
      entryMax: num(r.entry_max),
      stopLoss: num(r.stop_loss),
      tp1: num(r.tp1),
      tp2: num(r.tp2),
      // Как и в resolveLevels(): если колонка targets пуста, лестницу собирает
      // пара tp1/tp2. Иначе адаптер отказал бы с NO_TARGETS на старых строках.
      targets: targets && targets.length ? targets : [num(r.tp1), num(r.tp2)].filter((t) => t != null),
      status: r.status,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      fillPrice: num(r.fill_price),
      filledAt: r.filled_at ?? null,
      fillStop: num(r.fill_stop),
      fillTargets: numArr(r.fill_targets),
      closedAt: r.closed_at ?? null,
      closePrice: num(r.close_price),
      closeReason: r.close_reason ?? null,
      resultR: num(r.result_r),
      netResultR: num(r.net_result_r),
      pnlResultPct: num(r.pnl_result_pct),
      barsHeld: r.bars_held ?? null,
      metadata: r.metadata ?? null,
      hash: r.hash,
      previousHash: r.previous_hash,
      outcomeHash: r.outcome_hash ?? null,
      chainVersion: Number(r.chain_version ?? 1),
      monitorCheckCount: Number(r.monitor_check_count ?? 0),
      monitorLastCheckAt: r.monitor_last_check_at ?? null,
      monitorLastResult: r.monitor_last_result ?? null,
      monitorLastError: r.monitor_last_error ?? null,
      provenanceStatus: r.provenance_status ?? 'UNKNOWN',
    };
  }

  async function coreVerdict(row) {
    if (!core?.trackPublishedSetup || !toPublishedSetup || !fetcher) return { ok: false, reason: 'ядро/фетчер/адаптер недоступны' };
    const built = toPublishedSetup(mapDbRow(row));
    if (!built.ok) return { ok: false, reason: `адаптер отказал: ${built.reason}` };
    const span = tfMs(row.timeframe);
    const since = new Date(row.signal_candle_ts).getTime();
    const barsNeeded = Math.ceil((Date.now() - since) / span) + 60;
    const limit = Math.min(1000, Math.max(200, barsNeeded));
    const candles = await closedCandles(fetcher, core, toExchangeSymbol, row.symbol, row.timeframe, limit);
    if (!candles) return { ok: false, reason: 'рыночные данные недоступны' };
    if (candles.length === 0) return { ok: false, reason: 'пустая серия закрытых свечей' };
    if (candles[0].openTime > since) {
      return { ok: false, reason: `окно свечей начинается позже бара сетапа (нужно ${iso(since)}, есть ${iso(candles[0].openTime)})` };
    }
    try {
      const res = core.trackPublishedSetup(built.entry, candles);
      return { ok: true, res, candles, entry: built.entry };
    } catch (e) {
      return { ok: false, reason: `ядро бросило исключение: ${e.message}` };
    }
  }

  /** Наблюдение касаний опубликованных чисел. НЕ решение — только хронология. */
  function levelTimeline(row, candles) {
    if (!candles) return [];
    const long = row.direction === 'LONG';
    const start = new Date(row.signal_candle_ts).getTime();
    const zoneLow = n(row.entry_min), zoneHigh = n(row.entry_max) ?? n(row.entry_min);
    const stop = n(row.stop_loss);
    const targets = Array.isArray(row.targets) && row.targets.length ? row.targets.map(Number) : [n(row.tp1), n(row.tp2)].filter((x) => x != null);
    const t1 = targets[0], t2 = targets[1];
    const ev = [];
    let zoneSeen = false, t1Seen = false, t2Seen = false, stopSeen = false;
    for (const c of candles) {
      if (c.openTime < start) continue;
      if (c.openTime === start) { ev.push(['TRIGGER', c, 'бар, породивший сетап']); continue; }
      if (!zoneSeen && zoneLow != null && c.high >= zoneLow && c.low <= zoneHigh) {
        zoneSeen = true; ev.push(['ZONE_TOUCH', c, `зона ${fx(zoneLow)}–${fx(zoneHigh)}`]);
      }
      if (!stopSeen && stop != null && (long ? c.low <= stop : c.high >= stop)) {
        stopSeen = true; ev.push(['STOP_TOUCH', c, `стоп ${fx(stop)}${zoneSeen ? '' : ' (ДО касания зоны)'}`]);
      }
      if (!t1Seen && t1 != null && (long ? c.high >= t1 : c.low <= t1)) {
        t1Seen = true; ev.push(['TP1_TOUCH', c, `TP1 ${fx(t1)}${zoneSeen ? '' : ' (ДО касания зоны)'}`]);
      }
      if (!t2Seen && t2 != null && (long ? c.high >= t2 : c.low <= t2)) {
        t2Seen = true; ev.push(['TP2_TOUCH', c, `TP2 ${fx(t2)}${zoneSeen ? '' : ' (ДО касания зоны)'}`]);
      }
    }
    return ev;
  }

  function printTimeline(ev) {
    if (!ev.length) { out('  (нет данных)'); return; }
    out('  событие      время бара (UTC)      open        high        low         close');
    for (const [kind, c, note] of ev) {
      out(`  ${kind.padEnd(12)} ${iso(c.openTime).padEnd(21)} ${fx(c.open).padEnd(11)} ${fx(c.high).padEnd(11)} ${fx(c.low).padEnd(11)} ${fx(c.close).padEnd(11)} ${note}`);
    }
  }

  /**
   * Ярлык UI читается из ФАКТИЧЕСКОГО src/utils/serverSignalText.ts установки,
   * а не из копии в этом скрипте: если на сервере другая редакция текстов,
   * отчёт покажет именно её. Разбираются три таблицы по отдельности, чтобы
   * подпись бейджа не перепуталась с подсказкой.
   */
  function parseUiTable(src, name) {
    const start = src.indexOf(`export const ${name}`);
    if (start < 0) return {};
    const open = src.indexOf('{', start);
    const end = src.indexOf('});', open);
    if (open < 0 || end < 0) return {};
    const body = src.slice(open, end);
    const map = {};
    for (const m of body.matchAll(/\b([A-Z_]{3,}):\s*\n?\s*'((?:[^'\\]|\\.)*)'/g)) {
      if (!(m[1] in map)) map[m[1]] = m[2];
    }
    return map;
  }
  const uiSrc = (() => {
    const p = path.join(ROOT, 'src/utils/serverSignalText.ts');
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
  })();
  const UI_BADGE = parseUiTable(uiSrc, 'SERVER_STATUS_LABELS');
  const UI_SHORT = parseUiTable(uiSrc, 'SERVER_STATUS_SHORT_LABELS');
  const UI_HINT = parseUiTable(uiSrc, 'SERVER_STATUS_HINTS');
  const uiStatus = (s) => {
    if (!UI_BADGE[s] && !UI_SHORT[s]) return `${s} (ярлык UI не найден в src/utils/serverSignalText.ts)`;
    const badge = UI_BADGE[s] ?? '—';
    const short = UI_SHORT[s] ?? '—';
    const hint = UI_HINT[s] ? ` | подсказка: ${UI_HINT[s]}` : '';
    return `${s} → бейдж «${badge}», подпись «${short}»${hint}`;
  };

  function dumpRow(row) {
    out(`  id              : ${row.id}`);
    out(`  стратегия       : ${row.strategy_id} ${row.strategy_version ?? ''}`);
    out(`  инструмент      : ${row.symbol} ${row.timeframe} ${row.direction}`);
    out(`  бар сетапа (UTC): ${iso(row.signal_candle_ts)}`);
    out(`  создан (UTC)    : ${iso(row.created_at)}`);
    out(`  зона входа      : ${fx(row.entry_min)} – ${fx(row.entry_max)}`);
    out(`  стоп            : ${fx(row.stop_loss)}`);
    out(`  цели            : ${Array.isArray(row.targets) && row.targets.length ? row.targets.map((t) => fx(t)).join(' / ') : `${fx(row.tp1)} / ${fx(row.tp2)}`}`);
    out(`  СТАТУС В БД     : ${row.status}`);
    out(`  СТАТУС В UI     : ${uiStatus(row.status)}`);
    out(`  fill            : ${row.fill_price == null ? 'нет' : `${fx(row.fill_price)} @ ${iso(row.filled_at)}`}`);
    if ('fill_stop' in row) out(`  стоп после fill : ${row.fill_stop == null ? '— (сдвига нет)' : fx(row.fill_stop)}`);
    out(`  закрыт          : ${row.closed_at ? iso(row.closed_at) : 'нет'}  причина: ${row.close_reason ?? row.exit_reason ?? '—'}`);
    out(`  R               : gross ${fx(row.result_r, 4)}  net ${fx(row.net_result_r, 4)}  баров ${row.bars_held ?? '—'}`);
    if ('monitor_last_check_at' in row) {
      out(`  монитор         : проверок ${row.monitor_check_count ?? 0}, последняя ${iso(row.monitor_last_check_at) ?? 'никогда'}, результат ${row.monitor_last_result ?? '—'}${row.monitor_last_error ? `, ошибка: ${row.monitor_last_error}` : ''}`);
    }
    if ('provenance_status' in row) out(`  происхождение   : ${row.provenance_status}`);
  }

  function describeCore(v) {
    if (!v.ok) return `НЕДОСТУПЕН (${v.reason})`;
    const r = v.res;
    if (r.kind === 'UNCHANGED') return 'ещё не разрешён (ядро: UNCHANGED — исхода пока нет)';
    if (r.kind === 'SKIP') return `SKIP (${r.reason})`;
    if (r.kind === 'FILLED') return `FILLED, позиция открыта: вход ${fx(r.fill.price)} @ ${iso(r.fill.barOpenTime)}`;
    const o = r.outcome;
    return `${o.status} / ${o.exitReason} @ ${iso(o.closedAt)}  exit ${fx(o.exitPrice)}  R ${fx(o.resultR, 4)} (net ${fx(o.netResultR, 4)})`
      + (r.fill ? `; вход ${fx(r.fill.price)} @ ${iso(r.fill.barOpenTime)}` : '; входа не было');
  }

  function classify(row, v) {
    if (!v.ok) return 'НЕ КЛАССИФИЦИРОВАНО — нет вердикта ядра';
    const r = v.res;
    const open = row.status === 'ACTIVE' || row.status === 'FILLED';
    if (r.kind === 'RESOLVED' && open) {
      const reason = r.outcome.exitReason ?? '';
      if (reason === 'SL' || r.outcome.status === 'INVALIDATED') return 'ACTIVE_AFTER_SL — ядро видит стоп, строка осталась открытой';
      if (reason === 'TP2' || r.outcome.status === 'TARGET_REACHED') return 'ACTIVE_AFTER_TP2 — ядро видит TP2, строка осталась открытой';
      if (reason.startsWith('TP1')) return 'MISSING_TP1_TRANSITION — ядро видит закрытие после TP1, строка осталась открытой';
      return `РАСХОЖДЕНИЕ — ядро закрыло бы (${r.outcome.status}/${reason}), строка ${row.status}`;
    }
    if (r.kind === 'FILLED' && row.status === 'ACTIVE') return 'MISSING_FILL_TRANSITION — ядро видит исполнение, строка ещё ACTIVE';
    if (r.kind === 'UNCHANGED' && row.status === 'FILLED' && row.fill_price == null) return 'IMPOSSIBLE_STATUS — FILLED без fill_price';
    if (!open && r.kind !== 'RESOLVED') return `РАСХОЖДЕНИЕ — строка закрыта (${row.status}), ядро исхода не видит`;
    return 'СОГЛАСОВАНО';
  }

  /* ── 3. APT ──────────────────────────────────────────────────────── */

  hr('3. APT/USDT LONG V3.0 — целевой сигнал');
  const aptRes = await sel(`SELECT ${SEL_LIST} FROM signals WHERE id = $1`, [APT_ID]);
  const apt = aptRes.rows[0] ?? null;
  let aptV = { ok: false, reason: 'строка не найдена' };
  if (!apt) {
    out(`Сигнал ${APT_ID} в таблице signals НЕ НАЙДЕН.`);
    const near = await sel(`SELECT ${SEL_LIST} FROM signals WHERE symbol ILIKE 'APT%' ORDER BY created_at DESC LIMIT 10`);
    out(`Ближайшие сигналы по APT (${near.rowCount}):`);
    for (const r of near.rows) out(`  ${r.id} ${r.strategy_id} ${r.direction} ${iso(r.signal_candle_ts)} ${r.status}`);
  } else {
    dumpRow(apt);
    aptV = await coreVerdict(apt);
    out('');
    out(`  ЯДРО (frozen)   : ${describeCore(aptV)}`);
    out('');
    out('  ХРОНОЛОГИЯ КАСАНИЙ (наблюдение по закрытым свечам, не решение):');
    printTimeline(levelTimeline(apt, aptV.ok ? aptV.candles : null));
    out('');
    out(`  КЛАССИФИКАЦИЯ   : ${classify(apt, aptV)}`);
  }

  /* ── 4. SOL ──────────────────────────────────────────────────────── */

  hr('4. SOL/USDT V3.3 — SHORT, LONG и их пересечение');

  const solShortRes = await sel(`SELECT ${SEL_LIST} FROM signals WHERE id = $1`, [SOL_SHORT_ID]);
  const solShort = solShortRes.rows[0] ?? null;

  out('4.1 Поиск предыдущего SOL LONG V3.3 (ID не угадывается — ищется SELECT-ом)');
  const solCands = await sel(`
    SELECT ${SEL_LIST} FROM signals
    WHERE symbol ILIKE 'SOL%' AND direction = 'LONG' AND strategy_id ILIKE 'V3\\_3%'
      AND signal_candle_ts >= $1::timestamptz - interval '18 hours'
      AND signal_candle_ts <= $1::timestamptz + interval '6 hours'
    ORDER BY signal_candle_ts DESC`, ['2026-09-29T04:00:00Z']);
  out(`  кандидатов: ${solCands.rowCount}`);
  const TARGET_LEVELS = { entry_min: 117.01, entry_max: 117.27, stop_loss: 115.66, tp1: 119.10, tp2: 124.95 };
  let solLong = null; let bestScore = Infinity;
  for (const r of solCands.rows) {
    const t = Array.isArray(r.targets) && r.targets.length ? r.targets.map(Number) : [n(r.tp1), n(r.tp2)];
    const score = Math.abs((n(r.entry_min) ?? 0) - TARGET_LEVELS.entry_min)
      + Math.abs((n(r.entry_max) ?? 0) - TARGET_LEVELS.entry_max)
      + Math.abs((n(r.stop_loss) ?? 0) - TARGET_LEVELS.stop_loss)
      + Math.abs((t[0] ?? 0) - TARGET_LEVELS.tp1);
    out(`  ${r.id} ${iso(r.signal_candle_ts)} ${r.status} зона ${fx(r.entry_min)}–${fx(r.entry_max)} стоп ${fx(r.stop_loss)} цели ${t.map((x) => fx(x)).join('/')}  Δуровней ${score.toFixed(4)}`);
    if (score < bestScore) { bestScore = score; solLong = r; }
  }
  if (solLong) out(`  ВЫБРАН по близости уровней: ${solLong.id} (Δ ${bestScore.toFixed(4)})`);
  else out('  подходящих строк нет');

  let solLongV = { ok: false, reason: 'строка не найдена' };
  if (solLong) {
    out('');
    out('4.2 SOL LONG');
    dumpRow(solLong);
    solLongV = await coreVerdict(solLong);
    out('');
    out(`  ЯДРО (frozen)   : ${describeCore(solLongV)}`);
    out('  ХРОНОЛОГИЯ КАСАНИЙ:');
    printTimeline(levelTimeline(solLong, solLongV.ok ? solLongV.candles : null));
    out(`  КЛАССИФИКАЦИЯ   : ${classify(solLong, solLongV)}`);
  }

  let solShortV = { ok: false, reason: 'строка не найдена' };
  out('');
  out('4.3 SOL SHORT');
  if (!solShort) {
    out(`Сигнал ${SOL_SHORT_ID} НЕ НАЙДЕН.`);
    const near = await sel(`SELECT ${SEL_LIST} FROM signals WHERE symbol ILIKE 'SOL%' AND direction='SHORT' ORDER BY created_at DESC LIMIT 10`);
    for (const r of near.rows) out(`  ${r.id} ${r.strategy_id} ${iso(r.signal_candle_ts)} ${r.status}`);
  } else {
    dumpRow(solShort);
    solShortV = await coreVerdict(solShort);
    out('');
    out(`  ЯДРО (frozen)   : ${describeCore(solShortV)}`);
    out('  ХРОНОЛОГИЯ КАСАНИЙ:');
    printTimeline(levelTimeline(solShort, solShortV.ok ? solShortV.candles : null));
    out(`  КЛАССИФИКАЦИЯ   : ${classify(solShort, solShortV)}`);
  }

  /* ── 4.4 состояние LONG в момент появления SHORT ─────────────────── */

  out('');
  out('4.4 СОСТОЯНИЕ LONG В МОМЕНТ ПОЯВЛЕНИЯ SHORT');
  if (solLong && solShort) {
    const shortBorn = new Date(solShort.created_at).getTime();
    const shortSetup = new Date(solShort.signal_candle_ts).getTime();
    const longFill = solLong.filled_at ? new Date(solLong.filled_at).getTime()
      : (solLongV.ok && solLongV.res.fill ? solLongV.res.fill.barOpenTime : null);
    const longClose = solLong.closed_at ? new Date(solLong.closed_at).getTime()
      : (solLongV.ok && solLongV.res.kind === 'RESOLVED' ? new Date(solLongV.res.outcome.closedAt).getTime() : null);
    out(`  SHORT: бар сетапа ${iso(shortSetup)}, строка создана ${iso(shortBorn)}`);
    out(`  LONG : fill ${longFill ? iso(longFill) : 'нет'}, закрытие ${longClose ? iso(longClose) : 'ещё открыт'}`);

    const tl = solLongV.ok ? levelTimeline(solLong, solLongV.candles) : [];
    const t1ev = tl.find((e) => e[0] === 'TP1_TOUCH');
    const t2ev = tl.find((e) => e[0] === 'TP2_TOUCH');
    const slev = tl.find((e) => e[0] === 'STOP_TOUCH');
    out(`  LONG TP1 касание : ${t1ev ? iso(t1ev[1].openTime) : 'не наблюдалось'}`);
    out(`  LONG TP2 касание : ${t2ev ? iso(t2ev[1].openTime) : 'не наблюдалось'}`);
    out(`  LONG SL касание  : ${slev ? iso(slev[1].openTime) : 'не наблюдалось'}`);

    const longOpenAtShort = longFill != null && longFill <= shortBorn && (longClose == null || longClose > shortBorn);
    out('');
    out('  МОДЕЛЬНОЕ СОСТОЯНИЕ LONG НЕПОСРЕДСТВЕННО ПЕРЕД SHORT');
    out('  (по правилам сопровождения V3.3, зафиксированным в v33Core.manageTrade:');
    out('   TP1 → закрыть 50 % и перенести стоп в безубыток со следующего бара)');
    if (!longOpenAtShort) {
      out('    LONG в этот момент НЕ был в позиции — расчёт остатка не имеет смысла.');
    } else {
      const tp1Before = t1ev && t1ev[1].openTime <= shortBorn;
      const entry = n(solLong.fill_price) ?? (solLongV.ok && solLongV.res.fill ? solLongV.res.fill.price : null);
      const stop0 = n(solLong.stop_loss);
      const tgts = Array.isArray(solLong.targets) && solLong.targets.length ? solLong.targets.map(Number) : [n(solLong.tp1), n(solLong.tp2)];
      const risk = entry != null && stop0 != null ? Math.abs(entry - stop0) : null;
      out(`    remaining position % : ${tp1Before ? '50 %' : '100 %'}`);
      out(`    realized R           : ${tp1Before && risk ? (0.5 * Math.abs(tgts[0] - entry) / risk).toFixed(4) : '0 (TP1 ещё не взят)'}`);
      out(`    stop state           : ${tp1Before ? 'БЕЗУБЫТОК (перенесён на цену входа)' : `ОРИГИНАЛЬНЫЙ ${fx(stop0)}`}`);
      out(`    next target          : ${tp1Before ? `TP2 ${fx(tgts[1])}` : `TP1 ${fx(tgts[0])}`}`);
      const px = solLongV.ok ? (() => {
        const before = solLongV.candles.filter((c) => c.openTime <= shortBorn);
        return before.length ? before[before.length - 1].close : null;
      })() : null;
      out(`    последняя close до SHORT: ${fx(px)}`);
      out(`    unrealized/model R   : ${px != null && entry != null && risk ? (((px - entry) / risk) * (solLong.direction === 'LONG' ? 1 : -1) * (tp1Before ? 0.5 : 1)).toFixed(4) : '—'}`);
    }

    /* пересечение */
    const shortFill = solShort.filled_at ? new Date(solShort.filled_at).getTime()
      : (solShortV.ok && solShortV.res.fill ? solShortV.res.fill.barOpenTime : null);
    const shortClose = solShort.closed_at ? new Date(solShort.closed_at).getTime()
      : (solShortV.ok && solShortV.res.kind === 'RESOLVED' ? new Date(solShortV.res.outcome.closedAt).getTime() : null);
    const aFrom = longFill, aTo = longClose ?? Date.now();
    const bFrom = shortFill, bTo = shortClose ?? Date.now();
    out('');
    if (aFrom != null && bFrom != null) {
      const from = Math.max(aFrom, bFrom), to = Math.min(aTo, bTo);
      if (to > from) {
        out(`  SOL OVERLAP: YES`);
        out(`  INTERVAL   : ${iso(from)} … ${iso(to)}  (${((to - from) / 3600000).toFixed(2)} ч)`);
        out(`               LONG  в позиции ${iso(aFrom)} … ${longClose ? iso(aTo) : 'по настоящее время'}`);
        out(`               SHORT в позиции ${iso(bFrom)} … ${shortClose ? iso(bTo) : 'по настоящее время'}`);
      } else {
        out('  SOL OVERLAP: NO (интервалы позиций не пересекаются)');
      }
    } else {
      out('  SOL OVERLAP: НЕ ОПРЕДЕЛЕНО (нет времени исполнения одной из сторон)');
    }
  } else {
    out('  недостаточно данных: не найдены обе строки');
  }

  /* ── 4.5 политика встречных сигналов — по фактическому коду ──────── */

  out('');
  out('4.5 OPPOSITE SIGNAL POLICY — поиск в ФАКТИЧЕСКОМ коде установки');
  /**
   * Ищется ИСПОЛНЯЕМАЯ логика, а не слова. Перед проверкой из строки
   * вырезаются комментарии и строковые литералы: иначе в «политику» попадают
   * описания стратегий («TP2 = противоположный свинг») и SQL `ON CONFLICT`
   * внутри шаблонных строк, которые к встречным сигналам отношения не имеют.
   */
  const stripNonCode = (line) => line
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/gs, '``')
    .replace(/\/\/.*$/, '')
    .replace(/\/\*.*?\*\//g, '');
  const policyHits = [];
  const policyNoise = [];
  const scanDirs = ['src/services/signals', 'server/services'];
  const rx = /(?<![.\w])(opposite|hedge|netting|встречн|противополож)/i;
  for (const d of scanDirs) {
    const abs = path.join(ROOT, d);
    if (!fs.existsSync(abs)) continue;
    const stack = [abs];
    while (stack.length) {
      const cur = stack.pop();
      for (const ent of fs.readdirSync(cur, { withFileTypes: true })) {
        const full = path.join(cur, ent.name);
        if (ent.isDirectory()) { if (ent.name !== 'node_modules' && ent.name !== '.generated') stack.push(full); continue; }
        if (!/\.(ts|js)$/.test(ent.name)) continue;
        const src = fs.readFileSync(full, 'utf8');
        src.split('\n').forEach((line, i) => {
          const trimmed = line.trim();
          if (/^(\*|\/\/|\/\*)/.test(trimmed)) return;
          const where = `${path.relative(ROOT, full)}:${i + 1}: ${trimmed.slice(0, 110)}`;
          if (rx.test(stripNonCode(line))) policyHits.push(where);
          else if (rx.test(line)) policyNoise.push(where);
        });
      }
    }
  }
  out(`  Просканировано: ${scanDirs.join(', ')} (.ts/.js, без комментариев и строковых литералов)`);
  if (policyHits.length === 0) {
    out('  В коде публикации, монитора и репозитория сигналов НЕТ ни одной исполняемой');
    out('  строки, реализующей политику встречных сигналов: ни блокировки, ни неттинга,');
    out('  ни закрытия противоположной позиции. Исполняемых совпадений: 0.');
    out(`  (в описаниях и комментариях слово встречается ${policyNoise.length} раз — это тексты стратегий,`);
    out('   например «TP2 = противоположный 4H-свинг», к политике отношения не имеют)');
  } else {
    out(`  Исполняемых совпадений: ${policyHits.length}`);
    for (const h of policyHits.slice(0, 30)) out(`    ${h}`);
  }
  const dedup = await sel(`
    SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
    WHERE conrelid = 'public.signals'::regclass AND contype = 'u'`);
  out('  Ограничения уникальности в БД (что реально мешает дублям):');
  for (const r of dedup.rows) out(`    ${r.conname}: ${r.def}`);
  out('  → направление (direction) в ключ дедупликации НЕ входит: LONG и SHORT по одному');
  out('    инструменту — это две независимые строки, БД их пересечение не запрещает.');

  /* ── 5. Глобальный аудит ─────────────────────────────────────────── */

  hr('5. ГЛОБАЛЬНЫЙ АУДИТ ВСЕХ ОТКРЫТЫХ СИГНАЛОВ');

  const openRes = await sel(`
    SELECT ${SEL_LIST} FROM signals
    WHERE status IN ('ACTIVE','FILLED')
    ORDER BY symbol, timeframe, signal_candle_ts`);
  const openRows = openRes.rows;
  out(`Открытых строк (ACTIVE/FILLED): ${openRows.length}`);

  const byStatus = await sel(`SELECT status, count(*) AS c FROM signals GROUP BY status ORDER BY c DESC`);
  out(`Распределение по статусам: ${byStatus.rows.map((r) => `${r.status}=${r.c}`).join(', ')}`);

  const findings = {
    ACTIVE_AFTER_SL: [], ACTIVE_AFTER_TP2: [], MISSING_TP1_TRANSITION: [],
    IMPOSSIBLE_STATUS: [], LONG_SHORT_OVERLAP: [], DUPLICATE_ACTIVE_SIGNAL: [],
    MONITOR_STALE: [], CORE_UNAVAILABLE: [], OTHER_MISMATCH: [],
  };

  // 5a. Невозможные состояния — чистый SQL-инвариант, рынок не нужен.
  for (const r of openRows) {
    const bad = [];
    if (r.status === 'FILLED' && r.fill_price == null) bad.push('FILLED без fill_price');
    if (r.status === 'FILLED' && r.filled_at == null) bad.push('FILLED без filled_at');
    if (r.status === 'ACTIVE' && r.fill_price != null) bad.push('ACTIVE, но fill_price заполнен');
    if (r.closed_at != null) bad.push(`открытый статус ${r.status}, но closed_at заполнен`);
    if (r.result_r != null) bad.push(`открытый статус ${r.status}, но result_r заполнен`);
    if (r.entry_min != null && r.entry_max != null && Number(r.entry_min) > Number(r.entry_max)) bad.push('entry_min > entry_max');
    if (r.stop_loss != null && r.entry_min != null) {
      const inside = Number(r.stop_loss) >= Number(r.entry_min) && Number(r.stop_loss) <= Number(r.entry_max ?? r.entry_min);
      if (inside) bad.push('стоп внутри зоны входа');
    }
    if (bad.length) findings.IMPOSSIBLE_STATUS.push(`${r.id} ${r.symbol} ${r.direction} ${r.status}: ${bad.join('; ')}`);
  }

  // 5b. Дубли открытых.
  const dupKey = new Map();
  for (const r of openRows) {
    const k = `${r.strategy_id}|${r.symbol}|${r.timeframe}|${r.direction}`;
    if (!dupKey.has(k)) dupKey.set(k, []);
    dupKey.get(k).push(r);
  }
  for (const [k, list] of dupKey) {
    if (list.length > 1) {
      findings.DUPLICATE_ACTIVE_SIGNAL.push(`${k}: ${list.length} открытых — ${list.map((r) => `${r.id}@${iso(r.signal_candle_ts)}`).join(', ')}`);
    }
  }

  // 5c. Монитор молчит.
  const now = Date.now();
  for (const r of openRows) {
    if (!('monitor_last_check_at' in r)) break;
    const last = r.monitor_last_check_at ? new Date(r.monitor_last_check_at).getTime() : null;
    if (last == null) {
      findings.MONITOR_STALE.push(`${r.id} ${r.symbol} ${r.direction}: монитор НИ РАЗУ не проверял (checks=${r.monitor_check_count ?? 0}, создан ${iso(r.created_at)})`);
    } else if (now - last > STALE_MIN * 60000) {
      findings.MONITOR_STALE.push(`${r.id} ${r.symbol} ${r.direction}: последняя проверка ${iso(last)} (${((now - last) / 60000).toFixed(1)} мин назад, порог ${STALE_MIN})`);
    }
    if (r.monitor_last_error) {
      findings.MONITOR_STALE.push(`${r.id} ${r.symbol}: monitor_last_error = ${r.monitor_last_error}`);
    }
  }

  // 5d. Пересечения LONG/SHORT — по всем строкам, не только открытым.
  const posRes = await sel(`
    SELECT id, strategy_id, symbol, direction, filled_at, closed_at, status
    FROM signals WHERE filled_at IS NOT NULL ORDER BY symbol, filled_at`);
  const bySym = new Map();
  for (const r of posRes.rows) {
    const k = `${r.strategy_id}|${r.symbol}`;
    if (!bySym.has(k)) bySym.set(k, []);
    bySym.get(k).push(r);
  }
  for (const [k, list] of bySym) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        if (a.direction === b.direction) continue;
        const aF = new Date(a.filled_at).getTime(), aT = a.closed_at ? new Date(a.closed_at).getTime() : now;
        const bF = new Date(b.filled_at).getTime(), bT = b.closed_at ? new Date(b.closed_at).getTime() : now;
        const from = Math.max(aF, bF), to = Math.min(aT, bT);
        if (to > from) {
          findings.LONG_SHORT_OVERLAP.push(
            `${k}: ${a.direction} ${a.id} (${iso(aF)}…${a.closed_at ? iso(aT) : 'открыт'}) ∩ `
            + `${b.direction} ${b.id} (${iso(bF)}…${b.closed_at ? iso(bT) : 'открыт'}) = `
            + `${iso(from)} … ${iso(to)} (${((to - from) / 3600000).toFixed(2)} ч)`);
        }
      }
    }
  }

  // 5e. Сверка с ядром — требует рынка, поэтому ограничена по группам.
  const groups = new Set(openRows.map((r) => `${r.symbol}|${r.timeframe}`));
  out(`Групп (символ × таймфрейм) для запроса свечей: ${groups.size}${groups.size > MAX_GROUPS ? ` — ограничено до ${MAX_GROUPS}` : ''}`);
  const allowed = new Set([...groups].slice(0, MAX_GROUPS));
  let audited = 0;
  for (const r of openRows) {
    if (!allowed.has(`${r.symbol}|${r.timeframe}`)) continue;
    const v = await coreVerdict(r);
    audited++;
    if (!v.ok) { findings.CORE_UNAVAILABLE.push(`${r.id} ${r.symbol} ${r.direction}: ${v.reason}`); continue; }
    const cls = classify(r, v);
    if (cls === 'СОГЛАСОВАНО') continue;
    const evidence = `${r.id} ${r.symbol} ${r.timeframe} ${r.direction} ${r.strategy_id} | БД ${r.status}`
      + ` | ядро ${describeCore(v)}`;
    if (cls.startsWith('ACTIVE_AFTER_SL')) findings.ACTIVE_AFTER_SL.push(evidence);
    else if (cls.startsWith('ACTIVE_AFTER_TP2')) findings.ACTIVE_AFTER_TP2.push(evidence);
    else if (cls.startsWith('MISSING_TP1_TRANSITION')) findings.MISSING_TP1_TRANSITION.push(evidence);
    else findings.OTHER_MISMATCH.push(`${cls} :: ${evidence}`);
  }
  out(`Сверено с ядром: ${audited} из ${openRows.length}`);

  for (const [k, list] of Object.entries(findings)) {
    out('');
    out(`${k}: ${list.length}`);
    for (const e of list.slice(0, 50)) out(`  • ${e}`);
    if (list.length > 50) out(`  … ещё ${list.length - 50}`);
  }

  /* ── 6. Телеметрия монитора ──────────────────────────────────────── */

  hr('6. ТЕЛЕМЕТРИЯ МОНИТОРА');
  if (COLS.has('signal_monitor_state')) {
    const st = await sel('SELECT * FROM signal_monitor_state WHERE id = 1');
    if (st.rowCount === 0) out('  строки состояния нет — монитор ни разу не отчитывался');
    else {
      const s = st.rows[0];
      for (const [k, v] of Object.entries(s)) {
        out(`  ${k.padEnd(24)}: ${v instanceof Date ? iso(v) : String(v)}`);
      }
      if (s.last_tick_finished_at) {
        const age = (now - new Date(s.last_tick_finished_at).getTime()) / 60000;
        out(`  → последний тик ${age.toFixed(1)} мин назад${age > STALE_MIN ? '  ⚠ МОНИТОР МОЛЧИТ' : ''}`);
      }
    }
  } else out('  таблицы signal_monitor_state нет');

  const enabled = await sel(`SELECT strategy_id, enabled, scan_interval_seconds, last_scan_at, last_error FROM strategy_settings ORDER BY strategy_id`)
    .catch(() => ({ rows: [] }));
  if (enabled.rows?.length) {
    out('');
    out('  strategy_settings (только чтение):');
    for (const r of enabled.rows) {
      out(`    ${r.strategy_id.padEnd(34)} enabled=${r.enabled} interval=${r.scan_interval_seconds}s last_scan=${iso(r.last_scan_at) ?? '—'}${r.last_error ? ` error=${r.last_error}` : ''}`);
    }
  }

  /* ── 7. Итоговый отчёт в запрошенной форме ───────────────────────── */

  hr('7. ИТОГОВЫЙ ОТЧЁТ');

  const tlOf = (row, v) => (v.ok ? levelTimeline(row, v.candles) : []);
  const evTime = (tl, kind) => { const e = tl.find((x) => x[0] === kind); return e ? iso(e[1].openTime) : 'не наблюдалось'; };

  const aptTl = apt ? tlOf(apt, aptV) : [];
  out('APT');
  out(`SIGNAL ID: ${apt?.id ?? 'НЕ НАЙДЕН'}`);
  out(`FILL: ${apt?.fill_price != null ? `${fx(apt.fill_price)} @ ${iso(apt.filled_at)}` : (aptV.ok && aptV.res.fill ? `${fx(aptV.res.fill.price)} @ ${iso(aptV.res.fill.barOpenTime)} (по ядру; в БД нет)` : 'нет')}`);
  out(`FIRST POST-FILL SL: ${evTime(aptTl, 'STOP_TOUCH')}`);
  out(`TP1: ${evTime(aptTl, 'TP1_TOUCH')}`);
  out(`TP2: ${evTime(aptTl, 'TP2_TOUCH')}`);
  out(`EXPECTED: ${describeCore(aptV)}`);
  out(`DB: ${apt ? `${apt.status}, closed_at ${iso(apt.closed_at) ?? '—'}, reason ${apt.close_reason ?? '—'}, R ${fx(apt.result_r, 4)}` : '—'}`);
  out(`UI-DERIVED: ${apt ? uiStatus(apt.status) : '—'}`);
  out(`CLASSIFICATION: ${apt ? classify(apt, aptV) : 'НЕ НАЙДЕН'}`);

  const slTl = solLong ? tlOf(solLong, solLongV) : [];
  out('');
  out('SOL LONG');
  out(`SIGNAL ID: ${solLong?.id ?? 'НЕ НАЙДЕН'}`);
  out(`FILL: ${solLong?.fill_price != null ? `${fx(solLong.fill_price)} @ ${iso(solLong.filled_at)}` : 'нет'}`);
  out(`TP1: ${evTime(slTl, 'TP1_TOUCH')}`);
  out(`TP2: ${evTime(slTl, 'TP2_TOUCH')}`);
  out(`SL: ${evTime(slTl, 'STOP_TOUCH')}`);
  out(`DB: ${solLong ? `${solLong.status}, R ${fx(solLong.result_r, 4)}` : '—'}`);
  out(`EXPECTED: ${describeCore(solLongV)}`);
  out(`STATE AT SHORT CREATION: см. раздел 4.4`);

  const ssTl = solShort ? tlOf(solShort, solShortV) : [];
  out('');
  out('SOL SHORT');
  out(`SIGNAL ID: ${solShort?.id ?? 'НЕ НАЙДЕН'}`);
  out(`FILL: ${solShort?.fill_price != null ? `${fx(solShort.fill_price)} @ ${iso(solShort.filled_at)}` : 'нет'}`);
  out(`TP1: ${evTime(ssTl, 'TP1_TOUCH')}`);
  out(`TP2: ${evTime(ssTl, 'TP2_TOUCH')}`);
  out(`SL: ${evTime(ssTl, 'STOP_TOUCH')}`);
  out(`OUTCOME: ${solShort ? `БД ${solShort.status} / ${solShort.close_reason ?? '—'}; ядро ${describeCore(solShortV)}` : '—'}`);

  out('');
  const solOv = findings.LONG_SHORT_OVERLAP.filter((s) => s.includes('SOL'));
  out(`SOL OVERLAP: ${solOv.length ? 'YES' : 'NO'}`);
  out(`INTERVAL: ${solOv.length ? solOv.map((s) => s.split('= ')[1]).join(' | ') : '—'}`);
  out('');
  out(`OPPOSITE SIGNAL POLICY: ${policyHits.length === 0
    ? 'НЕ РЕАЛИЗОВАНА — в коде публикации/монитора/репозитория нет ни блокировки встречного сигнала, ни неттинга, ни закрытия противоположной позиции; ключ дедупликации БД не включает direction'
    : `найдено ${policyHits.length} исполняемых совпадений — см. раздел 4.5`}`);

  out('');
  out('GLOBAL');
  out(`ACTIVE AUDITED: ${audited} (всего открытых ${openRows.length})`);
  out(`ACTIVE_AFTER_SL: ${findings.ACTIVE_AFTER_SL.length}`);
  out(`ACTIVE_AFTER_TP2: ${findings.ACTIVE_AFTER_TP2.length}`);
  out(`MISSING_TP1_TRANSITION: ${findings.MISSING_TP1_TRANSITION.length}`);
  out(`IMPOSSIBLE_STATUS: ${findings.IMPOSSIBLE_STATUS.length}`);
  out(`LONG_SHORT_OVERLAP: ${findings.LONG_SHORT_OVERLAP.length}`);
  out(`DUPLICATE_ACTIVE: ${findings.DUPLICATE_ACTIVE_SIGNAL.length}`);
  out(`MONITOR_STALE: ${findings.MONITOR_STALE.length}`);
  out(`OTHER_MISMATCH: ${findings.OTHER_MISMATCH.length}`);
  out(`CORE_UNAVAILABLE: ${findings.CORE_UNAVAILABLE.length}`);

  const suspects = new Set();
  for (const [, list] of Object.entries(findings)) {
    for (const e of list) {
      const m = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
      for (const id of String(e).match(m) ?? []) suspects.add(id);
    }
  }
  out('');
  out(`SUSPECT SIGNAL IDS: ${suspects.size}`);
  for (const id of suspects) out(`  ${id}`);

  if (marketErrors.length) {
    out('');
    out(`ОШИБКИ РЫНОЧНЫХ ДАННЫХ: ${marketErrors.length}`);
    for (const e of marketErrors.slice(0, 20)) out(`  ${e}`);
  }
  out('');
  out(`HTTP-запросов свечей: ${marketRequests}`);

  out('');
  out('PRODUCTION DB WRITES: 0');
  out('PRODUCTION SETTINGS MODIFIED: NO');
  out('PRODUCTION SIGNALS MODIFIED: NO');
  out('SERVICE RESTARTED: NO');
  out('DEPLOYED: NO');
} catch (e) {
  out('');
  out(`ОШИБКА ВЫПОЛНЕНИЯ: ${e instanceof Error ? `${e.message}\n${e.stack}` : String(e)}`);
} finally {
  try { await client.query('ROLLBACK'); out(''); out('Транзакция завершена: ROLLBACK (изменений не было).'); } catch { /* соединение уже закрыто */ }
  try { await client.end(); } catch { /* уже закрыт */ }
}

process.stdout.write(sanitize(LINES.join('\n')) + '\n');

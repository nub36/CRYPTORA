#!/usr/bin/env node
/**
 * CRYPTORA — READ-ONLY диагностика TP/SL-геометрии сохранённых сигналов.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ КОНТРАКТ БЕЗОПАСНОСТИ                                                    ║
 * ║  • Ни одного INSERT / UPDATE / DELETE / DDL. Единственный SQL —          ║
 * ║    `SELECT` внутри явной `READ ONLY`-транзакции, поэтому запись          ║
 * ║    физически отклоняется сервером PostgreSQL, а не «обещанием кода».     ║
 * ║  • Математика стратегий не вызывается и не пересчитывается: читаются     ║
 * ║    УЖЕ СОХРАНЁННЫЕ уровни, производные считает                           ║
 * ║    `shared/diagnostics/targetGeometry.js`.                               ║
 * ║  • Никаких PII: user_id, e-mail, сессии и таблица users не читаются.     ║
 * ║    Выводятся только id сигнала, символ, версия, уровни и R.              ║
 * ║  • Exit-код: 1 ТОЛЬКО при структурном повреждении данных                 ║
 * ║    (цель/стоп не с той стороны, TP2 ≤ TP1, риск ≤ 0, NaN, пропуск        ║
 * ║    уровня) либо при ошибке доступа. Плохой R:R — это НЕ ошибка: отчёт    ║
 * ║    печатается, код возврата 0.                                           ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Источники данных (взаимоисключающие):
 *   DATABASE_URL   прямое чтение таблицы `signals` (полный набор полей)
 *   --base-url URL публичный read-path `GET /api/signals` работающего сервера
 *   --file PATH    JSON-выгрузка (массив строк или {items: [...]}) — для
 *                  воспроизводимого офлайн-анализа
 *
 * Использование:
 *   npm run diagnose:strategy-targets
 *   npm run diagnose:strategy-targets -- --base-url https://host
 *   npm run diagnose:strategy-targets -- --file ./signals.json --json out.json
 *
 * Флаги:
 *   --base-url URL     читать через публичный API вместо БД
 *   --file PATH        читать из JSON-файла
 *   --limit N          максимум строк (по умолчанию 100000 для БД, 200/страница для API)
 *   --version V        фильтр по strategy_version ('3.0', '3.3')
 *   --symbol S         фильтр по символу ('BTC/USDT')
 *   --json PATH        записать машиночитаемый отчёт (единственная запись на диск)
 *   --max-anomalies N  сколько id аномалий печатать в текст (по умолчанию 25)
 *   --quiet            только итоговые строки
 */

import process from 'node:process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import {
  analyzeSignalGeometry,
  analyzeSignalBatch,
  groupStats,
  summarizeOutcomes,
  priceResolution,
  QUALITY_THRESHOLDS,
} from '../shared/diagnostics/targetGeometry.js';

const EXIT_OK = 0;
const EXIT_STRUCTURAL = 1;
const EXIT_ACCESS = 2;

function parseArgs(argv) {
  const args = {
    baseUrl: '', file: '', limit: 0, version: '', symbol: '',
    json: '', maxAnomalies: 25, quiet: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const [flag, inline] = argv[i].includes('=') ? argv[i].split(/=(.*)/s) : [argv[i], null];
    const next = () => (inline !== null ? inline : argv[++i]);
    switch (flag) {
      case '--base-url': args.baseUrl = String(next()).replace(/\/+$/, ''); break;
      case '--file': args.file = String(next()); break;
      case '--limit': args.limit = Number.parseInt(next(), 10) || 0; break;
      case '--version': args.version = String(next()); break;
      case '--symbol': args.symbol = String(next()).toUpperCase(); break;
      case '--json': args.json = String(next()); break;
      case '--max-anomalies': args.maxAnomalies = Number.parseInt(next(), 10) || 25; break;
      case '--quiet': args.quiet = true; break;
      case '--help': case '-h': args.help = true; break;
      default:
        if (flag.startsWith('--')) throw new Error(`Неизвестный флаг: ${flag}`);
    }
  }
  return args;
}

/** Нормализация любой формы строки сигнала к входу диагностики. */
export function toDiagnosticRow(raw) {
  const num = (v) => {
    if (v === null || v === undefined) return null;
    const n = typeof v === 'string' ? Number(v) : v;
    return typeof n === 'number' ? n : null;
  };
  const targets = Array.isArray(raw.targets) ? raw.targets.map(num) : [];
  const tp1 = num(raw.tp1) ?? targets[0] ?? null;
  const tp2 = num(raw.tp2) ?? targets[1] ?? null;
  return {
    id: raw.id ?? null,
    symbol: raw.symbol ?? null,
    direction: raw.direction ?? null,
    timeframe: raw.timeframe ?? null,
    strategyId: raw.strategyId ?? raw.strategy_id ?? null,
    strategyVersion: raw.strategyVersion ?? raw.strategy_version ?? null,
    provenanceStatus: raw.provenanceStatus ?? raw.provenance_status ?? null,
    status: raw.status ?? null,
    closeReason: raw.closeReason ?? raw.close_reason ?? null,
    createdAt: raw.createdAt ?? raw.created_at ?? null,
    signalCandleTs: raw.signalCandleTs ?? raw.signal_candle_ts ?? null,
    entryLow: num(raw.entryMin ?? raw.entry_min),
    entryHigh: num(raw.entryMax ?? raw.entry_max),
    stop: num(raw.stopLoss ?? raw.stop_loss),
    tp1, tp2,
    targetCount: targets.length,
  };
}

/** Чтение из PostgreSQL. Транзакция объявлена READ ONLY на уровне сервера. */
async function loadFromDatabase(args) {
  const { default: pg } = await import('pg');
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ...(process.env.DATABASE_SSL === 'true' ? { ssl: { rejectUnauthorized: false } } : {}),
  });
  await client.connect();
  try {
    await client.query('BEGIN TRANSACTION READ ONLY');
    const where = [];
    const params = [];
    if (args.version) { params.push(args.version); where.push(`strategy_version = $${params.length}`); }
    if (args.symbol) { params.push(args.symbol); where.push(`symbol = $${params.length}`); }
    params.push(args.limit > 0 ? args.limit : 100000);
    const sql = `
      SELECT id, strategy_id, strategy_version, symbol, timeframe, direction,
             signal_candle_ts, created_at, status, close_reason,
             entry_min, entry_max, stop_loss, tp1, tp2, targets,
             provenance_status, entry_type, valid_for_bars,
             fill_price, filled_at, result_r, net_result_r, bars_held
        FROM signals
       ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY created_at DESC
       LIMIT $${params.length}`;
    const res = await client.query(sql, params);
    await client.query('COMMIT');
    return { source: 'DATABASE', rows: res.rows.map(toDiagnosticRow) };
  } finally {
    await client.end();
  }
}

/** Чтение через публичный read-path. Пагинация по контракту (limit ≤ 200). */
async function loadFromApi(args) {
  const rows = [];
  const pageSize = 200;
  const hardLimit = args.limit > 0 ? args.limit : 5000;
  for (let offset = 0; offset < hardLimit; offset += pageSize) {
    const url = new URL(`${args.baseUrl}/api/signals`);
    url.searchParams.set('limit', String(Math.min(pageSize, hardLimit - offset)));
    url.searchParams.set('offset', String(offset));
    if (args.symbol) url.searchParams.set('symbol', args.symbol);
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`GET ${url.pathname} → HTTP ${res.status}`);
    const body = await res.json();
    const items = Array.isArray(body?.items) ? body.items : Array.isArray(body) ? body : [];
    rows.push(...items.map(toDiagnosticRow));
    if (items.length < pageSize) break;
  }
  const filtered = args.version ? rows.filter((r) => String(r.strategyVersion) === args.version) : rows;
  return { source: 'API', rows: filtered };
}

async function loadFromFile(args) {
  const text = await readFile(args.file, 'utf8');
  const parsed = JSON.parse(text);
  const items = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.items) ? parsed.items : [];
  let rows = items.map(toDiagnosticRow);
  if (args.version) rows = rows.filter((r) => String(r.strategyVersion) === args.version);
  if (args.symbol) rows = rows.filter((r) => String(r.symbol).toUpperCase() === args.symbol);
  return { source: 'FILE', rows };
}

const f = (v, d = 4) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(d));
const pctText = (v) => (v === null || v === undefined ? '—' : `${v.toFixed(2)} %`);

function printSummaryTable(title, s, out) {
  out(`  ${title}: n=${s.count} min=${f(s.min)} p10=${f(s.p10)} p25=${f(s.p25)} median=${f(s.median)} p75=${f(s.p75)} p90=${f(s.p90)} max=${f(s.max)} mean=${f(s.mean)}`);
}

function printShares(title, sh, out) {
  const parts = sh.below.map((b) => `<${b.threshold}: ${b.count} (${pctText(b.pct)})`);
  out(`  ${title}: ${parts.join('  ')}  >=1.0: ${sh.atLeastOneR.count} (${pctText(sh.atLeastOneR.pct)})`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const lines = [];
  const out = (s = '') => { lines.push(s); if (!args.quiet) console.log(s); };

  if (args.help) {
    console.log(String(await readFile(new URL(import.meta.url)))
      .split('\n').filter((l) => l.startsWith(' *') || l.startsWith('/**')).join('\n'));
    return EXIT_OK;
  }

  let loaded;
  try {
    if (args.file) loaded = await loadFromFile(args);
    else if (args.baseUrl) loaded = await loadFromApi(args);
    else if (process.env.DATABASE_URL) loaded = await loadFromDatabase(args);
    else {
      console.error('НЕТ ИСТОЧНИКА ДАННЫХ: задайте DATABASE_URL, либо --base-url URL, либо --file PATH.');
      console.error('Диагностика ничего не выдумывает: без источника отчёт не печатается.');
      return EXIT_ACCESS;
    }
  } catch (err) {
    console.error(`ОШИБКА ДОСТУПА К ДАННЫМ: ${err instanceof Error ? err.message : String(err)}`);
    return EXIT_ACCESS;
  }

  const rows = loaded.rows;
  out('═══════════════════════════════════════════════════════════════════════');
  out('CRYPTORA — READ-ONLY ДИАГНОСТИКА TP/SL-ГЕОМЕТРИИ СИГНАЛОВ');
  out('═══════════════════════════════════════════════════════════════════════');
  out(`Источник: ${loaded.source}   строк получено: ${rows.length}   ${new Date().toISOString()}`);
  out('Запись в БД не выполняется. Уровни и формулы стратегий не изменяются.');
  out('');

  if (rows.length === 0) {
    out('СИГНАЛОВ НЕТ. Распределения и hit-rate НЕ ВЫЧИСЛЯЮТСЯ (нет данных ≠ ноль).');
    if (args.json) await writeReport(args.json, { source: loaded.source, rows: 0, note: 'NO_SIGNALS' });
    return EXIT_OK;
  }

  const batch = analyzeSignalBatch(rows);
  const results = batch.results;
  const byId = new Map(rows.map((r, i) => [i, r]));

  out('── 1. ОБЩИЕ ЧИСЛА ────────────────────────────────────────────────────');
  out(`  всего сигналов:            ${batch.total}`);
  out(`  структурно валидных:       ${batch.structurallyValid}`);
  out(`  структурно повреждённых:   ${batch.structurallyBroken}`);
  out('');

  out('── 2. РАСПРЕДЕЛЕНИЕ R (якорь = середина зоны входа) ───────────────────');
  printSummaryTable('R1  ', batch.r1Mid, out);
  printSummaryTable('R2  ', batch.r2Mid, out);
  out('  якорь = фактическое исполнение раннера (худшая граница коридора):');
  printSummaryTable('R1far', batch.r1Far, out);
  printSummaryTable('R2far', batch.r2Far, out);
  out('');
  printShares('R1 доли', batch.r1Shares, out);
  printShares('R2 доли', batch.r2Shares, out);
  out('');

  out('── 3. РАЗРЕЗЫ ────────────────────────────────────────────────────────');
  const cuts = [
    ['версия', (r) => String(r.strategyVersion ?? '—')],
    ['направление', (r) => String(r.direction ?? '—')],
    ['символ', (r) => String(r.symbol ?? '—')],
    ['таймфрейм', (r) => String(r.timeframe ?? '—')],
  ];
  const groups = {};
  for (const [label, keyOf] of cuts) {
    out(`  · ${label}`);
    const g = groupStats(results, keyOf);
    groups[label] = g;
    for (const row of g) {
      out(`    ${row.key.padEnd(14)} n=${String(row.total).padStart(5)} valid=${String(row.structurallyValid).padStart(5)}`
        + `  R1 med=${f(row.r1.median, 3)} p25=${f(row.r1.p25, 3)} p75=${f(row.r1.p75, 3)}`
        + `  R2 med=${f(row.r2.median, 3)}`
        + `  R1<0.25=${pctText(row.r1Shares.below[0]?.pct ?? null)}`);
    }
  }
  out('');

  out('── 4. АНОМАЛИИ ───────────────────────────────────────────────────────');
  for (const [code, n] of Object.entries(batch.anomalyCounts)) {
    if (n > 0) out(`  ${code.padEnd(22)} ${n}`);
  }
  const broken = results.filter((r) => !r.ok);
  if (broken.length > 0) {
    out('');
    out(`  СТРУКТУРНО ПОВРЕЖДЁННЫЕ (первые ${Math.min(args.maxAnomalies, broken.length)}):`);
    for (const r of broken.slice(0, args.maxAnomalies)) {
      out(`    ${String(r.id ?? '—')}  ${String(r.symbol ?? '—')} ${String(r.direction ?? '—')} v${String(r.strategyVersion ?? '—')} :: ${r.structural.join(', ')}`);
    }
  }
  const close = results.filter((r) => r.ok && r.quality.includes('TP1_VERY_CLOSE'));
  if (close.length > 0) {
    out('');
    out(`  TP1 БЛИЖЕ ${QUALITY_THRESHOLDS.tp1CloseR}R (качество, НЕ повреждение): ${close.length}`);
    for (const r of close.slice(0, args.maxAnomalies)) {
      out(`    ${String(r.id ?? '—')}  ${String(r.symbol ?? '—')} ${String(r.direction ?? '—')} v${String(r.strategyVersion ?? '—')} R1=${f(r.r1Mid, 3)} R2=${f(r.r2Mid, 3)}`);
    }
  }
  out('');

  out('── 5. ИСХОДЫ (по close_reason замороженного ядра) ─────────────────────');
  const outcomes = summarizeOutcomes(rows);
  out(`  всего: ${outcomes.total}   открытых: ${outcomes.open}   разрешённых сделок: ${outcomes.resolvedTrades}   без сделки: ${outcomes.noTrade}`);
  out(`  статусы: ${Object.entries(outcomes.byStatus).map(([k, v]) => `${k}=${v}`).join(' ') || '—'}`);
  out(`  причины: ${Object.entries(outcomes.byReason).map(([k, v]) => `${k}=${v}`).join(' ') || '—'}`);
  if (outcomes.resolvedTrades === 0) {
    out('  TP1/TP2/SL hit rate: НЕТ ДАННЫХ (нет ни одной разрешённой сделки).');
  } else {
    out(`  TP1 hit rate: ${pctText(outcomes.tp1HitRatePct)}   TP2 hit rate: ${pctText(outcomes.tp2HitRatePct)}   SL rate: ${pctText(outcomes.slRatePct)}`);
    out('  ПОРЯДОК СОБЫТИЙ: БД хранит только ПРИЧИНУ финального выхода, отдельной');
    out('  временной шкалы «TP1 → SL» нет. TP1-before-SL выводится из литерала');
    out(`  TP1_THEN_SL = ${outcomes.byReason.TP1_THEN_SL ?? 0}; SL-before-TP1 = SL = ${outcomes.byReason.SL ?? 0}.`);
  }
  out('');

  out('── 6. MFE / MAE ──────────────────────────────────────────────────────');
  out('  NOT AVAILABLE. Таблица `signals` не хранит ни экстремумы после входа,');
  out('  ни ссылку на свечи; исторические свечи не персистятся в этом проекте.');
  out('  Восстановление требует внешнего источника OHLCV и здесь не имитируется.');
  out('');

  out('── 7. ТОЧНОСТЬ ХРАНЕНИЯ УРОВНЕЙ ──────────────────────────────────────');
  const lowPrice = results.filter((r) => r.tp1 !== null && Math.abs(r.tp1) < 1);
  out(`  сигналов с ценой < 1: ${lowPrice.length}`);
  let precisionIssues = 0;
  for (const r of lowPrice) {
    for (const [name, v] of [['entryLow', r.entryLow], ['entryHigh', r.entryHigh], ['stop', r.stop], ['tp1', r.tp1], ['tp2', r.tp2]]) {
      const pr = priceResolution(v ?? NaN, 4);
      if (!pr.ok) {
        precisionIssues += 1;
        if (precisionIssues <= args.maxAnomalies) {
          out(`    ${String(r.id ?? '—')} ${String(r.symbol ?? '—')} ${name}=${v} значащих цифр=${pr.significantDigits}`);
        }
      }
    }
  }
  out(`  уровней с < 4 значащими цифрами: ${precisionIssues}`);
  out('  (это проверка ХРАНЕНИЯ; форматирование UI на persisted-значения не влияет)');
  out('');

  out('── 8. PROVENANCE ─────────────────────────────────────────────────────');
  const prov = {};
  const noVersion = rows.filter((r) => !r.strategyVersion).length;
  for (const r of rows) {
    const k = String(r.provenanceStatus ?? 'НЕ ОТДАНО ЧИТАТЕЛЕМ');
    prov[k] = (prov[k] ?? 0) + 1;
  }
  out(`  provenance_status: ${Object.entries(prov).map(([k, v]) => `${k}=${v}`).join(' ')}`);
  out(`  строк без strategy_version: ${noVersion}`);
  out('  СНИМКА НАСТРОЕК НЕТ: таблица `signals` не хранит версию/хэш настроек на');
  out('  момент публикации (см. отчёт аудита, §12).');
  out('');

  const structuralTotal = batch.structurallyBroken;
  out('═══════════════════════════════════════════════════════════════════════');
  out(`ИТОГ: структурных повреждений ${structuralTotal}; записей с R1 < 0.25: ${batch.r1Shares.below[0]?.count ?? 0}`);
  out('Плохой R:R не считается ошибкой выполнения (exit 0). Exit 1 — только структурное повреждение.');
  out('═══════════════════════════════════════════════════════════════════════');

  if (args.json) {
    await writeReport(args.json, {
      source: loaded.source,
      generatedAt: new Date().toISOString(),
      totals: {
        total: batch.total,
        structurallyValid: batch.structurallyValid,
        structurallyBroken: batch.structurallyBroken,
      },
      r1Mid: batch.r1Mid, r2Mid: batch.r2Mid, r1Far: batch.r1Far, r2Far: batch.r2Far,
      r1Shares: batch.r1Shares, r2Shares: batch.r2Shares,
      anomalyCounts: batch.anomalyCounts,
      groups,
      outcomes,
      mfeMae: 'NOT_AVAILABLE',
      brokenIds: broken.map((r) => ({ id: r.id, symbol: r.symbol, codes: r.structural })),
      text: lines.join('\n'),
    });
    if (!args.quiet) console.log(`\nJSON-отчёт: ${args.json}`);
  }
  void byId;

  return structuralTotal > 0 ? EXIT_STRUCTURAL : EXIT_OK;
}

async function writeReport(target, payload) {
  const abs = path.resolve(target);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

/** Экспортируется для тестов — сборка отчёта без CLI. */
export function analyzeRows(rawRows) {
  const rows = (Array.isArray(rawRows) ? rawRows : []).map(toDiagnosticRow);
  return {
    rows,
    batch: analyzeSignalBatch(rows),
    outcomes: summarizeOutcomes(rows),
    perSignal: rows.map(analyzeSignalGeometry),
  };
}

const invokedDirectly = process.argv[1] && import.meta.url === `file://${path.resolve(process.argv[1])}`;
if (invokedDirectly) {
  main()
    .then((code) => { process.exitCode = code; })
    .catch((err) => {
      console.error(`СБОЙ ДИАГНОСТИКИ: ${err instanceof Error ? err.stack : String(err)}`);
      process.exitCode = EXIT_ACCESS;
    });
}

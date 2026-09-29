#!/usr/bin/env node
/**
 * CRYPTORA chart diagnostics harness (task §4).
 *
 * Walks the FULL Spot and USD-M Futures universes — not a hand-picked
 * BTC/ETH/SOL sample — and, for every instrument × interval, pulls candles
 * through the REAL CRYPTORA data path and runs the same normalization and
 * validation the UI uses (`shared/market/candleSeries.js`).
 *
 * Safety contract:
 *   • READ-ONLY. It issues public GET requests only and never touches
 *     PostgreSQL, migrations, env, or any production setting.
 *   • Controlled concurrency + inter-batch pause, so 1000+ instruments never
 *     turn into a request storm against Binance rate limits.
 *   • Honest classification: NO_DATA / UNSUPPORTED / RATE_LIMITED are reported
 *     as themselves, never silently upgraded to PASS and never patched with
 *     synthetic candles.
 *
 * Transports:
 *   default        in-process gateway (`server/services/marketDataGateway.js`)
 *   --base-url URL through a running CRYPTORA server, e.g. http://127.0.0.1:3000
 *
 * Usage:
 *   npm run diagnose:charts
 *   npm run diagnose:charts -- --market futures --intervals 1h,1d --limit 50
 *   npm run diagnose:charts -- --base-url http://127.0.0.1:3000 --concurrency 3
 *   npm run diagnose:charts -- --json .diagnostics/charts.json
 *
 * Flags:
 *   --market spot|futures|both   (default both)
 *   --intervals 1m,5m,15m,1h,4h,1d
 *   --limit N                    max instruments per market (default all)
 *   --symbols BTC,ETH            explicit instrument shortlist
 *   --concurrency N              parallel requests (default 4, max 8)
 *   --pause-ms N                 pause between batches (default 250)
 *   --candles N                  klines per request (default 200)
 *   --json PATH                  write the machine-readable report
 *   --base-url URL               use a running server instead of in-process
 */

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {
  normalizeBinanceKlineSeries,
  validateCandleSeries,
} from '../shared/market/candleSeries.js';

const DEFAULT_INTERVALS = ['1m', '5m', '15m', '1h', '4h', '1d'];
const STATUSES = ['PASS', 'FAIL', 'NO_DATA', 'UNSUPPORTED', 'RATE_LIMITED', 'ERROR'];

function parseArgs(argv) {
  const args = { market: 'both', intervals: DEFAULT_INTERVALS, limit: 0, symbols: [], concurrency: 4, pauseMs: 250, candles: 200, json: '', baseUrl: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const [flag, inline] = argv[i].includes('=') ? argv[i].split(/=(.*)/s) : [argv[i], null];
    const next = () => (inline !== null ? inline : argv[++i]);
    switch (flag) {
      case '--market': args.market = String(next()).toLowerCase(); break;
      case '--intervals': args.intervals = String(next()).split(',').map((s) => s.trim()).filter(Boolean); break;
      case '--limit': args.limit = Number.parseInt(next(), 10) || 0; break;
      case '--symbols': args.symbols = String(next()).split(',').map((s) => s.trim().toUpperCase()).filter(Boolean); break;
      case '--concurrency': args.concurrency = Math.min(8, Math.max(1, Number.parseInt(next(), 10) || 4)); break;
      case '--pause-ms': args.pauseMs = Math.max(0, Number.parseInt(next(), 10) || 0); break;
      case '--candles': args.candles = Math.min(1000, Math.max(10, Number.parseInt(next(), 10) || 200)); break;
      case '--json': args.json = String(next()); break;
      case '--base-url': args.baseUrl = String(next()).replace(/\/$/, ''); break;
      case '--help': case '-h': args.help = true; break;
      default: if (flag.startsWith('--')) throw new Error(`Unknown flag: ${flag}`);
    }
  }
  if (!['spot', 'futures', 'both'].includes(args.market)) throw new Error(`--market must be spot|futures|both`);
  return args;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Creates the transport used for every gateway call (in-process or HTTP). */
async function createTransport(baseUrl) {
  if (baseUrl) {
    return {
      label: `http ${baseUrl}/api/market`,
      async get(routePath, query) {
        const url = `${baseUrl}/api/market${routePath}${query ? `?${query}` : ''}`;
        const response = await fetch(url, { headers: { accept: 'application/json' } });
        let body = null;
        try { body = await response.json(); } catch { body = null; }
        return { status: response.status, body };
      },
    };
  }
  const { requestMarketData } = await import('../server/services/marketDataGateway.js');
  return {
    label: 'in-process gateway (server/services/marketDataGateway.js)',
    async get(routePath, query) {
      const result = await requestMarketData(routePath, new URLSearchParams(query ?? ''));
      return { status: result.status, body: result.body };
    },
  };
}

/** Binance error payloads that mean "this symbol/interval is not tradable here". */
function classifyUpstreamError(status, body) {
  const code = body && typeof body === 'object' ? Number(body.code) : NaN;
  if (status === 429 || status === 418 || code === -1003) return 'RATE_LIMITED';
  if (status === 400 && (code === -1121 || code === -1100 || code === -1102)) return 'UNSUPPORTED';
  if (status === 400) return 'UNSUPPORTED';
  return 'ERROR';
}

async function loadUniverse(transport, market, args) {
  if (args.symbols.length > 0) {
    return args.symbols.map((base) => ({ base, exchangeSymbol: `${base}USDT` }));
  }
  const route = market === 'futures' ? '/universe/futures' : '/universe/spot';
  const { status, body } = await transport.get(route, '');
  if (status !== 200 || !body) throw new Error(`${route} → HTTP ${status}`);
  const rows = market === 'futures' ? body.contracts : body.symbols;
  if (!Array.isArray(rows)) throw new Error(`${route} → unexpected payload`);
  const universe = rows.map((row) => ({ base: row.symbol, exchangeSymbol: row.exchangeSymbol }));
  return args.limit > 0 ? universe.slice(0, args.limit) : universe;
}

/**
 * One instrument × interval probe through the real pipeline:
 * gateway → JSON → shared normalizer → shared validator.
 */
async function probe(transport, market, instrument, interval, args) {
  const route = market === 'futures' ? '/binance/futures/fapi/v1/klines' : '/binance/spot/api/v3/klines';
  const query = new URLSearchParams({ symbol: instrument.exchangeSymbol, interval, limit: String(args.candles) }).toString();
  const started = Date.now();
  let response;
  try {
    response = await transport.get(route, query);
  } catch (error) {
    return { status: 'ERROR', reason: `transport: ${error instanceof Error ? error.message : String(error)}`, ms: Date.now() - started };
  }
  const ms = Date.now() - started;

  if (response.status !== 200) {
    const status = classifyUpstreamError(response.status, response.body);
    const detail = response.body && typeof response.body === 'object'
      ? (response.body.msg ?? response.body.error ?? JSON.stringify(response.body).slice(0, 120))
      : `HTTP ${response.status}`;
    return { status, reason: `HTTP ${response.status}: ${detail}`, ms };
  }
  if (!Array.isArray(response.body)) {
    return { status: 'FAIL', reason: 'payload_not_array', ms };
  }
  if (response.body.length === 0) {
    return { status: 'NO_DATA', reason: 'empty candle array', ms };
  }

  let normalized;
  try {
    normalized = normalizeBinanceKlineSeries(response.body, { symbol: instrument.base, market, exchange: 'binance' });
  } catch (error) {
    return { status: 'FAIL', reason: `normalizer threw: ${error instanceof Error ? error.message : String(error)}`, ms };
  }
  if (normalized.candles.length === 0) {
    const reasons = [...new Set(normalized.rejected.map((r) => r.reason))].join(', ');
    return { status: 'NO_DATA', reason: `all ${response.body.length} rows rejected: ${reasons || 'unknown'}`, ms };
  }

  const validation = validateCandleSeries(normalized.candles, { requireVolume: false, minCandles: 1 });
  const issues = [...validation.issues];
  if (normalized.rejected.length > 0) {
    const reasons = [...new Set(normalized.rejected.map((r) => r.reason))].join(', ');
    issues.push(`rejected ${normalized.rejected.length}/${response.body.length} rows (${reasons})`);
  }
  if (!validation.ok) {
    return { status: 'FAIL', reason: issues.join('; '), ms, candles: normalized.candles.length };
  }
  return {
    status: 'PASS',
    ms,
    candles: normalized.candles.length,
    rejected: normalized.rejected.length,
    warnings: issues,
    firstTime: normalized.candles[0].time,
    lastTime: normalized.candles[normalized.candles.length - 1].time,
  };
}

/** Runs tasks with a bounded worker pool plus a pause between batches. */
async function runPool(tasks, concurrency, pauseMs, onDone) {
  const results = [];
  let cursor = 0;
  let completed = 0;
  async function worker() {
    for (;;) {
      const index = cursor++;
      if (index >= tasks.length) return;
      const result = await tasks[index]();
      results[index] = result;
      completed += 1;
      onDone?.(completed, tasks.length, result);
      if (pauseMs > 0) await sleep(pauseMs);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  return results;
}

function emptyTally() {
  return Object.fromEntries(STATUSES.map((status) => [status, 0]));
}

async function diagnoseMarket(transport, market, args) {
  process.stdout.write(`\n=== ${market.toUpperCase()} ===\n`);
  let universe;
  try {
    universe = await loadUniverse(transport, market, args);
  } catch (error) {
    process.stdout.write(`  universe unavailable: ${error instanceof Error ? error.message : String(error)}\n`);
    return { market, universeError: String(error), instruments: 0, intervals: args.intervals, probes: emptyTally(), instrumentTally: emptyTally(), problems: [] };
  }
  process.stdout.write(`  instruments: ${universe.length} · intervals: ${args.intervals.join(', ')} · concurrency ${args.concurrency}\n`);

  const jobs = [];
  for (const instrument of universe) {
    for (const interval of args.intervals) {
      jobs.push(async () => ({
        market,
        base: instrument.base,
        exchangeSymbol: instrument.exchangeSymbol,
        interval,
        ...(await probe(transport, market, instrument, interval, args)),
      }));
    }
  }

  const probes = emptyTally();
  const results = await runPool(jobs, args.concurrency, args.pauseMs, (done, total, result) => {
    probes[result.status] = (probes[result.status] ?? 0) + 1;
    if (done % 25 === 0 || done === total) {
      process.stdout.write(`  ...${done}/${total} probes (PASS ${probes.PASS} · FAIL ${probes.FAIL} · NO_DATA ${probes.NO_DATA} · UNSUPPORTED ${probes.UNSUPPORTED} · RATE_LIMITED ${probes.RATE_LIMITED} · ERROR ${probes.ERROR})\n`);
    }
  });

  // Per-instrument verdict: the worst probe wins, so one broken interval cannot
  // be hidden behind five healthy ones.
  const severity = { PASS: 0, NO_DATA: 1, UNSUPPORTED: 2, RATE_LIMITED: 3, ERROR: 4, FAIL: 5 };
  const byInstrument = new Map();
  for (const row of results) {
    const current = byInstrument.get(row.base);
    if (!current || severity[row.status] > severity[current.status]) {
      byInstrument.set(row.base, row);
    }
  }
  const instrumentTally = emptyTally();
  for (const row of byInstrument.values()) instrumentTally[row.status] += 1;

  const problems = results
    .filter((row) => row.status !== 'PASS')
    .map((row) => ({ market, symbol: row.base, exchangeSymbol: row.exchangeSymbol, interval: row.interval, status: row.status, reason: row.reason ?? '' }));

  return { market, instruments: universe.length, intervals: args.intervals, probes, instrumentTally, problems, results };
}

function printSummary(report) {
  process.stdout.write('\n================ CHART DIAGNOSTICS SUMMARY ================\n');
  process.stdout.write(`transport: ${report.transport}\nstarted:   ${report.startedAt}\nduration:  ${(report.durationMs / 1000).toFixed(1)}s\n`);
  for (const section of report.markets) {
    process.stdout.write(`\n[${section.market.toUpperCase()}]\n`);
    if (section.universeError) {
      process.stdout.write(`  UNIVERSE UNAVAILABLE — ${section.universeError}\n`);
      continue;
    }
    const totalProbes = STATUSES.reduce((sum, s) => sum + section.probes[s], 0);
    process.stdout.write(`  instruments tested: ${section.instruments} · intervals: ${section.intervals.join(',')} · probes: ${totalProbes}\n`);
    process.stdout.write(`  probes      → PASS ${section.probes.PASS} · FAIL ${section.probes.FAIL} · NO_DATA ${section.probes.NO_DATA} · UNSUPPORTED ${section.probes.UNSUPPORTED} · RATE_LIMITED ${section.probes.RATE_LIMITED} · ERROR ${section.probes.ERROR}\n`);
    process.stdout.write(`  instruments → PASS ${section.instrumentTally.PASS} · FAIL ${section.instrumentTally.FAIL} · NO_DATA ${section.instrumentTally.NO_DATA} · UNSUPPORTED ${section.instrumentTally.UNSUPPORTED} · RATE_LIMITED ${section.instrumentTally.RATE_LIMITED} · ERROR ${section.instrumentTally.ERROR}\n`);
    if (section.problems.length > 0) {
      process.stdout.write(`  problem instruments (${section.problems.length}):\n`);
      for (const problem of section.problems.slice(0, 60)) {
        process.stdout.write(`    ${problem.status.padEnd(12)} ${problem.symbol}/${problem.interval} (${problem.exchangeSymbol}) — ${problem.reason}\n`);
      }
      if (section.problems.length > 60) process.stdout.write(`    …and ${section.problems.length - 60} more (see --json report)\n`);
    }
  }
  process.stdout.write('\n===========================================================\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write([
      'npm run diagnose:charts -- [flags]   (read-only chart diagnostics)',
      '  --market spot|futures|both   default both',
      `  --intervals a,b,c            default ${DEFAULT_INTERVALS.join(',')}`,
      '  --symbols BTC,ETH            explicit shortlist instead of the full universe',
      '  --limit N                    cap instruments per market',
      '  --concurrency N              parallel requests (1-8, default 4)',
      '  --pause-ms N                 pause between requests per worker (default 250)',
      '  --candles N                  klines per request (default 200)',
      '  --base-url URL               run through a live CRYPTORA server instead of in-process',
      '  --json PATH                  write the machine-readable report',
      '',
    ].join('\n'));
    return;
  }
  const transport = await createTransport(args.baseUrl);
  const startedAt = new Date().toISOString();
  const start = Date.now();
  process.stdout.write(`CRYPTORA chart diagnostics — READ ONLY (no DB writes, GET requests only)\ntransport: ${transport.label}\n`);

  const markets = args.market === 'both' ? ['spot', 'futures'] : [args.market];
  const sections = [];
  for (const market of markets) {
    sections.push(await diagnoseMarket(transport, market, args));
  }

  const report = {
    transport: transport.label,
    startedAt,
    durationMs: Date.now() - start,
    options: { market: args.market, intervals: args.intervals, limit: args.limit, concurrency: args.concurrency, pauseMs: args.pauseMs, candles: args.candles },
    markets: sections,
  };
  printSummary(report);

  if (args.json) {
    await mkdir(path.dirname(path.resolve(args.json)), { recursive: true });
    await writeFile(path.resolve(args.json), JSON.stringify(report, null, 2), 'utf8');
    process.stdout.write(`JSON report: ${args.json}\n`);
  }

  const hardFailures = sections.reduce((sum, section) => sum + (section.universeError ? 1 : section.probes.FAIL + section.probes.ERROR), 0);
  process.exitCode = hardFailures > 0 ? 1 : 0;
}

main().catch((error) => {
  process.stderr.write(`diagnose-charts failed: ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 2;
});

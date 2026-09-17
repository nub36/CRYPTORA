#!/usr/bin/env node
/**
 * OFFLINE operator script — Strategy Archive V3.0 reproduction on the pinned dataset.
 *
 *   • NOT called by the production UI; NOT executed on site start; NO private API.
 *   • Reads ONLY a local checkout of nub36/svechnoy-suslik-binance-data @ c3c1dce
 *     (Binance Spot monthly kline ZIPs, publicly re-hosted). Nothing is downloaded here.
 *   • Writes a reproduction report JSON; it does NOT change any committed artifact.
 *
 * Usage:
 *   git clone https://github.com/nub36/svechnoy-suslik-binance-data.git /path/dataset
 *   git -C /path/dataset checkout c3c1dcecfe2784a147f591f2b5b4526cbf99df9f
 *   node scripts/strategy-archive/reproduce-v30.mjs --dataset=/path/dataset --slice=train --out=/tmp/v30-train.json
 *
 * Layout expected (as in the dataset repo): <dataset>/<SYMBOL>/<tf>/<SYMBOL>-<tf>-YYYY-MM.zip
 * Each ZIP holds one CSV: openTime,open,high,low,close,volume,closeTime,... (openTime in ms or µs).
 *
 * Comparison target: src/services/strategyArchive/results/v30/v30-{train,validation}-metrics.json.
 * Only if funnel + n + grossRPerTrade + netRPerTrade match may the status be raised to REPRODUCED
 * (by a human, in a separate commit) — this script never edits the definition.
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

function arg(name, def) {
  const v = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
  if (v === undefined && def === undefined) throw new Error(`missing --${name}`);
  return v ?? def;
}

const dataset = arg('dataset');
const slice = arg('slice', 'train');
const out = arg('out');
const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT'];
const TF_MS = { '1h': 3_600_000, '4h': 14_400_000 };

const head = execFileSync('git', ['-C', dataset, 'rev-parse', 'HEAD']).toString().trim();
if (head !== 'c3c1dcecfe2784a147f591f2b5b4526cbf99df9f') {
  throw new Error(`dataset HEAD ${head} != pinned c3c1dce…`);
}

function loadSeries(symbol, tf) {
  const dir = join(dataset, symbol, tf);
  if (!existsSync(dir)) throw new Error(`missing ${dir}`);
  const zips = readdirSync(dir).filter((f) => f.endsWith('.zip')).sort();
  const rows = [];
  for (const z of zips) {
    // unzip -p streams the CSV; the archive contains exactly one file.
    const csv = execFileSync('unzip', ['-p', join(dir, z)], { maxBuffer: 1 << 28 }).toString();
    for (const line of csv.split('\n')) {
      if (!line || line.startsWith('open_time')) continue;
      const f = line.split(',');
      let t = Number(f[0]);
      if (t >= 1e15) t = Math.floor(t / 1000);        // µs → ms (2025 archives)
      rows.push({ openTime: t, open: +f[1], high: +f[2], low: +f[3], close: +f[4], volume: +f[5],
        closeTime: t + TF_MS[tf] - 1, isClosed: true });
    }
  }
  rows.sort((a, b) => a.openTime - b.openTime);
  return rows;
}

// Load the archive module through Vite-less ESM: compile step is required, so we go via tsx if present.
let archive;
try {
  archive = await import(pathToFileURL(join(process.cwd(), 'src/services/strategyArchive/index.ts')).href);
} catch {
  throw new Error('Run with tsx: `npx tsx scripts/strategy-archive/reproduce-v30.mjs …` (TypeScript sources).');
}
const { V30_DEFINITION, reproduce } = archive;

const series = [];
for (const s of SYMBOLS) {
  console.error(`loading ${s} …`);
  series.push({ symbol: s, bySeries: { '1h': loadSeries(s, '1h'), '4h': loadSeries(s, '4h') } });
}
const report = reproduce(V30_DEFINITION, series, slice);
const target = JSON.parse(readFileSync(
  join(process.cwd(), `src/services/strategyArchive/results/v30/v30-${slice}-metrics.json`), 'utf8'));
const comparison = {
  n: { source: target.n, reproduced: report.metrics.n },
  grossRPerTrade: { source: target.grossRPerTrade, reproduced: report.metrics.grossRPerTrade },
  netRPerTrade: { source: target.netRPerTrade.FUT_4, reproduced: report.metrics.netRPerTradeHeadline },
  funnel: { source: target.funnel, reproduced: report.funnel },
  match: target.n === report.metrics.n
    && target.grossRPerTrade === report.metrics.grossRPerTrade
    && target.netRPerTrade.FUT_4 === report.metrics.netRPerTradeHeadline,
};
writeFileSync(out, JSON.stringify({ datasetHead: head, slice, comparison,
  report: { ...report, trades: report.trades.length } }, null, 2));
console.log(JSON.stringify(comparison, null, 2));
console.log(comparison.match ? 'MATCH — eligible for REPRODUCED (manual status change)' : 'MISMATCH — keep NOT_RERUN / investigate');

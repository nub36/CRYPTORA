#!/usr/bin/env node
/**
 * OFFLINE operator script — Strategy Archive reproduction on the pinned dataset.
 * Generalised successor of reproduce-v30.mjs (kept for backwards compatibility).
 *
 *   • NOT called by the production UI; NOT executed on site start; NO private API.
 *   • Reads ONLY a local checkout of nub36/svechnoy-suslik-binance-data @ c3c1dce.
 *   • Writes a CRYPTORA_REPRODUCTION_EVIDENCE JSON; never edits committed artifacts.
 *
 * Usage (TypeScript sources → run through tsx):
 *   npx tsx scripts/strategy-archive/reproduce.mjs --dataset=/path/dataset \
 *       --version=V3_1_HTF_TREND_PULLBACK --slice=train [--variant=leg] --out=/tmp/x.json
 *
 * Comparison: the definition's variant artifact (or headline artifact) copied under
 * src/services/strategyArchive/results/. Status changes are made by a human commit.
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
const versionId = arg('version');
const slice = arg('slice', 'train');
const variant = arg('variant', '');
const out = arg('out');
const PINNED = 'c3c1dcecfe2784a147f591f2b5b4526cbf99df9f';
const TF_MS = { '15m': 900_000, '1h': 3_600_000, '4h': 14_400_000, '1d': 86_400_000 };

const head = execFileSync('git', ['-C', dataset, 'rev-parse', 'HEAD']).toString().trim();
if (head !== PINNED) throw new Error(`dataset HEAD ${head} != pinned ${PINNED}`);

function loadSeries(symbol, tf) {
  const dir = join(dataset, symbol, tf);
  if (!existsSync(dir)) throw new Error(`missing ${dir} — extend the sparse checkout`);
  const rows = [];
  for (const z of readdirSync(dir).filter((f) => f.endsWith('.zip')).sort()) {
    const csv = execFileSync('unzip', ['-p', join(dir, z)], { maxBuffer: 1 << 28 }).toString();
    for (const line of csv.split('\n')) {
      if (!line || line.startsWith('open_time')) continue;
      const f = line.split(',');
      let t = Number(f[0]);
      if (t >= 1e15) t = Math.floor(t / 1000);
      rows.push({ openTime: t, open: +f[1], high: +f[2], low: +f[3], close: +f[4], volume: +f[5],
        closeTime: t + TF_MS[tf] - 1, isClosed: true });
    }
  }
  rows.sort((a, b) => a.openTime - b.openTime);
  return rows;
}

const archive = await import(pathToFileURL(join(process.cwd(), 'src/services/strategyArchive/index.ts')).href);
const def = archive.STRATEGY_ARCHIVE.find((d) => d.id === versionId);
if (!def) throw new Error(`unknown version ${versionId}; known: ${archive.STRATEGY_ARCHIVE.map((d) => d.id).join(', ')}`);
const variantId = variant || def.headlineVariantId || undefined;
const tfs = [def.execTimeframe, def.structuralTimeframe].filter(Boolean);

const series = [];
for (const s of def.symbols) {
  console.error(`loading ${s} ${tfs.join('/')} …`);
  const bySeries = {};
  for (const tf of tfs) bySeries[tf] = loadSeries(s, tf);
  series.push({ symbol: s, bySeries });
}
const report = archive.reproduce(def, series, slice, undefined, variantId);

const v = def.variants?.find((x) => x.id === variantId);
const artifactRel = v ? v.artifactPath : def.sourcePins.find((p) => p.role === 'ARTIFACT')?.path;
const localArtifact = join(process.cwd(), 'src/services/strategyArchive/results', artifactRel.replace(/^artifacts\/research\//, ''));
const target = JSON.parse(readFileSync(localArtifact, 'utf8'));
const sha = execFileSync('sha256sum', [localArtifact]).toString().split(' ')[0];

const m = report.metrics;
const cmp = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// Source artifacts may name funnel keys differently (V3.2: cascadesWithVolume = signals).
const srcFunnel = target.funnel ? { ...target.funnel } : null;
if (srcFunnel && 'cascadesWithVolume' in srcFunnel) {
  srcFunnel.signals = srcFunnel.cascadesWithVolume; delete srcFunnel.cascadesWithVolume; delete srcFunnel.cascadesFailingAbsorption;
}
const norm = (f) => f && Object.fromEntries(Object.keys(report.funnel).map((k) => [k, f[k]]));
const checks = {
  n: cmp(target.n, m.n),
  funnel: cmp(norm(srcFunnel), norm(report.funnel)),
  grossRPerTrade: cmp(target.grossRPerTrade, m.grossRPerTrade),
  netRPerTrade: cmp(target.netRPerTrade?.FUT_4, m.netRPerTradeHeadline),
  netRPerTradeSpot: target.netRPerTrade?.SPOT === undefined ? null : cmp(target.netRPerTrade.SPOT, m.netRPerTradeStress),
  feeDragR: cmp(target.feeDragR?.FUT_4, m.feeDragRHeadline),
  profitFactor: cmp(target.profitFactor, m.profitFactor),
  maxDrawdownR: cmp(target.maxDrawdownR, m.maxDrawdownR),
  exits: cmp(target.exits, m.exits),
  bySymbol: cmp(target.bySymbol, m.bySymbol),
  byDirection: cmp(target.byDirection, m.byDirection),
  outlierDependence: cmp(
    { ...target.outlierDependence, edgeRetainedPct: undefined }, { ...m.outlierDependence, edgeRetainedPct: undefined }),
  stopDistancePct: cmp(target.stopDistancePct, m.stopDistancePct),
  medianBarsHeld: cmp(target.medianBarsHeld, m.medianBarsHeld),
  avgWinR: cmp(target.avgWinR, m.avgWinR),
  avgLossR: cmp(target.avgLossR, m.avgLossR),
  grossMedianR: cmp(target.grossMedianR, m.grossMedianR),
  positiveRRatePct: cmp(target.positiveRRatePct, m.positiveRRatePct),
};
// Version-specific extras derived from trade tags (TP1/TP2 hit rates, source splits) when present.
const tagged = report.trades.filter((t) => t.tags);
if (target.tp1HitRatePct !== undefined && tagged.length === report.trades.length && report.trades.length) {
  const n = report.trades.length;
  checks.tp1HitRatePct = cmp(target.tp1HitRatePct, +((tagged.filter((t) => t.tags.hitTp1).length / n) * 100).toFixed(2));
  checks.tp2HitRatePct = cmp(target.tp2HitRatePct, +((tagged.filter((t) => t.tags.hitTp2).length / n) * 100).toFixed(2));
}
const firstMismatch = Object.entries(checks).find(([, ok]) => ok === false)?.[0] ?? null;

const evidence = {
  kind: 'CRYPTORA_REPRODUCTION_EVIDENCE', origin: 'DERIVED_BY_CRYPTORA',
  versionId, variantId: variantId ?? null, slice,
  runAtUtc: new Date().toISOString(), runner: 'scripts/strategy-archive/reproduce.mjs',
  dataset: { repo: 'https://github.com/nub36/svechnoy-suslik-binance-data.git', commit: head, intervalsRead: tfs, symbols: def.symbols,
    loader: 'monthly ZIP → CSV, openTime µs→ms normalised, closeTime=open+span−1, isClosed=true' },
  sourceArtifact: { path: artifactRel, sha256: sha },
  deterministicDigest: report.deterministicDigest, tradeCount: report.trades.length, funnel: report.funnel,
  maxCandleOpenTimeRead: report.maxCandleOpenTimeRead, metrics: m,
  comparison: { checks, allMatched: firstMismatch === null, firstMismatch,
    source: { n: target.n, grossRPerTrade: target.grossRPerTrade, netRPerTrade: target.netRPerTrade, profitFactor: target.profitFactor, funnel: target.funnel } },
};
writeFileSync(out, JSON.stringify(evidence, null, 2));
console.log(JSON.stringify({ versionId, variantId, slice, n: m.n, gross: m.grossRPerTrade, net: m.netRPerTradeHeadline, pf: m.profitFactor, checks, firstMismatch }, null, 2));
console.log(firstMismatch === null ? 'MATCH' : `MISMATCH — first mismatch: ${firstMismatch}`);

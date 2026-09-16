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
const TF_MS = { '1m': 60_000, '5m': 300_000, '15m': 900_000, '30m': 1_800_000, '1h': 3_600_000, '4h': 14_400_000, '1d': 86_400_000 };

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
// V2.x pooled studies: load the whole scope plus the frozen HTF_MAP parents (1h/4h/1d) the engine consults.
const tfs = def.scopeTimeframes
  ? [...new Set([...def.scopeTimeframes, '1h', '4h', '1d'])]
  : [def.execTimeframe, def.structuralTimeframe].filter(Boolean);

const series = [];
for (const s of def.symbols) {
  console.error(`loading ${s} ${tfs.join('/')} …`);
  const bySeries = {};
  for (const tf of tfs) bySeries[tf] = loadSeries(s, tf);
  series.push({ symbol: s, bySeries });
}
const report = archive.reproduce(def, series, slice, undefined, variantId);

const v = def.variants?.find((x) => x.id === variantId);
// Prefer the ARTIFACT pin whose file name carries the slice (v28-train-… vs v28-validation-…); fall back to the
// variant's artifact, then the first ARTIFACT pin.
const slicePin = def.sourcePins.find((p) => p.role === 'ARTIFACT' && p.path.includes(`-${slice}-`))?.path;
const artifactRel = (v && v.artifactPath.includes(`-${slice}-`)) ? v.artifactPath
  : (slicePin ?? (v ? v.artifactPath : def.sourcePins.find((p) => p.role === 'ARTIFACT')?.path));
const localArtifact = join(process.cwd(), 'src/services/strategyArchive/results', artifactRel.replace(/^artifacts\/research\//, ''));
const artifactFile = JSON.parse(readFileSync(localArtifact, 'utf8'));
// V2.7/V2.8 artifacts hold several `arms`; the variant is one arm. Normalise to the flat V3.x shape.
let target = artifactFile;
// V2.2–V2.6 artifacts: `arms` is an OBJECT keyed by arm name with the v2x-train.ts field names.
if (artifactFile.arms && !Array.isArray(artifactFile.arms)) {
  const a = artifactFile.arms[variantId];
  if (!a) throw new Error(`arm ${variantId} not in artifact`);
  const head = a.netByFeeEnv?.FUT_7 && a.headlineEnv?.startsWith('FUT_7') ? 'FUT_7'
    : a.netByFeeEnv?.FUT_4 && !a.netByFeeEnv?.FUT_7 ? 'FUT_4'
      : (artifactFile.headlineLabel ? 'FUT_4' : 'FUT_7');
  const exits = a.exitReasons ?? (a.tp !== undefined ? { TP: a.tp, SL: a.sl, TIMEOUT: a.timeout } : undefined);
  target = {
    n: a.closed,
    grossRPerTrade: a.grossExpectancyPerFilled ?? a.grossExpectancyPerTrade,
    netRPerTrade: { [head === 'FUT_7' ? 'FUT_4' : 'FUT_4']: a.netByFeeEnv[head].perFilled, SPOT: a.netByFeeEnv.SPOT?.perFilled },
    feeDragR: { FUT_4: a.netByFeeEnv[head].meanFeeDragR },
    profitFactor: a.grossPF,
    maxDrawdownR: a.maxDrawdownR,
    exits,
    bySymbol: a.bySymbol, byDirection: a.byDirection, byTimeframe: a.byTimeframe,
    outlierDependence: a.outlierDependence,
    medianBarsHeld: a.medianBarsHeld,
    avgWinR: a.avgWin, avgLossR: a.avgLoss !== undefined ? -Math.abs(a.avgLoss) : undefined,
    grossMedianR: a.grossMedianR,
    positiveRRatePct: a.positiveRRate ?? a.winRate,
    funnel: { signals: a.actionableSetups ?? artifactFile.actionableSetups, pendingCreated: a.pendingCreated, filled: a.closed },
    stopDistancePct: undefined, tp1HitRatePct: undefined,
  };
  // Some fields are absent in the v22–v24 artifacts; comparison treats undefined source as "not checked".
  for (const k of Object.keys(target)) if (target[k] === undefined) delete target[k];
}
if (Array.isArray(artifactFile.arms)) {
  const a = artifactFile.arms.find((x) => x.arm === variantId);
  if (!a) throw new Error(`arm ${variantId} not in artifact`);
  target = {
    ...a,
    funnel: { signals: artifactFile.actionableSetups, pendingCreated: artifactFile.sniperEntries, filled: a.n },
    netRPerTrade: a.netRPerTrade !== undefined ? { FUT_4: a.netRPerTrade, SPOT: a.netRPerTradeStress55 } : { FUT_4: a.grossRPerTrade },
    feeDragR: a.feeRPerTrade !== undefined ? { FUT_4: a.feeRPerTrade } : { FUT_4: 0 },
    profitFactor: a.profitFactor ?? a.grossPF,
    stopDistancePct: undefined, tp1HitRatePct: undefined,
  };
}
const sha = execFileSync('sha256sum', [localArtifact]).toString().split(' ')[0];

const m = report.metrics;
const canon = (v) => (v && typeof v === 'object' && !Array.isArray(v))
  ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])]))
  : Array.isArray(v) ? v.map(canon) : v;
// key-order-insensitive deep equality (source artifacts and CRYPTORA reports may list object keys in different order)
const cmp = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
// Source artifacts may name funnel keys differently (V3.2: cascadesWithVolume = signals).
const srcFunnel = target.funnel ? { ...target.funnel } : null;
if (srcFunnel && 'cascadesWithVolume' in srcFunnel) {
  srcFunnel.signals = srcFunnel.cascadesWithVolume; delete srcFunnel.cascadesWithVolume; delete srcFunnel.cascadesFailingAbsorption;
}
// V3.3: funnel has `triggersInZone` (= signals) plus zone-level counters that live in report extras.
if (srcFunnel && 'triggersInZone' in srcFunnel && !('signals' in srcFunnel)) srcFunnel.signals = srcFunnel.triggersInZone;
const norm = (f) => f && Object.fromEntries(Object.keys(report.funnel).map((k) => [k, f[k]]));
const armMode = !!artifactFile.arms;
const objArm = artifactFile.arms && !Array.isArray(artifactFile.arms);
const normArm = (f) => f && Object.fromEntries(['signals', 'pendingCreated', 'filled'].map((k) => [k, f[k]]));
const checks = {
  n: cmp(target.n, m.n),
  funnel: armMode ? cmp(normArm(srcFunnel), normArm(report.funnel)) : cmp(norm(srcFunnel), norm(report.funnel)),
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
  stopDistancePct: target.stopDistancePct === undefined ? null : cmp(target.stopDistancePct, m.stopDistancePct),
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
// V2.x arms carry a byTimeframe split (pooled 15m/30m/1h/4h) — derived from trade tags.
if (target.byTimeframe !== undefined) {
  const g = new Map();
  for (const t of report.trades) { const k = t.tags?.timeframe; const e = g.get(k) ?? { n: 0, sum: 0 }; e.n++; e.sum += t.grossR; g.set(k, e); }
  const got = Object.fromEntries([...g].map(([k, v]) => [k, { n: v.n, grossExpectancy: +(v.sum / v.n).toFixed(4) }]));
  checks.byTimeframe = cmp(target.byTimeframe, got);
}
if (target.winRatePct !== undefined || target.winRateTargetPct !== undefined) {
  const n = report.trades.length;
  const hit = report.trades.filter((t) => t.tags?.hitTp === true || t.tags?.hitTarget === true).length;
  checks.winRatePct = cmp(target.winRatePct ?? target.winRateTargetPct, n ? +((hit / n) * 100).toFixed(2) : 0);
}
if (objArm) {
  const srcKey = { n: 'n', grossRPerTrade: 'grossRPerTrade', netRPerTrade: 'netRPerTrade', netRPerTradeSpot: 'netRPerTrade', feeDragR: 'feeDragR', profitFactor: 'profitFactor', maxDrawdownR: 'maxDrawdownR', exits: 'exits', bySymbol: 'bySymbol', byDirection: 'byDirection', outlierDependence: 'outlierDependence', medianBarsHeld: 'medianBarsHeld', avgWinR: 'avgWinR', avgLossR: 'avgLossR', grossMedianR: 'grossMedianR', positiveRRatePct: 'positiveRRatePct', byTimeframe: 'byTimeframe', winRatePct: 'winRatePct' };
  for (const [k, sk] of Object.entries(srcKey)) if (target[sk] === undefined) checks[k] = null;
  // v22–v26 funnel: signals = actionable setups, pendingCreated = source `pendingCreated`/entries, filled = closed.
  const hasPending = srcFunnel?.pendingCreated !== undefined;
  const fa = (f) => f && { signals: f.signals, ...(hasPending ? { pendingCreated: f.pendingCreated } : {}), filled: f.filled };
  checks.funnel = cmp(fa(srcFunnel), fa(report.funnel));
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

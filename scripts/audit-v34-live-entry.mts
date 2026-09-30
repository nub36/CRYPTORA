/**
 * CRYPTORA — READ-ONLY аудит СЕМАНТИКИ ВХОДА V3.4 В LIVE.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ КОНТРАКТ БЕЗОПАСНОСТИ                                                    ║
 * ║  • Скрипт ничего не меняет: ни кода стратегий, ни БД, ни настроек, ни    ║
 * ║    константы V34_ENTRY_ZONE_ATR_PAD. Только чтение с диска + печать.     ║
 * ║  • Сети нет, БД нет, продакшена нет.                                     ║
 * ║  • Сетапы берутся ПРОДУКТОВЫМ `runV34LiveReplay` (тот же вызов, что      ║
 * ║    делает LiveSignalEngine), без параллельной реализации правил.         ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * ВОПРОС. Исторический реплей ведёт сделку по ЗАКРЫТЫМ 1H-барам, и вход в
 * коридор там практически гарантирован (коридор центрирован на close бара
 * сетапа, а open следующего бара равен этому close). Нужно проверить то же
 * самое на минутных данных, ближе к реальной последовательности событий:
 *
 *   1. бар N (1H) закрывается в момент T0;
 *   2. планировщик через ≤ tick+interval запускает скан, сетап публикуется
 *      в момент T0 + lag;
 *   3. где в этот момент цена относительно базовой (±0.10 ATR) и расширенной
 *      (±0.35 ATR) зоны?
 *   4. если бы вход исполнялся ВНУТРИБАРНЫМ лимитным ордером, выставленным в
 *      момент публикации, дало бы расширение дополнительные исполнения?
 *
 * Пункт 4 — ГИПОТЕТИЧЕСКАЯ модель: продуктовый код так НЕ работает (он ведёт
 * коридор по закрытым 1H-барам, см. lifecycle.ts / signalMonitor.js). Она
 * нужна только чтобы численно оценить, чего расширение стоит в семантике,
 * которой в системе сейчас нет.
 *
 * Данные: закреплённый датасет исследования
 *   repo   https://github.com/nub36/svechnoy-suslik-binance-data
 *   commit c3c1dcecfe2784a147f591f2b5b4526cbf99df9f
 * (тот же commit в src/services/strategyArchive/provenance/dataset-manifest.c3c1dce.json)
 *
 * Запуск:
 *   node_modules/.bin/vite-node scripts/audit-v34-live-entry.mts -- --data /tmp/ds
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { ArchiveCandle } from '@/services/strategyArchive/types';
import type { ReplayRecord } from '@/services/signals/live/replays/types';
import { runV33LiveReplay, type V33CorridorCtx, type V33CorridorPlan } from '@/services/signals/live/replays/v33LiveReplay';
import { v34CorridorHook } from '@/services/signals/live/replays/v34LiveReplay';
import { V34_ENTRY_ZONE_ATR_PAD } from '@/services/signals/live/targetQuality';
import { V33_CONSTANTS } from '@/services/strategyArchive/definitions/v3_3-htf-zone-mitigation/v33Core';

/* ─────────────────────────────────────────────────────────── аргументы ── */

const argv = process.argv.slice(2);
const arg = (name: string, dflt: string | null = null): string | null => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1]! : dflt;
};
const DATA_DIR = arg('data', '/tmp/ds')!;
const JSON_OUT = arg('json');
const SYMBOLS = (arg('symbols', 'BTCUSDT,ETHUSDT,BNBUSDT,SOLUSDT,XRPUSDT,DOGEUSDT')!).split(',');
/** Задержки публикации относительно закрытия бара N, секунды. */
const LAGS_S = (arg('lags', '0,15,30,60,90,120,300')!).split(',').map(Number);
/** Задержка, используемая как базовая в гипотетической внутрибарной модели. */
const PRIMARY_LAG_S = Number(arg('primaryLag', '60'));

const HOUR = 3_600_000;
const MINUTE = 60_000;
const BASE_FRAC = V33_CONSTANTS.CORRIDOR_ATR_FRAC;          // 0.10
const EXP_FRAC = BASE_FRAC + V34_ENTRY_ZONE_ATR_PAD;        // 0.35
const EXPIRY_BARS = V33_CONSTANTS.CORRIDOR_EXPIRY_BARS;     // 3

/* ────────────────────────────────────────────────────── загрузка свечей ── */

function parseCsvRows(text: string, cb: (t: number, o: number, h: number, l: number, c: number, v: number) => void): void {
  let i = 0;
  const n = text.length;
  while (i < n) {
    let j = text.indexOf('\n', i);
    if (j < 0) j = n;
    const line = text.slice(i, j);
    i = j + 1;
    if (!line) continue;
    const f = line.split(',');
    if (f.length < 6) continue;
    let t = Number(f[0]);
    if (!Number.isFinite(t)) continue;          // строка заголовка новых архивов
    if (t > 1e15) t = Math.floor(t / 1000);     // микросекунды → миллисекунды
    const o = Number(f[1]), h = Number(f[2]), l = Number(f[3]), c = Number(f[4]), v = Number(f[5]);
    if (!(Number.isFinite(o) && Number.isFinite(h) && Number.isFinite(l) && Number.isFinite(c) && Number.isFinite(v))) continue;
    cb(t, o, h, l, c, v);
  }
}

function loadSeries(symbol: string, tf: '1h' | '4h'): ArchiveCandle[] {
  const dir = path.join(DATA_DIR, symbol, tf);
  if (!fs.existsSync(dir)) throw new Error(`нет каталога данных: ${dir}`);
  const span = tf === '1h' ? HOUR : 4 * HOUR;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.zip')).sort();
  const seen = new Set<number>();
  const all: ArchiveCandle[] = [];
  for (const f of files) {
    const csv = execFileSync('unzip', ['-p', path.join(dir, f)], { maxBuffer: 1 << 28 }).toString('utf8');
    parseCsvRows(csv, (t, o, h, l, c, v) => {
      if (seen.has(t)) return;
      seen.add(t);
      all.push({ openTime: t, open: o, high: h, low: l, close: c, volume: v, closeTime: t + span - 1, isClosed: true });
    });
  }
  all.sort((a, b) => a.openTime - b.openTime);
  return all;
}

/** Минутный ряд в типизированных массивах: 2.1 млн баров × 6 символов не помещаются как объекты. */
interface Minutes { t: Float64Array; o: Float64Array; h: Float64Array; l: Float64Array; c: Float64Array; n: number }

function loadMinutes(symbol: string): Minutes {
  const dir = path.join(DATA_DIR, symbol, '1m');
  if (!fs.existsSync(dir)) throw new Error(`нет минутных данных: ${dir}`);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.zip')).sort();
  let cap = 1 << 20;
  let t = new Float64Array(cap), o = new Float64Array(cap), h = new Float64Array(cap), l = new Float64Array(cap), c = new Float64Array(cap);
  let n = 0;
  const grow = () => {
    cap *= 2;
    const gt = new Float64Array(cap); gt.set(t); t = gt;
    const go = new Float64Array(cap); go.set(o); o = go;
    const gh = new Float64Array(cap); gh.set(h); h = gh;
    const gl = new Float64Array(cap); gl.set(l); l = gl;
    const gc = new Float64Array(cap); gc.set(c); c = gc;
  };
  for (const f of files) {
    const csv = execFileSync('unzip', ['-p', path.join(dir, f)], { maxBuffer: 1 << 29 }).toString('utf8');
    parseCsvRows(csv, (tt, oo, hh, ll, cc) => {
      if (n > 0 && tt <= t[n - 1]!) return;    // дубли/несортированность внутри архива
      if (n === cap) grow();
      t[n] = tt; o[n] = oo; h[n] = hh; l[n] = ll; c[n] = cc; n++;
    });
  }
  return { t, o, h, l, c, n };
}

/** Индекс последнего минутного бара с openTime <= ts (−1, если такого нет). */
function idxAtOrBefore(m: Minutes, ts: number): number {
  let lo = 0, hi = m.n - 1, res = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (m.t[mid]! <= ts) { res = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return res;
}

/* ───────────────────────────────────────── сетапы продуктовой V3.4 ── */

interface Captured { close: number; atr: number; baseLow: number; baseHigh: number; rejected: boolean }

/**
 * Продуктовый hook V3.4 + запись контекста. Возвращаемое значение НЕ меняется:
 * `capture` только копирует то, что hook получил и отдал, поэтому сетапы
 * остаются ровно такими же, как в LiveSignalEngine.
 */
function capturingHook(sink: Captured[]) {
  return (ctx: V33CorridorCtx): V33CorridorPlan => {
    const plan = v34CorridorHook(ctx);
    sink.push({
      close: ctx.close, atr: ctx.atr, baseLow: ctx.baseLow, baseHigh: ctx.baseHigh,
      rejected: typeof plan.rejectReason === 'string' && plan.rejectReason.length > 0,
    });
    return plan;
  };
}

/* ──────────────────────────────────────────────────────── аккумуляторы ── */

interface LagStat {
  lagS: number;
  n: number;
  insideBase: number;
  insideExpanded: number;
  outsideBothBeyond: number;   // цена ушла ЗА зону в сторону, противоположную входу
  outsideBothAgainst: number;  // цена ушла ЗА зону в сторону входа (вход стал бы лучше)
  distAtr: number[];           // расстояние до ближайшей грани базовой зоны, в ATR (0 внутри)
  driftAtr: number[];          // |price − close| / ATR
}

const blankLag = (lagS: number): LagStat => ({
  lagS, n: 0, insideBase: 0, insideExpanded: 0, outsideBothBeyond: 0, outsideBothAgainst: 0,
  distAtr: [], driftAtr: [],
});

interface IntrabarStat {
  n: number;
  baseFilled: number;
  expFilled: number;
  expansionOnly: number;
  baseCancelledByStop: number;
  expCancelledByStop: number;
  baseNoTouch: number;
  expNoTouch: number;
  immediateBase: number;       // базовая зона касается уже на первой минуте после публикации
  immediateExp: number;
  expansionOnlyDetail: string[];
}

const blankIntrabar = (): IntrabarStat => ({
  n: 0, baseFilled: 0, expFilled: 0, expansionOnly: 0,
  baseCancelledByStop: 0, expCancelledByStop: 0, baseNoTouch: 0, expNoTouch: 0,
  immediateBase: 0, immediateExp: 0, expansionOnlyDetail: [],
});

function quantile(sorted: number[], q: number): number | null {
  if (sorted.length === 0) return null;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return lo === hi ? sorted[lo]! : sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (i - lo);
}

/* ───────────────────────────────────────────────────────────── прогон ── */

const lagStats = new Map<number, LagStat>(LAGS_S.map((s) => [s, blankLag(s)]));
const intrabar = blankIntrabar();
const perSymbol: Record<string, { setups: number; publishable: number; withMinutes: number }> = {};
let totalSetups = 0, totalPublishable = 0;
let gapNoMinute = 0;

for (const symbol of SYMBOLS) {
  const h1 = loadSeries(symbol, '1h');
  const h4 = loadSeries(symbol, '4h');
  const captured: Captured[] = [];
  const out = runV33LiveReplay({ symbol, h1, h4, corridor: capturingHook(captured) });
  const recs: ReplayRecord[] = out.records;
  if (recs.length !== captured.length) {
    throw new Error(`несоответствие записей и вызовов hook: ${recs.length} ≠ ${captured.length}`);
  }
  const minutes = loadMinutes(symbol);
  const st = { setups: recs.length, publishable: 0, withMinutes: 0 };

  for (let k = 0; k < recs.length; k++) {
    const r = recs[k]!;
    const cap = captured[k]!;
    totalSetups++;
    // Живьём публикуются только publishable-сетапы (LiveSignalEngine.scanSymbol).
    if (!r.publishable) continue;
    st.publishable++;
    totalPublishable++;

    const long = r.direction === 'LONG';
    const atr = cap.atr;
    const baseLow = cap.baseLow, baseHigh = cap.baseHigh;
    const expLow = r.entryZone[0], expHigh = r.entryZone[1];
    const t0 = r.setupOpenTime + HOUR;   // момент закрытия бара сетапа

    // ── цена в момент публикации, по минутным данным ──────────────────
    let haveMinutes = false;
    for (const lagS of LAGS_S) {
      const ts = t0 + lagS * 1000;
      // последний ЗАКРЫВШИЙСЯ минутный бар на момент ts: его close — цена рынка
      const idx = idxAtOrBefore(minutes, ts - MINUTE);
      if (idx < 0) continue;
      const barT = minutes.t[idx]!;
      // без данных рядом с сетапом сравнение бессмысленно (пропуск в серии)
      if (ts - barT > 10 * MINUTE) continue;
      const price = minutes.c[idx]!;
      const s = lagStats.get(lagS)!;
      s.n++;
      haveMinutes = true;
      const inBase = price >= baseLow && price <= baseHigh;
      const inExp = price >= expLow && price <= expHigh;
      if (inBase) s.insideBase++;
      if (inExp) s.insideExpanded++;
      if (!inExp) {
        // «за зоной в сторону входа» = цена ушла туда, откуда лимит уже не нужен
        const favourable = long ? price < expLow : price > expHigh;
        if (favourable) s.outsideBothAgainst++; else s.outsideBothBeyond++;
      }
      const dist = price < baseLow ? baseLow - price : price > baseHigh ? price - baseHigh : 0;
      s.distAtr.push(atr > 0 ? dist / atr : 0);
      s.driftAtr.push(atr > 0 ? Math.abs(price - cap.close) / atr : 0);
    }
    if (haveMinutes) st.withMinutes++; else { gapNoMinute++; continue; }

    // ── ГИПОТЕТИЧЕСКАЯ внутрибарная модель лимитного входа ────────────
    // Ордер выставлен в момент публикации; окно жизни коридора — те же
    // CORRIDOR_EXPIRY_BARS часовых баров, что и в продуктовом коридоре.
    const tStart = t0 + PRIMARY_LAG_S * 1000;
    const tEnd = r.setupOpenTime + (EXPIRY_BARS + 1) * HOUR;
    let i = idxAtOrBefore(minutes, tStart);
    if (i < 0) continue;
    if (minutes.t[i]! < tStart) i++;           // первый бар, начавшийся не раньше публикации
    if (i >= minutes.n || minutes.t[i]! >= tEnd) continue;

    intrabar.n++;
    const scan = (zLow: number, zHigh: number): { kind: 'FILL' | 'STOP' | 'NONE'; minutesWaited: number } => {
      let j = i;
      let waited = 0;
      while (j < minutes.n && minutes.t[j]! < tEnd) {
        const lo = minutes.l[j]!, hi = minutes.h[j]!;
        const touches = long ? lo <= zHigh : hi >= zLow;
        const hitStop = long ? lo <= r.stop : hi >= r.stop;
        if (touches && hitStop) return { kind: 'STOP', minutesWaited: waited };
        if (touches) return { kind: 'FILL', minutesWaited: waited };
        if (hitStop) return { kind: 'STOP', minutesWaited: waited };
        j++; waited++;
      }
      return { kind: 'NONE', minutesWaited: waited };
    };
    const rb = scan(baseLow, baseHigh);
    const re = scan(expLow, expHigh);
    if (rb.kind === 'FILL') { intrabar.baseFilled++; if (rb.minutesWaited === 0) intrabar.immediateBase++; }
    if (rb.kind === 'STOP') intrabar.baseCancelledByStop++;
    if (rb.kind === 'NONE') intrabar.baseNoTouch++;
    if (re.kind === 'FILL') { intrabar.expFilled++; if (re.minutesWaited === 0) intrabar.immediateExp++; }
    if (re.kind === 'STOP') intrabar.expCancelledByStop++;
    if (re.kind === 'NONE') intrabar.expNoTouch++;
    if (re.kind === 'FILL' && rb.kind !== 'FILL') {
      intrabar.expansionOnly++;
      if (intrabar.expansionOnlyDetail.length < 25) {
        intrabar.expansionOnlyDetail.push(
          `${symbol} ${new Date(r.setupOpenTime).toISOString().slice(0, 16)} ${r.direction} ` +
          `база ${rb.kind}, расширение FILL через ${re.minutesWaited} мин`,
        );
      }
    }
  }
  perSymbol[symbol] = st;
  // eslint-disable-next-line no-console
  console.log(`${symbol}: 1h=${h1.length} 4h=${h4.length} 1m=${minutes.n} · сетапов ${st.setups}, publishable ${st.publishable}`);
}

/* ──────────────────────────────────────────────────────────── отчёт ── */

const pad = (s: string | number, w: number) => String(s).padStart(w);
const pct = (a: number, b: number) => (b ? ((a / b) * 100).toFixed(2) : '—');

console.log('\n' + '═'.repeat(70));
console.log('V3.4 LIVE ENTRY SEMANTICS AUDIT — READ ONLY');
console.log('═'.repeat(70));
console.log(`Датасет     : svechnoy-suslik-binance-data @ c3c1dce (Binance Spot 1m/1h/4h)`);
console.log(`Символы     : ${SYMBOLS.join(', ')}`);
console.log(`Базовая зона: close ± ${BASE_FRAC} ATR(1H)   расширенная: close ± ${EXP_FRAC} ATR(1H)`);
console.log(`Сетапов     : ${totalSetups}, из них publishable (публикуются живьём): ${totalPublishable}`);
if (gapNoMinute) console.log(`Без минутных данных рядом с сетапом: ${gapNoMinute}`);

console.log('\n── ЦЕНА В МОМЕНТ ПУБЛИКАЦИИ (минутные данные) ─────────────────────');
console.log(`  задержка    n     в базовой зоне     в расширенной   |дрейф| медиана ATR`);
for (const lagS of LAGS_S) {
  const s = lagStats.get(lagS)!;
  const drift = [...s.driftAtr].sort((a, b) => a - b);
  console.log(
    `  ${pad(lagS + 'с', 7)} ${pad(s.n, 6)}   ` +
    `${pad(s.insideBase, 6)} (${pad(pct(s.insideBase, s.n), 6)} %)   ` +
    `${pad(s.insideExpanded, 6)} (${pad(pct(s.insideExpanded, s.n), 6)} %)   ` +
    `${pad((quantile(drift, 0.5) ?? 0).toFixed(4), 8)}`,
  );
}

console.log('\n── РАССТОЯНИЕ ДО БАЗОВОЙ ЗОНЫ В МОМЕНТ ПУБЛИКАЦИИ (ATR) ───────────');
console.log(`  задержка   p50      p75      p90      p99      max`);
for (const lagS of LAGS_S) {
  const s = lagStats.get(lagS)!;
  const d = [...s.distAtr].sort((a, b) => a - b);
  const f = (q: number) => pad((quantile(d, q) ?? 0).toFixed(4), 8);
  console.log(`  ${pad(lagS + 'с', 7)} ${f(0.5)} ${f(0.75)} ${f(0.9)} ${f(0.99)} ${pad((d[d.length - 1] ?? 0).toFixed(4), 8)}`);
}

console.log('\n── ГИПОТЕТИЧЕСКИЙ ВНУТРИБАРНЫЙ ЛИМИТ (продуктовый код так НЕ работает) ──');
console.log(`  ордер выставлен через ${PRIMARY_LAG_S} с после закрытия бара сетапа,`);
console.log(`  живёт ${EXPIRY_BARS} часовых бара, проверка по минутным барам`);
console.log(`  сетапов в модели                ${intrabar.n}`);
console.log(`  БАЗОВАЯ зона: исполнено         ${intrabar.baseFilled} (${pct(intrabar.baseFilled, intrabar.n)} %)`);
console.log(`                отменено стопом   ${intrabar.baseCancelledByStop}`);
console.log(`                не коснулась      ${intrabar.baseNoTouch}`);
console.log(`                исполнено сразу   ${intrabar.immediateBase} (${pct(intrabar.immediateBase, intrabar.baseFilled)} % от исполненных)`);
console.log(`  РАСШИРЕННАЯ:  исполнено         ${intrabar.expFilled} (${pct(intrabar.expFilled, intrabar.n)} %)`);
console.log(`                отменено стопом   ${intrabar.expCancelledByStop}`);
console.log(`                не коснулась      ${intrabar.expNoTouch}`);
console.log(`                исполнено сразу   ${intrabar.immediateExp} (${pct(intrabar.immediateExp, intrabar.expFilled)} % от исполненных)`);
console.log(`  ТОЛЬКО ЗА СЧЁТ РАСШИРЕНИЯ       ${intrabar.expansionOnly} (${pct(intrabar.expansionOnly, intrabar.n)} %)`);
for (const d of intrabar.expansionOnlyDetail) console.log(`    · ${d}`);

console.log('\nПримечание: ни одна константа и ни одна строка продуктового кода не изменены.');

if (JSON_OUT) {
  const json = {
    dataset: { repo: 'svechnoy-suslik-binance-data', commit: 'c3c1dcecfe2784a147f591f2b5b4526cbf99df9f' },
    symbols: SYMBOLS, perSymbol, totalSetups, totalPublishable, gapNoMinute,
    baseFrac: BASE_FRAC, expandedFrac: EXP_FRAC, primaryLagS: PRIMARY_LAG_S, expiryBars: EXPIRY_BARS,
    lags: LAGS_S.map((lagS) => {
      const s = lagStats.get(lagS)!;
      const d = [...s.distAtr].sort((a, b) => a - b);
      const dr = [...s.driftAtr].sort((a, b) => a - b);
      return {
        lagS, n: s.n, insideBase: s.insideBase, insideExpanded: s.insideExpanded,
        outsideFavourable: s.outsideBothAgainst, outsideAdverse: s.outsideBothBeyond,
        distAtr: { p50: quantile(d, 0.5), p75: quantile(d, 0.75), p90: quantile(d, 0.9), p99: quantile(d, 0.99), max: d[d.length - 1] ?? null },
        driftAtr: { p50: quantile(dr, 0.5), p90: quantile(dr, 0.9), max: dr[dr.length - 1] ?? null },
      };
    }),
    intrabar: { ...intrabar, expansionOnlyDetail: intrabar.expansionOnlyDetail },
  };
  fs.writeFileSync(JSON_OUT, JSON.stringify(json, null, 2));
  console.log(`\nJSON: ${JSON_OUT}`);
}

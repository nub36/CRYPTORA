/**
 * CRYPTORA — READ-ONLY аудит чувствительности V3.4 к ширине расширения входа.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ КОНТРАКТ БЕЗОПАСНОСТИ                                                    ║
 * ║  • Скрипт НИЧЕГО не меняет: ни кода стратегий, ни БД, ни настроек, ни    ║
 * ║    константы V34_ENTRY_ZONE_ATR_PAD. Он только читает свечи и печатает   ║
 * ║    отчёт (плюс опциональный --json на диск).                             ║
 * ║  • Математика V3.0 / V3.3 не трогается: используется штатный             ║
 * ║    `runV33LiveReplay` с тем же hook-механизмом, что и продуктовая V3.4.  ║
 * ║  • Для pad = 0.25 локальный hook сверяется с продуктовым                 ║
 * ║    `v34CorridorHook` побайтово — иначе скрипт падает. Аудит не может     ║
 * ║    «уехать» от реальной стратегии незаметно.                             ║
 * ║  • Никакой сети и никакой БД: данные читаются с локального диска.        ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Данные: закреплённый датасет исследования
 *   repo   https://github.com/nub36/svechnoy-suslik-binance-data
 *   commit c3c1dcecfe2784a147f591f2b5b4526cbf99df9f
 *   (оригинальные месячные ZIP Binance Spot из data.binance.vision)
 * Тот же commit записан в src/services/strategyArchive/provenance/dataset-manifest.c3c1dce.json.
 *
 * Синтетическая фикстура тестов ЗДЕСЬ НЕ ИСПОЛЬЗУЕТСЯ — она остаётся только
 * для детерминированных регрессий.
 *
 * Запуск:
 *   node_modules/.bin/vite-node scripts/audit-v34-expansion.mts -- --data /path/to/dataset
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { ArchiveCandle } from '@/services/strategyArchive/types';
import type { ReplayRecord } from '@/services/signals/live/replays/types';
import {
  runV33LiveReplay, type V33CorridorHook, type V33CorridorPlan,
} from '@/services/signals/live/replays/v33LiveReplay';
import { v34CorridorHook, V34_STRATEGY_ID } from '@/services/signals/live/replays/v34LiveReplay';
import {
  evaluateTargetQuality, expandEntryZone, V34_ENTRY_ZONE_ATR_PAD,
  V34_TP1_MIN_R, V34_TP2_MIN_R,
} from '@/services/signals/live/targetQuality';

// expandEntryZone используется только в проверке паритета — сам аудит считает
// отступ с переменной долей ATR.
void expandEntryZone;

/* ─────────────────────────────────────────────────────────── аргументы ── */

const argv = process.argv.slice(2);
const arg = (name: string, dflt: string | null = null): string | null => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1]! : dflt;
};
const DATA_DIR = arg('data', '/tmp/ds')!;
const JSON_OUT = arg('json');
const SYMBOLS = (arg('symbols', 'BTCUSDT,ETHUSDT,BNBUSDT,SOLUSDT,XRPUSDT,DOGEUSDT')!).split(',');
const PADS = (arg('pads', '0.00,0.05,0.10,0.15,0.20,0.25,0.30')!).split(',').map(Number);

/* ────────────────────────────────────────────────────── загрузка свечей ── */

/** Binance monthly kline CSV → ArchiveCandle. Единицы времени определяются по величине. */
function parseCsv(text: string, spanMs: number): ArchiveCandle[] {
  const out: ArchiveCandle[] = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    const f = line.split(',');
    if (f.length < 6) continue;
    let t = Number(f[0]);
    if (!Number.isFinite(t)) continue;           // строка заголовка новых архивов
    if (t > 1e15) t = Math.floor(t / 1000);      // микросекунды → миллисекунды
    const open = Number(f[1]), high = Number(f[2]), low = Number(f[3]);
    const close = Number(f[4]), volume = Number(f[5]);
    if (![open, high, low, close, volume].every(Number.isFinite)) continue;
    out.push({ openTime: t, open, high, low, close, volume, closeTime: t + spanMs - 1, isClosed: true });
  }
  return out;
}

function loadSeries(symbol: string, tf: '1h' | '4h'): ArchiveCandle[] {
  const dir = path.join(DATA_DIR, symbol, tf);
  if (!fs.existsSync(dir)) throw new Error(`нет каталога данных: ${dir}`);
  const span = tf === '1h' ? 3_600_000 : 4 * 3_600_000;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.zip')).sort();
  const seen = new Set<number>();
  const all: ArchiveCandle[] = [];
  for (const f of files) {
    const csv = execFileSync('unzip', ['-p', path.join(dir, f)], { maxBuffer: 1 << 28 }).toString('utf8');
    for (const c of parseCsv(csv, span)) {
      if (seen.has(c.openTime)) continue;
      seen.add(c.openTime);
      all.push(c);
    }
  }
  all.sort((a, b) => a.openTime - b.openTime);
  return all;
}

/* ───────────────────────────────────────────── параметризованный hook ── */

/**
 * Тот же алгоритм, что у продуктового `v34CorridorHook`, но с переменным
 * отступом. Для pad = 0.25 совпадение с продуктовым hook'ом проверяется
 * отдельно (`assertHookParity`), поэтому подмены стратегии здесь быть не может.
 */
function makeHook(padAtr: number): V33CorridorHook {
  return (ctx): V33CorridorPlan => {
    // Та же формула, что в expandEntryZone, но с переменной долей ATR.
    // При padAtr === V34_ENTRY_ZONE_ATR_PAD выражение побитово совпадает с
    // продуктовым (это и проверяет assertHookParity).
    const pad = padAtr * ctx.atr;
    const low = ctx.baseLow - pad;
    const high = ctx.baseHigh + pad;
    const q = evaluateTargetQuality({
      direction: ctx.direction, entryLow: low, entryHigh: high,
      stop: ctx.stop, tp1: ctx.tp1, tp2: ctx.tp2,
    });
    const meta: Record<string, number | string | null> = {
      baseEntryZoneLow: ctx.baseLow, baseEntryZoneHigh: ctx.baseHigh,
      entryZonePad: pad, atr1h: ctx.atr,
      entryReference: q.entryReference, initialRisk: q.initialRisk,
      targetQualityTp1R: q.tp1R, targetQualityTp2R: q.tp2R,
      targetQualityRejectReason: q.reason,
    };
    return q.accepted
      ? { low, high, meta }
      : { low, high, meta, rejectReason: q.reason!, rejectNote: q.reason! };
  };
}

/** Локальный hook при 0.25 обязан совпадать с продуктовым по уровням и вердикту. */
function assertHookParity(): void {
  const cases = [
    { direction: 'LONG' as const, baseLow: 990, baseHigh: 1010, atr: 100, close: 1000, stop: 900, tp1: 1110, tp2: 1250 },
    { direction: 'SHORT' as const, baseLow: 990, baseHigh: 1010, atr: 100, close: 1000, stop: 1100, tp1: 890, tp2: 750 },
    { direction: 'SHORT' as const, baseLow: 84154.2, baseHigh: 84245.9, atr: 458.5, close: 84200.05, stop: 84911.8, tp1: 84104.5, tp2: 82563 },
    { direction: 'LONG' as const, baseLow: 0.0000123, baseHigh: 0.00001238, atr: 4e-7, close: 0.00001234, stop: 0.0000115, tp1: 0.00001297, tp2: 0.000014 },
  ];
  const local = makeHook(V34_ENTRY_ZONE_ATR_PAD);
  for (const c of cases) {
    const a = v34CorridorHook(c);
    const b = local(c);
    const same = a.low === b.low && a.high === b.high
      && (a.rejectReason ?? null) === (b.rejectReason ?? null)
      && (a.meta!.targetQualityTp1R ?? null) === (b.meta!.targetQualityTp1R ?? null)
      && (a.meta!.targetQualityTp2R ?? null) === (b.meta!.targetQualityTp2R ?? null);
    if (!same) {
      throw new Error(`hook parity FAILED at 0.25 для ${c.direction}: ${JSON.stringify({ a, b })}`);
    }
  }
}

/* ──────────────────────────────────────────────────────────── метрики ── */

const q = (xs: number[], p: number): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const i = (s.length - 1) * p;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return lo === hi ? s[lo]! : s[lo]! + (s[hi]! - s[lo]!) * (i - lo);
};
const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const f = (x: number | null, d = 3): string => (x === null ? '—' : x.toFixed(d));

interface PadStats {
  pad: number;
  total: number; publishable: number; filled: number; expiredNoFill: number;
  cancelledNoFill: number;
  reject: Record<string, number>;
  outcomes: Record<string, number>;
  r1: number[]; r2: number[];
  widthAtr: number[]; widthPct: number[];
  grossR: number[]; netR: number[];
  expansionOnlyFills: { outcomes: Record<string, number>; grossR: number[]; netR: number[]; count: number };
  setupsAbsentInBaseline: number;
}

function blank(pad: number): PadStats {
  return {
    pad, total: 0, publishable: 0, filled: 0, expiredNoFill: 0, cancelledNoFill: 0,
    reject: {}, outcomes: {}, r1: [], r2: [], widthAtr: [], widthPct: [],
    grossR: [], netR: [],
    expansionOnlyFills: { outcomes: {}, grossR: [], netR: [], count: 0 },
    setupsAbsentInBaseline: 0,
  };
}

const bump = (m: Record<string, number>, k: string) => { m[k] = (m[k] ?? 0) + 1; };

function collect(st: PadStats, recs: readonly ReplayRecord[], baselineFilled: Map<number, boolean>): void {
  for (const r of recs) {
    st.total++;
    const reason = (r.meta?.targetQualityRejectReason ?? null) as string | null;
    if (reason) bump(st.reject, reason);
    if (r.publishable) st.publishable++;

    const atr = r.meta?.atr1h as number | undefined;
    const width = r.entryZone[1] - r.entryZone[0];
    if (atr && atr > 0) st.widthAtr.push(width / atr);
    const mid = (r.entryZone[0] + r.entryZone[1]) / 2;
    if (mid > 0) st.widthPct.push((width / mid) * 100);

    const t1 = r.meta?.targetQualityTp1R as number | null | undefined;
    const t2 = r.meta?.targetQualityTp2R as number | null | undefined;
    if (!reason && typeof t1 === 'number' && Number.isFinite(t1)) st.r1.push(t1);
    if (!reason && typeof t2 === 'number' && Number.isFinite(t2)) st.r2.push(t2);

    if (r.fill) {
      st.filled++;
      const ex = r.outcome?.exitReason ?? 'OPEN';
      bump(st.outcomes, ex);
      if (typeof r.outcome?.grossR === 'number') st.grossR.push(r.outcome.grossR);
      if (typeof r.outcome?.netR === 'number') st.netR.push(r.outcome.netR);

      // Expansion-only fill: базовый коридор V3.3 на этом же сетапе НЕ дал фила.
      const base = baselineFilled.get(r.setupOpenTime);
      if (base === undefined) st.setupsAbsentInBaseline++;
      else if (base === false) {
        st.expansionOnlyFills.count++;
        bump(st.expansionOnlyFills.outcomes, ex);
        if (typeof r.outcome?.grossR === 'number') st.expansionOnlyFills.grossR.push(r.outcome.grossR);
        if (typeof r.outcome?.netR === 'number') st.expansionOnlyFills.netR.push(r.outcome.netR);
      }
    } else if (r.outcome?.status === 'EXPIRED') st.expiredNoFill++;
    else if (r.outcome?.status === 'CANCELLED') st.cancelledNoFill++;
  }
}

/* ─────────────────────────────────────────────────────────────── main ── */

function main(): void {
  assertHookParity();
  console.log('hook parity @ 0.25 ATR: OK (локальный hook ≡ продуктовый v34CorridorHook)\n');

  const stats = new Map<number, PadStats>(PADS.map((p) => [p, blank(p)]));
  const mech = {
    baseTotal: 0, basePublishable: 0, baseFilled: 0, baseExpired: 0, baseNoFillOther: 0,
    filledOnNextBar: 0, filledAtNextOpen: 0, filledAtWorstEdge: 0,
    comparedFills: 0, fillPriceChanged: 0, fillBarChanged: 0,
    slippageR: [] as number[], changedDetail: [] as string[],
  };
  let bars1h = 0, bars4h = 0;
  let firstTs = Infinity, lastTs = -Infinity;

  for (const symbol of SYMBOLS) {
    const h1 = loadSeries(symbol, '1h');
    const h4 = loadSeries(symbol, '4h');
    bars1h += h1.length; bars4h += h4.length;
    firstTs = Math.min(firstTs, h1[0]!.openTime);
    lastTs = Math.max(lastTs, h1[h1.length - 1]!.openTime);
    console.error(`${symbol}: 1h=${h1.length} 4h=${h4.length}`);

    // Эталон для expansion-only: ЧИСТЫЙ коридор V3.3 без фильтра качества.
    const baseRun = runV33LiveReplay({ symbol, h1, h4 });
    const baselineFilled = new Map<number, boolean>(
      baseRun.records.map((r) => [r.setupOpenTime, r.fill !== null]),
    );

    // ── Механика коридора: почему расширение может/не может добавить фил ──
    const byTime1h = new Map(h1.map((c, i) => [c.openTime, i]));
    for (const r of baseRun.records) {
      mech.baseTotal++;
      if (r.publishable) mech.basePublishable++;
      if (r.fill) {
        mech.baseFilled++;
        const si = byTime1h.get(r.setupOpenTime);
        const next = si !== undefined ? h1[si + 1] : undefined;
        if (next && r.fill.barOpenTime === next.openTime) mech.filledOnNextBar++;
        if (next && Math.abs(r.fill.price - next.open) < 1e-12) mech.filledAtNextOpen++;
        const worst = r.direction === 'LONG' ? r.entryZone[1] : r.entryZone[0];
        if (Math.abs(r.fill.price - worst) < 1e-12) mech.filledAtWorstEdge++;
      } else if (r.outcome?.status === 'EXPIRED') mech.baseExpired++;
      else mech.baseNoFillOther++;
    }

    const perPadRecs = new Map<number, ReplayRecord[]>();
    for (const pad of PADS) {
      const out = runV33LiveReplay({ symbol, h1, h4, corridor: makeHook(pad) });
      perPadRecs.set(pad, out.records);
      collect(stats.get(pad)!, out.records, baselineFilled);
    }
    // Изменилась ли ФАКТИЧЕСКАЯ цена входа от расширения (0.00 → max pad)?
    const lo = new Map((perPadRecs.get(PADS[0]!) ?? []).map((r) => [r.setupOpenTime, r]));
    for (const r of perPadRecs.get(PADS[PADS.length - 1]!) ?? []) {
      const a = lo.get(r.setupOpenTime);
      if (!a || !a.fill || !r.fill) continue;
      mech.comparedFills++;
      if (Math.abs(a.fill.price - r.fill.price) > 1e-12) {
        mech.fillPriceChanged++;
        const risk = Math.abs(a.fill.price - a.stop);
        const worse = r.direction === 'LONG' ? r.fill.price - a.fill.price : a.fill.price - r.fill.price;
        mech.slippageR.push(risk > 0 ? worse / risk : 0);
        mech.changedDetail.push(
          `${symbol} ${new Date(r.setupOpenTime).toISOString().slice(0, 16)} ${r.direction} ` +
          `${a.fill.price} → ${r.fill.price} (${worse > 0 ? 'хуже' : 'лучше'}, ` +
          `${((worse / (risk || 1)) * 100).toFixed(2)} % R) ` +
          `исход ${a.outcome?.exitReason ?? a.outcome?.status} → ${r.outcome?.exitReason ?? r.outcome?.status}`,
        );
      }
      if (a.fill.barOpenTime !== r.fill.barOpenTime) mech.fillBarChanged++;
    }
  }

  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  console.log('════════════════════════════════════════════════════════════════');
  console.log('V3.4 ENTRY EXPANSION SENSITIVITY AUDIT — READ ONLY');
  console.log('════════════════════════════════════════════════════════════════');
  console.log(`Датасет     : svechnoy-suslik-binance-data @ c3c1dce (Binance Spot, реальные klines)`);
  console.log(`Символы     : ${SYMBOLS.join(', ')}`);
  console.log(`Период      : ${iso(firstTs)} … ${iso(lastTs)}`);
  console.log(`Баров       : 1h=${bars1h}  4h=${bars4h}`);
  console.log(`Стратегия   : ${V34_STRATEGY_ID}, пороги качества TP1≥${V34_TP1_MIN_R}R TP2≥${V34_TP2_MIN_R}R`);
  console.log(`Текущее prod-значение отступа: ${V34_ENTRY_ZONE_ATR_PAD} ATR (НЕ меняется этим скриптом)\n`);

  const rows: any[] = [];
  for (const pad of PADS) {
    const s = stats.get(pad)!;
    rows.push({
      pad, total: s.total, publishable: s.publishable,
      publishablePct: s.total ? (s.publishable / s.total) * 100 : null,
      filled: s.filled, fillPct: s.total ? (s.filled / s.total) * 100 : null,
      fillOfPublishablePct: s.publishable ? (s.filled / s.publishable) * 100 : null,
      expiredNoFill: s.expiredNoFill, cancelledNoFill: s.cancelledNoFill,
      reject: s.reject, outcomes: s.outcomes,
      r1: { p25: q(s.r1, 0.25), med: q(s.r1, 0.5), p75: q(s.r1, 0.75), n: s.r1.length },
      r2: { p25: q(s.r2, 0.25), med: q(s.r2, 0.5), p75: q(s.r2, 0.75), n: s.r2.length },
      widthAtrMed: q(s.widthAtr, 0.5), widthPctMed: q(s.widthPct, 0.5),
      grossAvg: mean(s.grossR), grossMed: q(s.grossR, 0.5), netAvg: mean(s.netR), netMed: q(s.netR, 0.5),
      closed: s.grossR.length,
      expOnly: {
        count: s.expansionOnlyFills.count,
        outcomes: s.expansionOnlyFills.outcomes,
        grossAvg: mean(s.expansionOnlyFills.grossR),
        netAvg: mean(s.expansionOnlyFills.netR),
        n: s.expansionOnlyFills.grossR.length,
      },
      setupsAbsentInBaseline: s.setupsAbsentInBaseline,
    });
  }

  const OUTCOME_KEYS = ['TP2', 'TP1_THEN_BE', 'TP1_THEN_SL', 'TP1_THEN_TIMEOUT', 'SL', 'TIMEOUT'];
  const p = (n: number, w: number) => String(n).padStart(w);
  const ps = (x: string, w: number) => x.padStart(w);

  const line = (label: string, get: (r: any) => string) =>
    console.log(label.padEnd(26) + rows.map((r) => ps(get(r), 10)).join(''));

  console.log('── ВОРОНКА ──────────────────────────────────────────────────────');
  console.log('ATR / сторона'.padEnd(26) + rows.map((r) => ps(r.pad.toFixed(2), 10)).join(''));
  line('TOTAL SETUPS', (r) => String(r.total));
  line('PUBLISHABLE', (r) => String(r.publishable));
  line('PUBLISHABLE %', (r) => f(r.publishablePct, 1));
  line('FILLED', (r) => String(r.filled));
  line('FILL % (от всех)', (r) => f(r.fillPct, 1));
  line('FILL % (от publishable)', (r) => f(r.fillOfPublishablePct, 1));
  line('EXPIRED без fill', (r) => String(r.expiredNoFill));
  line('CANCELLED без fill', (r) => String(r.cancelledNoFill));

  console.log('\n── ПРИЧИНЫ ОТКАЗА ───────────────────────────────────────────────');
  for (const k of ['GEOMETRY_INVALID', 'ENTRY_ZONE_CROSSES_STOP', 'TARGET_QUALITY_TP1', 'TARGET_QUALITY_TP2']) {
    line(k, (r) => String(r.reject[k] ?? 0));
  }

  console.log('\n── ИСХОДЫ СДЕЛОК ────────────────────────────────────────────────');
  for (const k of OUTCOME_KEYS) line(k, (r) => String(r.outcomes[k] ?? 0));
  const known = new Set(OUTCOME_KEYS);
  const others = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r.outcomes)) if (!known.has(k)) others.add(k);
  for (const k of [...others].sort()) line(`${k} (прочее)`, (r) => String(r.outcomes[k] ?? 0));

  console.log('\n── КАЧЕСТВО ЦЕЛЕЙ У ПРИНЯТЫХ СЕТАПОВ ────────────────────────────');
  line('R1 p25', (r) => f(r.r1.p25));
  line('R1 median', (r) => f(r.r1.med));
  line('R1 p75', (r) => f(r.r1.p75));
  line('R2 p25', (r) => f(r.r2.p25));
  line('R2 median', (r) => f(r.r2.med));
  line('R2 p75', (r) => f(r.r2.p75));

  console.log('\n── ШИРИНА ЗОНЫ ВХОДА ────────────────────────────────────────────');
  line('median ATR', (r) => f(r.widthAtrMed));
  line('median %', (r) => f(r.widthPctMed, 4));

  console.log('\n── РЕЗУЛЬТАТ ЗАКРЫТЫХ СДЕЛОК ────────────────────────────────────');
  line('closed n', (r) => String(r.closed));
  line('avg gross R', (r) => f(r.grossAvg, 4));
  line('median gross R', (r) => f(r.grossMed, 4));
  line('avg net R (expectancy)', (r) => f(r.netAvg, 4));
  line('median net R', (r) => f(r.netMed, 4));

  console.log('\n── EXPANSION-ONLY FILLS (нет фила у базового коридора V3.3) ─────');
  line('count', (r) => String(r.expOnly.count));
  for (const k of OUTCOME_KEYS) line(`  ${k}`, (r) => String(r.expOnly.outcomes[k] ?? 0));
  line('  avg gross R', (r) => f(r.expOnly.grossAvg, 4));
  line('  avg net R', (r) => f(r.expOnly.netAvg, 4));
  line('сетапов вне baseline', (r) => String(r.setupsAbsentInBaseline));

  const pc = (a: number, b: number) => (b ? ((a / b) * 100).toFixed(2) + ' %' : '—');
  console.log('\n── МЕХАНИКА КОРИДОРА (чистая V3.3, без фильтра качества) ────────');
  console.log(`  сетапов                         ${mech.baseTotal}`);
  console.log(`  publishable (геометрия V3.3)    ${mech.basePublishable}  (${pc(mech.basePublishable, mech.baseTotal)})`);
  console.log(`  исполнено                       ${mech.baseFilled}`);
  console.log(`  истекло без фила                ${mech.baseExpired}`);
  console.log(`  без фила по иной причине        ${mech.baseNoFillOther}`);
  console.log(`  фил на СЛЕДУЮЩЕМ баре           ${mech.filledOnNextBar}  (${pc(mech.filledOnNextBar, mech.baseFilled)})`);
  console.log(`  фил ровно по open след. бара    ${mech.filledAtNextOpen}  (${pc(mech.filledAtNextOpen, mech.baseFilled)})`);
  console.log(`  фил по ХУДШЕЙ границе коридора  ${mech.filledAtWorstEdge}  (${pc(mech.filledAtWorstEdge, mech.baseFilled)})`);
  console.log(`\n  сравнение ${PADS[0]!.toFixed(2)} ATR ↔ ${PADS[PADS.length - 1]!.toFixed(2)} ATR на общих сетапах:`);
  console.log(`  сопоставлено филов              ${mech.comparedFills}`);
  console.log(`  изменилась ЦЕНА входа           ${mech.fillPriceChanged}  (${pc(mech.fillPriceChanged, mech.comparedFills)})`);
  if (mech.changedDetail.length) {
    const avg = mech.slippageR.reduce((a, b) => a + b, 0) / mech.slippageR.length;
    console.log(`  средний сдвиг входа            ${(avg * 100).toFixed(2)} % R (плюс = хуже)`);
    for (const d of mech.changedDetail) console.log(`    · ${d}`);
  }
  console.log(`  изменился БАР входа             ${mech.fillBarChanged}  (${pc(mech.fillBarChanged, mech.comparedFills)})`);

  console.log('\nПримечание: ни одна константа не изменена. Выбор параметра — решение человека.');
  void p;

  if (JSON_OUT) {
    fs.writeFileSync(JSON_OUT, JSON.stringify({
      dataset: { repo: 'svechnoy-suslik-binance-data', commit: 'c3c1dcecfe2784a147f591f2b5b4526cbf99df9f' },
      symbols: SYMBOLS, from: iso(firstTs), to: iso(lastTs), bars1h, bars4h, rows,
    }, null, 2));
    console.log(`\nJSON: ${JSON_OUT}`);
  }
}

main();
